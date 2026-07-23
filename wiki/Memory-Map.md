# Memory Map

Confirmed runtime offsets for the **current Steam build**. Live-validated via the Frida
explorer (`tools/dev/memexplore.js`) unless noted; cross-checked against the doski2
`snowrunner-real` reference (the only current-build map — Noclip's `mappings.md` is patch-18
and stale). ✅ = live-validated read.

> Offsets moved between patches; the *pointer chains* below are for THIS build. The
> `hkpRigidBody` internal layout is stable across builds (only the pointer to it moved).

## Anchors / globals (image base + RVA)

| Thing | Where | Notes |
|---|---|---|
| `TRUCK_CONTROL` singleton | `image + 0x2A8EDD8` | Resolve **via AOB** (version-robust), not the static RVA |
| `DRIVE_LOGIC` singleton | `image + 0x2A8EDC8` | = `TRUCK_CONTROL − 0x10` |
| Current vehicle | `[[TRUCK_CONTROL] + 0x08]` | pointer to the active `Vehicle` |

**TRUCK_CONTROL AOB** (SMT, MIT): `40 53 48 83 EC 20 48 8B D9 E8 ?? ?? ?? ?? 33 C9 48 89 18`
→ follow the `E8` call → first `48 8D 05` (`lea rax,[rip+d]`) in the callee → `&global`.
✅ Resolved exactly onto `image+0x2A8EDD8`.

## Vehicle struct

| Field | Offset | Notes |
|---|---|---|
| → `combineTruckAction` | **+0x68** | confirmed by the SetPowerCoef AOB (`mov rax,[rcx+0x68]`) |
| → chassis `hkpRigidBody` | **+0x5D0** | ✅ speed 0 at rest → ~14 m/s driving (was 0x5C8 in patch 18) |
| → wheels array (begin/end) | **+0x200 / +0x208** | `vector<TRUCK_WHEEL_MODEL*>` — gameplay/terrain models, **not** physics bodies |
| addon manager | +0x48 | |
| **`q_VehStateFlags`** | **+0x768** | ✅ **bit0 = engine running** (on→off diff `0x303`→`0x300`). `engineOn = *(u32*)(veh+0x768) & 1`. Confirmed under load too — all 208 driving samples read `0x303`. |

## combineTruckAction (Vehicle+0x68)

| Field | Off | Notes |
|---|---|---|
| PowerCoef (engine-power mult) | 0x38 | ~1.0 always; the field SMT's SetPowerCoef writes. **L/L+/L− multiplier, NOT a final drive** |
| IsInAutoMode (bool) | 0x3C | 0 = manual |
| WheelTurn (steer) | 0x40 | −1..1 |
| **Accel (throttle input)** | **0x44** | ✅ the real driver input |
| Handbrake / AWD / Diff (bools) | 0x48 / 0x49 / 0x4A | ✅ independent 0↔1 flips; direct byte-write togglable |
| Torque | 0x50 | 70000 = engine XML `Torque` |
| **Gear_1 (CURRENT gear)** | **0x70** | ✅ int32, −1=R 0=N 1..n; ApplyGear copies +0x74→+0x70 |
| **Gear_2 (COMMANDED gear)** | **0x74** | ✅ int32. **Manual shift = IsInAutoMode(0x3C)=0 + write target to 0x74** |
| SwitchThreshold | 0xDC | float, dynamic auto-shift threshold |
| NextGear | 0xE0 | int32 (Ferrster) — **not** RPM |
| engine load (live) | 0xB4 | float 0..1; jumps up at upshift, high on wheelspin → **load axis** |
| **→ gearbox struct** | **+0x58** | ptr; `+0x00` = `AngVel` caps array `[reverse, g1..gN, high]` (begin `+0x58`, end `+0x60`) |

## hkpRigidBody internal layout (stable across builds)

| Field | Offset |
|---|---|
| Linear velocity X / Y(up) / Z | +0x230 / +0x234 / +0x238 (`speed = hypot(X,Z)`) |
| **Angular velocity** pitch / yaw / roll | **+0x240 / +0x244 / +0x248** (rad/s) |
| World position (hkTransform) | +0x1A0 / +0x1A4 / +0x1A8 |
| Orientation rows fwd / up / right | +0x170 / +0x180 / +0x190 |
| Mass → hkpMotion | +0xB8 → hkpMotion +0xA4 = inverse mass |
| **Simulation island** | **+0x128** → island; `island+0x60` = `hkpRigidBody*` array, `island+0x68` = count |

## ✅ The wheelspin signal — TRUE wheel angular velocity

This is the physics state the stock game ignores. Chain:

```
Vehicle+0x5D0  → chassis hkpRigidBody
       +0x128  → hkpSimulationIsland*
       +0x60   → hkpRigidBody* array   (+0x68 = count)
   each body   +0x240/+0x244/+0x248 = angVel
```

- The **wheel** rigid bodies carry the true spin: ~0 at rest, spikes on wheelspin even when
  the chassis is still.
- **Aggregate = MEAN of the driven-wheel cluster** (the top-N |angVel| bodies, N = wheel
  count from `Vehicle+0x200`). A differential outputs the average of its wheels, so
  mean-of-wheels **is** the driveshaft speed by definition — this is what the visual
  propshaft displays. Mean is smooth; the earlier median-of-top-4 oscillated during mixed
  grip/spin. **User-confirmed smooth.** Code: `tools/dev/src/10-vehicle.js wheelAngvelIsland`.
- **Island size gotcha:** an 8-wheeler's island is 72–80 bodies. The walk must allow
  `cnt > 64` (cap raised to 512) or big trucks return `wav=0` → RPM 0. Fixed.
- ⚠️ `Vehicle+0x200` objects are `TRUCK_WHEEL_MODEL` (gameplay/terrain — grip/surface
  constants like `3.4`/`13.2` that fooled early scans), **NOT** the physics bodies. True spin
  is only on the Havok bodies above.

## What does NOT exist (hunts closed)

- **No driveshaft rigid body.** No island body spins faster than the wheels
  (`fastBody(>1.5×wav)=0`). The shaft is modeled as a Havok cog-wheel constraint; its angvel
  is never materialized.
- **No stored driveshaft/output scalar** anywhere in `Vehicle[0..0x800]` /
  `TruckAction[0..0x400]` / `gearbox[0..0x200]` holds a stable multiple of `wav`. The
  debug-HUD `AngVel` at `Vehicle+0x180` is ground-speed based (ruled out).
- ⇒ **The driven-wheel-cluster mean is the only RPM signal.** See [[RPM Derivation|RPM-Derivation]].

_Related: [[RPM Derivation|RPM-Derivation]] · [[Ghidra Functions|Ghidra-Functions]]._
