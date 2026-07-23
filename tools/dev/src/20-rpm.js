// 20-rpm — the synthesized gear-aware RPM model + per-frame tick.
let g_rpm = 0.15, g_load = 0, g_pitch = 1.0, g_vol = 1.0, g_cutoff = 1.0, g_gear = 0, g_gameRpm = 0, g_gameLoad = 0;
let g_speed = 0, g_throttle = 0, g_modelRpm = 0, g_gsig = 0, g_powerCoef = 1.0;   // g_gsig = shift signal; g_powerCoef = L-range mult (TA+0x38)
// distrib(g) = the stock box's redline signal for gear g = (0.9*cap[g] + 2.0) * avgWheelRadius (decompiled).
function distribFor(g, caps, avgR) { if (!caps || avgR <= 1e-3) return 0; const i = clamp(g > 0 ? g : 0, 0, caps.length - 1); return (0.9 * caps[i] + 2.0) * avgR; }
let g_prevAngle = null, g_wheelRate = 0;   // wheel angular velocity (rad/s) from angle differentiation
let g_caps = null, g_capSpeed = 0, g_wav = 0, g_radius = 0.53, g_redlineMps = 0;   // g_wav = island angvel (arbitrary units, ~3x tire); g_radius per-truck; g_redlineMps = redline speed
let g_avgR = 0;   // game's avgWheelRadius = SUM(w110*w94)/SUM(w110); the radius factor in distrib(g) (per-truck, static)
const g_redlineByGear = {};   // gear -> distrib(gear) fetched straight from the game (hi_GetGearData); per-truck exact
let g_ggLastGear = -99, g_ggAt = 0;   // throttle the game-fn call: on gear change + every 500ms
let g_engineOn = true;   // from Vehicle+0x768 (q_VehStateFlags) bit0
let g_inTruck = false;   // vehicle pointer resolves = player is in a truck (gauges hidden otherwise)
let g_idleEff = 0.15;    // idle floor incl. idle-hunt wobble -> telemetry rpmIdle (+124)
let g_gearMax = 0;       // top forward gear -> telemetry gearMax (+112); vector count preferred, caps fallback
// redline tire-angvel for a gear = redline_speed(gear) / radius. Empirically the game upshifts
// g->g+1 at ground speed ~= cap[gear+1] (reference/drivetrain-rpm-empirical.md), so redline_speed
// for a non-top gear is cap[gear+1]; the TOP gear has no next real gear (cap[gear+1] is the special
// HIGH cap) so it redlines at its OWN cap[gear] (the truck's absolute top ~= cap[maxG]).
function redlineFor(gear, caps) {
  if (!caps || gear < 0 || gear >= caps.length) return null;
  const maxG = caps.length - 1;
  // forward gear g redlines at the NEXT gear's cap (upshift point thrUp ~= cap[g+1], decompiled);
  // reverse (0) and top gear have no real next cap -> use their own. wheel-angvel = cap / tire radius.
  const nc = (gear >= 1 && gear < maxG) ? caps[gear + 1] : caps[gear];
  return nc / g_radius;
}
const learned = {}; let prevGear = 0;
let g_rgear = 0, g_rgearPend = 0, g_rgearAt = 0, g_rpmPrevGear = 0;   // debounced gear feeding the RPM redline
function topSpeed(g) {
  if (CFG.learn && learned[g]) return learned[g];                 // measured shift speed = the real cap
  if (CFG.learn && learned[g - 1]) return learned[g - 1] * 1.28;  // extrapolate top gear from prior gear
  const i = Math.min(Math.abs(g), CFG.gearTop.length - 1); return CFG.gearTop[i];
}
// dt-corrected smoothing: CFG smoothing constants are tuned as per-50ms factors; convert to
// the actual elapsed dt so the FEEL is identical at any tick rate (tick now runs ~120Hz).
let g_lastTickAt = 0, g_tickN = 0;   // g_tickN: ticks since last TEL line (rate check)
function smoothK(per50ms, dtMs) { return 1 - Math.pow(1 - per50ms, dtMs / 50); }
// The gear's redline wheel angular velocity (rad/s) = thrUp = 2*cap[gear] + 5.0, scaled by PowerCoef
// (L/L+/L- low range, TA+0x38). SINGLE SOURCE OF TRUTH -- used by both the RPM tick and the auto-box so
// the box shifts on exactly the RPM the player hears. (2.0/5.0 are the game's own thrUp constants.)
function redlineWavFor(caps, gear, ta) {
  if (!caps || !caps.length) return 0;
  const idx = clamp(gear > 0 ? gear : 0, 0, caps.length - 1);
  let pc = 1.0; if (ta) { const p = rf(ta.add(0x38)); if (p !== null && p > 0.05 && p <= 2.0) pc = p; }
  return (2.0 * caps[idx] + 5.0) * pc;
}
function tick() {
  const now = Date.now();
  const dtMs = clamp(g_lastTickAt ? now - g_lastTickAt : 50, 4, 100);
  g_lastTickAt = now; g_tickN++;
  const v = vehicle();
  if (!v) { g_inTruck = false; shmWrite(); return; }   // menus/map: still publish (inTruck=0 hides gauges)
  const ta = rptr(v.add(0x68)); if (!ta) { g_inTruck = false; shmWrite(); return; }
  g_inTruck = true;
  const gear = ri(ta.add(0x70)) || 0, accel = Math.abs(rf(ta.add(0x44)) || 0), speed = speedOf(v);
  const caps = gearCaps(ta); g_caps = caps;
  g_gearMax = gearMaxOf(ta) || (caps ? caps.length - 1 : 0);
  const wp = wheelPhys(v);          // TRUE per-wheel tire angvel (physics wheel +0x174), spinning-cluster
  g_wav = wp ? wp.wav : 0;          // rad/s, wheelspin-aware, rests at 0 -- the RPM numerator
  const wlin = wp ? wp.lin : 0;     // wheels' own ground/contact speed (+0x170)
  if (wp && wp.gr > 1e-3) g_avgR = g_avgR > 1e-3 ? g_avgR * 0.9 + wp.gr * 0.1 : wp.gr;   // static per truck; light smooth to reject transients
  const gsig = gameShiftSignal(v); g_gsig = gsig === null ? g_gsig : gsig;   // the game's own shift signal (compared to distrib(gear))
  const gtorque = rf(ta.add(0xb4));
  g_gameLoad = (gtorque !== null && gtorque >= 0 && gtorque <= 1.5) ? gtorque : g_gameLoad;
  // per-truck wheel RADIUS from the two physics fields while GRIPPING: radius = wheel_ground_speed / tire_angvel
  if (g_wav > 1 && wlin > 0.8) { const rad = wlin / g_wav; if (rad > 0.2 && rad < 1.2) { const kr = smoothK(0.05, dtMs); g_radius = g_radius * (1 - kr) + rad * kr; } }
  prevGear = gear;
  // Gear debounce for RPM: a changed gear must persist CFG.rpmDebounceMs before the RPM adopts it, so a
  // transient read (mid-shift neutral flicker / 1-frame glitch / instantly-reversed hunt) can't blip pitch.
  // Raw `gear` still drives telemetry/HUD/autoShift; only the RPM redline uses the debounced value.
  if (gear === g_rgear) g_rgearPend = gear;
  else if (gear !== g_rgearPend) { g_rgearPend = gear; g_rgearAt = now; }
  else if (now - g_rgearAt >= (CFG.rpmDebounceMs || 0)) g_rgear = gear;
  const rgear = g_rgear;
  const idle = 0.15;
  try { g_engineOn = (v.add(0x768).readU32() & 1) === 1; } catch (e) {}   // Vehicle+0x768 = q_VehStateFlags; bit0 = engine running
  let target;
  if (!g_engineOn) {
    target = 0;                                       // engine off -> tach reads 0 (no idle floor)
  } else if (rgear === 0) {
    target = clamp(idle + accel * CFG.revThrottle * (1 - idle), idle, 1.0); g_capSpeed = 0;   // neutral: throttle revs
  } else if (caps) {                              // GAME-DERIVED redline in WHEEL-ANGVEL units -- no radius, no scale
    const idx = clamp(rgear > 0 ? rgear : 0, 0, caps.length - 1);   // reverse -> index 0
    // Redline = thrUp(gear) = 2*cap[gear] + 5.0 (rad/s). CONFIRMED: hi_GetGearData computes thrUp = 2*cap + ed00
    // (ed00=5.0 from binary), and hi_DrivetrainUpdate_ApplyGear uses thrUp as the UPPER edge of the engine
    // torque hump, compared against WHEEL ANGVEL (+0x16c) -- power falls to 0 at thrUp = redline. Those are the
    // SAME rad/s units as our g_wav, so RPM = wav / thrUp directly: no radius, no ground speed, no per-truck
    // scale factor. Validated on two trucks (radius 0.74 & 0.51, caps [0.5..3.5] & [1.5..10]): wav ~= thrUp at
    // every upshift. The 2.0/5.0 are the game's own constants (shared code -> hold for every truck). PowerCoef
    // (TA+0x38) scales thrUp for low gear but is 1.0 for normal gears.
    // PowerCoef (TA+0x38) is the L / L+ / L- low-range multiplier; the game scales thrUp by it in
    // hi_DrivetrainUpdate_ApplyGear, so L gear (gear 1 @ PowerCoef 0.45) redlines at 45% of the wheel
    // speed -> higher RPM per wav = a genuine lower-than-1 ratio. 1.0 for normal gears.
    const pc = rf(ta.add(0x38)); g_powerCoef = (pc !== null && pc > 0.05 && pc <= 2.0) ? pc : 1.0;   // for TEL
    const redlineWav = redlineWavFor(caps, rgear, ta);    // rad/s -- SAME redline the auto-box shifts on
    g_capSpeed = redlineWav;
    g_redlineMps = redlineWav * g_radius;        // display only: redline expressed back in m/s
    // Pure wheel angular velocity over the redline: a stuck wheel spinning at a standstill has high g_wav and
    // therefore high RPM, with no wheelspin special-case -- it just falls out of the formula.
    target = clamp(g_wav / redlineWav, idle, CFG.overRev);
  } else {
    target = clamp(speed / topSpeed(gear), idle, 1.0);
  }
  // idle hunt: subtle two-sine wobble around the idle floor while the engine idles (off when engine off)
  g_idleEff = g_engineOn
    ? idle + CFG.idleHunt * (0.7 * Math.sin(now / 1000 * 2 * Math.PI * 1.3) + 0.4 * Math.sin(now / 1000 * 2 * Math.PI * 3.7))
    : idle;
  if (g_engineOn && target <= idle + 0.02) target = g_idleEff;
  const gearChanged = (rgear !== g_rpmPrevGear);   // snap only on the DEBOUNCED gear change
  g_rpmPrevGear = rgear;
  g_rpm += (target - g_rpm) * (gearChanged ? 0.9 : smoothK(CFG.rpmSmooth, dtMs));   // snap the drop at a shift, else smooth
  const targetLoad = (CFG.useGameLoad && gtorque !== null && gtorque >= 0 && gtorque <= 1.5)
    ? gtorque                                                  // real engine torque/load from the game
    : clamp(accel * (0.55 + 0.6 * (1 - g_rpm)), 0, 1);         // fallback throttle model
  g_load += (targetLoad - g_load) * smoothK(CFG.loadSmooth, dtMs);
  g_pitch = clamp(CFG.idlePitch + g_rpm * (CFG.redlinePitch - CFG.idlePitch), 0.5, 1.8);
  g_vol = clamp((CFG.volBase + CFG.volRpm * g_rpm + CFG.volLoad * g_load) * CFG.masterVol, 0, 3);
  g_cutoff = clamp(CFG.filterBase + CFG.loadBright * g_load, 0.05, 1.0);
  g_gear = gear; g_speed = speed; g_throttle = accel;
  g_modelRpm = gear === 0 ? idle : clamp(speed / topSpeed(gear), idle, 1.0);   // gear-aware speed model (reference)
  const ang = wheelAngle(v);                    // differentiate wheel angle -> angular velocity (rad/s)
  if (ang !== null) {
    if (g_prevAngle !== null) {
      let d = ang - g_prevAngle;
      if (d > 3.14159) d -= 6.28318; else if (d < -3.14159) d += 6.28318;   // unwrap
      const rate = Math.abs(d) / (dtMs / 1000);
      const kw = smoothK(0.5, dtMs);
      g_wheelRate = g_wheelRate * (1 - kw) + rate * kw;
    }
    g_prevAngle = ang;
  }
  autoShift(v, ta, gear, caps, accel, speed);   // our auto-box (no-op unless g_shiftMode==='ours')
  if (g_inTruck && caps) {                       // CSV trace row for offline model fitting (rpm.csv)
    const distG = distribFor(gear, caps, g_avgR), distNext = distribFor(gear + 1, caps, g_avgR);
    csv([now, gear, (ri(ta.add(0x74)) || 0), speed.toFixed(3), g_wav.toFixed(3), (g_wav * g_radius).toFixed(3),
         g_radius.toFixed(3), g_avgR.toFixed(3), g_gsig.toFixed(3), Math.abs(g_gsig).toFixed(3),
         g_redlineMps.toFixed(3), distG.toFixed(3), distNext.toFixed(3), g_rpm.toFixed(3),
         g_engineOn ? 1 : 0, '"' + caps.map(function (c) { return c.toFixed(2); }).join(' ') + '"'].join(','));
  }
  shmWrite();                                   // publish this tick's coherent snapshot (60-shm.js)
}

