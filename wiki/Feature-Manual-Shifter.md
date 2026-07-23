# Feature: Manual shifter  ✅

Full manual gear control, using the game's **own** gear-apply path so side effects are faithful.

## What it does

- Shift up / down, select neutral, and cycle gearbox mode (game-auto ↔ our-auto ↔ manual).
- Default binds `]` up / `[` down / `\` mode (all rebindable — see
  [[Feature: Input & binds|Feature-Input-Binds]]).

## How it's implemented

- Set `IsInAutoMode (TruckAction+0x3C) = 0` and write the target gear to `TruckAction+0x74`
  (commanded); the game's `hi_DrivetrainUpdate_ApplyGear @ 0xc404f0` copies `+0x74 → +0x70` and
  applies it next frame. Reversible, uses the game's own logic.
- Input layer in `tools/dev/src/30-gearbox.js` — 8 actions × 2 binds, XInput polling + edge
  detect, NEUTRAL / GEAR_LOW / GEAR_HIGH actions, mode-policy pinning.
- Offsets: [[Memory Map|Memory-Map]]; apply function: [[Ghidra Functions|Ghidra-Functions]].

## Status & open issues

✅ Working live. Low/High (`L`/`H`) gear encoding solved (`ta+0x58` float vector `[R,g1..gN,high]`,
`maxGear = count−2`). Commanding the low-range `L−/L/L+` modes specifically is still open —
[[Feature: Drivetrain controls|Feature-Drivetrain-Controls]].
