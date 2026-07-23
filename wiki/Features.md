# Features

What SnowRunner+ actually does, one sub-page per feature. Each sub-page states: what it does,
**status**, how it's implemented (files / hooks / offsets), and open issues. Features are
documented at their **current** state — planned/untested parts are marked, not hidden.

**Status legend:** ✅ working (live-verified in-game) · 🔨 built, tuning or in-game test
pending · 📋 planned/not built.

## Drivetrain module (the first module)

| Feature | Status | What it is |
|---|---|---|
| [[Gear-aware RPM|Feature-RPM]] | 🔨 | Synthesized wheelspin-aware engine RPM from Havok wheel angvel ÷ gear cap |
| [[Engine audio sync|Feature-Engine-Audio]] | 🔨 | Engine pitch / layer crossfade driven by our RPM + the missing shift rev-drop; shift-clunk control |
| [[Tachometer & overlay|Feature-Overlay]] | ✅ | In-game ImGui overlay: tach, gear panel, speed, load bars, assignable gauges, shifter strip |
| [[Automatic gearbox|Feature-Auto-Gearbox]] | 🔨 | Our RPM-scheduled auto-box: throttle-blended shift points, pre-emptive kickdown, anti-hunt |
| [[Manual shifter|Feature-Manual-Shifter]] | ✅ | Manual gear up/down/neutral via the game's own apply path |
| [[Clutch|Feature-Clutch]] | ✅ | Hold = neutral with gear pre-select; shift-clunk learn/mute/replay in the clutch window |
| [[Drivetrain controls|Feature-Drivetrain-Controls]] | 🔨 | Diff-lock / AWD toggles + low-range `L−/L/L+` (incl. the diff-lock-in-`L` gating problem) |
| [[Input & binds|Feature-Input-Binds]] | ✅ | Dual-bind keyboard + controller actions, rebindable, in-game config UI, mode policy |

## Framework services (SnowRunner+)

The reusable hook surface these features sit on — offsets service, overlay/UI host, input
interception, audio hooks, IPC bus, asset service — is documented on [[SnowRunner+|SnowRunner-Plus]].

## Planned modules

- **MapNav** 📋 — compass + minimap + waypoints. De-risked (position/heading = chassis
  rigid-body world transform; map imagery via asset service). See [[SnowRunner+|SnowRunner-Plus]].
