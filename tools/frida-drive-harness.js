'use strict';
/*
 * frida-drive-harness.js — L1 machine-controllable driving (autodrive)
 * ===================================================================
 * Concatenate AFTER frida-trace-xaudio.js (shares its emit/csv/log/T0 so input events
 * land on the SAME clock and CSV as the audio events). See docs/test-harness.md.
 *
 * How it works (thread-safe by construction):
 *   - We hook the game's own per-frame throttle apply, SetPowerCoef (SMT MIT AOB), which
 *     runs ON THE GAME THREAD. In that hook we (a) capture the controller pointer, (b)
 *     override the throttle float with the scenario's target, and (c) drain any queued gear
 *     action by calling the SMT shift functions right there on the game thread.
 *   - The scenario runner (Frida JS thread) ONLY mutates plain vars / pushes to a queue.
 *     It never calls game code directly -> no cross-thread races.
 *
 * Attribution: AOB signatures ported from drafty46/SMT and Ferrster/Snowrunner-Manual-
 * Gearbox-Mod (both MIT). See docs/prior-art.md.
 *
 * SAFETY: autodrive is OFF by default (DRIVE.enabled=false). If any signature fails to
 * resolve, the harness disables itself; the audio tracer keeps running untouched.
 */

// ---- graceful standalone fallback (if not concatenated with the tracer) --------------
if (typeof csv === 'undefined') { globalThis.csv = function () {}; }
if (typeof log === 'undefined') { globalThis.log = function (m) { console.log('[drive] ' + m); }; }
if (typeof addrLabel === 'undefined') {
  globalThis.addrLabel = function (a) { const m = Process.findModuleByAddress(a); return m ? m.name + '+0x' + a.sub(m.base).toString(16) : String(a); };
}

// ---- the test scenario (edit freely; times are ms from "first in a truck") -----------
const SCENARIO = [
  { t: 0,     throttle: 0.0, note: 'idle baseline' },
  { t: 5000,  throttle: 1.0, note: 'rev in neutral (no gear change)' },
  { t: 9000,  throttle: 0.0, note: 'release' },
  { t: 11000, gear: 'manual', note: 'ensure manual mode' },
  { t: 12000, throttle: 1.0, note: 'accelerate (low gear)' },
  { t: 20000, shift: 'up',   note: 'UPSHIFT #1 — expect ratio DROP here' },
  { t: 28000, shift: 'up',   note: 'UPSHIFT #2' },
  { t: 34000, throttle: 0.0, note: 'coast' },
  { t: 40000, throttle: 0.0, note: 'done' },
];

const DRIVE = {
  enabled: false,   // <<< set true to autodrive; false = trace-only (safe default)
  scenario: SCENARIO,
};

// ---- SMT / Ferrster AOB signatures (current build) -----------------------------------
const AOBS = {
  SetPowerCoef:        '48 8B 41 68 F3 0F 11 48 38 C3',
  ShiftToHigh:         '40 53 48 83 EC 20 48 8B D9 E8 ?? ?? ?? ?? 48 8B CB 8D 50 01 48 83 C4 20 5B',
  ShiftToReverse:      'BA FF FF FF FF E9 ?? ?? ?? ?? CC',
  DisableAutoAndShift: '48 8B 41 68 C6 40 3C 00 E9',
};

function scanOne(mod, name, pattern) {
  try {
    const hits = Memory.scanSync(mod.base, mod.size, pattern);
    if (hits.length) { log('AOB ' + name + ' -> ' + addrLabel(hits[0].address) + (hits.length > 1 ? ' (+' + (hits.length - 1) + ' more)' : '')); return hits[0].address; }
    log('AOB ' + name + ' -> NOT FOUND');
  } catch (e) { log('AOB ' + name + ' scan error: ' + e); }
  return null;
}

// ---- harness state -------------------------------------------------------------------
let g_ctl = null;                 // controller/vehicle pointer (rcx of SetPowerCoef)
let g_throttleOverride = null;    // null = don't override; else forced throttle 0..1
let g_gearQueue = [];             // {kind:'up'|'reverse'|'manual'} drained on game thread
let g_scenarioStarted = false;
let g_fn = {};                    // resolved NativeFunctions

function startScenarioOnce() {
  if (g_scenarioStarted) return;
  g_scenarioStarted = true;
  log('AUTODRIVE: in a truck — scenario clock starts now (' + DRIVE.scenario.length + ' steps)');
  csv('input', '', 'scenario_start', 'autodrive');
  for (const step of DRIVE.scenario) {
    setTimeout(function () {
      if ('throttle' in step) g_throttleOverride = step.throttle;
      if ('shift' in step && step.shift === 'up') g_gearQueue.push({ kind: 'up' });
      if ('gear' in step && step.gear === 'R') g_gearQueue.push({ kind: 'reverse' });
      if ('gear' in step && step.gear === 'manual') g_gearQueue.push({ kind: 'manual' });
      const desc = JSON.stringify(step).replace(/,/g, ';');
      log('SCENARIO t=' + step.t + ' ' + desc);
      csv('input', '', desc, step.note ? step.note.replace(/,/g, ';') : '');
    }, step.t);
  }
}

// Drain at most one gear action per frame (game thread). Returns nothing.
function drainGear(ctl) {
  if (!g_gearQueue.length || !ctl) return;
  const a = g_gearQueue.shift();
  try {
    if (a.kind === 'manual' && g_fn.DisableAutoAndShift) g_fn.DisableAutoAndShift(ctl);
    else if (a.kind === 'up' && g_fn.ShiftToHigh) g_fn.ShiftToHigh(ctl);
    else if (a.kind === 'reverse' && g_fn.ShiftToReverse) g_fn.ShiftToReverse(ctl);
    csv('input', '', 'gear_' + a.kind, 'applied');
    log('gear action applied: ' + a.kind);
  } catch (e) { log('gear action ' + a.kind + ' error: ' + e); }
}

// ---- bootstrap: resolve AOBs, hook SetPowerCoef --------------------------------------
function initDriveHarness() {
  // SAFETY: never touch game code unless autodrive is explicitly enabled. (A prior version
  // installed the SetPowerCoef replace unconditionally and is suspected in a Wine crash.)
  if (!DRIVE.enabled) { log('AUTODRIVE off — installing NO game-code hooks (trace-only safe).'); return; }
  const mod = Process.enumerateModules().find(m => /snowrunner\.exe$/i.test(m.name));
  if (!mod) { log('AUTODRIVE: SnowRunner.exe module not found — harness idle'); return; }
  log('AUTODRIVE: scanning ' + mod.name + ' (0x' + mod.size.toString(16) + ') for SMT signatures...');

  const aSet = scanOne(mod, 'SetPowerCoef', AOBS.SetPowerCoef);
  const aUp  = scanOne(mod, 'ShiftToHigh', AOBS.ShiftToHigh);
  const aRev = scanOne(mod, 'ShiftToReverse', AOBS.ShiftToReverse);
  const aDis = scanOne(mod, 'DisableAutoAndShift', AOBS.DisableAutoAndShift);

  if (!aSet) { log('AUTODRIVE DISABLED: SetPowerCoef not found (throttle override impossible).'); return; }
  if (aUp)  g_fn.ShiftToHigh        = new NativeFunction(aUp,  'void', ['pointer'], 'win64');
  if (aRev) g_fn.ShiftToReverse     = new NativeFunction(aRev, 'void', ['pointer'], 'win64');
  if (aDis) g_fn.DisableAutoAndShift = new NativeFunction(aDis, 'void', ['pointer'], 'win64');

  // Replace SetPowerCoef to (1) capture ctl, (2) override throttle, (3) drain gear queue.
  const orig = new NativeFunction(aSet, 'void', ['pointer', 'float'], 'win64');
  Interceptor.replace(aSet, new NativeCallback(function (ctl, coef) {
    try {
      g_ctl = ctl;
      if (DRIVE.enabled) {
        startScenarioOnce();              // anchors scenario t=0 to first in-truck frame
        drainGear(ctl);
        if (g_throttleOverride !== null) {
          csv('input', '', 'throttle=' + g_throttleOverride.toFixed(2), 'override');
          return orig(ctl, g_throttleOverride);
        }
      }
    } catch (e) { /* never break the game */ }
    return orig(ctl, coef);
  }, 'void', ['pointer', 'float'], 'win64'));

  log('AUTODRIVE: SetPowerCoef hooked. enabled=' + DRIVE.enabled +
      ' shift[up=' + !!aUp + ' rev=' + !!aRev + ' manual=' + !!aDis + ']');
  if (!DRIVE.enabled) log('AUTODRIVE is OFF (DRIVE.enabled=false) — set true to drive.');
}

// SnowRunner.exe is SteamStub-wrapped; give the loader time to decrypt/map .text before
// scanning. Retry a few times.
(function waitForGame(tries) {
  const mod = Process.enumerateModules().find(m => /snowrunner\.exe$/i.test(m.name));
  if (mod && mod.size > 0x1000000) { initDriveHarness(); return; }
  if (tries > 0) setTimeout(function () { waitForGame(tries - 1); }, 1500);
  else log('AUTODRIVE: gave up waiting for SnowRunner.exe module');
})(20);
