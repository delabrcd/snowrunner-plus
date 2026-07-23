# Feature: Automatic gearbox  🔨

Our own automatic transmission, scheduled by the real [[RPM|Feature-RPM]] instead of the stock
ground-speed logic — with adjustable shift timing and a pre-emptive kickdown.

## What it does

- Shift points are **RPM thresholds blended by throttle**: `upThr = lerp(upRpmLo,upRpmHi,thr)`,
  `dnThr = lerp(dnRpmLo,dnRpmHi,thr)`. Heavy throttle holds gears toward redline.
- **Pre-emptive downshift (kickdown):** drops a gear as soon as RPM sags below the working band,
  before the engine bogs.
- Upshift signal = grip RPM (wheelspin-immune); downshift signal = true wheel RPM.
- All four thresholds + hold time are live sliders; up/down markers drawn on the tach arc.
- `\` cycles game-auto ↔ our-auto; `]`/`[` nudge + briefly pause the box in our-auto.

## How it's implemented

- `tools/dev/src/30-gearbox.js` (`autoShift`), on top of the manual-shift path
  ([[Feature: Manual shifter|Feature-Manual-Shifter]]).
- Runs inside `tick()`, which is frame-synced by attaching to
  `hi_DrivetrainUpdate_ApplyGear @ 0xc404f0` — the gear write lands on the same thread/frame the
  decision is made ([[Ghidra Functions|Ghidra-Functions]], [[RE Toolchain|RE-Toolchain]]).
- **Anti-hunt** (offline-sim validated): down-side hysteresis, instant-kickdown / slow-release
  scheduling throttle, post-downshift upshift margin, time debounce, over-rev guard.

## Status & open issues

🔨 Logic **passes the offline sim (ALL PASS, zero hunting)** on the running build, but the
**in-game feel pass is still pending**. Known tuning notes: upshift threshold should track where
tall gears actually reach redline (≈`0.85×cap[gear+1]`) + an accel-stall trigger; `gearMax`
bound needs reconciling ([[Open Problems|Open-Problems]]). Once tuned, port the policy into the
C++ ASI.
