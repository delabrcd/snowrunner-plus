// 70-framehook — drive tick() from the game's OWN drivetrain update instead of a timer:
// Interceptor.attach (observe-only trampoline, auto-reverted on unload) on
// hi_DrivetrainUpdate_ApplyGear (rva 0xc404f0; Ghidra-labeled: copies commanded gear
// TA+0x74 -> current TA+0x70). tick() in onEnter = same thread, right BEFORE the game
// applies the commanded gear — the auto-box write lands race-free in the frame it decided.
//
// Safety (2026-07-04 crash postmortem lessons): attach, never replace; installed exactly
// once, only after the module anchor resolved; the function's byte signature is verified
// against the live build before attaching (unique-AOB fallback scan if the RVA moved,
// abort to timer mode otherwise); the 90-main timer stays armed as fallback and takes
// over within 100ms whenever the hook goes quiet (menus, pause, hook unavailable).
// build.sh only publishes complete node-checked scripts, so reloads never install
// half-written hooks.
const DT_RVA = 0xc404f0;   // hi_DrivetrainUpdate_ApplyGear, current build (docs/evidence/memory-offsets.md)
const DT_SIG = '48 8B C4 55 56 57 41 54 41 55 41 56 41 57 48 8D A8 B8 FE FF FF 48 81 EC 10 02 00 00 48 C7 45 20';
let g_dtHooked = false, g_dtCalls = 0, g_dtTicks = 0, g_lastHookAt = 0;
function sigAt(addr) {
  try {
    const want = DT_SIG.split(' ');
    for (let i = 0; i < want.length; i++) if (addr.add(i).readU8() !== parseInt(want[i], 16)) return false;
    return true;
  } catch (e) { return false; }
}
function hookDrivetrain() {
  if (g_dtHooked || !CFG.frameHook || !g_snow) return;
  let addr = g_snow.base.add(DT_RVA);
  if (!sigAt(addr)) {
    out('DTHOOK sig mismatch at rva 0x' + DT_RVA.toString(16) + ' (new build?) — scanning...');
    const hits = Memory.scanSync(g_snow.base, g_snow.size, DT_SIG);
    if (hits.length !== 1) { out('DTHOOK scan hits=' + hits.length + ' — staying on timer fallback'); return; }
    addr = hits[0].address;
    out('DTHOOK relocated to rva 0x' + addr.sub(g_snow.base).toString(16));
  }
  Interceptor.attach(addr, {
    onEnter: function () {
      g_dtCalls++;
      const now = Date.now();
      g_lastHookAt = now;
      if (now - g_lastTickAt < CFG.frameHookMinMs) return;   // dedupe multi-vehicle calls within one frame
      g_dtTicks++;
      try { tick(); } catch (e) {}
    },
  });
  g_dtHooked = true;
  out('DTHOOK attached @ ' + addr + ' — tick is now game-frame-synced');
}
