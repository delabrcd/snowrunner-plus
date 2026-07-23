// 30-gearbox — input layer (keyboard + XInput binds), manual shift, special gears, and
// our RPM-scheduled auto-box.
//
// ACTIONS/BINDS (mirrors mod/src/telemetry.h SrdtAction): 0 shiftUp, 1 shiftDown,
// 2 modeCycle, 3 clutch, 4 neutral, 5 lowGear, 6 highGear, 7 reserved. Two binds per
// action, each word = (type<<16)|code: type 0 = unbound, 1 = keyboard VK
// (GetAsyncKeyState), 2 = XInput button (code = bit index in XINPUT_GAMEPAD.wButtons).
// Keyboard defaults ] [ \ V; the in-game config UI overrides them live via the SRDC v2
// shm block (60-shm.js shmReadCfg). While the user is rebinding in the overlay
// (g_ovlCfgOpen, SRDC flags bit0) every action is swallowed.
//
// g_shiftMode: 'game' = stock auto | 'ours' = our RPM-scheduled auto-box | 'manual' = hold gear.
// modePolicy (SRDC flags bits 4-5): 0 = free cycling via modeCycle; 1/2/3 = pin ours/manual/game.
//
// SPECIAL GEARS (evidence: SMGM working mod + current-build decompile @0xc404f0 ApplyGear,
// @0xd72300 GetMaxGear, @0xd72640 gear-param lookup — see reference/):
//   HIGH = write gear maxG+1 (the caps vector ta+0x58..0x60 is [R, g1..gN, high]; maxG = count-2;
//          ApplyGear special-cases commanded == GetMaxGear()+1, high AngVel = caps[maxG+1]).
//   LOW  = gear 1 with PowerCoef (ta+0x38) = 0.45 (game L; L+ = 1.0, L- = 0.2 per SMGM).
//          The coef is restored to 1.0 on any other shift we make.
const ACT_UP = 0, ACT_DN = 1, ACT_MODE = 2, ACT_CLUTCH = 3, ACT_NEUTRAL = 4, ACT_LOW = 5, ACT_HIGH = 6, ACT_N = 8;
const BIND_DEF = [0x100DD, 0x100DB, 0x100DC, 0x10056, 0, 0, 0, 0];   // slot-0 keyboard defaults: ] [ \ V
const BINDS = BIND_DEF.map(function (b) { return [b, 0]; });
let g_getKey = null;
try { g_getKey = new NativeFunction(Module.getExportByName('user32.dll', 'GetAsyncKeyState'), 'int16', ['int'], 'win64'); } catch (e) {}
function keyDown(vk) { try { return g_getKey ? ((g_getKey(vk) & 0x8000) !== 0) : false; } catch (e) { return false; } }
// ---- XInput pad: controller 0, polled once per pollKeys pass ----
let g_xinput = null, g_xiState = null, g_xiButtons = 0;
function xinputInit() {
  for (const dll of ['xinput1_4.dll', 'xinput1_3.dll', 'xinput9_1_0.dll']) {
    try {
      g_xinput = new NativeFunction(Module.getExportByName(dll, 'XInputGetState'), 'uint32', ['uint32', 'pointer'], 'win64');
      g_xiState = Memory.alloc(16);            // XINPUT_STATE {u32 dwPacketNumber; XINPUT_GAMEPAD}
      out('XINPUT via ' + dll); return;
    } catch (e) {}
  }
  out('XINPUT unavailable (no xinput dll) — pad binds inert');
}
xinputInit();
function xiPoll() {
  if (!g_xinput) return;
  try { g_xiButtons = g_xinput(0, g_xiState) === 0 ? g_xiState.add(4).readU16() : 0; } catch (e) { g_xiButtons = 0; }
}
function bindDown(b) {
  const t = b >>> 16, c = b & 0xffff;
  if (t === 1) return keyDown(c);
  if (t === 2) return ((g_xiButtons >>> c) & 1) !== 0;
  return false;
}
function actDown(a) { return bindDown(BINDS[a][0]) || bindDown(BINDS[a][1]); }
let g_ovlCfgOpen = false;
const g_actPrev = [false, false, false, false, false, false, false, false];   // per-action previous state (edge detection)
let g_clutched = false, g_selGear = 1;   // clutch: hold = neutral; up/dn pick g_selGear; release applies it
let g_muteShiftUntil = 0;                // brief window after the fake shift-to-N: 40-audio mutes the clunk
let g_shiftMode = 'game';
let g_holdUntil = 0;   // no auto-box decisions before this time (post-shift hold / manual nudge)
let g_selNeutral = false;    // player selected neutral (telemetry flags bit5); cleared by any engagement
let g_lowCoef = false;       // we set the low-gear PowerCoef -> restore 1.0 on the next shift
let g_modePolicy = 0, g_lastPolicy = -1, g_polShiftLogged = false, g_polModeLogged = false;
function clearLowCoef(ta) { if (!g_lowCoef) return; g_lowCoef = false; try { ta.add(0x38).writeFloat(1.0); } catch (e) {} }
function manualShift(v, ta, d) {
  if (g_modePolicy === 3) { if (!g_polShiftLogged) { g_polShiftLogged = true; out('SHIFT keys ignored (policy: stock auto)'); } return; }
  const cur = ri(ta.add(0x70)) || 0;
  const maxG = gearMaxOf(ta) || (gearCaps(ta) ? gearCaps(ta).length - 1 : 8);
  const g = clamp(cur + d, 1, maxG);   // sequential forward 1..maxG (reverse stays on the game's own keys)
  try {
    ta.add(0x3c).writeU8(0); callSetGear(v, g);   // game's shifter -> clutch-out / torque-cut
    clearLowCoef(ta); g_selNeutral = false;
    if (g_shiftMode === 'game') g_shiftMode = 'manual';               // in 'ours', a key shift is a nudge: auto pauses then resumes
    g_holdUntil = Date.now() + (g_shiftMode === 'ours' ? CFG.nudgeHoldMs : 0);
    out('SHIFT key ' + (d > 0 ? 'up' : 'dn') + ' ' + cur + '->' + g + ' (' + g_shiftMode + ')');
  } catch (e) {}
}
function cycleMode(ta) {
  if (g_modePolicy !== 0) { if (!g_polModeLogged) { g_polModeLogged = true; out('MODE cycle ignored (policy=' + g_modePolicy + ')'); } return; }
  g_shiftMode = g_shiftMode === 'ours' ? 'game' : 'ours';   // game/manual -> ours, ours -> game
  try { ta.add(0x3c).writeU8(g_shiftMode === 'game' ? 1 : 0); } catch (e) {}
  g_holdUntil = Date.now() + CFG.shiftHoldMs;
  out('SHIFT mode -> ' + g_shiftMode);
}
// neutral action: manual/ours only — park the box in N until the next engagement
function selectNeutral(v, ta) {
  if (g_shiftMode === 'game') { out('NEUTRAL ignored (stock-auto mode)'); return; }
  try {
    ta.add(0x3c).writeU8(0); callSetGear(v, 0);
    clearLowCoef(ta); g_selNeutral = true;
    g_holdUntil = Date.now() + CFG.shiftHoldMs;
    out('NEUTRAL selected');
  } catch (e) {}
}
// HIGH gear: commanded = maxG+1 (the game's own special value, see header evidence)
function gearHigh(v, ta) {
  if (g_modePolicy === 3) { if (!g_polShiftLogged) { g_polShiftLogged = true; out('SHIFT keys ignored (policy: stock auto)'); } return; }
  const maxG = gearMaxOf(ta);
  if (!maxG) { out('GEAR H: gear vector unreadable'); return; }
  try {
    ta.add(0x3c).writeU8(0); callSetGear(v, maxG + 1);
    clearLowCoef(ta); g_selNeutral = false;
    if (g_shiftMode === 'game') g_shiftMode = 'manual';
    g_holdUntil = Date.now() + (g_shiftMode === 'ours' ? CFG.nudgeHoldMs : CFG.shiftHoldMs);
    out('GEAR H -> ' + (maxG + 1) + ' (maxG=' + maxG + ')');
  } catch (e) {}
}
// LOW gear: gear 1 + PowerCoef 0.45 (SMGM encoding; restored to 1.0 by clearLowCoef)
function gearLow(v, ta) {
  if (g_modePolicy === 3) { if (!g_polShiftLogged) { g_polShiftLogged = true; out('SHIFT keys ignored (policy: stock auto)'); } return; }
  try {
    ta.add(0x3c).writeU8(0); callSetGear(v, 1);
    ta.add(0x38).writeFloat(0.45); g_lowCoef = true; g_selNeutral = false;
    if (g_shiftMode === 'game') g_shiftMode = 'manual';
    g_holdUntil = Date.now() + (g_shiftMode === 'ours' ? CFG.nudgeHoldMs : CFG.shiftHoldMs);
    out('GEAR L -> 1 @ PowerCoef 0.45');
  } catch (e) {}
}
// pin g_shiftMode per modePolicy; runs every pollKeys pass + logs on policy change
function applyModePolicy(ta) {
  if (g_modePolicy !== g_lastPolicy) {
    g_lastPolicy = g_modePolicy; g_polShiftLogged = g_polModeLogged = false;
    out('POLICY -> ' + ['free', 'ours', 'manual', 'game'][g_modePolicy]);
  }
  if (g_modePolicy === 1) { g_shiftMode = 'ours'; }                    // autoShift keeps IsInAutoMode=0
  else if (g_modePolicy === 2) { g_shiftMode = 'manual'; if (!g_clutched) { try { ta.add(0x3c).writeU8(0); } catch (e) {} } }
  else if (g_modePolicy === 3) { g_shiftMode = 'game'; if (!g_clutched) { try { ta.add(0x3c).writeU8(1); } catch (e) {} } }
}
let g_passiveInit = false;
function pollKeys() {
  shmReadCfg();                                  // adopt overlay binds/policy + config-open flag (60-shm.js)
  const v = vehicle(); if (!v) return; const ta = rptr(v.add(0x68)); if (!ta) return;
  if (CFG.boxPassive) {                          // hand the box back to the game: enable game auto ONCE, then never write
    if (!g_passiveInit) { try { ta.add(0x3c).writeU8(1); } catch (e) {} g_passiveInit = true; g_shiftMode = 'game'; out('BOX passive: control handed to game (autoMode=1)'); }
    return;
  }
  g_passiveInit = false;
  applyModePolicy(ta);
  xiPoll();
  const cur = []; for (let i = 0; i < ACT_N; i++) cur[i] = actDown(i);
  if (g_ovlCfgOpen) { for (let i = 0; i < ACT_N; i++) g_actPrev[i] = cur[i]; return; }   // rebinding in the overlay: swallow everything
  const edge = function (i) { return cur[i] && !g_actPrev[i]; };
  if (g_clutched) {                              // clutched: up/dn pick the gear to engage on release
    const maxG = gearMaxOf(ta) || (gearCaps(ta) ? gearCaps(ta).length - 1 : 8);
    if (edge(ACT_UP)) { g_selGear = clamp(g_selGear + 1, 1, maxG); playShiftSound(); out('CLUTCH select -> ' + g_selGear); }
    if (edge(ACT_DN)) { g_selGear = clamp(g_selGear - 1, 1, maxG); playShiftSound(); out('CLUTCH select -> ' + g_selGear); }
    if (edge(ACT_MODE)) cycleMode(ta);
  } else {
    if (edge(ACT_UP)) manualShift(v, ta, 1);
    if (edge(ACT_DN)) manualShift(v, ta, -1);
    if (edge(ACT_MODE)) cycleMode(ta);
    if (edge(ACT_NEUTRAL)) selectNeutral(v, ta);
    if (edge(ACT_LOW)) gearLow(v, ta);
    if (edge(ACT_HIGH)) gearHigh(v, ta);
  }
  for (let i = 0; i < ACT_N; i++) g_actPrev[i] = cur[i];
  const cl = cur[ACT_CLUTCH];                    // clutch: hold = neutral (free-rev), release = engage g_selGear
  if (cl && !g_clutched) {
    g_clutched = true;
    g_selGear = ri(ta.add(0x70)) || 1;           // start from the gear we're in
    g_muteShiftUntil = Date.now() + 400;         // hide the fake shift-to-N clunk
    try { ta.add(0x3c).writeU8(0); callSetGear(v, 0); out('CLUTCH in (holding gear ' + g_selGear + ')'); } catch (e) {}
  } else if (!cl && g_clutched) {
    g_clutched = false;
    try {
      callSetGear(v, g_selGear);                 // engage whatever the driver selected (game shifter -> clutch-cut)
      clearLowCoef(ta); g_selNeutral = false;
      if (g_shiftMode === 'game') ta.add(0x3c).writeU8(1);   // stock-auto mode: hand the box back to the game
    } catch (e) {}
    g_holdUntil = Date.now() + CFG.shiftHoldMs;  // let the re-engage settle before auto decisions
    out('CLUTCH out -> ' + g_selGear);
  }
}

// ---- our auto-box: RPM-scheduled shift policy (replaces the game's ground-speed hunting) ----
// Shift points are throttle-blended: light throttle upshifts early and lets RPM sag before
// downshifting; heavy throttle holds gears toward redline AND raises the downshift point, so the
// box drops a gear PRE-EMPTIVELY as soon as RPM falls a (tunable) amount below the working band —
// before the engine bogs. Upshift signal = grip RPM (ground speed / radius / redline: wheelspin-
// immune, so spinning wheels can't trigger an upshift). Downshift signal = true wheel RPM.
// Anti-hunt hysteresis lives on the DOWN side: a downshift is refused if it would land back above
// (upThr - huntMargin), i.e. where the lower gear would immediately want to upshift again. (An
// up-side landing guard is WRONG here: with wide cap gaps — e.g. 8->14, ratio 1.75 — a full-
// throttle upshift necessarily lands below the kickdown point, and blocking it pins the truck at
// redline.) dnMaxAfter is a second, absolute over-rev ceiling on the landing RPM.
// Debounce and throttle-release are TIME-based (not tick-count) so the auto-box behaves
// identically whether tick runs at 20Hz or 120Hz.
let g_upSince = 0, g_dnSince = 0, g_upThr = 0, g_dnThr = 0, g_rpmGrip = 0, g_rpmRaw = 0;
let g_thrS = 0, g_lastDnAt = -1e9, g_lastAsAt = 0;   // scheduling throttle (instant rise / slow release); last downshift time
let g_asLastSpeed = 0, g_asAccel = 0;                // smoothed ground-accel (m/s^2) for the stall-upshift trigger
let g_weOwnFwd = false;                              // hysteresis latch: our box owns FORWARD driving (else the game does)
function autoShift(v, ta, gear, caps, thr, speed) {
  if (CFG.boxPassive) return;                            // passive: never touch the box
  if (g_shiftMode !== 'ours') { g_upSince = g_dnSince = 0; return; }
  if (g_clutched) { g_upSince = g_dnSince = 0; return; } // clutch held: the driver owns the box
  if (!g_engineOn || !caps) return;
  const now = Date.now(), maxG = caps.length - 1;
  const dtS = clamp(g_lastAsAt ? (now - g_lastAsAt) / 1000 : 0.05, 0.004, 0.1);
  g_lastAsAt = now;
  // Driver direction intent from the SIGNED throttle axis (TA+0x44): W = +, S = - (gear-independent, since
  // we keep the game's own auto disengaged -- matches FUN_6ffffb3e2890's non-reverse branch). fSpeed is the
  // SIGNED forward ground speed (g_gsig): <0 means rolling backward.
  const t44 = rf(ta.add(0x44)) || 0, fwdThr = Math.max(0, t44), revThr = Math.max(0, -t44);
  const fSpeed = g_gsig;
  g_thrS = fwdThr >= g_thrS ? fwdThr : g_thrS + (fwdThr - g_thrS) * Math.min(1, dtS / CFG.thrReleaseS);   // schedule on FORWARD pedal only
  const accelMs2 = (speed - g_asLastSpeed) / dtS; g_asLastSpeed = speed;   // ground acceleration
  g_asAccel = g_asAccel * 0.8 + accelMs2 * 0.2;                            // smoothed, for the stall trigger
  // ---- direction: WE own every gear. Forward runs with the game's auto OFF (autoMode=0) so it can't fight
  //      us. Reverse torque is gated on autoMode in the binary (FUN_6ffffb3e2890's throttle swap), so while
  //      we hold reverse we flip autoMode=1 to borrow that plumbing -- but keep deciding the gear ourselves,
  //      reasserting it every frame (our tick runs on ApplyGear's onEnter, after the game's AutoShiftDecision,
  //      so our write wins). We enter reverse on a near-stop S request and leave it on a near-stop W. ----
  // Reverse torque is gated on the game's own reverse-engagement (autoMode=1) in the binary; FORCING the
  // gear each frame reads as a never-finishing shift -> clutch-out -> no torque (that was the "doesn't move"
  // regression). So we hand reverse EXECUTION to the game (autoMode=1, don't touch the gear) while WE own
  // the direction decision + all forward driving (autoMode=0).
  // The game OWNS standstill + reverse + every direction change (autoMode=1): reverse torque comes from its
  // own engagement, and its reverse-drive pedal (the accelerator -- reverse gear negates the torque) must NOT
  // be stolen by any exit logic of ours. That was the "reverse engages but won't move" deadlock -- our
  // W-near-stop exit grabbed the very pedal that drives reverse. So we own ONLY clearly-rolling FORWARD
  // driving; hysteresis on ground speed prevents autoMode flicker at the handoff.
  if (g_weOwnFwd) { if (gear < 1 || fSpeed < CFG.revEngageMps) g_weOwnFwd = false; }        // give back near a stop / in reverse
  else if (gear >= 1 && revThr <= 0.1 && fSpeed > CFG.revEngageMps + 1.0) g_weOwnFwd = true; // grab once clearly rolling forward
  if (!g_weOwnFwd) { try { ta.add(0x3c).writeU8(1); } catch (e) {} g_upSince = g_dnSince = 0; return; }   // game handles it
  try { ta.add(0x3c).writeU8(0); } catch (e) {}          // forward driving: OUR box owns the shifting
  if (gear > maxG) return;                                // HIGH gear engaged: driver-controlled
  const rl = redlineWavFor(caps, gear, ta); if (!rl) return;   // SAME redline as the RPM/audio (2*cap+5)*PowerCoef
  g_rpmRaw = g_wav / rl;                                  // true engine RPM (wheelspin-aware)
  g_rpmGrip = (speed / g_radius) / rl;                    // grip RPM (wheelspin-immune)
  g_upThr = CFG.upRpmLo + (CFG.upRpmHi - CFG.upRpmLo) * g_thrS;
  g_dnThr = CFG.dnRpmLo + (CFG.dnRpmHi - CFG.dnRpmLo) * g_thrS;
  if (now < g_holdUntil) { g_upSince = g_dnSince = 0; return; }
  let want = 0;
  const upNeed = g_upThr + (now - g_lastDnAt < CFG.upAfterDnMs ? CFG.huntMargin : 0);   // fresh kickdown: don't bounce back
  if (gear < maxG && g_rpmGrip > upNeed) want = 1;        // upshift: real road speed demands it
  // accel-stall upshift: RPM is up past upStallRpm but the truck has stopped accelerating -> it's at this
  // gear's ceiling (which may sit below upThr on tight-cap gears), so upshift instead of hanging at redline.
  if (!want && gear < maxG && g_rpmRaw > CFG.upStallRpm && g_asAccel < CFG.upStallAcc && g_thrS > 0.5) want = 1;
  if (!want && gear > 1 && g_rpmRaw < g_dnThr) {          // downshift: RPM sagged below the floor...
    const after = g_wav / (redlineWavFor(caps, gear - 1, ta) || 1e9);
    // ...and the lower gear neither over-revs nor lands where it would immediately upshift again
    if (after < Math.min(CFG.dnMaxAfter, g_upThr - CFG.huntMargin)) want = -1;
  }
  g_upSince = want > 0 ? (g_upSince || now) : 0;          // condition must HOLD debounceMs
  g_dnSince = want < 0 ? (g_dnSince || now) : 0;
  if (want > 0 && now - g_upSince >= CFG.debounceMs) {
    callSetGear(v, gear + 1); g_selNeutral = false;      // through the game's shifter -> clutch-out / torque-cut
    clearLowCoef(ta);
    g_holdUntil = now + CFG.shiftHoldMs; g_upSince = g_dnSince = 0;
    out('ASHIFT up ' + gear + '->' + (gear + 1) + ' grip=' + g_rpmGrip.toFixed(2) + ' thr=' + g_thrS.toFixed(2) + ' up@' + g_upThr.toFixed(2));
  } else if (want < 0 && now - g_dnSince >= CFG.debounceMs) {
    callSetGear(v, gear - 1); g_selNeutral = false;      // through the game's shifter -> clutch-out / torque-cut
    clearLowCoef(ta);
    g_holdUntil = now + CFG.shiftHoldMs; g_upSince = g_dnSince = 0; g_lastDnAt = now;
    out('ASHIFT dn ' + gear + '->' + (gear - 1) + ' rpm=' + g_rpmRaw.toFixed(2) + ' thr=' + g_thrS.toFixed(2) + ' dn@' + g_dnThr.toFixed(2));
  }
}
