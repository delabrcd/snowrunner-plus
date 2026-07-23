// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.
// 90-main — init + interval wiring + telemetry writers (rpm.txt, dash.json). Runs last.
out('engine takeover loaded @ ' + Date.now());
loadCfg();
// resilient init: if the script reloads mid map-load, memory may not be ready yet -> retry
// instead of letting an uncaught throw abort the whole script (and kill all the intervals).
function safeInit() {
  try {
    if (!g_global) resolveGlobal();
    if (g_global && !g_audioHooked) { hookAudio(); g_audioHooked = true; }
    if (g_global && g_audioHooked) { out('init OK: global=' + g_global + ' audio hooked'); hookDrivetrain(); return; }
  } catch (e) { out('init retry: ' + e); }
  setTimeout(safeInit, 500);
}
safeInit();
installExcHandler();           // always-on, gated by g_armed
setTimeout(defensiveUnset, 200);   // clear any stale watchpoints from a prior context
setInterval(pollWatchCmd, 300);    // arm via watch_cmd.txt (write "0xADDR [size]")
setInterval(pollKeys, 40);       // shifter actions (kbd+pad binds, ~25Hz, edge-detected; 30-gearbox)
setInterval(gprobe, 100);        // GPROBE: TruckAction change tracer (CFG.gprobe; 50-recon)
setInterval(diagAngvel, 200);    // DIAG: empirical drivetrain probe while driving (CFG.diagAngvel; 55-diag)
setInterval(diagState, 250);     // STATE: box-control state, logged on change (CFG.diagAngvel; 55-diag)
setInterval(function () { if (CFG.diagAngvel) findWheelBodies(); }, 1500); // WB: discover wheelModel->rigidBody link offset (10-vehicle)
setInterval(diagWheels, 250);    // WHEELS: per-wheel angvel via wheelModel->rigidBody link (55-diag)
setInterval(diagHunt, 60);       // HUNT: accumulate stored-angvel-multiple candidates while driving (55-diag)
setInterval(diagHuntReport, 3000); // HUNT: print survivors every 3s (55-diag)
setInterval(function () {    // TIMER FALLBACK ~120Hz: only when the drivetrain hook is quiet
  if (Date.now() - g_lastHookAt > 100) tick();   // menus/pause, or hook unavailable on this build
}, 8);
setInterval(loadCfg, 250);   // poll UI params
shmInit();                     // shared-memory telemetry -> overlay; written inside tick() (60-shm.js)
setInterval(function () {     // TEL: classify every signal by its shift behaviour in one run
  out('TEL sp=' + g_speed.toFixed(2) + ' g=' + g_gear + ' thr=' + g_throttle.toFixed(2) +
      ' rpm=' + Math.round(g_rpm * 100) + '% wav=' + g_wav.toFixed(2) + ' rad=' + g_radius.toFixed(2) + ' avgR=' + g_avgR.toFixed(2) + ' pc=' + g_powerCoef.toFixed(2) + ' rl=' + g_capSpeed.toFixed(2) +
      ' tick=' + Math.round(g_tickN / 0.15) + 'Hz frame=' + Math.round(g_dtTicks / 0.15) + '/' + Math.round(g_dtCalls / 0.15) + 'Hz');
  g_tickN = g_dtTicks = g_dtCalls = 0;
}, 150);
setInterval(function () {
  const keys = Object.keys(gameRatios); for (const k of keys) delete gameRatios[k];
  const line = 'RPM ' + Math.round(g_rpm * 100) + '%  LOAD ' + Math.round(g_load * 100) + '%  gear ' +
    (g_gear < 0 ? 'R' : g_gear) + '\npitch ' + g_pitch.toFixed(2) + '  vol ' + g_vol.toFixed(2) +
    '  cutoff ' + g_cutoff.toFixed(2) + '  mode ' + CFG.mode + '  voices ' + Object.keys(engineVoices).length + '\n';
  try { const f = new File(RPM_TXT, 'w'); f.write(line); f.flush(); if (f.close) f.close(); } catch (e) {}
  // full telemetry for the virtual dashboard
  const dash = {
    gear: g_clutched ? g_selGear : g_gear, speed: +g_speed.toFixed(2), throttle: +g_throttle.toFixed(2),
    torque_b4: +g_gameLoad.toFixed(3), model_rpm: +g_modelRpm.toFixed(3),
    wheel_rate: +g_wheelRate.toFixed(2), wheel_norm: +clamp(g_wheelRate / 25, 0, 1).toFixed(3),
    caps: g_caps ? g_caps.map(x => +x.toFixed(1)) : null, capSpeed: +g_capSpeed.toFixed(2), wav: +g_wav.toFixed(2), redline_mps: +g_redlineMps.toFixed(1), engineOn: g_engineOn,
    mix_rpm: +g_rpm.toFixed(3), mix_load: +g_load.toFixed(3), pitch: +g_pitch.toFixed(2),
    vol: +g_vol.toFixed(2), bright: +g_cutoff.toFixed(2), mode: CFG.mode, voices: Object.keys(engineVoices).length,
    box: g_shiftMode, upThr: +g_upThr.toFixed(2), dnThr: +g_dnThr.toFixed(2), rpm_grip: +g_rpmGrip.toFixed(3),
  };
  try { const f = new File(DASH_PATH, 'w'); f.write(JSON.stringify(dash)); f.flush(); if (f.close) f.close(); } catch (e) {}
}, 150);
