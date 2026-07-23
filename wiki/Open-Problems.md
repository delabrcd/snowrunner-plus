# Open Problems

What's still unknown or unverified. Newest/most-important first. When one is closed, move the
resolution into the relevant page and delete it here.

## 🔴 Per-truck cap↔speed scale (the big one)

**Confirmed facts:** caps are per-truck — truck A `[1.5..10]` ≈ its m/s, a crawler `[0.5..3.5]`
≈ ⅓ its speed → RPM pins ~114%. Measured: top-cluster `wav` ≈ 2× cap at upshift, `effR ≈ 0.5`.
Decompiled: `cap = caps[gear]`, `thrUp = 2*cap + k3`, `torque = Torque/sqrt(cap)`. PowerCoef is
a mode multiplier, not a final drive. First-party docs define `AngVel` as wheel angular
velocity ([[Game Model|Game-Model]]).

**Not yet confirmed:** how the documented `AngVel` maps to the Havok body angvel we read, the
cause of the ~2× factor, and whether that yields a radius-free universal RPM. Hypotheses +
the proposed live/decompile confirmation (hook the angvel↔cap comparison in
`md_DrivetrainWheelGearSync @ 0xc3fe20`) are on the [[Speculation|Speculation]] page (H1, P1).

**Interim:** `tools/dev/src/20-rpm.js` learns redline per gear from max-grip `wav`.
See [[RPM Derivation|RPM-Derivation]].

## 🔴 Commanding low-range `L` — gating feature (diff-lock dependency)

SnowRunner's shifter exposes low-range modes `L−`, `L`, `L+` (and `H` high). **Some gearboxes
won't let you engage the diff locker unless you're in `L`** — so being able to *command* `L`
from the mod is a **functional requirement** for diff-lock QOL, not a cosmetic nicety. This is
the priority within the low-range work.

**Confirmed pieces:**
- `L−/L/L+` are a **PowerCoef multiplier** on the low gear(s), not separate XML `<Gear>` tags —
  PowerCoef at `TruckAction+0x38` (`hi_Gearbox_PowerCoefPtr @ 0xd71750`); the shifter work
  encoded Low as `gear1 + PowerCoef`. Saber docs document only `<Gear>`/`<HighGear>`/
  `<ReverseGear>` — no L-range tag — consistent with L being a runtime PowerCoef mode.
- Diff lock = `TruckAction+0x4A`, AWD = `+0x49` (byte-writable), commanded gear = `+0x74`,
  current gear = `+0x70`, IsInAutoMode = `+0x3C` ([[Memory Map|Memory-Map]]).

**The open RE questions:**
1. **How to command `L`** — what exact state makes the game consider the truck "in L"? Writing
   PowerCoef@0x38 alone, or PowerCoef + a specific commanded gear/mode, or a dedicated selector
   field we haven't mapped? (Confirm what value/range PowerCoef takes for L−/L/L+.)
2. **What gates the diff locker** — find the code path that reads the gear/PowerCoef mode when
   the diff-lock toggle is refused, so we know whether writing our own state satisfies it or
   the game checks an internal mode we must set the game's own way (e.g. via its L-select
   function, AOB-anchored). Watchpoint `TA+0x4A` / trace the diff-lock enable check.
3. **RPM/shift behavior in low range** — whether the RPM model, auto-box, clutch, and shifter
   UI behave correctly while PowerCoef scales effective cap/torque. Untested in-game.

Needs an in-game session on a truck with a low-range, diff-lock-gated box. Until tested, assume
nothing about L-range correctness.

## 🟡 Exact shift-clunk trigger path

`StartSoundObject @ 0xdfe630` is the confirmed sink, but whether the clunk arrives via the
explicit `PlaySoundEventByHash` path or the animation-keyframe path is undetermined — the
gear-shift event hash is data-driven (baked from the truck XML sound-event name), not a static
constant. Needs one runtime correlation. The pointer-match suppression strategy works without
resolving this. See [[Audio Pipeline|Audio-Pipeline]].

## 🟡 `gearMax` reconciliation

`autoShift` uses `maxG = caps.length − 1` (upshifts into the high-range pseudo-gear) while the
newer `gearMaxOf` returns `count − 2`. Pre-existing disagreement, cosmetic for manual bounds /
telemetry, not a functional fault. Reconcile.

## 🟢 Per-truck engine base-freq table — known NOT authoritative

`tools/model/engine_base_freqs.json` (109 trucks) is octave-ambiguous — only 18% pass the
idle≤low≤high sanity check. **Do not rely on it.** The minimal audio fix scales the game's own
ratio and needs no base freqs. Only revisit with a YIN/pYIN octave-prior tracker if a full
re-synthesis is ever needed. See [[Audio Pipeline|Audio-Pipeline]].

## 🟡 Input system — unresolved gaps

From the input-dispatch RE ([[Input System|Input-System]]):
- **Handbrake** action hash not isolated statically, and no discrete `SwitchHandbrake` setter
  appears to exist (med-high confidence) — must be captured live.
- **Handler0** ("A" handler) return-value semantics + per-action press/hold/toggle/axis roles
  unresolved (needs runtime disambiguation).
- The `.data` **handler-pointer table** (~`0x2c47xxx`) is runtime-populated (static bytes zero)
  — readable only live.
- `ActionRegistryBuild @ 0xb5a2b0` AOB is **not unique** (6 matches) — needs a better anchor.
- `SetPowerCoef` / `SetCurrentVehicle` not isolated (appear inlined) on this build.

## 🟡 Asset service — HUD atlas SRV last hop

From the asset/HUD RE ([[Asset and HUD System|Asset-and-HUD-System]]): the engine-tex `+0xa8`
→ RHI-tex `+0x128[]` chain's **final hop to a raw `ID3D11ShaderResourceView*`** is a wrapped
handle with no RTTI — the DX11-backend struct layout is undiscovered and build/backend-specific
(blocks the direct-SRV HUD-skin route). Also the exact **`TexMgr` registry key string** the HUD
atlas is stored under is unknown. Proposed workaround (device-hook snapshot) is on
[[Speculation|Speculation]] (P2).

## 🟡 Distribution fragility — build-specific audio offsets

The `SetFrequencyRatio` DLL offset and the engine-voice caller RVA region are build-specific;
version robustness needs AOB anchors, not raw RVAs ([[Distribution and Portability|Distribution-and-Portability]]).

## Not yet mapped

- Per-wheel suspension travel; a direct wheel-torque write field.
- The `DAT_` k-constant addresses (k1/k2/k3) — blocks the scale fix above.
