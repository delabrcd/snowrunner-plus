// 10-vehicle — TRUCK_CONTROL anchor resolution, Vehicle/TruckAction/gearbox/Havok reads.
let g_global = null, g_snow = null, g_audioHooked = false;
function resolveGlobal() {
  g_snow = Process.enumerateModules().find(x => /snowrunner\.exe$/i.test(x.name));
  const hits = Memory.scanSync(g_snow.base, g_snow.size, ANCHOR); if (!hits.length) { out('anchor NOT found'); return; }
  const a = hits[0].address, c = a.add(14 + a.add(10).readS32());
  for (let k = 0; k < 48; k++) if (c.add(k).readU8() === 0x48 && c.add(k + 1).readU8() === 0x8d && c.add(k + 2).readU8() === 0x05)
    { g_global = c.add(k + 7 + c.add(k + 3).readS32()); return; }
}
function vehicle() { if (!g_global) return null; const c = rptr(g_global); return c ? rptr(c.add(0x08)) : null; }
function speedOf(v) { const rb = rptr(v.add(0x5d0)); if (!rb) return 0; const x = rf(rb.add(0x230)), z = rf(rb.add(0x238)); return x === null ? 0 : Math.hypot(x, z); }
// The stock box's OWN shift signal (decompiled hi_AutoShiftDecision @0xd7b19b0): body B = *(*(v+0x60)+0x230),
// signal = dot(B.linVel[+0x230..238], B.axis[+0x170..178]). Upshift when signal > distrib(gear). Read it
// live and signed so we can compare it directly to distrib(g) = (0.9*cap[g]+2.0)*avgWheelRadius.
function driveBody(v) { try { const s = rptr(v.add(0x60)); if (!s) return null; return rptr(s.add(0x230)); } catch (e) { return null; } }
function gameShiftSignal(v) {
  const b = driveBody(v); if (!b) return null;
  const vx = rf(b.add(0x230)), vy = rf(b.add(0x234)), vz = rf(b.add(0x238));
  const ax = rf(b.add(0x170)), ay = rf(b.add(0x174)), az = rf(b.add(0x178));
  if (vx === null || vy === null || vz === null || ax === null || ay === null || az === null) return null;
  const s = vx * ax + vy * ay + vz * az;
  return isFinite(s) ? s : null;
}

// ---- call the game's OWN gear-data function for exact per-gear numbers (no reconstruction) ----
// hi_GetGearData @ RVA 0xd72640: bool GetGearData(vehicle, gear, float* torque, *thrDn, *cap, *thrUp, *distrib).
// distrib = the ground-speed redline the stock box upshifts at (decompiled hi_AutoShiftDecision). Read-only
// (only writes our out-params) so it's safe to invoke from tick() on the game thread.
const GETGEARDATA_RVA = 0xd72640;
let g_getGearDataFn = null, g_getGearDataTried = false;
const _ggBuf = Memory.alloc(0x40);   // 5 float out-params + slack
function getGearDataFn() {
  if (g_getGearDataFn || g_getGearDataTried) return g_getGearDataFn;
  g_getGearDataTried = true;
  try {
    if (!g_snow) return null;
    g_getGearDataFn = new NativeFunction(g_snow.base.add(GETGEARDATA_RVA), 'uint64',
      ['pointer', 'uint32', 'pointer', 'pointer', 'pointer', 'pointer', 'pointer'], 'win64');
    out('GetGearData bound @ ' + g_snow.base.add(GETGEARDATA_RVA));
  } catch (e) { out('GetGearData bind FAIL: ' + e); g_getGearDataFn = null; }
  return g_getGearDataFn;
}
// hi_SetGear @ RVA 0xd72570: bool SetGear(vehicle, int gear). Writes TA+0x74 AND fires FUN_6ffffb197b10 --
// the event that starts the game's clutch-out / torque-cut interpolation. Routing our shifts through it (vs a
// raw 0x74 write) gives a real shift: power briefly drops as the box changes gear. No-ops if a shift is
// already in progress (its own 0x148 guard). Safe to call from tick() -- the game calls it from the same
// drivetrain update, right before ApplyGear (which our framehook rides).
const SETGEAR_RVA = 0xd72570;
let g_setGearFn = null, g_setGearTried = false;
function callSetGear(v, gear) {
  if (!v) return false;
  if (!g_setGearFn && !g_setGearTried) {
    g_setGearTried = true;
    try {
      if (g_snow) { g_setGearFn = new NativeFunction(g_snow.base.add(SETGEAR_RVA), 'uint64', ['pointer', 'int32'], 'win64'); out('SetGear bound @ ' + g_snow.base.add(SETGEAR_RVA)); }
    } catch (e) { out('SetGear bind FAIL: ' + e); g_setGearFn = null; }
  }
  if (!g_setGearFn) return false;
  try { const r = g_setGearFn(v, gear); return (r.toNumber() & 0xff) !== 0; } catch (e) { return false; }
}
// returns {ok, torque, thrDn, cap, thrUp, distrib} or null on failure
function callGetGearData(v, gear) {
  const fn = getGearDataFn(); if (!fn || !v) return null;
  try {
    const pT = _ggBuf, pDn = _ggBuf.add(4), pCap = _ggBuf.add(8), pUp = _ggBuf.add(12), pDist = _ggBuf.add(16);
    pT.writeFloat(0); pDn.writeFloat(0); pCap.writeFloat(0); pUp.writeFloat(0); pDist.writeFloat(0);
    const r = fn(v, gear, pT, pDn, pCap, pUp, pDist);
    const ok = (r.toNumber() & 0xff) !== 0;
    return { ok: ok, torque: pT.readFloat(), thrDn: pDn.readFloat(), cap: pCap.readFloat(), thrUp: pUp.readFloat(), distrib: pDist.readFloat() };
  } catch (e) { return null; }
}
// wheel/output rotation ANGLE (wheel[0] -> +0x58 sub-object -> +0x210). Its rate = wheel angular velocity.
function wheelAngle(v) { try { const wb = rptr(v.add(0x200)); if (!wb) return null; const w0 = rptr(wb); if (!w0) return null; const sub = rptr(w0.add(0x58)); if (!sub) return null; return rf(sub.add(0x210)); } catch (e) { return null; } }
// TRUE wheel angular velocity: wheel[i] (Vehicle+0x200 vector) -> +0x60 sub-object -> +0x10.
// ~0 at rest, tracks ground speed when gripping, and stays high during wheelspin. Averaged over wheels.
function wheelAngvel(v) {
  try {
    const wb = rptr(v.add(0x200)), we = rptr(v.add(0x208));
    if (!wb || !we || we.compare(wb) <= 0) return null;
    const cnt = Math.min(we.sub(wb).toInt32() / 8, 10);
    let sum = 0, n = 0, mx = 0;
    for (let i = 0; i < cnt; i++) {
      const wp = rptr(wb.add(i * 8)); if (!wp) continue;
      const sub = rptr(wp.add(0x60)); if (!sub) continue;
      const a = rf(sub.add(0x10)); if (a !== null && isFinite(a) && Math.abs(a) < 200) { const av = Math.abs(a); sum += av; n++; if (av > mx) mx = av; }
    }
    return n ? { avg: sum / n, max: mx } : null;
  } catch (e) { return null; }
}
// PREFERRED tire-angvel source: per-wheel by IDENTITY (wheel[i] Vehicle+0x200 vector -> +0x60 sub
// -> +0x10 = that wheel's angular velocity, rad/s). Reads ~0 at rest, so unlike the island top-
// cluster it does NOT latch onto settling suspension/chassis bodies (that caused the ~5s RPM ring-
// down after stopping, and inflates wav while driving -> false over-rev). Same spinning-cluster
// aggregation (REV_CLUSTER) as the island path so an OPEN diff (one wheel spinning per axle) isn't
// halved by its held partner. Defined below wheelCount/REV_CLUSTER; only CALLED from tick() so the
// forward reference resolves at runtime.
// TRUE per-wheel tire angvel from the game's own physics wheel object. Decompiled + live-confirmed:
//   GetWheelPhys @0xd71850:      phys = *(container + 0x2c8)    (container = Vehicle+0x200[i])
//   WheelPhysUpdate_AngVel @0xc26160:  phys+0x174 = bodyAngVel(+0x240/4/8) . spinAxis  (rad/s, signed)
//                                      phys+0x170 = bodyLinVel(+0x230/4/8) . axis       (m/s, signed = wheel ground speed)
// raw174 tracks speed while gripping (~= lin170/radius, radius~0.6m), carries per-wheel slip, rises
// on wheelspin, rests at 0 -- so no island walk, no phantom bodies, no unit calibration. Returns the
// spinning-cluster mean of |angvel| (open-diff aware: a held partner near 0 doesn't dilute) and the
// mean |ground speed| (for the live radius measure). Zeros/garbage wheels (e.g. a free steer wheel) drop out.
function wheelPhys(v) {
  const wb = rptr(v.add(0x200)), we = rptr(v.add(0x208));
  if (!wb || !we || we.compare(wb) <= 0) return null;
  const cnt = Math.min(we.sub(wb).toInt32() / 8, 24);
  const angs = [], lins = [];
  let swr = 0, sw = 0;   // game's avgWheelRadius = SUM(w110*w94)/SUM(w110), same weighting as hi_GetGearData
  for (let i = 0; i < cnt; i++) {
    const c = rptr(wb.add(i * 8)); if (!c) continue;
    const ph = rptr(c.add(0x2c8)); if (!ph) continue;
    const a = rf(ph.add(0x174)), l = rf(ph.add(0x170));
    if (a !== null && isFinite(a) && Math.abs(a) < 200) angs.push(Math.abs(a));
    if (l !== null && isFinite(l) && Math.abs(l) < 200) lins.push(Math.abs(l));
    // per-wheel weight w110 and value w94 -> weighted mean = the radius factor in distrib(g)
    // (decompiled hi_GetGearData: distrib = (0.9*cap+2.0) * SUM(phys+0x110 * phys+0x94)/SUM(phys+0x110))
    const w110 = rf(ph.add(0x110)), w94 = rf(ph.add(0x94));
    if (w110 !== null && w94 !== null && isFinite(w110) && isFinite(w94) && w110 > 0) { sw += w110; swr += w110 * w94; }
  }
  if (!angs.length) return null;
  angs.sort(function (x, y) { return y - x; });            // desc
  const top = angs[0], floor = top * REV_CLUSTER;          // spinning-with-the-fastest cluster
  let s = 0, n = 0; for (let i = 0; i < angs.length && angs[i] >= floor; i++) { s += angs[i]; n++; }
  const lin = lins.length ? lins.reduce(function (a, b) { return a + b; }, 0) / lins.length : 0;
  return { wav: n ? s / n : top, lin: lin, gr: sw > 1e-4 ? swr / sw : 0 };
}
// Havok simulation island: chassis body(+0x5D0) -> +0x128 = island -> +0x60 = hkpRigidBody* array,
// +0x68 = count. Each body has linVel@+0x230.. and angVel@+0x240/+0x244/+0x248. The WHEEL bodies'
// angular velocity is the TRUE wheel spin (nonzero during wheelspin even when chassis is still).
function islandBodies(v) {
  try {
    const chassis = rptr(v.add(0x5d0)); if (!chassis) return null;
    const island = rptr(chassis.add(0x128)); if (!island) return null;
    const arr = rptr(island.add(0x60)); const cnt = ri(island.add(0x68));
    // cnt is the number of connected rigid bodies. Big rigs (8-wheelers + suspension/addon/trailer
    // bodies) legitimately reach 72-80, so the old cnt>64 guard REJECTED the whole island -> wav=0
    // -> RPM read 0 on those trucks. Cap high (garbage-pointer guard only), and clamp the loop.
    if (!arr || cnt === null || cnt < 1 || cnt > 512) return null;
    const n = cnt > 256 ? 256 : cnt;
    const bodies = []; for (let i = 0; i < n; i++) { const b = rptr(arr.add(i * 8)); if (b) bodies.push(b); }
    return bodies;
  } catch (e) { return null; }
}
// pin the stable per-wheel -> rigid-body pointer: find which TRUCK_WHEEL_MODEL (veh+0x200[i]) field
// points at an island body. That offset is the wheel's hkpRigidBody -> read angVel@+0x240 per wheel.
function findWheelBodies() {
  const v = vehicle(); if (!v) return;
  const bodies = islandBodies(v); if (!bodies) { out('WB no-island'); return; }
  const set = {}; bodies.forEach(function (b) { set[b.toString()] = true; });
  const wb = rptr(v.add(0x200)), we = rptr(v.add(0x208));
  if (!wb || !we || we.compare(wb) <= 0) { out('WB no-wheels'); return; }
  const cnt = Math.min(we.sub(wb).toInt32() / 8, 12);
  let rep = '';
  for (let i = 0; i < cnt; i++) {
    const wp = rptr(wb.add(i * 8)); if (!wp) continue;
    for (let o = 0; o <= 0x600; o += 8) { const p = rptr(wp.add(o)); if (p && set[p.toString()]) rep += ' w' + i + '@0x' + o.toString(16); }
  }
  out('WB wheels=' + cnt + ' islandN=' + bodies.length + ' matches:' + (rep || ' none'));
}
// TIRE angular velocity feeding engine RPM. The driven wheels are the fastest island bodies (chassis
// /suspension sit far below), so we look only at the top-N (N = wheel count from Vehicle+0x200).
// KEY: a flat mean of all N wheels is WRONG for an OPEN differential -- only one wheel per axle
// actually spins, its gripping partner is held near 0, so the mean HALVES the signal and the tach
// can never climb past ~50% no matter the wheelspin. Instead take the fastest wheel and average in
// only the wheels spinning WITH it (>= REV_CLUSTER of the max) -- i.e. the wheels actually turning.
//   full grip / diff-lock: every wheel is near the max -> mean of all N (unchanged, correct).
//   open diff, one wheel spun up: just that wheel -> RPM tracks real wheelspin; held partners never
//   dilute it. Self-adapts to AWD/RWD/lock state with no drivetrain-flag read.
const REV_CLUSTER = 0.55;   // a wheel counts as "driven/spinning" if its angvel >= this fraction of the fastest wheel's
function wheelCount(v) {
  try { const wb = rptr(v.add(0x200)), we = rptr(v.add(0x208)); if (wb && we && we.compare(wb) > 0) { const n = we.sub(wb).toInt32() / 8; if (n >= 1 && n <= 24) return n; } } catch (e) {}
  return 4;
}
function wheelAngvelIsland(v) {
  const bodies = islandBodies(v); if (!bodies || !bodies.length) return 0;
  const angs = [];
  for (const b of bodies) angs.push(Math.hypot(rf(b.add(0x240)) || 0, rf(b.add(0x244)) || 0, rf(b.add(0x248)) || 0));
  angs.sort(function (a, b) { return b - a; });        // desc: the wheels are the top rotating bodies
  const w = Math.min(wheelCount(v), angs.length); if (w <= 0) return 0;
  const top = angs[0]; if (top <= 0) return 0;
  const floor = top * REV_CLUSTER;                     // spinning-with-the-fastest cluster
  let s = 0, n = 0;
  for (let i = 0; i < w && angs[i] >= floor; i++) { s += angs[i]; n++; }   // sorted desc -> stops at first laggard
  return n ? s / n : top;
}
// gearbox AngVel caps vector: TruckAction +0x58/+0x60 = begin/end of a float vector
// [reverse, g1..gN, high] (decompile @0xd72300: maxGear = count-2; high = caps[maxG+1]).
// gearCaps() below reads [reverse, g1..gN] via the monotonic filter (high breaks the run).
function gearMaxOf(ta) {
  try {
    const b = rptr(ta.add(0x58)), e = rptr(ta.add(0x60));
    if (!b || !e || e.compare(b) <= 0) return null;
    const n = e.sub(b).toInt32() / 4 - 2;              // count-2 = the game's own GetMaxGear
    return (n >= 1 && n <= 16) ? n : null;
  } catch (err) { return null; }
}
function gearCaps(ta) {
  try {
    const gb = rptr(ta.add(0x58)); if (!gb) return null;
    const caps = []; let prev = 0;
    for (let i = 0; i < 12; i++) { const f = rf(gb.add(i * 4)); if (f === null || !isFinite(f) || f < 0.3 || f > 60 || f < prev - 0.05) break; caps.push(f); prev = f; }  // allow equal (reverse==gear1)
    return caps.length >= 3 ? caps : null;
  } catch (e) { return null; }
}

