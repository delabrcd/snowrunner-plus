// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.
// 60-shm — shared-memory telemetry OUT (named mapping Local\srdt_telemetry): lock-free
// same-process feed to the overlay ASI at ~30Hz — no filesystem, no JSON. Byte layout is
// ABI, mirrored from mod/src/telemetry.h v2 (magic+0, layout+4, seq+8 seqlock, payload+12,
// v2 tail: gearMax+112, gearFlags+116, gameGear+120, rpmIdle+124). Reverse channel: the
// overlay's SRDC v2 config block at +2048 (binds + modePolicy + config-open flag).
// dash.json stays alive in 90-main as the fallback + feed for the Linux-side tkinter tools.
let g_shm = null;
function shmInit() {
  try {
    const CreateFileMappingA = new NativeFunction(
      Module.getExportByName('kernel32.dll', 'CreateFileMappingA'),
      'pointer', ['pointer', 'pointer', 'uint32', 'uint32', 'uint32', 'pointer'], 'win64');
    const MapViewOfFile = new NativeFunction(
      Module.getExportByName('kernel32.dll', 'MapViewOfFile'),
      'pointer', ['pointer', 'uint32', 'uint32', 'uint32', 'size_t'], 'win64');
    const INVALID_HANDLE = ptr('0xffffffffffffffff');
    const name = Memory.allocUtf8String('Local\\srdt_telemetry');
    const h = CreateFileMappingA(INVALID_HANDLE, NULL, 4 /*PAGE_READWRITE*/, 0, 4096, name);
    if (h.isNull()) { out('SHM CreateFileMapping failed'); return; }
    const v = MapViewOfFile(h, 0xF001F /*FILE_MAP_ALL_ACCESS*/, 0, 0, 0);
    if (v.isNull()) { out('SHM MapViewOfFile failed'); return; }
    v.writeU32(0x54445253);        // 'SRDT'
    v.add(4).writeU32(2);          // layout v2 (telemetry.h SRDT_LAYOUT_V)
    g_shm = v;
    out('SHM telemetry mapped @ ' + v);
  } catch (e) { out('SHM init err ' + e); }
}
function shmWrite() {
  if (!g_shm) return;
  const s = g_shm;
  const n = (s.add(8).readU32() + 1) >>> 0;
  s.add(8).writeU32(n);                                     // odd: writer busy
  s.add(12).writeS32(g_clutched ? g_selGear : g_gear);   // clutched: show the gear the driver is selecting
  s.add(16).writeFloat(g_rpm);
  s.add(20).writeFloat(g_load);
  s.add(24).writeFloat(g_throttle);
  s.add(28).writeFloat(g_speed);
  s.add(32).writeFloat(g_shiftMode === 'ours' ? g_upThr : 0);
  s.add(36).writeFloat(g_shiftMode === 'ours' ? g_dnThr : 0);
  s.add(40).writeFloat(g_rpmGrip);
  s.add(44).writeFloat(g_redlineMps);
  s.add(48).writeFloat(g_wav);
  s.add(52).writeU32((g_engineOn ? 1 : 0) | (g_shiftMode === 'ours' ? 2 : 0) | (g_shiftMode === 'manual' ? 4 : 0) |
                     (g_clutched ? 8 : 0) | (g_inTruck ? 16 : 0) | (g_selNeutral ? 32 : 0));
  s.add(56).writeU32(Object.keys(engineVoices).length);
  const caps = g_caps || [], nc = Math.min(caps.length, 12);
  s.add(60).writeS32(nc);
  for (let i = 0; i < nc; i++) s.add(64 + i * 4).writeFloat(caps[i]);
  s.add(112).writeS32(g_gearMax);                           // gearMax (top forward gear; game's own count-2, caps fallback)
  s.add(116).writeU32(0);                                   // gearFlags: runtime home of IsHighGearExists etc. not mapped yet
  s.add(120).writeS32(g_gear);                              // gameGear: the REAL current gear even while clutched
  s.add(124).writeFloat(g_idleEff);                         // rpmIdle: idle floor incl. idle-hunt wobble
  s.add(8).writeU32(n + 1);                                 // even: snapshot consistent
}

// reverse channel: overlay config block (SRDC v2 @ +2048; mod/src/telemetry.h SrdtOverlayCfg).
// flags+12: bit0 = config UI open (swallow all actions while rebinding); bits 4-5 = modePolicy.
// binds+16: 8 actions x 2 slots of u32 (type<<16)|code — stored into BINDS (30-gearbox), a
// zero/absent bind falls back to the slot-0 keyboard defaults. Polled from pollKeys (~25Hz);
// flags every pass, binds only when seq changes.
let g_lastCfgSeq = -1;
function shmReadCfg() {
  if (!g_shm) return;
  try {
    const c = g_shm.add(2048);
    if (c.readU32() !== 0x43445253) return;   // 'SRDC': overlay hasn't connected
    const flags = c.add(12).readU32();
    g_ovlCfgOpen = (flags & 1) !== 0;
    if (c.add(4).readU32() !== 2) return;     // only layout v2 is parsed beyond the open flag
    g_modePolicy = (flags >>> 4) & 3;
    const seq = c.add(8).readU32();
    if (seq === g_lastCfgSeq) return;
    g_lastCfgSeq = seq;
    for (let a = 0; a < ACT_N; a++) for (let sl = 0; sl < 2; sl++) {
      const b = c.add(16 + (a * 2 + sl) * 4).readU32();
      BINDS[a][sl] = b !== 0 ? b : (sl === 0 ? BIND_DEF[a] : 0);
    }
    out('SHM cfg v2 seq=' + seq + ' policy=' + g_modePolicy + ' binds=' +
        BINDS.map(function (p) { return p.map(function (x) { return x.toString(16); }).join('/'); }).join(' '));
  } catch (e) {}
}
