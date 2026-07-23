// 50-recon — dev-only probes: HW watchpoints, memory scans, module dump. Not part of the mod behavior.
// ---- HW watchpoint capability spike: can we catch the instruction that writes a physics value?
// If yes, we can pinpoint the wheel-angvel writer in one frame. Test on chassis linVel (written
// every physics frame). Probes the Frida API first, then sets a write-watchpoint on all threads. ----
let g_wpDone = false, g_wpHits = {}, g_excSet = false;
function probeWatchAPI() {
  try {
    const ths = Process.enumerateThreads();
    const t0 = ths[0];
    out('WP-API threads=' + ths.length + ' thread-keys=' + Object.keys(t0).join(',') +
        ' proto=' + Object.getOwnPropertyNames(Object.getPrototypeOf(t0) || {}).join(','));
    out('WP-API Thread-global=' + (typeof Thread !== 'undefined' ? Object.getOwnPropertyNames(Thread).join(',') : 'none') +
        ' t0.setHardwareWatchpoint=' + (typeof t0.setHardwareWatchpoint));
  } catch (e) { out('WP-API err ' + e); }
}
// ---- crash-safe watchpoint harness ----
// Handler is ALWAYS installed and gated by g_armed (so stray exceptions propagate normally).
// Arm by writing a hex address to watch_cmd.txt; auto-disarms after a short window and writes
// the writer PCs to watch_out.txt. Disarm sets g_armed=false BEFORE unsetting. Defensive unset on
// load clears any stragglers. Never hot-reload the script while armed.
const WATCH_CMD = BASE + 'watch_cmd.txt', WATCH_OUT = BASE + 'watch_out.txt';
let g_armed = false, g_watchHits = {};
function installExcHandler() {
  if (g_excSet) return; g_excSet = true;
  Process.setExceptionHandler(function (d) {
    if (g_armed && (d.type === 'single-step' || d.type === 'breakpoint')) {
      try { const off = d.context.pc.sub(g_snow.base); const k = '0x' + off.toString(16); g_watchHits[k] = (g_watchHits[k] || 0) + 1; } catch (e) {}
      return true;
    }
    return false;
  });
}
function defensiveUnset() { Process.enumerateThreads().forEach(function (t) { try { t.unsetHardwareWatchpoint(0); } catch (e) {} }); }
function armWatch(addrStr, size, durMs) {
  const target = ptr(addrStr); g_watchHits = {}; g_armed = true;
  let ok = 0; Process.enumerateThreads().forEach(function (t) { try { t.setHardwareWatchpoint(0, target, size || 4, 'w'); ok++; } catch (e) {} });
  out('WATCH armed @ ' + target + ' size=' + (size || 4) + ' for ' + (durMs || 1400) + 'ms on ' + ok + ' threads');
  setTimeout(function () { disarmWatch(target); }, durMs || 1400);
}
function disarmWatch(target) {
  g_armed = false; defensiveUnset();
  const hits = Object.keys(g_watchHits).sort(function (a, b) { return g_watchHits[b] - g_watchHits[a]; }).map(function (k) { return k + '(x' + g_watchHits[k] + ')'; });
  const s = 'WRITERS of ' + target + ': ' + (hits.length ? hits.join(' ') : 'none');
  out(s); try { const f = new File(WATCH_OUT, 'w'); f.write(s + '\n'); f.flush(); if (f.close) f.close(); } catch (e) {}
}
function pollWatchCmd() {
  if (g_armed) return;
  let c = null; try { c = File.readAllText(WATCH_CMD).trim(); } catch (e) {}
  if (c && /^0x[0-9a-fA-F]+/.test(c)) {
    const parts = c.split(/\s+/);   // "0xADDR [size] [durationMs]"
    try { const f = new File(WATCH_CMD, 'w'); f.write(''); f.flush(); if (f.close) f.close(); } catch (e) {}
    armWatch(parts[0], parts[1] ? parseInt(parts[1]) : 4, parts[2] ? parseInt(parts[2]) : 1400);
  }
}
// hunt the game's OWN output/driveshaft speed (in cap units): a gearbox/drivetrain field that is
// PROPORTIONAL to wheel angvel (stable ratio across speeds) and in the cap range. RPM = it / cap(gear).
function gbSpeedScan() {
  const v = vehicle(); if (!v) return; const ta = rptr(v.add(0x68)); if (!ta) return;
  const gb = rptr(ta.add(0x58)); if (!gb) return;
  if (g_wav < 3) return;   // need meaningful wheel rotation
  let s = 'GBSPD wav=' + g_wav.toFixed(1) + ' gear=' + (ri(ta.add(0x70)) || 0);
  for (let o = 0; o <= 0x140; o += 4) { const f = rf(gb.add(o)); if (f !== null && isFinite(f) && f > 0.5 && f < 60) s += ' +' + o.toString(16) + '=' + f.toFixed(1) + '(r' + (f / g_wav).toFixed(2) + ')'; }
  out(s);
}
function islandProbe() {
  const v = vehicle(); if (!v) return;
  const bodies = islandBodies(v); if (!bodies) { out('ISL none'); return; }
  const sp = speedOf(v); let s = '';
  for (const b of bodies) {
    const ang = Math.hypot(rf(b.add(0x240)) || 0, rf(b.add(0x244)) || 0, rf(b.add(0x248)) || 0);
    if (ang > 0.6) { const lin = Math.hypot(rf(b.add(0x230)) || 0, rf(b.add(0x234)) || 0, rf(b.add(0x238)) || 0);
      s += ' ' + b.and(0xffffff).toString(16) + '(a' + ang.toFixed(1) + ' l' + lin.toFixed(1) + ')'; }
  }
  out('ISL sp=' + sp.toFixed(2) + ' n=' + bodies.length + ' movers:' + (s || ' none'));
}
// ---- ANGVEL hunt (magnitude+stability): angular velocity is ~CONSTANT during a steady spin, so
// we look for a field that is ~0 at rest and a STABLE, plausible-rad/s value (|v| in [1.5,80],
// steady across the probe interval) during spin. Scans each wheel struct AND its sub-objects'
// velocity region (Havok bodies keep velocities near +0x1e0..+0x280). ----
let g_prevSnap = null;
const MINPTR = ptr('0x10000');
function snapWheels() {
  const v = vehicle(); if (!v) return null;
  const wb = rptr(v.add(0x200)), we = rptr(v.add(0x208));
  if (!wb || !we || we.compare(wb) <= 0) return null;
  const cnt = we.sub(wb).toInt32() / 8;
  const s = {};
  for (let wi = 0; wi < cnt; wi++) {
    const wp = rptr(wb.add(wi * 8)); if (!wp) continue;
    for (let o = 0; o <= 0x400; o += 4) { const f = rf(wp.add(o)); if (f !== null) s['w' + wi + '+' + o.toString(16)] = f; }
    for (let po = 0; po <= 0x160; po += 8) {                     // follow pointer fields
      const sub = rptr(wp.add(po)); if (!sub || sub.compare(MINPTR) < 0) continue;
      for (let so = 0x1e0; so <= 0x280; so += 4) { const f = rf(sub.add(so)); if (f !== null) s['w' + wi + '@' + po.toString(16) + '+' + so.toString(16)] = f; }
    }
  }
  return s;
}
const g_fmin = {}, g_fmax = {};   // per-field min/max |value| over session
function wheelProbe() {
  const s = snapWheels(); if (!s) return;
  for (const k in s) {
    const a = Math.abs(s[k]);
    g_fmin[k] = g_fmin[k] === undefined ? a : Math.min(g_fmin[k], a);
    g_fmax[k] = g_fmax[k] === undefined ? a : Math.max(g_fmax[k], a);
  }
  g_prevSnap = s;
}

// ---- RPM-float scan: the tach RPM (normalized 0..1) climbs on stuck wheelspin, so we hunt a
// float that idles LOW and rises under throttle/spin. Scans Vehicle + TruckAction (+ one level of
// pointer-linked sub-objects, e.g. the engine/dashboard sim). ----
const rpmIdle = {}, rpmHi = {}, rpmLast = {};
function rpmScan() {
  const v = vehicle(); if (!v) return; const ta = rptr(v.add(0x68)); if (!ta) return;
  const accel = Math.abs(rf(ta.add(0x44)) || 0), speed = speedOf(v);
  const bases = [['v', v, 0x1000], ['ta', ta, 0x400]];
  // follow a few pointer fields off TA/Vehicle into sub-objects
  for (let o = 0; o <= 0x120; o += 8) { const s1 = rptr(ta.add(o)); if (s1 && s1.compare(MINPTR) > 0) bases.push(['ta@' + o.toString(16), s1, 0x200]); }
  for (const [tag, base, lim] of bases) {
    for (let o = 0; o <= lim; o += 4) {
      const f = rf(base.add(o)); if (f === null || f < 0 || f > 1.05) continue;
      const k = tag + '+' + o.toString(16); rpmLast[k] = f;
      if (accel < 0.08 && speed < 1) rpmIdle[k] = f;
      if (accel > 0.5) rpmHi[k] = Math.max(rpmHi[k] === undefined ? 0 : rpmHi[k], f);
    }
  }
}
function dumpRpm() {
  const rows = [];
  for (const k in rpmHi) { const lo = rpmIdle[k]; if (lo === undefined) continue;
    if (lo < 0.35 && rpmHi[k] - lo > 0.25) rows.push([k, lo, rpmHi[k]]); }
  rows.sort((a, b) => (b[2] - b[1]) - (a[2] - a[1]));
  out('RPMCAND ' + (rows.length ? rows.slice(0, 24).map(r => r[0] + '(idle' + r[1].toFixed(2) + '->hi' + r[2].toFixed(2) + ')').join(' ') : 'none yet — need idle + throttle samples'));
}

// ---- gearbox AngVel-cap array hunt: find a run of >=4 constant, increasing floats (the per-gear
// wheel-speed caps) in the vehicle object graph. Scans vehicle + TruckAction + one pointer level. ----
function scanCapsIn(base, lim) {
  const hits = [];
  for (let o = 0; o <= lim; o += 4) {
    for (const stride of [4, 8, 12, 16, 24, 32]) {
      const run = []; let prev = 0;
      for (let i = 0; i < 8; i++) { const f = rf(base.add(o + i * stride)); if (f === null || !isFinite(f) || f < 0.3 || f > 45 || f <= prev + 0.05) break; run.push(f); prev = f; }
      if (run.length >= 4) { hits.push('+' + o.toString(16) + 's' + stride + '[' + run.map(x => x.toFixed(1)).join(',') + ']'); }
    }
  }
  return hits;
}
// crash-safe: only follow pointers that land inside a genuinely readable range (binary search)
let g_ranges = [];
function refreshRanges() { try { g_ranges = Process.enumerateRanges('r--').map(r => [r.base, r.base.add(r.size)]).sort((a, b) => a[0].compare(b[0])); } catch (e) { g_ranges = []; } }
function readable(p) {
  let lo = 0, hi = g_ranges.length - 1;
  while (lo <= hi) { const m = (lo + hi) >> 1, r = g_ranges[m]; if (p.compare(r[0]) < 0) hi = m - 1; else if (p.compare(r[1]) >= 0) lo = m + 1; else return true; }
  return false;
}
function sptr(a) { try { const p = a.readPointer(); return (p && !p.isNull() && readable(p)) ? p : null; } catch (e) { return null; } }
function capsScan() {
  refreshRanges(); if (!g_ranges.length) { out('CAPS no-ranges'); return; }
  const v = vehicle(); if (!v) return; const ta = sptr(v.add(0x68));
  let rep = [];
  for (const [tag, base, lim] of [['v', v, 0x1200], ['ta', ta, 0x400]]) {
    if (!base || !readable(base)) continue;
    for (const h of scanCapsIn(base, lim)) rep.push(tag + h);
  }
  for (const [tag, root] of [['v', v], ['ta', ta]]) {
    if (!root || !readable(root)) continue;
    for (let o = 0; o <= 0x1000; o += 8) { const sub = sptr(root.add(o)); if (sub) {   // validated pointer only
      for (const h of scanCapsIn(sub, 0x400)) rep.push(tag + '@' + o.toString(16) + h);
    } }
  }
  out('CAPS ' + (rep.length ? rep.slice(0, 80).join('  ') : 'none'));
}

// ---- RPM MATCH scan: the true RPM float tracks speed/gear_cap (drops at upshift). Score each
// [0,1] float by squared error vs that reference shape; lowest error = RPM (ta+0xB4 torque scores
// badly since it jumps UP at shifts). ----
const rpmErr = {}, rpmN = {}, rpmMax = {};
function rpmMatch() {
  const v = vehicle(); if (!v) return; const ta = rptr(v.add(0x68)); if (!ta) return;
  const gear = ri(ta.add(0x70)) || 0, speed = speedOf(v);
  if (gear < 1 || speed < 0.5) return;                 // only while driving in a forward gear
  const i = Math.min(gear, CFG.gearTop.length - 1);
  const cap = (CFG.learn && learned[gear]) ? learned[gear] : CFG.gearTop[i];
  const ref = clamp(speed / cap, 0.05, 1);
  const bases = [['v', v, 0x1000], ['ta', ta, 0x400]];
  for (let o = 0; o <= 0x120; o += 8) { const s1 = rptr(ta.add(o)); if (s1 && s1.compare(MINPTR) > 0) bases.push(['ta@' + o.toString(16), s1, 0x200]); }
  for (const [tag, base, lim] of bases) {
    for (let o = 0; o <= lim; o += 4) {
      const f = rf(base.add(o)); if (f === null || f < 0 || f > 1.2) continue;
      const k = tag + '+' + o.toString(16);
      rpmMax[k] = Math.max(rpmMax[k] || 0, f);
      if (ref > 0.35) { const d = f - ref; rpmErr[k] = (rpmErr[k] || 0) + d * d; rpmN[k] = (rpmN[k] || 0) + 1; }  // only score when RPM is genuinely high
    }
  }
}
function dumpMatch() {
  const rows = [];
  for (const k in rpmErr) if (rpmN[k] >= 15 && (rpmMax[k] || 0) > 0.5) rows.push([k, rpmErr[k] / rpmN[k], rpmMax[k]]);  // must actually sweep high
  rows.sort((a, b) => a[1] - b[1]);
  out('RPMMATCH ' + (rows.length ? rows.slice(0, 12).map(r => r[0] + '(err' + r[1].toFixed(3) + ',max' + r[2].toFixed(2) + ')').join(' ') : 'need high-speed driving samples'));
}

// probe the gearbox struct for the current output angular velocity (same units as the caps).
// It rises with wheel spin even when ground speed is ~0 -> the true RPM numerator.
function gearboxProbe() {
  const v = vehicle(); if (!v) return; const ta = rptr(v.add(0x68)); if (!ta) return;
  const gb = rptr(ta.add(0x58)); if (!gb) return;
  const gear = ri(ta.add(0x70)) || 0, speed = speedOf(v);
  let s = '';
  for (let o = 0x18; o <= 0x220; o += 4) {   // skip 0x00..0x14 (the caps array itself)
    const f = rf(gb.add(o));
    if (f !== null && isFinite(f) && Math.abs(f) > 0.15 && Math.abs(f) < 40) s += ' +' + o.toString(16) + '=' + f.toFixed(2);
  }
  out('GB g=' + gear + ' sp=' + speed.toFixed(2) + s);
}
// ---- Havok wheel-angvel hunt: the chassis body (Vehicle+0x5D0) is an hkpRigidBody with a vtable
// at +0. Wheel bodies share that vtable. Find all objects with the same vtable (pointer-validated),
// then read angVel@+0x240 on each. During wheelspin, wheel bodies' angVel spikes while ground~0. ----
let g_bodies = [];
function findBodies() { try { _findBodies(); } catch (e) { out('BODIES ERR ' + e + ' @ ' + e.stack); } }
function _findBodies() {
  out('BODIES scanning...');
  refreshRanges(); if (!g_ranges.length) { out('BODIES no-ranges'); return; }
  const v = vehicle(); if (!v) return;
  const chassis = rptr(v.add(0x5d0)); if (!chassis || !readable(chassis)) { out('BODIES no-chassis'); return; }
  let vt = null; try { vt = chassis.readPointer(); } catch (e) {} if (!vt) return;
  const found = [], seen = {};
  function consider(p) {
    if (!p || seen[p.toString()]) return; seen[p.toString()] = true;
    let pvt = null; try { pvt = p.readPointer(); } catch (e) {}
    if (pvt && !pvt.isNull() && pvt.equals(vt)) found.push(p);
  }
  for (let o = 0; o <= 0x1200; o += 8) { const p = sptr(v.add(o)); if (p) consider(p); }   // direct vehicle fields
  const wb = sptr(v.add(0x200)), we = rptr(v.add(0x208));                                   // wheel models -> bodies
  if (wb && we && we.compare(wb) > 0) {
    const cnt = Math.min(we.sub(wb).toInt32() / 8, 12);
    for (let i = 0; i < cnt; i++) { const wp = sptr(wb.add(i * 8)); if (!wp) continue;
      for (let o = 0; o <= 0x400; o += 8) { const p = sptr(wp.add(o)); if (p) consider(p); } }
  }
  g_bodies = found;
  out('BODIES found ' + found.length + ' (vtable ' + vt + '): ' + found.map(p => p.toString()).join(' '));
}
function bodyMon() {
  if (!g_bodies.length) return; let s = '';
  for (let i = 0; i < g_bodies.length; i++) { const p = g_bodies[i];
    const ax = rf(p.add(0x240)) || 0, ay = rf(p.add(0x244)) || 0, az = rf(p.add(0x248)) || 0;
    const lx = rf(p.add(0x230)) || 0, ly = rf(p.add(0x234)) || 0, lz = rf(p.add(0x238)) || 0;
    s += ' b' + i + '(ang' + Math.hypot(ax, ay, az).toFixed(1) + ' lin' + Math.hypot(lx, ly, lz).toFixed(1) + ')';
  }
  out('BODYMON sp=' + speedOf(vehicle()).toFixed(2) + s);
}
// spin-capture: over the vehicle + wheel models + their velocity-region sub-objects, track each
// field's rest-min; flag fields that were ~0 at rest but now hold a steady spin-like value (2..30).
const g_spinMin = {};
function spinScan() {
  const v = vehicle(); if (!v) return; if (!g_ranges.length) refreshRanges();
  const bases = [['v', v, 0x1000]];
  const wb = sptr(v.add(0x200)), we = rptr(v.add(0x208));
  if (wb && we && we.compare(wb) > 0) {
    const cnt = Math.min(we.sub(wb).toInt32() / 8, 8);
    for (let i = 0; i < cnt; i++) {
      const wp = sptr(wb.add(i * 8)); if (!wp) continue;
      bases.push(['w' + i, wp, 0x300]);
      for (let o = 0; o <= 0x120; o += 8) { const s = sptr(wp.add(o)); if (s) bases.push(['w' + i + '@' + o.toString(16), s, 0x120]); }
    }
  }
  const speed = speedOf(v); const cands = [];
  for (const [tag, base, lim] of bases) {
    for (let o = 0; o <= lim; o += 4) { const f = rf(base.add(o)); if (f === null || !isFinite(f)) continue;
      const a = Math.abs(f), k = tag + '+' + o.toString(16);
      g_spinMin[k] = g_spinMin[k] === undefined ? a : Math.min(g_spinMin[k], a);
      if (g_spinMin[k] < 0.5 && a >= 2 && a <= 30) cands.push(k + '=' + f.toFixed(1)); }
  }
  out('SPIN sp=' + speed.toFixed(2) + (cands.length ? ' ' + cands.slice(0, 40).join(' ') : ' -'));
}
// one-shot: dump the DECRYPTED SnowRunner.exe image from the live process (SteamStub is decrypted
// in memory) for static decompilation. Fills unreadable pages with zeros to preserve offsets.
function dumpModule() {
  const m = Process.enumerateModules().find(x => /snowrunner\.exe$/i.test(x.name));
  if (!m) { out('DUMP no-module'); return; }
  const path = BASE + '..\\\\..\\\\reference\\\\snowrunner-dump.bin';   // repo/reference/, derived from BASE (tools/dev/)
  out('DUMP start base=' + m.base + ' size=0x' + m.size.toString(16) + ' -> ' + path);
  let f = null; try { f = new File(path, 'wb'); } catch (e) { out('DUMP open-err ' + e); return; }
  const CHUNK = 0x100000; let read = 0;
  for (let off = 0; off < m.size; off += CHUNK) {
    const n = Math.min(CHUNK, m.size - off);
    let buf = null; try { buf = Memory.readByteArray(m.base.add(off), n); } catch (e) {}
    if (buf && buf.byteLength === n) { f.write(buf); read += n; continue; }
    const tmp = new Uint8Array(n);                         // partial: page-by-page, zero-fill gaps
    for (let p = 0; p < n; p += 0x1000) {
      try { const pb = Memory.readByteArray(m.base.add(off + p), Math.min(0x1000, n - p)); if (pb) { tmp.set(new Uint8Array(pb), p); read += pb.byteLength; } } catch (e) {}
    }
    f.write(tmp.buffer);
  }
  f.flush(); if (f.close) f.close();
  out('DUMP done readable=0x' + read.toString(16) + ' of 0x' + m.size.toString(16));
}
// setTimeout(dumpModule, 1000);   // done (reference/snowrunner-dump.bin)

// verify candidate wheel-angvel fields vs speed (real one: ~0 at rest, tracks speed when driving)
function wvelProbe() {
  const v = vehicle(); if (!v) return; const ta = rptr(v.add(0x68)); if (!ta) return;
  const speed = speedOf(v), gear = ri(ta.add(0x70)) || 0;
  const wb = rptr(v.add(0x200)), we = rptr(v.add(0x208)); if (!wb || !we) return;
  const cnt = Math.min(we.sub(wb).toInt32() / 8, 6);
  let ws = [];
  for (let i = 0; i < cnt; i++) { const wp = rptr(wb.add(i * 8)); if (!wp) { ws.push('-'); continue; }
    const s = rptr(wp.add(0x60)); ws.push(s ? (rf(s.add(0x10)) || 0).toFixed(1) : '-'); }
  const v70 = rf(v.add(0x70)), gb = rptr(ta.add(0x58)), c0 = gb ? rf(gb.add(0)) : null;
  out('WVEL sp=' + speed.toFixed(2) + ' g=' + gear + ' wheels[' + ws.join(',') + '] v+70=' + (v70 === null ? '?' : v70.toFixed(1)) + ' cap0=' + (c0 === null ? '?' : c0.toFixed(1)));
}
// setInterval(wvelProbe, 250);   // paused — pivoting to static decompilation for exact offsets

// ---- GPROBE: TruckAction dword-change tracer (gate: CFG.gprobe; 100ms from 90-main). ----
// Snapshots ta+0x38..0xE8 (u32 granularity) + v+0x768 and logs 'GPROBE +off old->new' per
// changed dword. Purpose: flip the STOCK in-game shifter through R/N/A/L/H once — the log
// reveals how the special gears are encoded (verifies the H=maxG+1 / L=gear1+PowerCoef
// mapping from the SMGM mod + decompile evidence). Continuously-varying floats (accel,
// load, timers) would drown the discrete fields, so an offset that changes in 15+
// consecutive snapshots is muted as analog noise; discrete mode/gear fields survive.
let g_gpPrev = null;
const g_gpNoise = {};
function gprobe() {
  if (!CFG.gprobe) { g_gpPrev = null; return; }
  const v = vehicle(); if (!v) { g_gpPrev = null; return; }
  const ta = rptr(v.add(0x68)); if (!ta) { g_gpPrev = null; return; }
  const cur = {};
  try {
    for (let o = 0x38; o <= 0xE8; o += 4) cur[o] = ta.add(o).readU32();
    cur[0x1000] = v.add(0x768).readU32();          // sentinel slot for v+0x768
  } catch (e) { g_gpPrev = null; return; }
  if (g_gpPrev) {
    let s = '';
    for (const k in cur) {
      if (cur[k] === g_gpPrev[k]) { g_gpNoise[k] = 0; continue; }
      g_gpNoise[k] = (g_gpNoise[k] || 0) + 1;
      if (g_gpNoise[k] === 15) { out('GPROBE muting +' + (+k === 0x1000 ? 'v768' : (+k).toString(16)) + ' (analog noise)'); continue; }
      if (g_gpNoise[k] > 15) continue;
      s += ' +' + (+k === 0x1000 ? 'v768' : (+k).toString(16)) + ' ' + g_gpPrev[k].toString(16) + '->' + cur[k].toString(16);
    }
    if (s) out('GPROBE' + s);
  }
  g_gpPrev = cur;
}
