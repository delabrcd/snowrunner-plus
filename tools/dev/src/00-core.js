// 00-core — paths/constants, tunable CFG (cfg.json), logging, read helpers.
/*
 * Engine audio takeover + live tuning.
 * Identifies the game's engine voices by the caller of SetFrequencyRatio
 * (SnowRunner.exe+0xdfb32f, from recon) and imposes OUR OWN mix on them:
 *   - PITCH  = gear-aware RPM (throttle revs it free of load; drops on upshift).
 *   - VOLUME = base + rpm + load effort cue.
 *   - FILTER = low-pass cutoff opens under LOAD  -> brighter/harder when working,
 *              darker when free-revving. (The "sounds different under load" axis.)
 * mode:"mute" instead forces every engine voice silent (true mute / A-B).
 *
 * All mix parameters live in cfg.json, written by the tuning UI (rpm_ui.py) and
 * polled here every 250ms -> tune by ear with sliders, no reload.
 */
const BASE = '@@DEV@@';   // build.sh injects the absolute Wine path to tools/dev/ (derived from repo location; survives rename)
const LOG = BASE + 'explore.log', RPM_TXT = BASE + 'rpm.txt', CFG_PATH = BASE + 'cfg.json', DASH_PATH = BASE + 'dash.json';
const CSV_PATH = BASE + 'rpm.csv';   // per-tick drivetrain trace for offline model analysis (20-rpm writes rows)
const ANCHOR = '40 53 48 83 EC 20 48 8B D9 E8 ?? ?? ?? ?? 33 C9 48 89 18';
const SETFREQ_OFF = 0x1ca10, VT_SETVOLUME = 12, VT_SETFILTER = 8;
const ENG_LO = 0xdfb000, ENG_HI = 0xdfb600;   // SetFrequencyRatio caller region = engine voices

// live-tunable mix params (defaults; overwritten by cfg.json from the UI)
const CFG = {
  mode: 'takeover',        // 'takeover' = our mix on game voices | 'mute' = silence engine
  volOverride: true,       // false = leave the game's per-layer volume crossfade intact (pitch-only)
  masterVol: 1.0,          // 0..2 overall engine loudness
  useGameRpm: false,       // CONFIRMED: SnowRunner has no real RPM (tach is cosmetic) -> we compute it
  rpmOffV: 0x71c,          // (unused: no real game RPM float exists)
  useGameLoad: true,       // load from the game's real engine torque (TruckAction+0xB4)
  idlePitch: 0.80, redlinePitch: 1.10,   // pitch = idlePitch + rpm*(redlinePitch-idlePitch); redline pitch tamed from 1.25
  revThrottle: 0.65,       // how hard throttle revs the engine with no load (rev-in-place)
  rpmSmooth: 0.35, loadSmooth: 0.12,
  rpmMode: 'pergear',      // 'pergear' = full rev sweep every gear | 'raw' = speed/cap (diminishing)
  rpmFloor: 0.25,          // (fallback model only) RPM right after an upshift
  overRev: 1.15,           // allow RPM slightly over redline during free wheelspin (live-tunable in cfg.json)
  rpmDebounceMs: 100,      // a changed gear must persist this long before RPM adopts it (filters shift-transient blips)
  volBase: 0.6, volRpm: 0.3, volLoad: 0.5,
  filterOn: true, filterBase: 0.35, loadBright: 0.6,   // low-pass cutoff = filterBase + loadBright*load
  gearTop: [4, 4.6, 6.5, 7.8, 9.5, 12.2, 15.6, 20], learn: true, diag: false,   // m/s shift-speed caps (measured, auto-refined)
  // ---- our auto-box (g_shiftMode 'ours'): RPM-scheduled shift points, throttle-blended ----
  upRpmLo: 0.74, upRpmHi: 0.90,   // upshift RPM at zero / full throttle (0.90: tall gears asymptote
                                  // just below cap[gear+1] ~0.89, so 0.96 was unreachable -> stuck)
  upStallRpm: 0.80,               // accel-stall upshift: if RPM past this AND speed has stopped
  upStallAcc: 0.12,               // climbing (< this m/s^2), upshift anyway (catches the redline asymptote)
  dnRpmLo: 0.32, dnRpmHi: 0.60,   // downshift RPM at zero / full throttle (full = kickdown)
  dnMaxAfter: 0.95,               // skip downshift if the lower gear would land above this (over-rev)
  huntMargin: 0.06,               // upshift must land above dnThr+margin or it's refused (anti-hunt)
  shiftHoldMs: 700,               // no auto decisions this long after any shift
  nudgeHoldMs: 2500,              // manual ]/[ in 'ours' mode pauses the auto this long
  debounceMs: 100,                // a shift condition must hold this long before firing
  thrReleaseS: 1.0,               // scheduling-throttle release time-constant (rise is instant:
                                  // kickdown reacts now; a lift lowers the thresholds gradually,
                                  // so a gear just kicked down to isn't bounced straight back up)
  upAfterDnMs: 2000,              // within this after a downshift, upshift needs +huntMargin extra
  revEngageMps: 0.6,              // auto-box: forward<->reverse only allowed below this signed ground speed (near-stop)
  frameHook: true,                // drive tick() from the game's drivetrain update (70-framehook.js)
  frameHookMinMs: 3,              // dedupe gate: one tick per frame across multi-vehicle calls
  idleHunt: 0.012,                // idle-hunt wobble amplitude (± around the 0.15 idle floor; 0 = flat idle)
  gprobe: true,                   // GPROBE (50-recon): log TruckAction dword changes -> map the stock shifter's L/H encoding
  diagAngvel: true,               // DIAG (55-diag): dump raw caps + island angvel distribution while driving (empirical RPM derivation)
  boxPassive: false,              // false = our input layer + auto-box are live (cycle to 'ours' with the MODE bind); true hands the box fully to the game
};

let _log = null; try { _log = new File(LOG, 'w'); } catch (e) {}
function out(s) { console.log(s); if (_log) { try { _log.write(s + '\n'); _log.flush(); } catch (e) {} } }

// ---- CSV drivetrain trace: one row per tick while in a truck, for offline model fitting ----
const CSV_COLS = 't_ms,gear,cmdGear,speed,wav,wavSpeed,rad,avgR,gsig,gsigAbs,rlMps,distG,distNext,rpm,engineOn,caps';
// APPEND (not truncate) so a hot-reload doesn't wipe the drive log. Each load re-emits the header line;
// analysis skips any row whose first field isn't numeric.
let _csv = null;
try { _csv = new File(CSV_PATH, 'a'); _csv.write(CSV_COLS + '\n'); _csv.flush(); } catch (e) {}
function csv(row) { if (!_csv) return; try { _csv.write(row + '\n'); _csv.flush(); } catch (e) {} }

function rptr(a) { try { return a.readPointer(); } catch (e) { return null; } }
function rf(a) { try { return a.readFloat(); } catch (e) { return null; } }
function ri(a) { try { return a.readS32(); } catch (e) { return null; } }
function clamp(x, lo, hi) { return x < lo ? lo : x > hi ? hi : x; }

// ---- poll cfg.json from the UI ----
function loadCfg() {
  try {
    const txt = File.readAllText(CFG_PATH);
    const o = JSON.parse(txt);
    for (const k in o) if (k in CFG) CFG[k] = o[k];
  } catch (e) { /* file missing / mid-write: keep last good */ }
}

