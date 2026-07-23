# Platform Roadmap

> **Status:** product/platform vision. Planning captured **2026-07-05** from user
> direction. Nothing on this page is in flight yet — but the **Design rules** below
> constrain all current work. This page is the full product/launcher/roadmap view;
> for the condensed RE-facing hook-surface it maps onto, see
> [[SnowRunner+|SnowRunner-Plus]]. The concrete v1 code architecture that current
> work implements is on [[Architecture]].

## Vision

The drivetrain / QOL work ships as a mode called **SnowRunner+**. It is distributed
through a **cross-platform launcher** (Linux + Windows) that auto-detects the
SnowRunner install, fetches the correct mod build for the installed game version from
GitHub, and handles install / update / uninstall.

The launcher itself grows into an **open modding platform for the Havok / Saber
"Husky" engine family**: it hosts multiple mods, accepts community mods via PRs, and
provides a shared framework for hooking and interacting with the game so mod authors
don't each re-derive injection, offsets, overlay, and input plumbing. The
**drivetrain / RPM / engine-audio mod is just the first module** built on it.

### Naming & structure (decided 2026-07-05)

- Product/brand is **SnowRunner+**.
- The drivetrain mod **lives inside SnowRunner+**. v1 is pragmatic: **one DLL,
  framework + bundled mods with an internal module boundary** — no cross-DLL plugin
  ABI yet; split out when a second team ships a mod.
- "Framework vs mod" is a **code-organization discipline** for now (mod-agnostic
  services in `framework/`, mods consume them), not a binary boundary.
- Renaming the built artifact/target from `snowrunner-engine` to a SnowRunner+ name
  is a **pending mechanical sweep** (touches CMake target, `.asi` / `.ini` names,
  install scripts) — do as one pass when convenient.

## Architecture sketch

Three layers. The framework-DLL hook services are summarized (with RE backing) in
[[SnowRunner+|SnowRunner-Plus]]; the fuller sketch:

```
launcher (cross-platform app)
  - install discovery: Steam libraryfolders.vdf -> game dir (Proton & native
    Windows); Epic / MS Store later
  - update channel: GitHub Releases; per-game-build compatibility matrix
    (game exe hash/version -> framework+mod versions)
  - mod manager: enable/disable, per-mod config, PR-driven community mod registry
    (manifest repo; CI builds; signing story TBD)
  - installs: ASI loader (dinput8.dll) + framework DLL + mod plugins + generated ini
    (same only-ADD-files / clean-delete contract as today's install scripts)

framework DLL ("the platform"; working name TBD — e.g. HuskyKit)
  - lifecycle & plugin host: mods as DLL plugins with a small C ABI / versioned API
  - hook manager: MinHook wrapper; attach/replace discipline, crash-safe patterns
  - offsets service: AOB-anchor registry + per-build offset DB (versioned,
    updatable without recompiling mods; today's [[Memory Map|Memory-Map]] becomes data)
  - overlay host: ONE Present/WndProc hook, ImGui context shared by all mods
    (panels/gauges/config pages register in; today's gauges/config UI generalizes)
  - settings service: mod declares a typed schema; framework auto-renders the
    config panel, persists to ini, hands back live values — no mod writes UI code
  - input/binds service: dual-bind keyboard+controller actions PLUS game input
    interception (suppress stock controls, own vehicle actions), executed via the
    game's OWN action functions, all AOB-anchored
  - IPC/telemetry bus: named-shm seqlock blocks, one region per mod
  - asset service: runtime loading from the player's OWN paks (zip + DDS/Scaleform);
    the platform never redistributes game assets

mods (plugins)
  - SnowRunner+ drivetrain (this repo's mod): RPM/audio, auto-box, clutch, shifter UI
  - MapNav (wanted): map overlay + navigation helper / compass
  - community mods via PRs
```

The settings service and input/binds service designs are detailed on
[[Architecture]]; their user-facing features are [[Feature-Input-Binds]],
[[Feature-Drivetrain-Controls]], and [[Feature-Overlay]].

## Launcher tech (direction chosen 2026-07-05)

User weighed Qt vs WebView on size, dev ease, cross-platform reach, and modern looks:

- **Tauri v2** — web UI, Rust backend; ~5–10 MB binaries.
- **Linux channel** ships as a **Flatpak** (bundles WebKitGTK — solves the
  distro / Steam Deck webview problem; Deck users expect Flatpak anyway).
- **Windows** uses **WebView2** (+ a tiny bootstrapper fallback).
- **Qt rejected**: 40–60 MB bundles, heavier dev ceremony, smaller contributor pool
  than web tech.
- **Non-negotiable either way**: launcher brains (install discovery, GitHub
  update/verify, install/uninstall) live in a **headless Rust core crate with a CLI**;
  the GUI is a replaceable skin.
- **Escape hatch** if webview pain materializes: self-rendered native UI (Slint / egui)
  on the same core — a UI rewrite, not a launcher rewrite.

## MapNav mod (map overlay + compass) — feasibility notes

Already de-risked by existing recon (see [[Memory Map|Memory-Map]]). A wanted second
mod that proves the multi-mod platform:

- **Position / heading are mapped**: chassis `hkpRigidBody` world transform —
  position at `+0x1A0/1A4/1A8`, orientation rows fwd/up/right at
  `+0x170 / +0x180 / +0x190`. Compass = `atan2` on the fwd vector. Trivial to
  prototype in the existing overlay.
- **Map imagery**: level paks contain map textures (`level_*.pak`); runtime pak
  loading is the same asset-service path the HUD-skin work needs anyway.
- **Nav helper**: waypoint / objective positions need new recon (objective
  entities), or v1 is user-dropped waypoints + straight-line bearing/distance;
  road-aware routing much later.
- **Sensible build order**: compass gauge (days, fits the current gauge framework) →
  minimap panel with truck marker (needs map texture + world-to-map calibration per
  level) → waypoints → objective integration.

## Design rules (constrain all current work)

1. **Split framework from mod.** New capabilities (overlay host, binds, shm bus,
   offsets resolution, pak/asset loading) written as if they'll lift into the
   platform DLL: mod-agnostic, no drivetrain assumptions, clean headers.
2. **AOB anchors over raw RVAs** wherever we hook or read; raw RVAs always carry a
   byte signature + rescan fallback. Offsets belong in data, not code.
3. **Versioned contracts.** Shm layouts (SRDT/SRDC), config files, and the future
   plugin API all carry explicit layout versions; bump on change, never silently
   reshape.
4. **Portability discipline** (already enforced): no machine paths in binaries;
   resolve relative to the module + ini overrides; installers only ADD files; clean
   uninstall.
5. **Never redistribute game assets** — runtime-load from the player's paks.
6. **Cosmetic-first defaults** for ToS / multiplayer safety: physics-affecting
   features gated and off by default.
7. **Windows parity**: every feature keeps a native-Windows path (the launcher
   targets both; dev remains Linux/Proton-primary).

## Open questions (decide later)

- **Platform name & repo split** — framework repo vs mods monorepo vs manifest
  registry.
- **Plugin ABI** — C ABI + version handshake vs static-linking mods into one DLL
  initially (pragmatic v1: monolithic DLL with an internal module registry; split
  when a second team ships a mod).
- **Game-build detection** — exe hash vs version resource; how the offsets DB
  updates ship (launcher-fetched JSON, signed?).
- **Other Husky-engine titles** (Expeditions, RoadCraft) — how much of the offsets
  service generalizes.

_(Launcher tech was itself an open question, resolved 2026-07-05 — see above.)_
