# Game Model

How SnowRunner actually models the drivetrain and engine sound — the *why* behind the mod.
Everything here is confirmed from the `.pak` data model (all 11,572 XML in `initial.pak`)
plus binary RE. Raw extracts live in `docs/evidence/sample-engine.xml`,
`sample-gearbox.xml`, `sample-truck-sounds.txt`.

## The one-sentence version

**The stock game runs the gearbox and the engine audio off `throttle + ground speed`. It
has no engine-RPM concept. The tachometer is cosmetic.** Meanwhile the Havok physics *does*
carry the true rotational state (wheel angular velocity), which spikes on wheelspin — the
game just never uses it for sound or shifting.

## Engine data — a single torque scalar

- Engine = a **single `Torque` scalar** (e.g. `70000`). **No torque curve, no RPM axis.**
- The complete union of `<Engine>` attributes across all **63 engine files / 125 variants**:
  `Torque`, `EngineResponsiveness`, `MaxDeltaAngVel`, `BrakesDelay`, `FuelConsumption`,
  `DamageCapacity`, `CriticalDamageThreshold`, `DamagedMinTorqueMultiplier`,
  `DamagedMaxTorqueMultiplier`, `DamagedConsumptionModifier`, `Name`.
  - `EngineResponsiveness` (documented) = "speed of increase of the engine speed" / how fast
    applied torque ramps.
  - `MaxDeltaAngVel` (documented, mandatory) = "limiter for the maximum angular acceleration
    of the wheels" — cap on angular-velocity change per tick.
- **There is no idle RPM, no redline, no rev range, no MinRpm/MaxRpm, no torque-vs-RPM
  table — anywhere in the 11,572 XML.** → the hook must own **idle and redline itself**
  ([[RPM Derivation|RPM-Derivation]]).

## Gearbox data — `AngVel` caps are the only ratio data

- Gearbox = a per-gear `AngVel` array. **First-party Saber docs define `AngVel` as "the
  maximum angular speed of the wheel when this gear is active"** (range `[0.1; 32]`) — i.e.
  wheel angular velocity per gear, not a mechanical gear ratio. It is effectively an output
  speed limiter, not a torque multiplier — this is what the community means by "low gear just
  caps speed, it doesn't multiply torque."
- Layout `[reverse, g1..gN, high]`. Each gear child (`ReverseGear` / `Gear` / `HighGear`)
  carries **only** `AngVel` and `FuelModifier` — no torque multiplier, no explicit ratio.
  `HighGear` is an overdrive top gear (`IsHighGearExists`). `AngVel` is **monotonic
  increasing** across forward gears → higher gear = higher wheel-speed cap = lower ratio.
- The `<Gearbox>` element's own attrs are economy/damage only:
  `AWDConsumptionModifier, CriticalDamageThreshold, DamageCapacity, DamagedConsumptionModifier,
  FuelConsumption, IdleFuelModifier, Name, MinBreakFreq, MaxBreakFreq`. `MinBreakFreq`/
  `MaxBreakFreq` are the **shift-damage frequency window, not RPM**.
- **`AngVel` *is* the gear ratio, up to a constant.** The ratio of consecutive `AngVel`
  values gives the exact per-gear divisor / RPM step at each shift the hook needs (e.g.
  scout_default `6.0/3.0` = 2.0× drop, `8.0/6.0` = 1.33×).
- The game upshifts near the top of a gear's band (empirically ≈ where ground speed reaches
  the next cap) and derives per-gear torque as a function of the cap (lower cap ⇒ more
  torque). Internals in [[RPM Derivation|RPM-Derivation]].

Full `AngVel` dumps (`Rev` / `High` | forward gears):

```
Scouts   (gearboxes_scouts.xml)
  g_scout_default : 2.0 / 10.0 | 3.0 6.0 8.0 14.0 20.0
  g_scout_highway : 3.0 / 10.0 | 1.5 3.0 6.0 10.0 18.0 24.0
  g_scout_offroad : 1.5 / 8.0  | 3.0 6.0 12.0 16.0
  g_scout_finetune: 1.5 / 8.0  | 2.5 5.0 10.0 13.0
Trucks   (gearboxes_trucks.xml)
  g_truck_default  : 1.5 / 7.5  | 1.5 4.0 6.0 8.0 10.0
  g_truck_highrange: 1.0 / 14.0 | 1.5 4.0 8.0 12.0 15.0 18.0 21.0 24.0
  g_truck_offroad  : 0.5 / 8.0  | 2.0 6.0 8.0 12.0
  g_truck_finetune : 0.7 / 9.0  | 2.0 5.0 7.5 10.0
Special  (gearboxes_special.xml)
  g_special_default : 0.5 / 3.0 | 0.9 1.7 2.5 3.5
  g_special_offroad : 0.7 / 5.0 | 0.9 1.8 2.6 3.7 4.9
  g_special_finetune: 0.7 / 5.0 | 0.9 1.6 2.2 3.5 5.0
Unique   (gearboxes_trucks_unique_offroad.xml)
  g_truck_unique_offroad: 0.5 / 8.0 | 2.0 5.0 7.0 12.0
```

> ⚠️ How the documented `AngVel` relates to the Havok body angvel we read (and whether that
> gives a radius-free universal RPM) is a hypothesis, not a confirmed fact — see
> [[Speculation|Speculation]].

## No wheel radius / final drive / gear ratio in data

- `<TruckWheels>` carries a `Radius`, but it is **uniformly `"1"` across every wheel file**
  (only `Width` varies, 0.45…1.57) → `Radius` is a normalized mesh-scale multiplier, **not a
  physical radius in metres**.
- Searching all XML for `differential / finaldrive / gearratio / axlegear / torqueconvert /
  TransferCase` → **NONE.** Drivetrain topology is expressed only as shaft *connections*
  (`<Shafts>` / `DefaultTransferbox` / `AllWheelsTransferbox`) — which shaft drives which
  wheel set (AWD/diff topology), carrying **no ratios**.
- **Consequence:** true physical wheel radius is unavailable *and unneeded*. `RPM =
  wheel_angvel / gear_AngVel` is a pure ratio — both terms are already angular velocities, so
  no radius, no unit conversion. See [[RPM Derivation|RPM-Derivation]].

## Tachometer / gauges

- Gauge `InputType` set is **complete at 5 values**: `engineEnabled`, `speed`, `fuel`, `rpm`,
  `none`. **There is no `gear`, `throttle`, or `load` gauge** — the dashboard is not a source
  of gear/throttle state; those come only from runtime physics.
- Counts and ranges across all XML: `engineEnabled` ×631 (`(0;1)`), `speed` ×111 (**real
  km/h** ranges `(0;120)`…`(0;240)`), `fuel` ×110 (`(0;1)`), `rpm` ×106 (mostly `(0;1)`, a
  few clipped `(0;.8)`/`(0;.75)`/`(0.2;1)`), `none` ×26.
- **`rpm` is confirmed on 102 of 116 engine trucks** — the internal RPM float the mod targets
  is real and already wired to the needle. Its `InputRange` is **normalized `(0;1)`**, *not* a
  real-RPM axis — the game feeds a 0..1 fraction, so a gear-fraction from the hook drops
  straight in. `speed` uses true km/h, so speed and rpm are distinct internal signals.
- The `rpm` the game feeds the gauge is the **ground-speed-derived** value, so the needle is
  effectively a speedometer in disguise — it never drops on an upshift and never rises on
  wheelspin. This is the cosmetic-tach finding.

## The internal RPM signal already exists — and drives more than the tach

The game computes a pseudo-RPM float and consumes it in at least three places, so one
corrected formula fixes all of them ([[Ghidra Functions|Ghidra-Functions]],
[[Memory Map|Memory-Map]]):

- `<Gauge InputType="rpm" InputRange="(0;1)">` — the dashboard tachometer needle.
- `gui/rpm__d_a.tga` — the tach texture.
- `logiWheelSetRpmLeds`, `logiWheelGetRpmLedCaps` — the game pushes RPM to **Logitech
  steering-wheel shift LEDs**.

## Engine sound — discrete crossfaded pitched PCM layers, fully code-driven

- Per truck: a stack of separate **PCM loop layers** (idle / low / high), stored as `.pcm` in
  `shared_sound.pak`. Despite the extension the files are **RIFF/WAVE containers**, format tag
  `0x0002` = **MS-ADPCM, mono, ~44.1 kHz**. Layers are recorded at different base engine
  speeds (measured for `ank_mk38`: idle ~79 Hz, low ~78 Hz, high ~108 Hz firing).
- Full engine-layer tag set (per-truck `<Sounds>`): `EngineIdle`, `EngineLow`, `EngineHigh`
  (each with a `_2d` interior mix), `EngineHeavy`, plus optional `EngineTrans` (transmission
  whine, 53 trucks) and `EngineTurbo` (17 trucks); one-shots `EngineAccel`, `EngineRev`,
  `EngineStart`, `EngineStop`, `Reverse`.
- The game renders a target engine speed by **picking a layer and pitch-shifting it**
  (`SetFrequencyRatio`, observed range ~0.75–1.2) and **crossfading** adjacent layers by
  volume. Both are driven by the ground-speed value → so the pitch **pins through an upshift**
  instead of dropping. This is the audible bug we measured (recon-run-02). Details:
  [[Audio Pipeline|Audio-Pipeline]].
- **Layer selection and pitch are 100% code-driven — zero data knobs to lean on:**
  - Engine sound tags carry **only** `Sound=` and `IsSound2D=` — no per-layer RPM threshold,
    crossfade point, pitch base, or volume.
  - The `<Sounds>` element's only mix knobs are `DisableReversePitch` (bool, per-truck pitch
    toggle) and `EngineHeavyVolume` (float, static mix level, default `0.4` in the `Default`
    template in `_templates\trucks.xml`; overridden on exactly 1 truck). Neither helps RPM
    derivation.
  - `sound.sound_list` (in `shared_sound.pak`: 5,726 `.pcm` + this one index) is a bare
    binary logical-name → filename map (`uint64 count`, then per-entry `uint64 len` + path) —
    **no pitch, loop points, volume envelope, or RPM metadata.** (Assets can exist unbound:
    `ank_mk38_turbo.pcm` ships even though that truck's `EngineTurbo Sound=""`.)
  - → the sound **cannot be re-tuned by editing XML**; the mod must intercept the pitch input
    (audio-proxy or binary patch), consistent with the thesis.

## No throttle / engine-load signal in data

Every `throttle / load / pedal / gas / accelerat` match in the XML is **cargo/trailer "load"
mechanics** (`TrailerLoad`, `LoadArea`, `ManualLoads`, `IdleFuelModifier`, …) — none relate
to engine throttle position or engine load. Both are **runtime physics state only**; the hook
must read gear + wheel-speed from game state, not from any data-exposed signal.

## The bug, precisely

The audio/telemetry layer maps **wheel/ground speed** straight to engine pitch and to the
tach, **missing the per-gear division and the shift discontinuity**. Divide by the current
gear's `AngVel` and clamp to `[idle, redline]` and you get a faithful RPM — which also becomes
wheelspin-aware for free, because the physics already knows the wheels are spinning.

## What the mod does about it

1. Read the true wheel angular velocity from Havok ([[Memory Map|Memory-Map]]).
2. Compute `RPM = wheel_angvel / gear_ratio(gear)`, clamp `[idle, redline]` (idle/redline are
   the hook's own constants — data provides no rev range) ([[RPM Derivation|RPM-Derivation]]).
3. Drive engine pitch/layer-crossfade + our own shift points off that RPM
   ([[Audio Pipeline|Audio-Pipeline]]).

Feature breakdown: [[Features|Features]]. Remaining unknowns: [[Open Problems|Open-Problems]].

## Engine identity

Assert strings leak the codebase: `...\MudRunner2\Sources\SpinTires\Husky\Network\
net_replication_truck.cpp`, method `pTruck->IsEngineEnabled(true)`. The vehicle class is
Saber's **"Husky"** engine (MudRunner2 / SpinTires lineage). Descriptive asserts carrying
file/line and method names make static RE materially easier — see
[[Ghidra Functions|Ghidra-Functions]].
