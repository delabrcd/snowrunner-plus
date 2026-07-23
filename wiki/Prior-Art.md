# Prior Art

Existing SnowRunner RE / drivetrain mods, the duplication sweep that confirms this idea is greenfield, and the licensing decisions governing what we may reuse. Feeds directly into [[Feasibility-and-Plan]] (input-reading is a *port*, not a from-scratch job) and [[Distribution-and-Portability]] (de-risks version-robust struct location).

## Is our idea already built? — NO (verified sweep, 2026-07-04)

A multi-platform sweep (NexusMods, mod.io, Focus forums, Steam, Reddit, YouTube, GitHub) found **no mod that remaps SnowRunner's engine-audio pitch to a gear-aware RPM**, nor one that adds a gearshift rev-drop or drives the tach/wheel-LEDs from a real RPM.

- **Exact match: none.** The complaint is real and loud but unsolved. Representative unanswered requests: Focus ["Fix engine sounds (constant revving…)"](https://community.focus-entmt.com/focus-entertainment/snowrunner/ideas/13615-fix-engine-sounds-constant-revving-shifting-sounds-etc); Steam ["Better transmission algorithm"](https://steamcommunity.com/app/1465360/discussions/0/6660355746101744445/) (nails our exact premise — wheel-speed limiter, "you want to DROP rpm on shift", gauges are "empty placeholders"); even RoadCraft (same devs, newer engine) ["Request for RPM-Based Audio"](https://community.focus-entmt.com/focus-entertainment/roadcraft/forums/116-general/threads/47222-engine-sound-system-feedback-%E2%80%94-request-for-rpm-based-audio) (May 2025) — no dev response, no mod.
- **"Realistic engine sound" mods: all asset swaps.** They replace clips referenced in vehicle XML; they cannot change the pitch-to-input mapping, so the broken wheel-speed behavior remains. Sources even state the popular one "does not solve the main problem — it just brings new audio."
- **Native/DLL mods: stop at shifting logic.** None reference sound/pitch/RPM/tach/XAudio2.

**Verdict: first of its kind.** The audio surface is open territory; the DLL-hook scene is proven but has never claimed it. (Full evidence: the duplication-sweep result in the session log.)

## Existing RE foundations we can build on

Three+ independent projects have already reverse-engineered the SnowRunner vehicle object. This turns "read throttle/gear/wheel-speed at runtime" from a from-scratch job into a **port**, and de-risks the biggest distribution concern (version-robust struct location).

| Project | What it is | Last push | Resolution | License | Value to us |
|---|---|---|---|---|---|
| **[drafty46/SMT](https://github.com/drafty46/SMT)** | Manual-transmission mod, C++ DLL + **Detours** hooks | **2026-02-01** | **AOB signatures** (self-relocating) | **MIT** ✅ | ★★★ primary — distributable DLL blueprint; build on with attribution |
| [Ferrster/Snowrunner-Manual-Gearbox-Mod](https://github.com/Ferrster/Snowrunner-Manual-Gearbox-Mod) | Original RE that SMT forks | 2025-03-10 | hardcoded module RVAs | **MIT** ✅ | Struct layout (RVAs stale) |
| [FindMuck/SnowRunner_Noclip](https://github.com/FindMuck/SnowRunner_Noclip) | Noclip + `mappings.md` struct map | 2026-04-01 | hardcoded RVAs | **none** ⚠️ | Havok velocity layout — read for *facts* only, don't copy code |

Adjacent forks/mods (shifting logic only — none touch audio): [drafty46/Snowrunner-Manual-Gearbox-Mod-Public](https://github.com/drafty46/Snowrunner-Manual-Gearbox-Mod-Public) (SMGM — up to 12 gears, clutch, immersive mode), [3riatarka H-shifter fork](https://github.com/3riatarka/Snowrunner-Manual-Gearbox-Mod-With-Logitec-H-Shifter-Support) (G29 support). The shared native-mod stack is **ASI loader + Kiero (DX11 hook) + ImGui + OIS** for the in-game menu, with Detours/AOB for transmission logic — so an **ASI loader is a second viable injection option** alongside the XAudio2 proxy.

Also: [tickelton frida-snowrunner-trainer](https://github.com/tickelton/misc.re) — savegame value-scan only, but **confirms Frida attaches to this process**. Forum CE tables (FR t=12273, cheatengine.net t=97272) are superseded by the GitHub work (fuel/money only, no RPM/gear).

## Licensing decisions (review DONE, `gh api .../license`)

- **SMT & Ferrster are MIT** — permissive; we may reuse code and AOB signatures in a distributed build, keeping the copyright/permission notice (attribution). **Building directly on SMT is clean.**
- **Noclip has NO license file** = all-rights-reserved by default (publishing on GitHub grants only view/fork *within* GitHub, not redistribution; intent to open-source is not a license). **Decision (2026-07-04): cleared to use Noclip's `mappings.md` offsets** — those are discovered *facts* about the binary (memory layout, Havok field positions), not copyrightable expression, so reproducing them is safe regardless of license. **We do NOT copy its Lua/`src` code** into the distributed build (SMT-MIT covers the anchor/injection code; the RPM logic is ours), so the license never bites. If code reuse is ever wanted, open an issue asking the author for an MIT `LICENSE` first.
- Correction to an earlier note: SMT's last push is **2026-02-01** (not 2026-07-03) — ~5 months old, still recent and MIT.

## Reusable intel

> The struct offsets / AOBs below are ported RE facts; the authoritative live-verified copy belongs on [[Memory-Map]] / [[Ghidra-Functions]]. Reproduced here as the prior-art provenance record.

### Anchor: `TRUCK_CONTROL` singleton → current vehicle (SMT, current build)
```
AOB (anchor fn that writes the singleton):
  40 53 48 83 EC 20 48 8B D9 E8 ? ? ? ? 33 C9 48 89 18
resolve the rip-relative global from that site, then:
  [TruckControlPtr]              -> combine_TRUCK_CONTROL*
  combine_TRUCK_CONTROL + 0x08   -> Vehicle*  (the truck you're driving)
```
Stable entry point. Everything below hangs off `Vehicle*`.

### `combineTruckAction` — throttle + gear
```
Vehicle + 0x80  -> combineTruckAction*   (SMT comment says +0x68 — VERIFY LIVE; the 0x18
                                          discrepancy between the two mods is the #1 thing to nail down)
  +0x44  float  Accel        <-- THROTTLE INPUT
  +0x70  int32  Gear_1       <-- CURRENT SELECTED GEAR (-1=R, 0=N, 1..n)
  +0x74  int32  Gear_2       (target gear)
  +0x38  float  PowerCoef
  +0x3C  bool   IsInAutoMode
  +0x40  float  WheelTurn
  +0xDC  float  SwitchThreshold  (auto-shift threshold — RPM-adjacent)
  +0xE0  int32  NextGear
  +0xB0/B4/B8/BC, +0xD8  float  UNLABELED  <-- prime RPM/engine-load candidates
```

### Wheel speed / ground velocity — Havok rigid body (Noclip)
```
Vehicle + 0x5C8 -> chassis hkpRigidBody
  hkpRigidBody +0x230 / +0x238  float  Linear Velocity X / Z   (ground-speed proxy)
  hkpRigidBody +0x240/244/248   float  Angular Velocity (pitch/yaw/roll)
Per-wheel angular velocity: wheel rigid bodies via the sim-island array
  (hkpRigidBody+0x128 -> island -> +0x60 array), or Vehicle+0x1F8 wheel vector
  (TRUCK_WHEEL_MODEL fields UNMAPPED — would need dissecting).
```

### Damage/fuel (Noclip; offsets ~2023, structure holds)
```
Vehicle +0x140 -> gearbox damage, +0x148 -> engine damage (each: +0x38 cur, +0x3C max)
Vehicle +0x58 (or +0x78 SMT) -> addon model (+0x568 fuel, +0x570 max fuel)
```

### Gearbox-function AOBs (SMT, current build — reusable with Frida `Memory.scan`)
`ShiftGear`, `GetMaxGear`, `ShiftToHigh`, `ShiftToReverse`, `SetPowerCoef`, `SetCurrentVehicle`, `DisableAutoAndShift` — full byte patterns in `evidence/` / SMT's `memory.cpp`. Several share the `48 8B 41 68` prelude = `mov rax,[rcx+0x68]`.

### The one real gap: engine RPM
**No project has labeled an engine-RPM float.** But we now reach `combineTruckAction` for free, so finding it is a small dissect of a known ~0x440-byte struct, not a blind scan. Priority candidates: unlabeled floats at `+0xB0/B4/B8/BC`, `+0xD8`, and `SwitchThreshold +0xDC` (auto-shift is inherently RPM-driven → RPM almost certainly lives in/near this struct). Fallback: compute `RPM = wheel_angvel × gear_ratio` from the Havok velocity + gearbox `AngVel`, which we were going to do anyway (see [[RPM-Derivation]]).

## Decision: build on SMT, RPM-remap is greenfield

- **Input-reading is no longer a risk.** SMT proves AOB-anchored struct reads are robust on the current build and maintainable across updates. The shipped mod reads throttle/gear/velocity via a ported AOB anchor instead of fragile raw offsets.
- **Vector B has a blueprint.** SMT is a distributable C++ DLL doing exactly this class of hook (Detours, AOB scan, vehicle-struct manipulation). Our RPM work follows its structure, and it already handles the "gearbox QOL" surface the mod wants.
- **Revised recommended architecture:** a C++ DLL (Detours/MinHook) that (1) AOB-anchors the vehicle, (2) reads throttle/gear/velocity, (3) computes a real gear-aware RPM, (4) drives engine-audio pitch — either by also proxying/hooking XAudio2 in the same DLL, or by fixing the RPM float in place so tach + LEDs + sound all correct together (dissect the float first). The Frida script stays the recon tool that IDs the audio voices and pitch call site.
- **Collaboration/base:** SMT is actively maintained and in-scope (manual gearbox) and MIT — building on / contributing to it is preferred over greenfield for the injection + input layer. The **RPM-remap itself is greenfield** — no prior art to fork, it is ours.
