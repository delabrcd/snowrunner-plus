# Feature: Tachometer & overlay  ✅

In-game, Steam-overlay-style HUD rendered over the game, showing the real gear-aware
[[RPM|Feature-RPM]] and drivetrain state.

## What it does

- **Tachometer** with a redline zone the needle pushes past (real-tach behavior) + up/down
  shift-point markers when the box is ours.
- **Gear panel** (big gear + AUTO*/MANUAL/CLUTCH mode), with an opaque option to occlude the
  game's own (wrong-in-manual) gear widget.
- **Speed**, throttle/load bars, box-mode badge, and **8 generic assignable gauges**
  (km/h · RPM · load · torque…, arc or bar).
- **Shifter strip** `[L] R N 1..gearMax [H]` with ease-out slide + glow animation.
- Rendering scale independent of size (font ladder 16/24/40/72px, crisp downscale); panels
  locked while playing, draggable/resizable while config is open; layout persists to a cfg file.
- **F9** toggles the whole overlay; **F8** (rebindable) opens the config panel.

## How it's implemented

- `mod/src/` — MinHook on `IDXGISwapChain::Present` (DXVK under Proton) + Dear ImGui;
  `overlay.cpp`, `gauges.cpp`, `widgets.cpp`, `bindings.cpp`. Fonts from the Wine prefix.
- Data via named-shm telemetry (`SRDT`, `mod/src/telemetry.h`) written by the Frida harness
  (`tools/dev/src/60-shm.js`), read per-Present with seqlock + ~50ms display smoothing → fluid at
  any fps. Config UI feeds the harness back over the `SRDC` reverse block.

## Status & open issues

✅ **Live-verified in-game under DXVK/Proton** — Present hooked, ImGui up, values matched the
telemetry during driving (including over-rev on wheelspin). This is the most mature feature.
Generalizes into the framework **overlay host** ([[SnowRunner+|SnowRunner-Plus]]).
