# RPM Derivation

How we synthesize a faithful engine RPM from state the running game already has. This is the
headline feature of [[the platform|Home]] and the reason the audio fix is possible.

## The signal

- **Numerator = `wav`** — the MEAN angular velocity of the driven-wheel cluster, read from
  the Havok simulation island ([[Memory Map|Memory-Map]]). This is wheelspin-aware by
  construction: stuck-in-mud wheels spin fast while ground speed is ~0, so `wav` (and thus
  RPM) rises even though the truck isn't moving — exactly what the stock game can't do.
- **Denominator = the current gear's ratio**, derived from the gearbox `AngVel` caps.
- **Clamp** to `[idle, redline]` with an over-rev allowance (~1.15).
- **Gate on engine-on** (`Vehicle+0x768 bit0`) — RPM 0 when off, idle floor (~0.15) when on.

## What `AngVel` is — first-party definition (confirmed)

The official **Saber modding docs** define the gearbox `AngVel` attribute verbatim:

> **`AngVel`** — "The maximum **angular speed of the wheel** when this gear is active."
> Default `0`, range `[0.1; 32]`. (Identical wording for `<Gear>`, `<HighGear>`, `<ReverseGear>`.)

So `AngVel` is documented as **wheel angular velocity per gear** — not ground speed, not a
mechanical gear ratio. Related engine params (also documented): `MaxDeltaAngVel` = "limiter
for the maximum angular acceleration of the wheels" (mandatory); `EngineResponsiveness` =
"speed of increase of the engine speed."

> ⚠️ Whether this documented `AngVel` equals the **Havok body angvel we read**
> ([[Memory Map|Memory-Map]]) in the same units — and therefore whether
> `RPM = wheel_angvel / AngVel_cap` works directly — is **NOT yet confirmed**. We measured a
> clean ~2× factor between them (see below). The tempting "radius-free universal RPM"
> conclusion and how to confirm it live are on the [[Speculation|Speculation]] page, not here.

## The caps as a ground-speed shift ladder (empirical, single-truck)

Raw caps vector `[reverse, g1..gN, high]`, e.g. `[1.5, 1.5, 4, 6, 8, 10, 7.5]`
(`GetMaxGear = count − 2`). Empirically (game in passive/auto), the game **upshifts `g→g+1`
at ground speed ≈ `cap[gear+1]`**:

| shift | speed (m/s) | cap[g+1] | ratio |
|---|---|---|---|
| 1→2 | 4.1 | 4 | 1.03 |
| 2→3 | 6.35 | 6 | 1.06 |
| 3→4 | 7.5 | 8 | 0.94 |
| 4→5 | 8.9 | 10 | 0.89 |

Ratio ≈ 0.98, drifting down for taller gears (rolling-resistance asymptote).

## The model (confirmed for the test truck)

```
RPM_frac(gear g) = clamp( speed / cap[gear+1], idle, overRev )
```

- Within a gear, `cap[g]/cap[g+1] → 1.0` (e.g. g2: 0.67→1.0), giving a realistic sawtooth
  that **drops to 67–80% at every upshift** — the rev-drop the stock game is missing.
- Equivalent via wheel angvel: `wav / (cap[g+1] / effR)` where `effR = speed/wav` is the
  measured effective wheel radius (~0.505 m on the test truck, stable across gears/speed —
  `wav↔speed` is a fixed linear map). Radius cancels; **ground speed is the clean base, `wav`
  adds the wheelspin term** (`wav ≫ speed/effR` during spin → over-rev).
- Per-gear redline SPEED = `cap[gear+1]`. Top gear has no `cap[g+1]` (the trailing `high` cap
  is special) → extrapolate ×1.25.

## Stock transmission internals (🟢 decompiled, high confidence)

From `hi_GetGearData @ 0xd72640` (see [[Ghidra Functions|Ghidra-Functions]]), signature
`GetGearData(vehicle, gear, &torque, &thrDn, &cap, &thrUp, &distrib)`:

- **`cap = caps[gear]`** — the gear's OWN index (reverse→caps[0]), **not** `caps[gear+1]`.
  (Reconciles with the empirical "upshift at ≈cap[gear+1]" because `thrUp = 2*cap[gear] + k`
  ≈ cap[gear+1] for geometric caps.)
- **`torque = Torque(TA+0x50) / sqrt(cap*k)`** — lower gear = lower cap = more torque. This
  is how "low gear = more force" is implemented.
- **`thrDn = cap*k1 − k2`**, **`thrUp = 2*cap + k3`** — the cap-linear shift thresholds.
- HIGH gear (== GetMaxGear+1) is special-cased: `torque = Torque*k`, `thrDn = 0.35`,
  `cap = cap+k`.
- The gearbox scalar `hi_Gearbox_PowerCoefPtr @ 0xd71750` = `&(TA+0x38)` = **PowerCoef**
  (L/L+/L− multiplier). It scales effective cap/torque but is **NOT a final drive**.

## 🔴 Open: the per-truck cap↔speed scale

Measured, unexplained: caps are per-truck — truck A caps `[1.5..10]` ≈ its m/s; a crawler
`[0.5..3.5]` ≈ ⅓ its m/s → RPM pins ~114%. Also measured: our top-cluster `wav` ≈ 2× cap at
an upshift, and `effR = speed/wav ≈ 0.5`. Decompiled: `thrUp = 2*cap + k3`
([[Ghidra Functions|Ghidra-Functions]]). PowerCoef is a mode multiplier, not a final drive.

These measurements are facts; the *explanation* (and whether the [[Game Model|Game-Model]]
`AngVel`-is-wheel-angvel definition lets us drop the per-truck scale) is a hypothesis on the
[[Speculation|Speculation]] page. Tracked in [[Open Problems|Open-Problems]].

**Interim (shipping now):** `tools/dev/src/20-rpm.js` learns redline per gear from max-grip
`wav` — a stopgap so RPM isn't pinned, until the game's own angvel/cap comparison is read.

## Why our shift MODES were broken (not the RPM math)

1. **Manual dead** — the `cfgOpen` (config-open) flag stuck `true`, so `pollKeys` swallowed
   every bind.
2. **Stuck in a mid gear (auto)** — `upThr` exceeded where tall gears actually reach redline;
   full-throttle upshift needed a speed the truck never reached. Fix: upshift threshold
   ≈ `0.85×cap[gear+1]` + an accel-stall trigger (RPM high AND speed not climbing → upshift).
3. **"RPM broken"** — mostly #1/#2 surfacing; the underlying `speed/cap[gear+1]` signal is
   correct. `engineOn` under load reads fine (all driving samples `v768=0x303`).

_Related: [[Memory Map|Memory-Map]] · [[Open Problems|Open-Problems]] · [[Speculation]]._
