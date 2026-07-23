# SnowRunner+ — RE Wiki

Reverse-engineering knowledge base for **[[SnowRunner+|SnowRunner-Plus]]**, a modular modding
framework for the Havok / Saber "Husky" engine family. The framework exposes reusable **hooks**
(game hooks + UI hooks) so mod authors don't each re-derive injection, offsets, overlay, and
input plumbing. The **drivetrain / RPM / engine-audio mod is the first module** on it — and the
source of most of the RE below.

This wiki is the single source of truth for *what we found in the binary*, so it never has to be
re-explained session to session. If a fact here disagrees with your memory, the wiki wins —
update it.

> **⚠️ Project state: early development.** There is no release and nothing here is installable
> as a normal mod. The drivetrain logic (RPM, audio takeover, auto-box) runs in the **Frida dev
> harness** (`tools/dev/src/`), not the C++ DLL — which today builds only the overlay, and the
> overlay just *renders* telemetry the harness publishes over shm. The RPM denominator is still
> unresolved per-truck ([[Open Problems|Open-Problems]]). Much of what follows describes
> **design intent and confirmed RE facts**, not shipped behavior; per-feature reality lives on
> [[Features]] with ✅ / 🔨 / 📋 markers.

> **Confirmed-only rule.** Every page here is for things we **definitely know** (live-validated,
> decompiled, or first-party documented). Unproven hypotheses, guesses, and open plans go on the
> [[Speculation / TBD|Speculation]] page — never stated as fact on a knowledge page. Confirm an
> item → move it here; disprove it → delete it.

> **Scope:** confirmed RE facts, memory offsets, labeled functions, the hook surface, and the
> derived RPM model. Live project state → [[Changelog]]. Product vision, launcher, and
> design rules → [[Platform Roadmap|Platform-Roadmap]].

---

## The framework

SnowRunner+ is **the platform**; individual mods are modules on it. See
[[SnowRunner+|SnowRunner-Plus]] for the full hook surface (offsets service, game-state hooks,
overlay/UI host, input interception, audio hooks, IPC bus, asset service) and which RE facts
back each one. v1 is one DLL: framework services + bundled mods, mod-agnostic code in
`framework/`.

---

## First module: the drivetrain mod

### The core problem (read this first)

**SnowRunner's built-in gearbox shifts and plays engine audio off of `throttle + ground
speed` — NOT engine RPM.** There is no real engine-RPM scalar; the on-dash tachometer is a
cosmetic placeholder driven by that same ground-speed mapping. See [[Game Model|Game-Model]].

**But the physics bodies still simulate the true rotational state.** When a truck is stuck in
mud with its tires spinning, the Havok wheel rigid bodies spin fast (high angular velocity)
while the chassis barely moves. That real wheel spin is fully observable — it's just never fed
back into the sound or the shift logic. See [[Memory Map|Memory-Map]].

**So the mod does two things:**

1. **Derive a faithful engine RPM** from the physics — `wheel_angvel / gear_ratio(gear)`,
   clamped `[idle, redline]`, wheelspin-aware. See [[RPM Derivation|RPM-Derivation]].
2. **Fix the sound simulation** so engine pitch / layer-crossfade and shift points follow that
   RPM instead of ground speed — including the missing rev-drop on every upshift. See
   [[Audio Pipeline|Audio-Pipeline]].

We **synthesize** a correct RPM from state the running game already has. We do **not** rebuild
the physics.

### Why this is the right model (settled, don't relitigate)

- Gearbox = single `Torque` scalar + per-gear `AngVel` caps (documented as max wheel angular
  velocity) — no torque curve, no RPM range in the data. ([[Game Model|Game-Model]])
- Engine sound = discrete PCM loop layers, pitch-shifted via XAudio2 `SetFrequencyRatio` and
  crossfaded by volume — driven by the ground-speed value. ([[Audio Pipeline|Audio-Pipeline]])
- The **true wheel angular velocity** is live in the Havok simulation island and spikes on
  wheelspin even when the chassis is still. ([[Memory Map|Memory-Map]])
- Correct RPM = `wheel_angvel / gear_ratio(current_gear)`, clamped `[idle, redline]`. Every
  term already exists at runtime. ([[RPM Derivation|RPM-Derivation]])

Feasibility is fully de-risked: x64, no Denuvo/EAC/VMProtect (SteamStub only), imports
`XAudio2_9Redist.dll` by name (proxy seam), Frida-gum works under Proton/Wine.
See [[RE Toolchain|RE-Toolchain]].

---

## Map of this wiki

**Platform & product**
| Page | What's in it |
|---|---|
| [[SnowRunner+|SnowRunner-Plus]] | The framework: hook surface, module list, design rules |
| [[Features]] | What the mod does — one sub-page per feature, with status |
| [[Platform Roadmap|Platform-Roadmap]] | Full vision: launcher, mod manager, MapNav, open questions |
| [[Architecture]] | v1 framework/mod split, input service, settings service |
| [[Feasibility & Plan|Feasibility-and-Plan]] | The feasibility verdict + the two attack vectors |
| [[Distribution & Portability|Distribution-and-Portability]] | Install contract, ToS posture, Windows/Proton parity |
| [[Prior Art|Prior-Art]] | Duplication sweep, reference mods, licensing decisions |

**RE knowledge** (confirmed facts)
| Page | What's in it |
|---|---|
| [[Game Model|Game-Model]] | The data model: gearbox `AngVel` caps, engine Torque scalar, cosmetic tach, audio layers |
| [[Memory Map|Memory-Map]] | Confirmed offsets: anchors, Vehicle / TruckAction / gearbox structs, Havok rigid body, wheel-angvel chain |
| [[RPM Derivation|RPM-Derivation]] | Computing RPM from physics; the caps↔RPM model; per-truck scale (open) |
| [[Audio Pipeline|Audio-Pipeline]] | Engine-loop layers, `SetFrequencyRatio` path, the shift-clunk trigger chain, the fix |
| [[Input System|Input-System]] | Action-hash registry, drivetrain setters, input suppress/inject design |
| [[Asset & HUD System|Asset-and-HUD-System]] | pak/Scaleform assets, HUD widget/rect map, asset-service seams |
| [[Ghidra Functions|Ghidra-Functions]] | Every labeled function: RVA, role, AOB signature, confidence |

**Process & status**
| Page | What's in it |
|---|---|
| [[RE Toolchain|RE-Toolchain]] | Ghidra project, Frida-under-Proton, driving harness, autonomous ops |
| [[Open Problems|Open-Problems]] | What's still unknown / next RE targets |
| [[Speculation / TBD|Speculation]] | Unconfirmed hypotheses + proposed confirmations — **not fact** |
| [[Changelog]] | The project journal, newest first |

---

## Ground-truth constants

- **Binary for static RE:** `reference/snowrunner-fixed.bin` (realigned PE dump, file-offset
  == RVA). Load with Ghidra PE loader or `r2 -B 0`.
- **Image base in the Ghidra DB:** `0x6ffffa670000` → **`rva = ghidra_VA − 0xa670000`**.
- **Install:** resolved via `$SR_GAME` (see `.env.local.example`)
  (AppID `1465360`, runtime GE-Proton10-34).
- Cached Ghidra project: `reference/ghidra-proj` (program `snowrunner-fixed.bin`).
  **Never re-import** — reuse with `-process snowrunner-fixed.bin -noanalysis`.
