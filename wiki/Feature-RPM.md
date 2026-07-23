# Feature: Gear-aware RPM  🔨

The headline feature: a **faithful engine RPM synthesized from the physics**, wheelspin-aware —
the thing the stock game never does ([[Game Model|Game-Model]]).

## What it does

- Computes `RPM = wheel_angvel / gear_ratio(current_gear)`, clamped `[idle, redline]`.
- **Wheelspin-aware:** the numerator is the true Havok wheel angular velocity, so RPM rises when
  the tires spin free even if the truck is stopped (stuck in mud).
- Gates on engine-on (`Vehicle+0x768 bit0`) — 0 when off, idle floor when on.
- Feeds the tach ([[Feature: Overlay|Feature-Overlay]]), the engine audio
  ([[Feature: Engine audio|Feature-Engine-Audio]]), and the auto-box shift scheduler
  ([[Feature: Automatic gearbox|Feature-Auto-Gearbox]]).

## How it's implemented

- Numerator = **mean of the driven-wheel cluster** angvel from the Havok simulation island —
  `tools/dev/src/10-vehicle.js` (`wheelAngvelIsland`). See [[Memory Map|Memory-Map]] for the chain.
- Denominator + clamps + idle-hunt in `tools/dev/src/20-rpm.js`.
- Full model + the caps math: [[RPM Derivation|RPM-Derivation]].

## Status & open issues

🔨 The signal is smooth and wheelspin-aware (**user-confirmed smooth**), but the **denominator
scale is not final**:
- The per-truck cap↔speed scale is unresolved; `20-rpm.js` currently **learns** redline per gear
  from max-grip `wav` as a stopgap. See [[Open Problems|Open-Problems]].
- Whether the first-party `AngVel` definition gives a radius-free universal RPM (and the ~2×
  factor) is unconfirmed — [[Speculation|Speculation]] (H1/P1).
- RPM correctness in low-range `L−/L/L+` untested ([[Feature: Drivetrain controls|Feature-Drivetrain-Controls]]).
