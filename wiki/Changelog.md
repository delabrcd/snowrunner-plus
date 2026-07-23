# Changelog

The project journal, folded into the wiki. **Newest first; dates absolute.** Living state that
used to live in [[Changelog]]. For durable RE facts see [[Memory Map|Memory-Map]],
[[Ghidra Functions|Ghidra-Functions]], [[RPM Derivation|RPM-Derivation]], and
[[Audio Pipeline|Audio-Pipeline]]; for guesses see [[Speculation|Speculation]] and
[[Open Problems|Open-Problems]].

## 2026-07-22 — Published to GitHub; licensed MPL-2.0; machine paths purged

- **Public repo:** <https://github.com/delabrcd/snowrunner-plus> + the wiki pushed to
  `snowrunner-plus.wiki.git` (29 pages; `wiki/README.md` stays repo-only). `wiki/` in the repo
  remains the source of truth — the GitHub wiki is a mirror, re-synced by copy.
- **License: MPL-2.0** (`LICENSE`, per-file Exhibit A headers on all first-party sources).
  File-level copyleft keeps framework files open while leaving third-party modules free to
  choose their own terms. Rationale + upstream table on [[Prior Art|Prior-Art]].
- **`THIRD-PARTY-NOTICES.md`** added, reproducing every upstream notice verbatim (SMT,
  Ferrster, Dear ImGui, MinHook).
- **enginesound port deleted.** The original licensing review had missed
  `DasEtwas/enginesound` (MIT): `mod/synth/engine_synth.hpp` was a C++ port of it and
  `tools/synth/presets/*.epreset` were converted from its presets. The Baldan waveguide model
  **doesn't sound right for diesels** and was never in `mod/CMakeLists.txt`, so it was removed
  (`engine_synth.hpp`, `synth_test.cpp`, `parse_esc.py`, `presets/`) rather than carried for
  an attribution we don't need. Our own synth research (`engine_synth.py`, `engine_match.py`,
  `analyze_p16.py`) is independent of it and stays. See [[Prior Art|Prior-Art]].
- **No machine-specific paths are committed any more.** Hardcoded install paths in 17 files
  (plus scratchpad paths carrying the username) are replaced by a single resolution point:
  `tools/_env.sh` (shell) + `tools/srenv.py` (python) → `$SR_GAME` → gitignored `.env.local`
  → autodetect of the usual Steam library locations. Template: `.env.local.example`.
  An explicitly-set-but-missing `SR_GAME` now fails loudly in both, instead of python
  silently autodetecting past a typo.
- **Stale `snowrunner-drivetrain` paths fixed** after the directory rename, by *deriving*
  paths rather than re-hardcoding: `health.sh` derives the repo root; `install-recon.sh`
  computes the Wine staging path and substitutes `@@STAGE@@` into `combined.js` + generates
  `frida.config` (the `@@DEV@@` idiom from `tools/dev/build.sh`); the `ghidra-re` skill uses
  `git rev-parse --show-toplevel`.
- README rewritten for the SnowRunner+ framing (it still claimed "research phase, no code
  yet" and linked `docs/*.md` pages that had moved into the wiki), now leading with the
  drivetrain module **and the dashboard**.

## 2026-07-09 — Found the real per-wheel tire angular velocity (RPM numerator)

- **RE:** decompiled the drivetrain traction loop and found the game's own per-wheel tire angvel.
  `hi_GetWheelPhys @0xd71850`: `phys = *(Vehicle+0x200[i] + 0x2c8)`. `hi_WheelPhysUpdate_AngVel
  @0xc26160`: **`phys+0x174` = Havok body angVel(`+0x240/4/8`) · wheel spin axis** (rad/s, signed,
  spin-axis projected → no chassis-rock noise); `phys+0x16c` = EMA-smoothed `+0x174`; `phys+0x170`
  = body linVel · axis = wheel ground/contact speed. Labeled `hi` in the Ghidra DB.
- **Live-confirmed** (WPHYS diag, 8-wheeler): `raw174` tracks speed while gripping (`≈ lin170/radius`,
  radius ≈ 0.6 m), signed (negative in reverse), carries per-wheel slip, and **rests at 0**.
- **Wired into RPM** (`tools/dev/src`): `g_wav = wheelPhys()` (spinning-cluster mean of `|+0x174|`,
  open-diff aware); radius self-measured from `+0x170 / +0x174`; `RPM = g_wav / (cap[gear+1]/radius)`.
  This **replaces the island heuristic** and **removes all calibration/learning** — the island was
  ~3× inflated arbitrary units (axle/driveshaft bodies), which is why per-gear redline *learning*
  had been silently calibrating it. `g_fAngVel@0x2287f60` and the debug `AngVel` are the cosmetic
  ground-speed value (dead ends for wheelspin), confirmed via xrefs. Clean at rest (no ring-down);
  end-to-end driving behavior pending validation.

## 2026-07-09 — RE knowledge consolidated into a GitHub-wiki-style `wiki/`

- Stood up `wiki/` as the **single source of truth for RE facts** (offsets, labeled functions,
  the RPM model, audio internals) so they never need re-explaining session to session. GitHub
  Wiki format (flat pages, `Home`/`_Sidebar`/`_Footer`, `[[wiki-links]]`) — pushable to
  `<repo>.wiki.git` verbatim; publish steps in `wiki/README.md`.
- Framed around **SnowRunner+ as the framework** (modular platform exposing game + UI hooks)
  with the **drivetrain/RPM/audio work as the first module**. Pages: [[Home]],
  [[SnowRunner Plus|SnowRunner-Plus]] (hook surface ↔ RE backing), [[Game Model|Game-Model]],
  [[Memory Map|Memory-Map]], [[RPM Derivation|RPM-Derivation]], [[Audio Pipeline|Audio-Pipeline]],
  [[Ghidra Functions|Ghidra-Functions]] (RVA/role/AOB), [[Open Problems|Open-Problems]],
  [[RE Toolchain|RE-Toolchain]]. Consolidates + cross-links the existing `docs/evidence/` +
  `reference/` deep-dives (no duplication of live state, which stays in this journal).
- Headline thesis now written down as page-one: stock game shifts + plays engine audio off
  **throttle + ground speed, not RPM**; the Havok bodies still simulate true wheel spin
  (wheelspin-in-mud) → we derive RPM from `wheel_angvel/gear_ratio` and fix the sound sim.
- **First-party `AngVel` definition found (web search of Saber modding docs):** `AngVel` =
  "the maximum **angular speed of the wheel** when this gear is active" (range [0.1;32]) — same
  quantity we read off the Havok bodies, NOT ground speed. Also captured `MaxDeltaAngVel`
  (wheel angular-accel limiter) + `EngineResponsiveness` + Engine `Torque` ranges. Recorded as
  fact; the *inference* that it gives a radius-free universal `RPM = wav/cap` is NOT confirmed
  (measured ~2× factor: `wav≈2×cap` at upshift, `effR≈0.5`, decompiled `thrUp=2*cap+k3`) →
  parked on [[Speculation|Speculation]] with a plan to hook the game's own angvel↔cap
  comparison (`md_DrivetrainWheelGearSync @0xc3fe20`).
- **Wiki discipline set:** knowledge pages are confirmed-only; guesses live on
  [[Speculation|Speculation]]. CLAUDE.md updated to point at the wiki as RE source of truth +
  this rule + the SnowRunner+ framework framing.
- **New untested item:** low-range `L−/L/L+` gears (a PowerCoef multiplier @ `TA+0x38` on the
  low gear, not separate XML tags). RPM/shift behavior in low range never tested in-game →
  [[Open Problems|Open-Problems]].
- No binary/RE changes this entry — documentation + web-research consolidation only.

## 2026-07-05 (late) — RPM signal hunt: driveshaft = mean-of-wheels; per-truck cap scale is the open problem

Investigating why RPM/shifting is broken across trucks. Key results (evidence in
[[RPM Derivation|RPM-Derivation]]; RE labels in the Ghidra DB):

- **Root cause of "RPM reads 0" on big trucks (FIXED):** `islandBodies()` rejected islands with
  `cnt>64`; an 8-wheeler's island is 72–80 bodies → walk returned null → `wav=0` → RPM 0 (both
  driving and wheelspin-against-tree). Raised the cap to 512 (256 loop clamp) in `10-vehicle.js`.
- **Numerator is now `wav` = MEAN of the driven wheels** (`10-vehicle.js wheelAngvelIsland`): a
  differential outputs the average of its wheels, so mean-of-wheels **is** the driveshaft speed
  by definition (the visual propshaft displays this). Wheels-by-identity = top-N island angvels
  where N = wheel count (`Vehicle+0x200`). This replaced the median-of-cluster, which
  **oscillated** during mixed grip/spin (median jumps 32→11→8). Mean is smooth. **User-confirmed
  smooth.**
- **Driveshaft is NOT a physics body / not a stored scalar** we can find: island hunt (no body
  spins faster than wheels), struct scans (no wav-multiple in veh/TA/gearbox), and the debug-HUD
  `AngVel` (`+0x180`, sits next to speed `+0x17c`) is **ground-speed based** (ruled out,
  user-flagged). User insight: the visible driveshaft has no collision → visual node, not
  simulated.
- **OPEN — the per-truck cap↔speed SCALE.** caps are per-truck AngVel units, NOT universally
  m/s: truck A caps `[1.5..10]` ≈ its m/s; a crawler caps `[0.5..3.5]` ≈ ⅓ its speed → RPM
  pinned 114%. Decompiled the transmission (`hi_GetGearData@0xd72640`,
  `hi_Gearbox_PowerCoefPtr@0xd71750`, `hi_GetMaxGear@0xd72300` — now labeled): **cap =
  `caps[gear]`** (own index, not gear+1); gear torque = `Torque/sqrt(cap)`; shift thresholds
  `thrDn=cap*k1-k2`, `thrUp=2*cap+k3`; the gearbox scalar is **PowerCoef** (L/L+/L− mult), NOT a
  final drive. **Next:** find the live output-angvel the game compares to caps[gear] (in
  `md_DrivetrainWheelGearSync@0xc3fe20`) + read the `DAT_` k-consts → exact `RPM =
  out_angvel/caps[gear]`, no learning. Interim: `20-rpm.js` learns redline per gear from
  max-grip-wav (stopgap so it isn't pinned).
- Also cleared: **engineOn under load = fine** (all samples `v768=0x303`, not the regression).
  Added a project **`ghidra-re` skill** (`.claude/skills/`) mandating confidence-labeled
  persistent labels.
- Diagnostic probes (`tools/dev/src/55-diag.js`, `CFG.diagAngvel`) + `CFG.boxPassive` (hands the
  box to the game) are ON for this investigation — turn off for normal play. Tasks #3/#4/#5/#6
  track the remaining work (auto-box shift points, stuck cfgOpen swallow, and the cap-scale
  decompile).

## 2026-07-05 — Nice-to-haves batch integrated (overlay v3 + harness v2); subagent-delegated

- **Delegated in parallel** (disjoint file trees): harness v2 (`tools/dev/src/*`), overlay v3
  (`mod/src/*`), HUD-asset recon. Contracts fixed first in `mod/src/telemetry.h` (SRDT/SRDC
  bumped to **layout v2**: +gearMax/gearFlags/gameGear/rpmIdle telemetry; SRDC reverse-channel
  gains `binds[8][2]` dual bindings + modePolicy). All published only after gates: cmake clean,
  `node --check` + sim ALL PASS.
- **Overlay v3** (new `mod/src/widgets.cpp`, `bindings.cpp`; `gauges.cpp` reworked): rendering
  scale independent of size (font ladder 16/24/40/72px, crisp downscale — fixes blurry sized-up
  gear), resizable tach (uniform-scaled), shifter strip `[L] R N 1..gearMax [H]` with ease-out
  slide + glow animation, 8 generic assignable gauges (km/h·RPM·load·torque…, arc or bar), config
  UI with dual-bind rows (keyboard **and** XInput buttons capturable), modePolicy radios
  (hot-swap / forced-ours-auto / forced-manual / forced-stock-auto), hide-stock-gear toggle.
- **Harness v2** (`30-gearbox.js` input layer): 8 actions × 2 binds, XInput polling + edge
  detect, NEUTRAL / GEAR_LOW / GEAR_HIGH actions, mode-policy pinning. RPM idle-hunt
  (`20-rpm.js`), L/H gear encoding solved (ta+0x58 float vector [R,g1..gN,high]; maxGear=count−2;
  Low=gear1+PowerCoef).
- **Keys:** **F9** = show/hide whole overlay; **F8** (rebindable) = open config panel.
- **Install:** `install-devmod.sh` — Frida harness live-reloaded; ASI overlay-only (ini
  `xaudio=off telemetry=off`, reads shm the harness writes). ASI loads on next game **restart**.
- **Ghidra caching confirmed:** analyzed program `snowrunner-fixed.bin` (realigned PE dump,
  706MB db) is cached in `reference/ghidra-proj`; reuse via
  `-process snowrunner-fixed.bin -noanalysis` — never re-import (would re-analyze from scratch).
- Open: shift-sound **trigger** call site (subagent tracing in Ghidra — the ApplyGear rand()
  torque write is the physical jolt, not the sound); live gearFlags H/L slot highlight (bits
  still 0).

## 2026-07-05 — Clutch v2: gear pre-select + shift-clunk learn/mute/replay

- **Clutch is now a real clutch** (30-gearbox.js): hold = neutral with the CURRENT gear held as
  `g_selGear`; `]`/`[` while clutched adjust the selection (no game writes); release engages it.
  Telemetry gear field carries the selected gear while clutched (flags bit3 says so) → gear panel
  shows it in yellow + CLUTCH. Fixed on the way: releasing the clutch in stock-'game' mode now
  restores `IsInAutoMode=1` (was silently leaving the game's auto off).
- **Shift-clunk control via SubmitSourceBuffer** (40-audio.js, vtable slot 21 — all source
  voices share one vtable, one Interceptor.replace covers everything): during the 400ms clutch
  window, one-shot submits are candidates keyed by `pAudioData` (stable PCM identity); a key seen
  in ≥2 windows IS the clunk → learned, then (a) swallowed inside clutch windows only — real
  manual/auto shifts keep their sound; (b) its 48-byte XAUDIO2_BUFFER is copied and REPLAYED
  (`SubmitSourceBuffer` + `Start` on the saved voice) as feedback for each gear-select while
  clutched. `Interceptor.attach` on DestroyVoice (slot 18) invalidates the saved voice so we never
  submit to a dead one. First clutch-in plays the clunk once (learning pass); silent from the
  second on.
- Sim ALL PASS; JS hot-reloaded live; gear-panel change (ASI) on next launch.

## 2026-07-05 — In-game config UI, rebindable hotkeys, gear-panel occluder, clutch

- (Context: game runs uncapped ~200fps but the drivetrain hook fires at 60Hz → the game's
  physics/drivetrain step is fixed 60Hz. Frame-synced telemetry = 60Hz by nature; fine for UI.)
- **Interactive overlay (needs game restart):** `Insert` opens a config UI (`mod/src/gauges.cpp`);
  WndProc hook feeds ImGui input and shields the game from mouse/keys while it's open. Panels are
  ImGui windows: locked in play, draggable while config is open. Per-gauge toggles (tach, speed,
  thr/load bars, gear panel, box badge). Layout + keys persist to `snowrunner-overlay.cfg` next to
  the .asi (saved on change/close; uninstall cleans it).
- **Rebindable hotkeys, applied live to the harness:** shift up/dn, gearbox mode, clutch — click a
  binding, press a key. Flows overlay→harness via a REVERSE shm block (`SrdtOverlayCfg` 'SRDC' @
  mapping+2048, telemetry.h); JS polls it in pollKeys and also honors the config-open flag
  (shifter keys ignored while rebinding).
- **Stock gear-select replacement (occlusion, not RE):** our gear panel (big gear + AUTO*/MANUAL/
  CLUTCH mode) has an "opaque" option — drag/resize it over the game's gear widget (which shows
  wrong state in manual mode) and it simply covers it. Root-cause HUD-flag RE deferred.
- **Clutch (live now, default `V`, rebindable):** hold = commanded gear 0 (neutral — engine
  free-revs on throttle per the existing neutral RPM model), release = previous gear re-engaged;
  auto-box suspends while held + shiftHoldMs settle after. Telemetry flags bit3 = clutched.
- Sim ALL PASS after changes. JS side hot-reloaded (clutch/hotkey plumbing live); C++ config UI
  lands on next game launch.

## 2026-07-05 — tick() frame-synced to the game's drivetrain update (attach on ApplyGear)

- **`Interceptor.attach` on `hi_DrivetrainUpdate_ApplyGear` (rva 0xc404f0) drives `tick()` from
  the game's own update** (`tools/dev/src/70-framehook.js`). Verified live while the user drove:
  `DTHOOK attached`, `TEL ... tick=60Hz frame=60/60Hz` — the function runs exactly ONCE per frame
  (player vehicle only; calls==ticks), so telemetry now matches game framerate by construction and
  scales with fps automatically. Attached mid-session under full throttle, no hiccup.
- **Race-free auto-box:** tick() runs in onEnter of the very function that copies commanded gear
  (TA+0x74 → +0x70) — our gear write lands on the same thread immediately before the apply, in the
  same frame the decision was made (the timer version wrote cross-thread).
- **Safety rails** (per the 07-04 crash postmortem — crashes came from live-hooking with
  half-written auto-reloaded scripts): attach not replace; install-once after anchor resolution;
  32-byte prologue signature verified at the RVA before attaching (bytes from
  `reference/snowrunner-fixed.bin`; unique-AOB rescan fallback, abort-to-timer otherwise); the 8ms
  timer stays armed and takes over within 100ms when the hook goes quiet (menus/pause); build.sh
  publishes only complete node-checked scripts so a reload can never install a half-written hook.
- Game restart earlier confirmed the new ASI end-to-end: `overlay: shm telemetry connected` —
  per-frame shm reads + display smoothing + bottom-left position all active.

## 2026-07-05 — Telemetry to 120Hz (measured live); dt-corrected model + display smoothing

- User asked for ≥60Hz overlay data, ideally frame-matched. Chain is now: `tick` at **120Hz
  (measured in-game via TEL `tick=` counter)** → `shmWrite()` inside tick (coherent snapshot per
  tick) → overlay reads shm every Present + ~50ms exponential display smoothing (needle inertia,
  fluid at any fps). Overlay renders at game fps by construction (Present hook).
- **dt-correction everywhere the rate changed:** CFG smoothing constants stay defined as per-50ms
  factors, converted per tick via `smoothK(k, dtMs) = 1-(1-k)^(dt/50)` (rpm, load, radius, wheel-
  rate EMAs; wheel-angle differentiation uses real dt). Auto-box debounce switched from
  tick-count to time (`debounceMs` 100, replaces `shiftDebounceN`); scheduling-throttle release
  uses real dt. Sim re-run after the change: ALL PASS (behavior identical by construction).
- Live-verified via hot-reload while the user drove; C++-side improvements (shm per-frame read,
  smoothing, bottom-left position) activate on next game launch.

## 2026-07-05 — LIVE: overlay verified in-game; shm telemetry replaces file IPC

- **Live test (combined install `tools/dev/install-devmod.sh`):** Frida harness + ASI overlay-only
  (`snowrunner-engine.ini`: `xaudio=off telemetry=off` — the Frida script owns those hooks;
  double-patching the same prologues would crash). **Overlay WORKS under DXVK/Proton**: Present
  hooked, ImGui up (tahoma.ttf from the prefix), and values matched dash.json exactly during live
  driving — including 115% over-rev with the truck spinning wheels in reverse (R, full thr bar).
  Auto-box live-drive feel pass still pending (monitor armed on explore.log for ASHIFT lines).
- **Overlay repositioned** (user call): bottom-left, right of the game's functions menu —
  `x = 0.30*display_h`, bottom-anchored. Takes effect on next game launch.
- **IPC upgraded file→shared memory** (user asked for "proper IPC, e.g. protobuf"; chose a named
  shm mapping instead — both endpoints are in the SAME process, so a fixed struct + seqlock beats
  serialization: zero copies, per-frame reads): `Local\srdt_telemetry`, layout = `mod/src/
  telemetry.h` (magic/layout-version/seqlock header, 112B payload), writer = `tools/dev/src/
  60-shm.js` @30Hz (kernel32 CreateFileMappingA/MapViewOfFile via NativeFunction), reader =
  overlay per-frame with seqlock retry; dash.json kept @7Hz as fallback + tkinter feed. Verified
  mapped live (`SHM telemetry mapped`). Protobuf revisit only if telemetry ever leaves the machine.
- **Gotchas learned:** (1) the frida gadget's script watcher misses a `mv` onto the watched path —
  `build.sh` now touches the output (verified reload). (2) Never `cp` over a mapped DLL of a
  running game — install scripts use `cp --remove-destination` (unlink first, old inode lives on).

## 2026-07-05 — In-game ImGui overlay, CMake build, no baked-in paths, modular dev script

- **In-game overlay (Steam-overlay style), untested in-game yet:** `mod/src/overlay.cpp` — MinHook
  on `IDXGISwapChain::Present` (address from a throwaway device+swapchain vtable, same impl as the
  game's = DXVK under Proton) + Dear ImGui (vendored v1.91.8, `mod/vendor/imgui/`). Draws the tach
  (redline zone, up/dn shift-point markers when the box is ours), gear, km/h, box mode, thr/load
  bars. Data = `tools/dev/dash.json` (written ~7Hz by the Frida harness) polled at 10Hz — same feed
  as the tkinter dash. **F9 toggles.** Display-only (no input hook) v1; fail-safe passthrough if
  init fails. `ResizeBuffers` hooked for RTV recreation.
- **Build → CMake** (`mod/CMakeLists.txt` + `cmake/mingw-w64-x86_64.cmake` toolchain; Makefile
  removed): `cmake -B build -DCMAKE_TOOLCHAIN_FILE=cmake/mingw-w64-x86_64.cmake && cmake --build
  build` → `build/snowrunner-engine.asi` (fully static, 2.3MB with ImGui).
- **No machine paths in the binary:** `mod/src/paths.h` resolves log/dash paths relative to the
  loaded .asi (`GetModuleFileName`); optional `snowrunner-engine.ini` next to it overrides
  (`log=`, `data_dir=`). `install-mod.sh` generates the dev ini pointing into this repo via `Z:`;
  a public install ships no ini. Uninstall removes ini+log.
- **memexplore.js is now GENERATED** from `tools/dev/src/*.js` (numeric prefix = load order:
  00-core, 10-vehicle, 20-rpm, 30-gearbox, 40-audio, 50-recon, 90-main wires init/intervals last)
  by `tools/dev/build.sh` (concat + `node --check`; `--watch` mode). Gadget hot-reload unchanged
  (frida.config still points at memexplore.js). Refactor verified: line-exact partition
  (sort-diff empty) + auto-box sim ALL PASS on the generated file. Generated file gitignored.

## 2026-07-05 — Our own auto-box: RPM-scheduled, adjustable shift timing + pre-emptive kickdown

- **Custom automatic gearbox** in `memexplore.js` (`autoShift()`), on top of the proven
  manual-shift path (`IsInAutoMode(TA+0x3C)=0` + commanded gear → `TA+0x74`). `\` cycles game-auto
  ↔ our-auto; `]`/`[` still manual (in our-auto they nudge + pause the box `nudgeHoldMs`).
- **Policy:** shift points are RPM thresholds blended by throttle — `upThr =
  lerp(upRpmLo,upRpmHi,thr)`, `dnThr = lerp(dnRpmLo,dnRpmHi,thr)`. Heavy throttle holds gears
  toward redline AND raises the downshift floor → the **pre-emptive downshift**: the box drops a
  gear as soon as RPM sags a tunable amount below the working band, before the engine bogs.
  Upshift signal = grip RPM (`speed/radius/redline`, wheelspin-immune); downshift signal = true
  wheel RPM (Havok angvel). All four thresholds + hold time are live sliders in `rpm_ui.py`; up/dn
  markers drawn on the `rpm_dash.py` tach arc.
- **Anti-hunt (validated by offline sim, scratchpad `sim_autoshift.js`, drives the REAL script
  with Frida stubbed):** (1) hysteresis on the DOWN side — refuse a downshift landing above
  `upThr−huntMargin` (an up-side landing guard is wrong: wide cap gaps like 8→14 make
  full-throttle upshifts land below the kickdown point and would pin the truck at redline); (2)
  scheduling throttle rises instantly (kickdown immediate) but releases over `thrReleaseS` — a
  throttle lift can't bounce a fresh kickdown straight back up; (3) post-downshift upshift margin
  `upAfterDnMs`; (4) debounce 3 ticks + `shiftHoldMs` hold; over-rev guard `dnMaxAfter`. Sim
  phases (real scout caps [2,3,6,8,14,20]): full-throttle 1→5, steady cruise, full-throttle hill
  (2 kickdowns at the floor), brake-to-stop chain 3→2→1, pure wheelspin (no false shifts) — ALL
  PASS, zero hunting.
- Untested in-game as of this entry — next session: live feel pass, then port the policy into the
  C++ ASI once tuned.

## 2026-07-05 — Manual shifter, engine-state flag, finalized RPM model, in-game-ready

- **RPM model finalized (no calibration):** `RPM = tire_angvel / redline(gear)`,
  `redline(gear) = cap(gear+1) / radius`. Key insight: the gearbox `AngVel` caps
  (`TruckAction+0x58 → +0x00`) are **ground-speed units** and **off-by-one** (gear g redlines at
  the NEXT gear's cap); the "≈2×" factor relating caps to Havok tire-angvel is just `1/radius`.
  Radius is measured live per-truck (`speed/tire_angvel` while gripping, ≈0.53). Wheelspin-aware,
  gear-aware. Wheel angvel = **median of top-4 island rigid-body angVels** (rejects single-body
  settling noise that caused idle RPM oscillation).
- **Engine on/off — the RIGHT way:** `Vehicle+0x768` (`q_VehStateFlags`) **bit0 = engine
  running**, found by a clean on→off Vehicle-struct diff (`0x303`→`0x300`), matches Ferrster's
  offset. Idle floor only applies when on; tach reads 0 when off. (Rejected the earlier
  audio-activity inference as hacky.)
- **Manual shifter (working):** `IsInAutoMode(TA+0x3C)=0` + write target gear to `TA+0x74`; the
  game's `hi_DrivetrainUpdate_ApplyGear @ rva 0xc404f0` copies `+0x74→+0x70` and applies it (found
  by watchpointing the gear field, decompiled in Ghidra). Bound to keys `]` up / `[` down / `\`
  auto in `memexplore.js pollKeys`. Reversible, uses the game's own logic.
- **HW-watchpoint→decompile→label loop** is the standing method. Ghidra project (`~/.local/opt`,
  JDK21) has 9 functions labeled `hi_/md_/lo_` + confidence comments; `tools/re/DefineStructs.java`
  adds Vehicle/TruckAction/Gearbox struct types so the decompiler shows named fields.
- **Dashboard** (`rpm_dash.py`): 270° tach with a redline zone the needle pushes past (real-tach),
  gear + km/h + static redline km/h. Offsets/model documented in [[Memory Map|Memory-Map]].

## 2026-07-04 — TRUE wheelspin-aware RPM (Havok wheel angular velocity) + HW watchpoints

- **Solved the core problem.** RPM is now driven by **real wheel angular velocity** read from the
  Havok physics, so it responds to wheelspin (engine revs when wheels spin free while stopped) —
  the thing SnowRunner fundamentally never does. Ground-speed/gear was ~what the game already
  does; this is the actual fix.
- **Wheel angvel chain (from `reference/snowrunner-real` lead):** chassis body `Vehicle+0x5D0`
  → `+0x128` = `hkpSimulationIsland*` → `+0x60` = `hkpRigidBody*` array, `+0x68` = count. Each body
  has linVel `+0x230..238`, **angVel `+0x240/+0x244/+0x248`**. The wheel rigid bodies' angVel is
  the true spin (0 at rest, spikes on wheelspin). Aggregate = mean of the top-4 island angVels (RWD
  tandem = 4 driven wheels). Note: `Vehicle+0x200` objects are `TRUCK_WHEEL_MODEL`
  (gameplay/terrain — grip/surface constants like the `3.4`/`13.2` that fooled earlier scans), NOT
  the physics bodies.
- **RPM model:** `RPM = wheel_angvel / (gearbox_cap(gear) * k)`, caps from `TruckAction+0x58` (game
  data), `k` (angvel↔cap unit scale, ~4-7) auto-calibrated from one upshift. Wheelspin-aware,
  gear-aware, universal. `memexplore.js` `wheelAngvelIsland()` / `islandBodies()`.
- **HW watchpoints work under Wine** (Frida `Thread.setHardwareWatchpoint` on all threads + a
  `Process.setExceptionHandler`). Crash-safe harness in `memexplore.js`: handler gated by
  `g_armed`, arm via `watch_cmd.txt` ("0xADDR [size]"), auto-disarm to `watch_out.txt`, defensive
  unset on load, never hot-reload while armed. Validated: caught the chassis-velocity writers
  (Havok solver `applyImpulse` @rva 0x195f0d0 etc.). This is the accelerator for future
  struct/code mapping.
- **Reference mods (MIT/facts):** Ferrster gearbox mod confirms `Accel@TA+0x44`, `Gear_1@+0x70`,
  `PowerCoef@+0x38`, `IsInAutoMode@+0x3C`, `Diff@+0x4A`, `AWD@+0x49`, `NextGear@+0xE0` (so the
  earlier `+0xE0` "rpm" match was NextGear). It shifts by calling the game's
  `ShiftGear(Vehicle*,int)` (RVA 0xD54AB0 in *its* build) — the blueprint for a manual-shifter
  feature; find our build's RVA + a signature for patch durability.
- **Audio polish (open):** between-shift "multiple layers" doubling — the game crossfades engine
  layers by its own ground-speed RPM; our blanket volume multiplier lifted faded layers.
  `volOverride` cfg flag (pitch-only) improves it. Proper fix = take over the layer crossfade by
  our RPM.

## 2026-07-04 — Universal caps-based RPM + static-RE (Ghidra) pipeline

- **Universal gear-aware RPM, live:** RPM = `wheel_speed / gearbox_cap(gear)`, caps read from game
  data per-truck at runtime. Cap array chain: `TruckAction(+0x68) -> +0x58 (gearbox struct) ->
  +0x00 = [reverse, g1..gN]` floats (e.g. scout `[2,3,6,8,14,20]`, `g_truck_default`
  `[1.5,1.5,4,6,8,10]`). Reads via `tools/dev/memexplore.js` `gearCaps()`. Chassis speed is the
  wheel-speed proxy; one scalar `R` (chassis-m/s per cap-unit) auto-calibrates from a single
  upshift. Gear-aware, drops on every upshift, no per-truck tuning. Live tuning UI + virtual
  dashboard: `tools/dev/rpm_ui.py`, `rpm_dash.py`.
- **Confirmed (community + our data): SnowRunner has NO usable engine-RPM.** Tach is a cosmetic
  placeholder; shift logic + engine sound are ground-speed-based. So a gear-aware RPM must be
  synthesized (our model), not extracted.
- **Wheelspin gap (unsolved at this entry):** ground speed can't capture stuck-wheel spin. Hunt for
  the true wheel angular velocity was inconclusive — on the grippy flat test map we never produced
  real free wheelspin, so candidate fields (`wheel[i]->+0x60->+0x10 = 3.4`, a `13.2` broadcast)
  turned out to be **constants**, not the spin signal. Needs a low-traction surface (mud) to
  generate a changing signal for the live magnitude scan.
- **Static-RE pipeline stood up (root-cause path):** SteamStub `.text` is decrypted in the live
  process → dumped via Frida (`memexplore.js` `dumpModule`, one-shot) to
  `reference/snowrunner-dump.bin`; PE headers realigned (file-offset = RVA) by
  `tools/re/unmap_pe.py` → `reference/snowrunner-fixed.bin` (load with `r2 -B 0` or Ghidra PE
  loader). r2ghidra won't build vs Fedora r2 5.9.8 (API drift); using **Ghidra 12.1.2 headless**
  (`~/.local/opt`, JDK 21 at `~/.local/opt/jdk-21.0.11+10`, `JAVA_HOME_OVERRIDE` in
  `support/launch.properties`). Analyzed project cached; re-query with `-process ... -noanalysis`.
  Scripts: `tools/re/Decomp{Drivetrain,Physics,Vehicle}.java`.
- **Decompile findings:** pitch path = `FUN@rva 0xdfb2f0` (guarded by byte `DAT@0x2aa19a4`; calls
  voice vtable `+0x60`=SetVolume, `+0xd0`=SetFrequencyRatio), sole caller `FUN@0xdff1e0` =
  `UpdateSound` (reads a pitch off the sound object — **no wheel data in the audio path**, as
  expected). String anchors reach config parsers only: gearbox `AngVel` parser `FUN@0xd072c0`,
  engine `MaxDeltaAngVel` `FUN@0xd06190`, wheel/terrain shader `g_fAngVel` binding `FUN@0xe5c5f0`
  (reflection/name table, not per-frame writer). `TRUCK_CONTROL@rva 0x2A8EDD8` has a single xref (a
  getter) — the per-frame vehicle/wheel update takes the vehicle by param, so neither strings nor
  that global reach the strings-less runtime physics loop where wheel angvel lives.

## 2026-07-04 — Recon + feasibility, project bootstrapped

- Located install (path is machine-specific; resolved via `$SR_GAME`)
  (AppID 1465360, GE-Proton10-34).
- Confirmed the drivetrain data model from `initial.pak`: engine = single `Torque` scalar (no
  RPM/torque curve); gearbox = per-gear `AngVel` wheel-speed caps; engine sound = discrete
  crossfaded, pitch-shifted PCM loop layers. See [[Game Model|Game-Model]].
- Established the thesis: correct RPM = `wheel_ang_vel / gear_ratio`, derivable from existing
  state; the bug is a wheel-speed mapping in the audio/telemetry layer, missing the per-gear
  division + shift discontinuity.
- Binary recon on `SnowRunner.exe`: x64, **no Denuvo/EAC/VMProtect** (SteamStub only), imports
  **`XAudio2_9Redist.dll` by name** (proxy seam), engine voice already pitch-shifted
  (`Sounds/DisableReversePitch`), internal RPM float already drives tach + `logiWheelSetRpmLeds`.
  Engine is Saber "Husky"/MudRunner2 (descriptive asserts).
- **Verdict: feasible.** Two vectors documented (audio proxy vs. root-cause patch); Frida recon
  spike is the agreed first step. See [[Feasibility and Plan|Feasibility-and-Plan]].
- Platform decision: Linux-primary, ship/test on Proton; Windows dual-boot only as an optional
  accelerator for live recon if in-prefix tooling is too painful.

## 2026-07-04 — CRASH fix + FULL AUTONOMOUS OPERATION + live bug confirmation

- **Crash post-mortem:** the `--drive` combined script installed an `Interceptor.replace` on the
  tiny per-frame `SetPowerCoef` **even in trace-only mode** (design flaw) → Wine crash. Fixed:
  trace-only now = pure XAudio2 tracer (no game-code hooks, byte-identical to run-01); autodrive is
  opt-in + internally guarded. Game restored to stock, relaunched clean.
- **Built the autonomous-ops toolkit** (`tools/auto/`): screen capture (`spectacle` — validated,
  agent can SEE the game), health/launch/stop, `uinput_kbd.py` (pure-python virtual keyboard,
  PASS). Combined with `vgamepad.py` + Frida = full see→act→dump→health loop. KDE Wayland:
  `spectacle` works, XWayland x11grab is black. (Now folded into [[RE Toolchain|RE-Toolchain]].)
- **Ran the whole loop hands-off:** launched via Steam → title (Enter) → main menu (Continue) →
  loaded save → in a truck → released handbrake (Space) → drove (hold W) → auto transmission
  upshifted. All driven by screenshots + virtual keyboard, no human.
- **LIVE BUG CONFIRMED (recon-run-02):** engine voice #13 pitch ramped 0.8→1.2 in gear 1, stayed
  **pinned at 1.200 straight through the 1→2 upshift** (gear 1 @csv484204 → gear 2 @csv492225) —
  **no rev-drop on shift.** The thesis is now measured, not inferred. → [[Audio Pipeline|Audio-Pipeline]].
- Cleaned up: stopped game, uninstalled harness (stock). Autonomous rig ready to re-run (e.g. a
  cleaner open-road multi-shift capture) on request.

## 2026-07-04 — Autonomous build session (user away): full test/analysis toolchain

Built and (where possible offline) validated the machine-controllable driving + analysis stack.
All 6 planned tasks done.

- **L1 autodrive harness** `tools/frida-drive-harness.js` — hooks the game's own per-frame
  `SetPowerCoef` (SMT MIT AOB) on the game thread; overrides throttle + drains a gear queue
  (ShiftToHigh/ShiftToReverse/DisableAutoAndShift) safely; scenario runner on JS thread.
  Concatenated with the tracer into `combined.js`. AOBs unvalidated until a live run (fail-safe if
  they miss). `install-recon.sh --drive` enables it.
- **L2 virtual gamepad** `tools/vgamepad.py` — pure-Python uinput X360 pad (evdev wouldn't build:
  no Python.h). `--selftest` **PASSES**: device created, kernel-registered, events emitted,
  destroyed. (Fixed: dropped hat axes the kernel rejects; input_event needs 8-byte timeval `<qqHHi`.)
- **RPM→pitch simulator** `tools/model/rpm_model.py` — `rpm_norm=clamp(idle,1,wheel_angvel/
  AngVel(gear))`; sim PASSES (drop at every shift in fixed curve, none in buggy). Emits
  `expected_curve.{csv,png}` = regression ground truth.
- **Trace analyzer** `tools/analyze-trace.py` — parses `xrecon-events.csv`, IDs the engine voice,
  checks drop-at-shift; on synthetic buggy data correctly returns "BUG CONFIRMED." Becomes the
  mod's pass/fail regression check.
- **Engine-audio DSP** `tools/model/analyze_engine_audio.py` — decoded ank_mk38 layers: idle~79Hz,
  low~78Hz, high~108Hz (1.36×). Layers = separate base-RPM recordings pitched ±20%. →
  [[Audio Pipeline|Audio-Pipeline]]. Batch base-freq table (109 trucks, `engine_base_freqs.json`):
  HPS detector got 72% into a plausible band but only 18% pass the idle≤low≤high monotonicity check
  → **flagged NOT authoritative** (octave ambiguity inherent to broadband diesel loops). Doesn't
  block the mod: the minimal fix scales the game's own ratio and needs no base freqs.
- Env notes: native gcc/cc present (Windows mingw still missing → mod DLL later needs
  `sudo dnf install mingw64-gcc`). numpy/scipy/matplotlib installed; ffmpeg present.
- Script v2 now installed as combined.js in Bin (trace-only, autodrive OFF) — next launch also
  free-tests whether the SMT AOBs resolve on this build.

**One launch closes the loop:** (1) `tools/install-recon.sh --drive` then launch SnowRunner, get
into a truck; (2) autodrive runs the scenario hands-free, quit after ~40s; (3) `python3
tools/analyze-trace.py tools/staging/xrecon-events.csv` → verdict + plot. If AOBs didn't resolve
(autodrive idle in log), fall back to manual driving; tracer still captures everything. Expect
verdict "BUG CONFIRMED" (stock game) — the baseline the mod must flip.

## 2026-07-04 — RECON RUN 01: approach validated end-to-end

- First live trace succeeded. **Frida-gum works under Wine** (the one unverified assumption).
  XAudio2 hooked, engine voices captured, typed float reads decode correctly.
- **Vector-B target found: `SnowRunner.exe+0xdfb32f`** sets engine-voice frequency ratio
  (6012/6022 calls); voice creation at `+0xdfb4a1`; 456-byte audio subsystem.
- **Correction:** the engine IS pitch-shifted via SetFrequencyRatio (continuous 0.746–1.184 on the
  engine layers; layers also pinned at 0.75/1.2 base offsets; 82% of all calls are 1.0 = non-engine
  voices). Not pure crossfade. Fix = override this one ratio input.
- Script v2: per-event CSV (`xrecon-events.csv`) with relative timestamps + min/max fix, for a
  structured correlation drive. → [[Audio Pipeline|Audio-Pipeline]].
- **Next direction (user call): build a machine-controllable driving harness** so test scenarios
  run without manual driving — reproducible correlation + eventual mod regression tests. (Now in
  [[RE Toolchain|RE-Toolchain]].)

## 2026-07-04 — Recon harness installed (compile-free ASI route); awaiting drive session

- Host has no C cross-compiler (mingw/wine/zig/clang all absent), so the xaudio2-proxy route is
  blocked without a `sudo dnf install mingw64-gcc`. Pivoted to the **compile-free injection**:
  Ultimate ASI Loader (`dinput8.dll`, prebuilt) → loads `frida.asi` (Frida gadget 16.7.19
  win-x86_64) → runs `tools/frida-trace-xaudio.js`. Game imports `DINPUT8.dll` so it loads at
  process init (before XAudio2). This only ADDS files to `Bin/` (game ships no dinput8.dll there) →
  uninstall is a clean delete; zero risk to originals.
- Added `tools/install-recon.sh` / `uninstall-recon.sh`, `tools/staging/` (dinput8.dll, frida.asi,
  frida.config). Script now also mirrors output to `tools/staging/xrecon.log` via Frida's File API
  (Proton stdout is unreliable), so results are captured to disk.
- Installed into Bin/. **Next: user launches + drives the 6-step protocol; then read
  `xrecon.log`.** Open risk (agent-flagged): frida-gum may not work under Wine — if the game hangs
  at launch (gadget stuck in listen mode) or crashes, `uninstall-recon.sh` restores stock and we
  fall back to the pure-C xaudio2 proxy (needs mingw) or Windows frida-server.

## 2026-07-04 — License cleared + duplication check: greenlit, novel

- **Licenses** (`gh api`): SMT **MIT**, Ferrster **MIT** → can build on/reuse code + AOBs with
  attribution; Noclip **no license** → reference its offset *facts* only, don't copy code.
  Correction: SMT last push is 2026-02-01 (not 07-03), ~5 months old.
  - **Noclip decision (user call):** cleared to use its `mappings.md` offsets (facts, not
    copyrightable); we do NOT copy its code (SMT-MIT covers injection; RPM logic is ours), so the
    missing license is a non-issue for our scope.
- **Duplication sweep: NOT built anywhere.** No mod remaps engine-audio pitch to gear-aware RPM or
  adds a shift rev-drop; "realistic sound" mods are all asset swaps; native mods stop at shifting
  logic. RPM-synced audio is a loud, unanswered community request (SnowRunner *and* RoadCraft).
  This would be first-of-its-kind. See [[Prior Art|Prior-Art]].
- New leads: more MIT gearbox forks (SMGM public 12-gear/clutch, G29 H-shifter); shared native-mod
  stack = ASI loader + Kiero(DX11) + ImGui + OIS → ASI loader is a 2nd injection option alongside
  the XAudio2 proxy.
- **Decision: proceed.** Build on SMT (MIT) for the vehicle-state/anchor layer; the audio RPM-remap
  is greenfield and ours.

## 2026-07-04 — All 5 recon agents in; feasibility fully de-risked

- **Static RE** — `.text` is SteamStub-encrypted (entropy 8.0): static disassembly needs
  Steamless-unwrap/memory-dump first (runtime hooking unaffected). Import = `XAudio2Create` by
  ordinal 1. RTTI anchors found: RPM → `GAME_HUSKY_UPDATE_JOB`/`mrPHYSICS_UPDATE_JOB` (Havok) + the
  `logiWheelSetRpmLeds` call site; pitch → `ASYNC_TRUCKS_EFFECTS_UPDATE`/`SOUND_EMITTER`/
  `AUDIO_DEVICE_CONTROLLER`. RPM signal also feeds TrueForce haptics (submix voice). →
  [[Ghidra Functions|Ghidra-Functions]]; folded into the attack-plan vector B.
- **Deep data-model** — confirmed NO rpm-range in data (hook owns idle/redline); NO wheel
  radius/final-drive needed (radius="1" mesh scale; ratio is dimensionless); engine audio fully
  code-driven (must intercept pitch); Gauge InputTypes = engineEnabled/speed/fuel/rpm/none, `rpm`
  normalized `(0;1)`. **Formula simplified to `rpm_norm = clamp(idle, 1, wheel_angvel /
  AngVel(gear))`** — maps straight onto the tach. → [[Game Model|Game-Model]].
- **Net:** every open feasibility risk is now closed. Audio hook lands (native redist under
  Proton), vtable layout verified, vehicle-state read is a solved port (SMT AOB), RPM math is a
  one-liner needing no data the game lacks. Remaining unknowns are execution, not viability: (1)
  does frida-gum actually fire under Wine (else pure-proxy fallback), (2) positively ID the RPM
  float vs. just computing it, (3) confirm `TruckAction` offset (`Vehicle+0x68` vs `+0x80`) live.

## 2026-07-04 — Recon results landing (3 of 5 agents in)

- **XAudio2 vtable ref** — confirmed script's indices/offsets exactly; saved
  [[Audio Pipeline|Audio-Pipeline]]. Fold-ins: hook `XAudio2CreateWithVersionInfo` too; pin
  `win64` ABI on typed callbacks.
- **Frida-under-Proton** — **premise confirmed**: game loads its own native `xaudio2_9redist.dll`
  (no FAudio), so the XAudio2 hook lands. The `xaudio2_9=disabled` reg entry was diabotical.exe's,
  not ours. Native-Linux Frida is a dead end (ELF view); use **proxy-DLL + frida-gadget** — which
  is *also the shipping mod's loader* (recon and product converge), and it sidesteps SteamStub.
  Runbook now in [[RE Toolchain|RE-Toolchain]].
- **Community CE tables / prior art** — three GitHub RE projects already map the vehicle struct;
  **drafty46/SMT** (manual-transmission mod, current build, **AOB signatures + Detours**) gives a
  version-robust anchor to `Vehicle*`, plus throttle (`TruckAction+0x44`) and gear
  (`TruckAction+0x70`). Only unmapped field is engine RPM (small dissect of a known struct, or
  compute it). This **removes the memory-offset fragility risk**. See [[Prior Art|Prior-Art]].
- **Plan impact:** revised architecture = one C++ proxy DLL (Detours/MinHook) that AOB-anchors the
  vehicle, reads throttle/gear/velocity, computes gear-aware RPM, and drives the XAudio2
  engine-voice pitch — recon (Frida) and product share the same DLL loader. Evaluate building
  on/contributing to SMT vs. greenfield (license review first).
- Still running: static RE of the exe; deep pak data-model dive.

## 2026-07-04 — Frida recon script written; 5 investigation agents dispatched

- Wrote `tools/frida-trace-xaudio.js` + `tools/README.md`. It hooks XAudio2Create →
  CreateSourceVoice → per-voice SetFrequencyRatio/SetVolume/SubmitSourceBuffer, identifies engine
  layers (infinite-loop buffers + continuously modulated ratio), logs the ratio time-series, and —
  the payload — prints the **game-code caller of SetFrequencyRatio** (the vector-B target). Uses
  typed Interceptor.replace to read the float ratio (XMM1 isn't decodable via attach args).
  Includes a driving protocol to line up the trace with gear events. vtable indices are the
  standard XAudio2 2.9 layout, pending confirmation.
- Fanned out 5 recon agents: (1) exact XAudio2 vtable indices/offsets reference; (2) how to inject
  Frida under GE-Proton + audio-routing check (redist vs FAudio); (3) static RE of SnowRunner.exe
  (imports, string xrefs, RPM-float leads) → [[Ghidra Functions|Ghidra-Functions]]; (4) mine community CE tables
  for vehicle-struct offsets/AOB signatures; (5) deep pak data-model dive (Gauge InputTypes, wheel
  radius, any RPM-range data) → [[Game Model|Game-Model]].
- Open question the recon must settle: are throttle/gear/wheel-speed reachable from the
  pitch-caller's hook context? If yes, the shipped mod avoids fragile memory offsets.

## 2026-07-04 — Distribution set as a hard requirement

- Mod must be publicly distributable and work on **native Windows**, not just Proton. See
  [[Distribution and Portability|Distribution-and-Portability]]. Consequences folded into the plan:
  - Vector A (audio proxy) is the shippable core — COM-vtable hooks survive game updates; vector B
    (physics/offset patch) becomes opt-in/advanced, not the v1 default.
  - Derive RPM inputs from *inside* the hooked audio calls where possible; avoid fragile memory
    offsets in the shipped build; **fail safe** (passthrough) on anything unrecognized — never
    crash a user's game.
  - Installer renames the user's own `XAudio2_9Redist.dll`; never redistribute it or any game
    asset. Idempotent install + clean uninstall.
  - Multiplayer/ToS: cosmetic (sound/tach/LEDs) low-risk; physics changes gated + off by default.
    Channel = NexusMods / forums (not in-game mod.io).
  - Dev stays Linux/Proton-primary, but **every release gets a native-Windows validation pass**.
