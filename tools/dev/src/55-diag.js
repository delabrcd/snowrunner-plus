// 55-diag — EMPIRICAL drivetrain probe (temporary). Logs the RAW gearbox caps vector, the
// full island angular-velocity distribution, ground speed, and candidate direct output-angvel
// fields, so we can DERIVE the true RPM formula from ground truth instead of guessing offsets.
// Gated by CFG.diagAngvel. Grep 'DIAG' in explore.log. Drive through the gears (manual is best:
// rev each gear to its ceiling) so every per-gear cap shows up in the data.

// RAW caps vector (unfiltered): TruckAction+0x58 begin, +0x60 end, float[]. Layout is
// [reverse, g1..gN, high]; GetMaxGear = count-2 (game's own accessor). We log ALL elements so
// the real per-gear cap structure is visible (the monotonic filter in gearCaps() hides it).
function rawCaps(ta) {
  try {
    const b = rptr(ta.add(0x58)), e = rptr(ta.add(0x60));
    if (!b || !e || e.compare(b) <= 0) return null;
    const n = Math.min(e.sub(b).toInt32() / 4, 16);
    const a = []; for (let i = 0; i < n; i++) { const f = rf(b.add(i * 4)); a.push(f === null ? NaN : f); }
    return a;
  } catch (e) { return null; }
}
// every island body's |angvel|, sorted desc — reveals how many bodies spin and whether the
// driven wheels form a clean cluster or the aggregation is really tracking one body.
function allIslandAngs(v) {
  const bodies = islandBodies(v); if (!bodies) return null;
  const a = bodies.map(function (b) { return Math.hypot(rf(b.add(0x240)) || 0, rf(b.add(0x244)) || 0, rf(b.add(0x248)) || 0); });
  a.sort(function (x, y) { return y - x; });
  return a;
}
function fmtArr(a, nd, k) { return a ? '[' + a.slice(0, k || a.length).map(function (x) { return isFinite(x) ? x.toFixed(nd) : 'nan'; }).join(',') + ']' : 'null'; }

// diagnose WHY the island walk returns nothing on some trucks: dump every step of the chain raw.
function islandChain(v) {
  const p = function (x) { return x ? '0x' + x.toString(16).slice(-9) : 'null'; };
  let s = 'chassis(v+5d0)=';
  const chassis = rptr(v.add(0x5d0)); s += p(chassis);
  if (!chassis) return s + ' STOP';
  const island = rptr(chassis.add(0x128)); s += ' island(+128)=' + p(island);
  if (!island) return s + ' STOP';
  const arr = rptr(island.add(0x60)); const cnt = ri(island.add(0x68));
  s += ' arr(+60)=' + p(arr) + ' cnt(+68)=' + cnt;
  // also probe a couple of alternate count/array layouts in case the offsets moved on this build/truck
  s += ' | alt +58=' + ri(island.add(0x58)) + ' +64=' + ri(island.add(0x64)) + ' +6c=' + ri(island.add(0x6c)) + ' +70=' + ri(island.add(0x70));
  return s;
}

// box-control state (logs on change, visible even parked) — so we can see WHY shifting is broken:
// is the game's auto disabled (autoMode=0)? is our commanded gear (+0x74) diverging from actual (+0x70)?
let g_stateLast = '';
function diagState() {
  if (!CFG.diagAngvel) return;
  const v = vehicle(); if (!v) return;
  const ta = rptr(v.add(0x68)); if (!ta) return;
  let am = -1; try { am = ta.add(0x3c).readU8(); } catch (e) {}
  let raw768 = 0, eng = -1; try { raw768 = v.add(0x768).readU32(); eng = raw768 & 1; } catch (e) {}
  const g = ri(ta.add(0x70)), cmd = ri(ta.add(0x74));
  const s = 'STATE mode=' + g_shiftMode + ' pol=' + g_modePolicy + ' cfgOpen=' + g_ovlCfgOpen +
            ' passive=' + CFG.boxPassive + ' autoMode=' + am + ' gear=' + g + ' cmd=' + cmd +
            ' engineOn=' + eng + ' v768=0x' + raw768.toString(16);
  if (s !== g_stateLast) { g_stateLast = s; out(s); }
}

// ---- DRIVESHAFT HUNT ----
// Goal: find a STORED output/driveshaft angular velocity = wheel_angvel * final_drive (a constant
// >1), cleaner than the wheel cluster. Two prongs:
//  (A) full island dump — confirm whether any BODY spins faster than the wheels (a shaft body).
//  (B) stateful struct scan — any float in Vehicle/TruckAction/gearbox whose ratio to wav stays
//      ~constant across the whole drive is a candidate (survivors printed by diagHuntReport).
let g_huntFastBody = 0, g_huntFastMax = 0;
function diagHuntBodies(v, wav) {
  const bodies = islandBodies(v); if (!bodies) return;
  let fast = 0, mx = 0;
  for (const b of bodies) {
    const a = Math.hypot(rf(b.add(0x240)) || 0, rf(b.add(0x244)) || 0, rf(b.add(0x248)) || 0);
    if (a > mx) mx = a;
    if (a > wav * 1.5) fast++;                 // spinning meaningfully faster than the wheel cluster
  }
  if (fast > g_huntFastBody) g_huntFastBody = fast;
  if (mx > g_huntFastMax) g_huntFastMax = mx;
}
let g_huntCand = null;
function scanRegion(name, base, span, wav) {
  if (!base) return;
  for (let off = 0; off < span; off += 4) {
    const f = rf(base.add(off)); if (f === null || !isFinite(f)) continue;
    const r = f / wav;
    if (r < 1.15 || r > 12) continue;          // want a MULTIPLE of wav (>~1.15 excludes wav & speed themselves)
    const key = name + '+0x' + off.toString(16);
    const c = g_huntCand[key] || (g_huntCand[key] = { n: 0, s: 0, mn: 1e9, mx: -1e9 });
    c.n++; c.s += r; if (r < c.mn) c.mn = r; if (r > c.mx) c.mx = r;
  }
}
function diagHunt() {
  if (!CFG.diagAngvel) return;
  const v = vehicle(); if (!v) return;
  const ta = rptr(v.add(0x68)); if (!ta) return;
  const sp = speedOf(v); if (sp < 4) return;   // steady grip only (avoid spin/settling transients)
  const wav = wheelAngvelIsland(v); if (wav < 8) return;
  if (Math.abs(sp / wav - 0.505) > 0.06) return;  // require clean grip (effR near nominal) so ratios are meaningful
  if (!g_huntCand) g_huntCand = {};
  diagHuntBodies(v, wav);
  scanRegion('veh', v, 0x800, wav);
  scanRegion('ta', ta, 0x400, wav);
  scanRegion('gb', rptr(ta.add(0x58)), 0x200, wav);
}
function diagHuntReport() {
  if (!CFG.diagAngvel || !g_huntCand) return;
  const rows = [];
  for (const k in g_huntCand) { const c = g_huntCand[k]; if (c.n >= 25 && c.mx / c.mn < 1.06) rows.push({ k: k, r: c.s / c.n, mn: c.mn, mx: c.mx, n: c.n }); }
  rows.sort(function (a, b) { return (a.mx / a.mn) - (b.mx / b.mn); });   // most-stable ratio first
  out('HUNT fastBody(count>1.5xwav)=' + g_huntFastBody + ' maxBodyAngvel=' + g_huntFastMax.toFixed(1) + ' | stable-multiple candidates=' + rows.length);
  rows.slice(0, 30).forEach(function (o) { out('  ' + o.k + ' ratio=' + o.r.toFixed(2) + ' [' + o.mn.toFixed(2) + '..' + o.mx.toFixed(2) + '] n=' + o.n); });
}

// WHEELS-BY-IDENTITY, DRIVETRAIN-SOURCED: the drivetrain update (hi_DrivetrainUpdate_ApplyGear
// @0xc404f0) reads a per-wheel value at wheelModel+0x16c that it NEGATES for reverse (direction-aware
// => rotational speed, not torque), and maintains per-wheel state at +0x114/+0x118 (+0x110=torque,
// +0xe8=wheel type: 0 disabled / 2 special). These live on the Vehicle+0x200 wheel list, so they're
// wheels-only with no physics-island walk. Dump them vs ground speed to find the clean angvel that
// also holds during wheelspin (the driveshaft-equivalent we want).
function diagWheels() {
  if (!CFG.diagAngvel) return;
  const v = vehicle(); if (!v) return;
  const sp = speedOf(v);
  const wb = rptr(v.add(0x200)), we = rptr(v.add(0x208));
  if (!wb || !we || we.compare(wb) <= 0) return;
  const cnt = Math.min(we.sub(wb).toInt32() / 8, 16);
  // PHYS wheel object = *(container+0x2c8) (decompiled FUN_0xd71850). On it: +0x174 = raw wheel angvel
  // (body.angVel . spinAxis), +0x16c = smoothed angvel, +0x170 = wheel ground/linear speed. THIS is the
  // wheelspin-aware tire angvel (per FUN_0xc26160). The container's own +0x16c is a flag (=1.0), unrelated.
  const praw = [], psm = [], plin = [];
  let maxRot = 0;   // track angvel magnitude so we log during stationary WHEELSPIN too
  const g = function (arr, base, off, track) { const x = base ? rf(base.add(off)) : null; if (x !== null && isFinite(x)) { arr.push(x.toFixed(2)); if (track && Math.abs(x) > maxRot) maxRot = Math.abs(x); } else arr.push('-'); };
  for (let i = 0; i < cnt; i++) {
    const wp = rptr(wb.add(i * 8)); const ph = wp ? rptr(wp.add(0x2c8)) : null;
    g(praw, ph, 0x174, true); g(psm, ph, 0x16c, true); g(plin, ph, 0x170, false);
  }
  if (sp < 1.0 && maxRot < 1.5) return;   // log while MOVING or while the tire is spinning (wheelspin at rest)
  out('WPHYS sp=' + sp.toFixed(2) + ' n=' + cnt + ' raw174=[' + praw.join(',') + '] sm16c=[' + psm.join(',') + '] lin170=[' + plin.join(',') + ']');
}

function diagAngvel() {
  if (!CFG.diagAngvel) return;
  const v = vehicle(); if (!v) return;
  const ta = rptr(v.add(0x68)); if (!ta) return;
  const sp = speedOf(v); if (sp < 1.2) return;              // only while genuinely moving
  const gear = ri(ta.add(0x70)) || 0;
  let eng = -1; try { eng = v.add(0x768).readU32() & 1; } catch (e) {}
  const caps = rawCaps(ta);
  const angs = allIslandAngs(v);
  const wav = wheelAngvelIsland(v);
  if (!angs || !angs.length) { out('DIAG-ISLAND sp=' + sp.toFixed(2) + ' g=' + gear + ' ' + islandChain(v)); }
  const nz = angs ? angs.filter(function (x) { return x > 0.5; }) : [];
  const meanNz = nz.length ? nz.reduce(function (s, x) { return s + x; }, 0) / nz.length : 0;
  // ratios that should reveal the correct redline mapping: whichever ratio approaches ~1.0 as a
  // gear tops out (just before an upshift) is the right numerator/denominator pair.
  const capG = (caps && gear >= 1 && gear < caps.length) ? caps[gear] : NaN;
  const capG1 = (caps && gear >= 1 && gear + 1 < caps.length) ? caps[gear + 1] : NaN;
  const r = function (num, den) { return isFinite(den) && den > 0.01 ? (num / den).toFixed(2) : '-'; };
  // candidate DIRECT output/driveshaft angvel field (killed static-hunt lead: a member near +0x180
  // off a +0x20 Vehicle deref). Sweep a small window; a value that tracks speed and ~= cap at the
  // limiter is the scalar we want (no radius/final-drive calibration needed).
  let o20 = 'n/a';
  try { const o = rptr(v.add(0x20)); if (o) { const p = []; for (let off = 0x160; off <= 0x1a0; off += 4) { const f = rf(o.add(off)); p.push(f === null ? '-' : f.toFixed(1)); } o20 = '[' + p.join(',') + ']'; } } catch (e) {}
  out('DIAG sp=' + sp.toFixed(2) + ' g=' + gear + ' eng=' + eng +
      ' caps=' + fmtArr(caps, 2) +
      ' N=' + (angs ? angs.length : 0) + ' angs=' + fmtArr(angs, 1, 8) + ' meanNz=' + meanNz.toFixed(1) +
      ' wav=' + wav.toFixed(1) + ' effR=' + (wav > 0.5 ? (sp / wav).toFixed(3) : '-') +
      ' | sp/capG=' + r(sp, capG) + ' sp/capG1=' + r(sp, capG1) +
      ' wav/capG=' + r(wav, capG) + ' wav/capG1=' + r(wav, capG1) +
      ' | o20[160..1a0]=' + o20);
}
