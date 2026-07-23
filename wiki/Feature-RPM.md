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

🔨 The signal is smooth and wheelspin-aware (**user-confirmed smooth**). The denominator comes
**straight from the game's gear data — nothing is learned or calibrated**:
- Redline angvel for a gear = the game's own upshift threshold
  `thrUp = 2*cap[gear] + 5.0`, scaled by PowerCoef (`TA+0x38`, the `L−/L/L+` low range) —
  decompiled from `hi_GetGearData @ 0xd72640` ([[Ghidra Functions|Ghidra-Functions]]).
  `redlineWavFor()` in `20-rpm.js` is the **single source of truth**, shared with the auto-box
  so the box shifts on exactly the RPM the player hears.
- This also accounts for the measured ~2× `wav`-vs-`cap` factor: the game compares wheel angvel
  against `2*cap + k`, so `2*cap` **is** the redline — it was never a scale error to correct.
- Pulling shift points from game data rather than learning them is a **hard requirement**:
  a learned redline silently calibrates around whatever the numerator happens to be, which is
  how an earlier inflated angvel source went unnoticed.
- RPM correctness in low-range `L−/L/L+` untested ([[Feature: Drivetrain controls|Feature-Drivetrain-Controls]]).
