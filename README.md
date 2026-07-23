# SnowRunner+

> ## ⚠️ Early development — not usable as a mod yet
>
> This is a **reverse-engineering project in progress**, not something you can install and
> play. There is no release, and the pieces that make it interesting don't run as a normal
> mod:
>
> - **The drivetrain logic lives in a Frida development harness**, not in the shippable DLL.
>   RPM synthesis, the engine-audio takeover, and the automatic gearbox are JavaScript in
>   `tools/dev/src/`, injected via a Frida gadget. Getting them running means a dev setup, not
>   a drop-in install.
> - **The C++ DLL currently builds only the overlay** (plus an optional XAudio2 hook) — and
>   the overlay is a *renderer*: it reads telemetry over shared memory that the Frida harness
>   writes. Without the harness it draws nothing.
> - **The core RPM model isn't finished.** The per-truck gear-cap scale is unresolved, so the
>   denominator is currently *learned* per gear as a stopgap and there's an unexplained ~2×
>   factor. RPM is smooth and wheelspin-aware, but not yet correct across all trucks.
>   See [Open-Problems](wiki/Open-Problems.md).
>
> What genuinely works is documented per feature, with honest status markers, in
> [Features](wiki/Features.md). Treat everything below as the design intent and the current
> research state — not a description of a working product.

A modular modding **framework** for the Havok / Saber "Husky" engine family, plus the first
module built on it: a **drivetrain mod** aiming to give SnowRunner a real, gear-aware engine
RPM — driving the sound and the shift logic — and an **in-game dashboard** showing truck
telemetry the stock HUD leaves out.

The framework's goal is that mod authors don't each have to re-derive injection, offsets,
overlay rendering, and input plumbing. The intended end state is a single Windows DLL carrying
framework services plus bundled modules; today that DLL hosts the overlay, and the rest is
still being proven out in the harness.

## The problem

SnowRunner's built-in gearbox shifts and plays engine audio off **throttle + ground speed —
not engine RPM.** There is no real engine-RPM scalar in the game:

- The **engine** is a single `Torque` scalar — no torque curve, no simulated crankshaft.
- The **gearbox** is a set of per-gear wheel-speed caps (`AngVel`), not torque ratios.
- The **engine sound** is a stack of discrete PCM loop layers (idle / low / high / heavy),
  crossfaded and pitch-shifted by that ground-speed value.
- The on-dash **tachometer** is a cosmetic placeholder fed by the same mapping.

The audible result: the note climbs with ground speed, there is no RPM drop on an upshift, and
the auto-box hunts in a continuous drone. It sounds like a CVT, not a diesel.

## The approach

The physics bodies *do* simulate the true rotational state — a truck stuck in mud spins its
tires fast while the chassis barely moves. That real wheel spin is fully observable; it just
never reaches the sound or the shift logic. So the mod aims to:

1. **Derive a faithful engine RPM** from the live physics —
   `wheel_angular_velocity / gear_ratio(gear)`, clamped `[idle, redline]`, wheelspin-aware.
   *Working in the harness; the per-truck denominator scale is still open.*
2. **Fix the sound simulation** so pitch, layer crossfade, and shift points follow that RPM
   instead of ground speed — restoring the missing rev-drop on every upshift. *In tuning.*
3. **Put a real dashboard on screen** — the truck telemetry the stock HUD never shows.
   *Working, and the most complete piece.*

The idea is to **synthesize** a correct RPM from state the running game already has, and not to
rebuild the physics. Details: [RPM-Derivation](wiki/RPM-Derivation.md),
[Audio-Pipeline](wiki/Audio-Pipeline.md).

## The dashboard

![The SnowRunner+ dashboard: tachometer with redline and shift markers, gear panel, and shifter
strip, drawn over the running game](docs/media/dashboard.jpg)

▶ **[Watch it in motion (15s, MP4)](docs/media/dashboard.mp4)** — the needle tracking real RPM
and dropping on each upshift as the box runs up through the gears. (GitHub can't play video
inline in a README, so this is a click-through.)

The most complete part of the project: an in-game overlay (Steam-overlay style, ImGui over
`IDXGISwapChain::Present`) showing drivetrain state the game keeps hidden. Live-verified under
DXVK/Proton.

It is a **renderer, not a data source** — it displays telemetry the Frida harness publishes
over shared memory, so it needs that harness running to show anything.

- **Tachometer** reading the real gear-aware RPM, with a redline zone the needle pushes past
  and up/down shift-point markers when the gearbox is ours.
- **Gear panel** — big current gear plus AUTO/MANUAL/CLUTCH mode, and an option to occlude the
  game's own gear widget (which is wrong in manual).
- **Shifter strip** `[L] R N 1..gearMax [H]` with slide and glow animation.
- **Speed, throttle and load bars**, plus **8 assignable gauges** (km/h, RPM, load, torque…,
  as arc or bar) you lay out yourself.
- Drag/resize while the config panel is open, locked while driving, layout persisted. **F9**
  toggles the overlay, **F8** opens config.

See [Feature-Overlay](wiki/Feature-Overlay.md). It generalizes into the framework's **overlay
host**, so other modules can draw their own panels rather than each re-deriving a D3D hook.

Feasibility is settled: standard x64 PE, **no Denuvo / VMProtect / kernel anti-cheat**
(SteamStub license wrapper only), imports `XAudio2_9Redist.dll` by name (a clean proxy-DLL
seam), and Frida-gum works under Proton/Wine. See
[Feasibility-and-Plan](wiki/Feasibility-and-Plan.md).

## Documentation

**The [`wiki/`](wiki/Home.md) is the source of truth** for everything prose — reverse-engineering
facts, design, plans, and the project journal. It's in GitHub-wiki format; start at
[Home](wiki/Home.md).

| Page | What's in it |
|---|---|
| [SnowRunner-Plus](wiki/SnowRunner-Plus.md) | The framework: hook surface, module list, design rules |
| [Features](wiki/Features.md) | What the mod does — one sub-page per feature, with status |
| [Game-Model](wiki/Game-Model.md) | How the game actually models engine / gearbox / sound |
| [Memory-Map](wiki/Memory-Map.md) | Confirmed offsets: vehicle, gearbox, Havok rigid body |
| [RPM-Derivation](wiki/RPM-Derivation.md) | Computing RPM from physics; the caps↔RPM model |
| [Audio-Pipeline](wiki/Audio-Pipeline.md) | Engine loop layers, `SetFrequencyRatio`, the fix |
| [Ghidra-Functions](wiki/Ghidra-Functions.md) | Every labeled function: RVA, role, AOB, confidence |
| [Changelog](wiki/Changelog.md) | The project journal, newest first |
| [Open-Problems](wiki/Open-Problems.md) | What's still unknown / next RE targets |

Knowledge pages are **confirmed-only** (live-validated, decompiled, or first-party documented);
unproven hypotheses live on [Speculation](wiki/Speculation.md).

## Layout

```
mod/        the C++ DLL (CMake, vendored imgui + minhook) — today: overlay + XAudio2 hook.
            Intended to grow into framework services + bundled modules.
tools/
  dev/      the Frida harness that currently does the real work (RPM, audio, auto-box,
            telemetry). src/*.js -> memexplore.js via build.sh
  re/       Ghidra headless scripts (decompile / hunt / label passes)
  synth/    engine-audio analysis + synthesis experiments (research, not shipped)
  model/    RPM model fitting
  auto/     run/health helpers
docs/
  evidence/ reproducible extracts from the local install (XML, exe strings, env)
wiki/       all project prose — see above
```

Not tracked here: game assets (copyrighted), the Ghidra project and binary dumps
(`reference/`), and generated artifacts — see [`.gitignore`](.gitignore).

## Building and running

**This is a development setup, not an install.** There is no packaged release, and none of
these produce a mod you can hand to someone else. Everything is a Windows PE DLL tested under
Proton, the real target.

The full experience — RPM, audio takeover, auto-box, and the dashboard — needs the **Frida
harness plus the overlay DLL together**, because the harness computes the telemetry the
overlay draws:

```bash
tools/dev/build.sh             # assemble tools/dev/src/*.js -> memexplore.js
tools/dev/install-devmod.sh    # Frida gadget + the ASI in overlay-only mode
```

The C++ DLL on its own (overlay + optional XAudio2 hook, no drivetrain logic):

```bash
cd mod && ./install-mod.sh     # build + install into the game's Sources/Bin
./uninstall-mod.sh             # clean removal
```

Recon harness for RE sessions — XAudio2 tracing only, no gameplay changes:

```bash
tools/install-recon.sh         # trace only
tools/uninstall-recon.sh
```

All of these only *add* files to the game's `Sources/Bin`, so uninstalling is a clean delete.

Paths are resolved, never hardcoded: the scripts autodetect the usual Steam library locations,
so normally there's nothing to configure. If your install lives somewhere unusual, either
export `SR_GAME` or copy [`.env.local.example`](.env.local.example) to `.env.local` (gitignored)
and set it there. The reference environment is SnowRunner (Steam AppID `1465360`) under
GE-Proton10-34.

Toolchain setup — Ghidra project, Frida under Proton, the driving harness — is documented in
[RE-Toolchain](wiki/RE-Toolchain.md).

## License

**[Mozilla Public License 2.0](LICENSE).** File-level copyleft: changes to SnowRunner+'s own
files stay open, but a module built on the framework can carry whatever license its author
wants — including a proprietary one. The intent is to keep the framework itself improvable by
everyone without dictating terms to the mods that sit on top of it.

Third-party code is bundled or ported under its own terms — SMT and Ferrster (MIT, the vehicle
anchor and struct layout), Dear ImGui (MIT), and MinHook (BSD-2-Clause). Full notices in
[THIRD-PARTY-NOTICES.md](THIRD-PARTY-NOTICES.md). Everything else in this repository is
MPL-2.0.

## Legal

An unofficial, non-commercial fan project, not affiliated with Saber Interactive or Focus
Entertainment. It ships **no game assets** and no copyrighted binaries — only original code and
reverse-engineering notes for interoperability. See
[Distribution-and-Portability](wiki/Distribution-and-Portability.md).
