# Feature: Input & binds  ✅

Rebindable, dual keyboard+controller bindings for every mod action, plus an in-game config UI —
the input layer the other drivetrain features sit on.

## What it does

- **8 actions × 2 binds each** (shift up/down, neutral, gearbox mode, clutch, diff/AWD…), each
  bindable to **both a keyboard key and an XInput controller button**.
- **In-game config UI** (F8, rebindable): click a binding, press a key/button to capture it;
  per-gauge toggles; **mode policy** radios (hot-swap / forced-ours-auto / forced-manual /
  forced-stock-auto); hide-stock-gear toggle. Persists next to the `.asi`.
- While the config panel is open, the WndProc hook feeds ImGui and **shields the game** from the
  mouse/keys.

## How it's implemented

- Harness input in `tools/dev/src/30-gearbox.js` (XInput polling + edge detect, mode-policy pin).
- Config UI in `mod/src/` (`gauges.cpp`/`bindings.cpp`); overlay→harness over the `SRDC` reverse
  shm block (`mod/src/telemetry.h`), which the harness polls (and honors the config-open flag so
  binds don't fire while rebinding).

## Status & open issues

✅ Working live (JS side hot-reloads; C++ config UI lands on game launch). Generalizes into the
framework **input/binds service** + **settings service** ([[SnowRunner+|SnowRunner-Plus]]) —
where a mod declares a typed schema and the framework auto-renders the config panel.
