# SnowRunner+ (the platform)

**SnowRunner+** is a modular modding framework for the Havok / Saber "Husky" engine family.
It exposes reusable **hooks** — game hooks and UI hooks — so mod authors don't each re-derive
injection, offsets, overlay, and input plumbing. The **drivetrain / RPM / engine-audio mod is
just the first module** built on it.

> This page is the RE-facing view of the platform: what hook surfaces exist and which RE facts
> back them. Full product/launcher vision, architecture, and the canonical **design rules** live
> in [[Platform Roadmap|Platform-Roadmap]] and [[Architecture]]. Live state in [[Changelog]].

## Structure

```
launcher (Tauri v2, cross-platform)  →  install discovery, GitHub update, mod manager
framework DLL ("the platform")       →  the hook services below
mods (plugins)                       →  drivetrain (this repo) · MapNav (wanted) · community PRs
```

v1 is pragmatic: **one DLL, framework + bundled mods with an internal module boundary** (no
cross-DLL plugin ABI yet). "Framework vs mod" is a code-organization discipline: mod-agnostic
services in `framework/`, mods consume them. The built artifact is being renamed from
`snowrunner-engine` → a SnowRunner+ name (pending mechanical sweep).

## The hook surface

Each service generalizes something the drivetrain mod already does. The RE facts backing each
are in this wiki.

| Service | What it exposes | RE backing |
|---|---|---|
| **Hook manager** | MinHook wrapper; crash-safe attach/replace discipline, prologue-signature verify + AOB rescan fallback | [[RE Toolchain|RE-Toolchain]] |
| **Offsets service** | AOB-anchor registry + per-build offset DB (versioned, updatable without recompiling mods) — *today's memory map becomes data* | [[Memory Map|Memory-Map]], [[Ghidra Functions|Ghidra-Functions]] |
| **Game-state hooks** | Read/write vehicle state (throttle, gear, flags), frame-synced tick via `ApplyGear` attach, Havok physics reads (velocity, angvel, transform) | [[Memory Map|Memory-Map]] |
| **Overlay host (UI hook)** | ONE Present/WndProc hook, shared ImGui context; mods register panels/gauges/config pages | overlay = `mod/src/` |
| **Settings service (UI hook)** | Mod declares a typed schema → framework auto-renders the config panel, persists to ini, hands back live values (no mod writes UI code) | [[Architecture]] |
| **Input/binds service (game hook)** | Dual-bind keyboard+controller actions + game input interception; execute via the game's OWN action functions (ShiftToGear/SwitchAWD/…), all AOB-anchored | [[Input System|Input-System]] |
| **Audio hooks** | XAudio2 source-voice vtable interception (pitch/volume/buffer) + one-shot event sink (`StartSoundObject`) | [[Audio Pipeline|Audio-Pipeline]] |
| **IPC/telemetry bus** | Named-shm seqlock blocks (SRDT/SRDC pattern), one region per mod | `mod/src/telemetry.h` |
| **Asset service** | Runtime loading from the player's OWN paks (zip + DDS/Scaleform); never redistributes assets | [[Asset and HUD System|Asset-and-HUD-System]], [[Asset and HUD System|Asset-and-HUD-System]] |

## Mods

- **Drivetrain / SnowRunner+ engine mod** (this repo) — derived RPM ([[RPM Derivation|RPM-Derivation]]),
  gear-aware engine audio + shift rev-drop ([[Audio Pipeline|Audio-Pipeline]]), custom
  auto-box, clutch, shifter UI. **The first consumer of every service above** and the source
  of most RE facts in this wiki.
- **MapNav** (wanted) — compass + minimap + waypoints. Already de-risked: position/heading are
  the chassis rigid-body world transform ([[Memory Map|Memory-Map]]); map imagery via the
  asset service.
- **Community mods** — via PRs against the manifest registry.

## Design rules (constrain all current work)

1. **Write new capability as if it lifts into the platform** — mod-agnostic, no drivetrain
   assumptions, clean headers.
2. **AOB anchors over raw RVAs** everywhere we hook/read; raw RVAs always carry a byte
   signature + rescan fallback. Offsets belong in data, not code.
3. **Versioned contracts** — shm layouts, config files, future plugin API all carry explicit
   layout versions; bump on change.
4. **Portability** — no machine paths in binaries; resolve relative to module + ini overrides;
   installers only ADD files; clean uninstall.
5. **Never redistribute game assets** — runtime-load from the player's paks.
6. **Cosmetic-first defaults** — physics-affecting features gated and off by default (ToS/MP
   safety).
7. **Windows parity** — every feature keeps a native-Windows path; dev is Linux/Proton-primary.

_Full vision, launcher tech (Tauri v2 + Flatpak), and open questions:
[[Platform Roadmap|Platform-Roadmap]]._
