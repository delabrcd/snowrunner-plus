# Feature: Drivetrain controls (diff-lock / AWD / low-range)  🔨

Direct control of diff lock, all-wheel drive, and the low-range `L−/L/L+` modes — including the
case where a gearbox **won't enable the diff locker unless you're in `L`**.

## What it does

- Toggle **diff lock** and **AWD** from our own binds.
- Command **low-range** `L−/L/L+` so diff-lock-gated gearboxes will accept the diff toggle.

## How it's implemented

- **Confirmed offsets** ([[Memory Map|Memory-Map]]): diff lock `TruckAction+0x4A`, AWD `+0x49`
  (byte-writable, live-confirmed independent 0↔1 flips), handbrake `+0x48`.
- **Low-range** = a **PowerCoef** multiplier on the low gear(s), `TruckAction+0x38`
  (`hi_Gearbox_PowerCoefPtr @ 0xd71750`) — not a separate XML `<Gear>` tag. Saber docs document
  only `<Gear>`/`<HighGear>`/`<ReverseGear>`, consistent with `L` being a runtime PowerCoef mode.

## Status & open issues

🔨 Diff/AWD reads confirmed and byte-writable; **commanding `L` and the diff-lock-in-`L` gate are
open** and this is the priority within low-range work (it's functional, not cosmetic). Open RE
questions — how to make the game consider the truck "in `L`", what the diff-lock enable path
reads, and RPM/shift correctness while PowerCoef scales cap/torque — are in
[[Open Problems|Open-Problems]]. Highest-leverage next step: watchpoint `TA+0x4A` while the game
refuses a diff-lock toggle out of `L` to see exactly what the enable check reads.
