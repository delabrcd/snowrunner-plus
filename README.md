# SnowRunner+

A modular modding **framework** for the Havok / Saber "Husky" engine family, plus the first
module built on it: a **drivetrain mod** that gives SnowRunner a real, gear-aware engine RPM —
driving the sound and the shift logic — and an **in-game dashboard** showing the truck
telemetry the stock HUD leaves out.

The framework exists so mod authors don't each have to re-derive injection, offsets, overlay
rendering, and input plumbing. It ships as a single Windows DLL: framework services plus
bundled modules.

> **Status:** actively developed, not yet released. The overlay, manual shifter, clutch, and
> input/bind system are live-verified in-game; RPM, engine audio, the automatic gearbox, and
> the drivetrain controls are built and in tuning. See [Features](wiki/Features.md).

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
never reaches the sound or the shift logic. So the mod:

1. **Derives a faithful engine RPM** from the live physics —
   `wheel_angular_velocity / gear_ratio(gear)`, clamped `[idle, redline]`, wheelspin-aware.
2. **Fixes the sound simulation** so pitch, layer crossfade, and shift points follow that RPM
   instead of ground speed — restoring the missing rev-drop on every upshift.
3. **Puts a real dashboard on screen** — the truck telemetry the stock HUD never shows.

We **synthesize** a correct RPM from state the running game already has. We do **not** rebuild
the physics. Details: [RPM-Derivation](wiki/RPM-Derivation.md),
[Audio-Pipeline](wiki/Audio-Pipeline.md).

## The dashboard

The most mature part of the mod, and useful on its own: an in-game overlay (Steam-overlay
style, ImGui over `IDXGISwapChain::Present`) showing drivetrain state the game keeps hidden.

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
mod/        the shippable DLL — framework services + modules (C++/CMake, vendored imgui + minhook)
tools/
  dev/      Frida recon script, assembled from src/ by build.sh
  re/       Ghidra headless scripts (decompile / hunt / label passes)
  synth/    engine-audio synthesis + spectral matching
  model/    RPM model fitting
  auto/     autonomous run/health helpers
docs/
  evidence/ reproducible extracts from the local install (XML, exe strings, env)
wiki/       all project prose — see above
```

Not tracked here: game assets (copyrighted), the Ghidra project and binary dumps
(`reference/`), and generated artifacts — see [`.gitignore`](.gitignore).

## Building and running

The mod is a **Windows PE DLL** and must be tested under Proton, the real target.

```bash
cd mod && ./install-mod.sh     # build + install into the game's Sources/Bin
./uninstall-mod.sh             # clean removal
```

Recon harness (Frida gadget via Ultimate ASI Loader, for RE sessions rather than play):

```bash
tools/install-recon.sh         # trace only
tools/uninstall-recon.sh
```

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
