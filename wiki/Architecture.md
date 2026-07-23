# Architecture

The concrete **v1** architecture that current work implements: the framework/mod
code split, the mod-DLL data flow, and the two foundational framework services —
**input/binds** and **declarative settings**. This is the design behind
[[SnowRunner+|SnowRunner-Plus]] (the platform's hook surface + RE backing) and the
[[Platform-Roadmap]] (the product vision). Design rules referenced here are from that
roadmap.

## Framework / mod code split

One C++ ASI DLL with an **internal module boundary** (Design Rule #1). No plugin ABI
yet — the roadmap's "monolithic DLL with an internal module registry, split when a
second team ships a mod." Mod-agnostic services live in `framework/`; the drivetrain
mod consumes them.

```
mod/src/framework/        ← THE PLATFORM (mod-agnostic; no drivetrain assumptions)
  hooks.{h,cpp}    MinHook wrapper: AOB-anchored resolve + attach (keep trampoline) /
                   detach, re-entrancy + null guards. Generalizes today's overlay
                   MinHook use.
  offsets.{h,cpp}  AOB-anchor registry -> resolved address table (the "offsets
                   service"; data, not code). Seeded from the input-system trace.
  input.{h,cpp}    Input-interception service (below).
  vehicle.{h,cpp}  Current-vehicle accessor (g_TruckControl image+0x2A8EDD8 -> +0x08)
                   + combineTruckAction (Vehicle+0x68) field-access helpers.

mod/src/  (drivetrain mod — CONSUMES the framework)
  drivetrain_input.{h,cpp}  binds config actions to framework input calls; polls
                   keyboard + XInput; owns suppression/injection policy. NOT
                   framework code.
  overlay / gauges / ...    (unchanged)
```

## Drivetrain mod — RPM + load simulation driving the audio

The first module. Goal: simulate real engine RPM and load from the **actual
drivetrain state** and *generate* the engine sound from that — the gearshift rev-drop
and load-dependent character emerge from the physics, they are not scripted. See
[[RPM Derivation|RPM-Derivation]], [[Feature-RPM]], and [[Audio Pipeline|Audio-Pipeline]].

```
[game memory] --read-only--> mem.c --state--> engine.c (sim) --targets--> hook.c --> XAudio2
 wheel speed                 (60-100Hz thread)   RPM, load           SetFrequencyRatio
 gear                                                                 (SetVolume later)
 throttle/PowerCoef
```

- **mem.c** — AOB-anchor the vehicle (ported from SMT, MIT); read-only each tick:
  chassis/wheel speed (Havok linear velocity), current gear (`TruckAction+0x70`),
  throttle (`PowerCoef +0x38` / `Accel +0x44`). Publishes to shared atomic state.
  Fail-safe: if the anchor doesn't resolve, the sim disables and the game's own audio
  passes through. **Read-only — no function replacement** (that's what crashed
  before).
- **engine.c** — the simulation (C port of `tools/model/rpm_model.py` + dynamics):
  - `rpm_norm_target = clamp(idle, 1, wheel_speed / gear_top_speed(gear))` —
    gear-aware, so the ratio jumps (RPM drops) at every shift. `gear_top_speed` from
    a per-gearbox ratio table (bundled from the game's `AngVel` caps; generic
    fallback if unknown).
  - **Flywheel inertia**: `rpm` chases `rpm_target` with a time constant → rev-hang
    on lift, smooth spool, blip on downshift. This is why it sounds like an engine.
  - **Load**: estimated from throttle vs. actual acceleration/slip (high throttle +
    low accel = lugging → RPM sags, heavier tone; low load = free rev). Drives
    layer/volume.
  - Outputs: `rpm` (→ pitch) and `load` (→ layer crossfade / heavy-turbo volume).
- **hook.c** — MinHook inline hooks:
  `XAudio2Create` → `CreateSourceVoice` (vtbl[5]) → `SetFrequencyRatio` (vtbl[26],
  shared function, hooked once). Engine voices identified dynamically (a voice that
  ever received a non-1.0 ratio = a pitched/engine voice — no version-fragile
  offsets); for those, **override** the ratio with the simulated value:
  `ratio = base_offset(voice) * rpm_to_pitch(rpm)`. Later: hook `SetVolume` (vtbl[12])
  to crossfade layers by load.

**Why this fixes it:** the game feeds `SetFrequencyRatio` a wheel-speed value capped
at ~1.2 (gear-unaware → no shift drop). We replace that input with
`rpm_to_pitch(simulated_rpm)`, which is gear-aware. At an upshift `wheel_speed` is
continuous but `gear_top_speed` jumps → RPM drops → pitch drops. Nothing is
hard-coded per-shift.

### Build / injection

- **Language: C++** (mingw `x86_64-w64-mingw32-g++` 16.1.1), statically linked
  (`-static -static-libgcc -static-libstdc++`) — no runtime deps. mingw ships
  `xaudio2.h`, so we use the real `IXAudio2` / `IXAudio2SourceVoice` COM interfaces
  (vtable indices cross-checked in [[Audio Pipeline|Audio-Pipeline]]). MinHook
  vendored (C, built with mingw gcc).
- **Injection**: built as `snowrunner-engine.asi` (rename pending — see
  [[Platform-Roadmap]]), loaded by the Ultimate ASI Loader (`dinput8.dll`) at process
  init, before XAudio2. A public release may switch to a `xaudio2_9redist` proxy; ASI
  is fine for dev.
- **Threading**: sim runs on its own thread (reads memory, integrates, publishes
  atomics). The `SetFrequencyRatio` hook (game audio thread) only *reads* a published
  value — no heavy work, no cross-thread game calls.

### Incremental, crash-averse build order

1. Scaffold + MinHook build → DLL loads via ASI, logs (no game hooks).
2. Hook `SetFrequencyRatio` as **identity + log** → confirm hooks fire, zero behavior
   change.
3. `mem.c` read-only drivetrain state → log real speed/gear/throttle while driving.
4. `engine.c` sim → override engine-voice pitch from simulated RPM. Validate (audio +
   analyzer).
5. Load → layer/volume crossfade. Config `.ini`. Per-truck gear tables.

Test on a flat, obstacle-free map (in-game **Mod Browser** proving-ground map, or
**Trials**) for clean multi-shift captures.

---

## Input / binds framework (design captured 2026-07-05)

Built as a **framework layer** (the first real platform piece) that the drivetrain
mod consumes. Grounded in [[Input System|Input-System]] (RVAs, AOBs, action
hashes). User-facing view: [[Feature-Input-Binds]], [[Feature-Drivetrain-Controls]].

### Input-interception service API (`framework/input.h`)

Mod-agnostic. Action identity is the game's **uint32 action hash** (the framework
exposes a named enum for resolved actions; raw hash for anything else). Surface (not
final signatures):

- `input_init()` — resolve all AOBs (offsets service), install the hooks below.
  Idempotent.
- **Suppression** — detour the semantic setters so stock input can be swallowed:
  `SwitchAWD@0xd7bc90`, `SwitchDiff@0xd7bcf0`, `DisableAutoAndShift@0xd76020`
  (covers manual/High/Neutral/Reverse — they tail-call it), `ShiftToAutoGear@0xd72340`.
  Each detour asks a policy callback "suppress this stock call?" → return without
  original (swallow) or call original (pass-through). **Default = pass-through**
  (cosmetic-safe, Design Rule #6).
- **Injection** — call the game's own setters with a `Vehicle*` from the global:
  `fw_awd(on)`, `fw_diff(on)`, `fw_shift(gear)` (→ DisableAutoAndShift /
  GearWriteCore), `fw_auto()`, `fw_high()/neutral()/reverse()`, and
  `fw_handbrake(on)` = direct `TA+0x48` byte-write (no setter exists). All resolve
  `Vehicle*` internally; no-op if none.
- **Generic primitive** — hook `RegisterAction@0xb71f20` at startup to (a) LOG the
  full hash→(handler0,handler1,slot) map — recovers the handbrake hash + any future
  action — and (b) let a consumer claim a hash and swap its set-handler for a
  trampoline. This is the reusable "intercept action by hash" service future mods use.
- **AOB-anchored resolution only** (Design Rule #2) — a game patch that shifts
  addresses still binds. RVAs in the trace are current-build sanity fallbacks.

Known action hashes (from the trace): AWD `0x716bfdbf`, diff `0xda0c5d2d`,
manual-shift `0xc4c3af6b`, auto `0xde225e27`, high `0xf58a3043`, reverse
`0x6f4ce2c7`, neutral `0x49877fd3`. Handbrake hash: capture via the RegisterAction
log (deferred).

### Coexistence with the live JS Frida harness

Not everything migrates at once. Ownership after this work:

| Concern | Owner | Mechanism |
|---|---|---|
| Player drivetrain **input** (gear up/down/neutral/high/reverse/low, AWD, diff, handbrake, clutch, mode-cycle) | **C++ framework+mod** | setter detours (suppress stock) + injection |
| Stock input **suppression** | **C++** | setter detours |
| RPM synthesis, telemetry shm, engine **audio** takeover | **JS harness** | unchanged (hooks `ApplyGear@0xc404f0`, writes TA + telemetry) |
| **Auto-box** decision (mode = ours-auto) | **JS harness** | unchanged: writes commanded gear `TA+0x74` directly |
| Live **mode** (game-auto / ours-auto / manual) | **C++** (authority) | published to JS via shm |

**No byte-level double-patch**: JS hooks `ApplyGear`; C++ hooks the *setters* +
`RegisterAction` — disjoint functions. Only shared state is **mode**; gear writes
never collide because mode gates who acts (JS auto-box runs only when C++ says
ours-auto; C++ manual injection runs only in manual).

**Safe handoff (no dead-input window):** C++ loads only on game restart; JS is always
live. Once the C++ input service initializes it sets **SRDC flags bit1 = "framework
owns input"** and publishes live **mode**. JS reads that flag each poll: **set → JS
stands down its input layer** (stops handling gear/AWD keys; keeps
RPM/telemetry/audio/auto-box); **clear → JS keeps full input handling** (today's
behavior — fully backward compatible). So an ASI without the input module, or a
pre-restart session, behaves exactly as now.

**Shm contract — SRDC layout v2 → v3** (`mod/src/telemetry.h`). Reverse channel
(C++ → JS) gains, appended (old fields unmoved; Design Rule #3):
- `flags` bit1 = framework-owns-input.
- `uint32 mode` = live mode: 0 game-auto, 1 ours-auto, 2 manual.

Both endpoints bump: `telemetry.h` (`SRDC_LAYOUT_V=3`) + `tools/dev/src/60-shm.js`.

**Build/install sequencing** (game is live): (1) C++ framework+consumer built +
installed (loads next restart); (2) JS handoff change published — safe: JS stands
down only when it SEES bit1, which only a restarted game with the new ASI sets; (3)
user restarts → C++ announces ownership → JS stands down input → C++ owns it. No dead
window in either order.

---

## Settings service (declarative config; design captured 2026-07-05)

A framework service so a mod exposes settings **without writing any UI code**: it
declares a schema, and the framework auto-renders the config panel, persists values,
and hands the mod its live values. Generalizes today's hand-written drivetrain config
UI (uiScale slider, modePolicy radios, bind rows, gauge add/remove) into data.
Foundational — it lands **before/with** the input-service consumer (otherwise we'd
build a bespoke config UI and immediately replace it). User-facing surface:
[[Feature-Overlay]].

### Model

A mod registers a **settings schema** = an ordered list of typed setting descriptors,
grouped into sections. The framework owns storage, rendering, and persistence.

```
Setting {
  key        stable id, unique within the mod (persistence + lookup)   e.g. "uiScale"
  label      display string                                            e.g. "UI scale"
  type       Bool | Int | Float | Enum | ActionBind | Header | Button
  // type-specific:
  Int/Float: min, max, step                (slider / drag)
  Enum:      option labels[]               (radio row or combo)
  ActionBind: 2 slots, keyboard VK + XInput button (reuses today's bind capture)
  Button:    onClick callback              (e.g. "reset to defaults", "add gauge")
  // wiring:
  value      framework-owned storage cell (bool/int/float/uint bind words/enum index)
  tooltip?   optional help text
  onChange?  optional callback(newValue)   (else mod reads value each frame)
  visibleIf? optional predicate            (conditional rows)
}

Section { title; Setting[] items }               // collapsible group in the panel
ModSettings { modId; displayName; Section[] sections }
```

### Framework API (surface)

- `settings_register(const ModSettings& schema)` at mod init — framework copies the
  schema, allocates/loads value cells, adds the mod to the config-panel registry.
- `settings_get(modId, key) -> value&` / typed helpers — mod reads its live values
  (or holds the returned pointer). Values update in place as the user edits.
- **Persistence** — framework writes/reads an ini section per mod
  (`[modId] key=value`), generic; no per-mod persistence code. ActionBind persists as
  the two `(type<<16)|code` words.
- **Rendering** — the overlay's config panel iterates the registry → one collapsible
  node per mod → renders each section/setting by type using the existing widgets
  (uiText, bind capture, sliders). **No mod touches ImGui.**
- **Reset** — per-mod and per-setting "reset to default" from the schema defaults.

### How the drivetrain mod uses it (replaces the bespoke config UI)

The drivetrain mod declares, e.g.:
- Section **"Display"**: `uiScale` (Float 0.6..2.5), `hideStockGear` (Bool), tach W/H
  (Int), per-gauge rows (dynamic — Button "add gauge" + generated ActionBind/Enum
  rows).
- Section **"Shifting"**: `modePolicy` (Enum: hot-swap / ours-auto / manual /
  stock-auto), and one ActionBind per game action: shift up/down, mode-cycle, clutch,
  neutral, low, high, **AWD, diff, handbrake** (the SrdtAction set).

The framework renders + persists all of it; the mod reads the values in its
input/overlay loops. `mod/src/gauges.cpp`'s config UI is refactored onto this service.

### Interaction with input service & JS coexistence

- The ActionBind settings **ARE** the drivetrain binds. The C++ input service reads
  them from the settings store and drives the game (setter detours + injection).
- During the JS coexistence window, the drivetrain mod **MIRRORS** the subset JS
  still needs (the CLUTCH bind, live `mode`, framework-owns-input flag) into the SRDC
  shm block. The settings service is the **C++-side source of truth**; SRDC is a
  coexistence mirror, not the general config store. When JS retires, SRDC shrinks to
  telemetry only.
