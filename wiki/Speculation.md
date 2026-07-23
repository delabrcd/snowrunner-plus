# Speculation / TBD

**Unconfirmed hypotheses and open plans. Nothing here is proven.** Do not cite anything on
this page as fact. When an item is confirmed (live test, decompile, or first-party doc), move
it to the relevant wiki page and delete it here. When it's disproven, delete it with a one-line
note in [[Open Problems|Open-Problems]].

---

## H1 — `RPM = measured_wheel_angvel / AngVel_cap(gear)`, radius-free & universal

**Status:** unconfirmed (2026-07-09). Inference, not tested.

**Basis (these parts ARE confirmed):**
- First-party Saber docs define `AngVel` as "the maximum angular speed of the wheel when this
  gear is active" ([[Game Model|Game-Model]]).
- We read wheel angular velocity directly off the Havok wheel bodies ([[Memory Map|Memory-Map]]).

**The leap (NOT confirmed):** that our measured Havok body angvel and the game's `AngVel` are
the *same quantity in the same units*, so dividing one by the other gives RPM directly with no
per-truck constant. If true, the old "per-truck cap↔speed scale" problem is just an artifact of
having used ground speed (= angvel × radius) as the numerator.

**What blocks confirmation — the ~2× discrepancy (this part IS measured):**
- Empirically our top-cluster `wav` ≈ **2×** cap at an upshift; `effR = speed/wav ≈ 0.5`.
- Decompiled upshift threshold is `thrUp = 2*cap + k3` ([[Ghidra Functions|Ghidra-Functions]]).

So measured-`wav` and `AngVel` are **not** trivially equal (there's a clean factor ~2).
Competing explanations, both unproven:
- **(a) body/aggregation mismatch** — we aggregate a different body or set than the game's
  notion of "the wheel" (hub vs tire; mean-of-cluster vs a specific reference wheel), or
- **(b) threshold doubling** — the game compares `wav` to a `2×cap` value, i.e. the real
  redline angvel is `2×cap`, not `cap`.

## P1 — Proposed confirmation: hook the sim where the game divides

**Status:** proposed, not done.

Rather than read raw Havok bodies and reconcile the factor, hook the point where the game
itself compares live wheel/output angvel to the cap: `md_DrivetrainWheelGearSync @ 0xc3fe20`
and `hi_GetGearData @ 0xd72640` (which already emits `&cap`, `&thrUp`, `&thrDn`). Watchpoint /
read the local it tests against `thrUp/thrDn` — that value is the game's own wheel-angvel in
the game's own units, so `RPM = that / cap` would be exact, immune to both the body-choice and
unit questions. Also read the `DAT_` k-constants (k1/k2/k3). Standing watchpoint→decompile→label
method ([[RE Toolchain|RE-Toolchain]]).

**Alternative/cheaper check:** log `wav / cap` at a known operating point across several trucks
of different tire sizes. If it's a constant (~0.5) regardless of truck, H1 holds and the
constant is real; if it varies with tire size, H1 is wrong (radius hasn't cancelled).

## A *true* engine-RPM float probably does NOT exist (working position)

**Reasoning (user, 2026-07-09):** if the game held a correct gear-aware, wheelspin-aware engine
RPM, its audio/tach would already be correct — they aren't. So there is almost certainly **no
usable engine-RPM signal to find**; the only "rpm" the game has is the **ground-speed-derived
cosmetic** value that feeds the tach gauge and Logitech shift-LEDs (that pseudo-value IS
confirmed — [[Game Model|Game-Model]]). This is *why* the project **synthesizes** RPM rather
than extracting it ([[RPM Derivation|RPM-Derivation]]). Treat "hunt for the RPM float" as low
value; don't chase it as if a right answer is hiding.

The two leads below are therefore about locating the **cosmetic** pseudo-RPM value, and matter
**only** for a Vector-B binary patch (overwrite that one input with our synthesized RPM so tach
+ LEDs + audio all correct at the source) — and even that assumes it's a single shared scalar
rather than recomputed per-consumer, which is unconfirmed.

### H2 — the cosmetic pseudo-RPM may be an unlabeled `combineTruckAction` float
Candidates from struct scans: `+0xB0/B4/B8/BC`, `+0xD8`, `SwitchThreshold+0xDC`
([[Memory Map|Memory-Map]]). Watchpoint to see which (if any) drives the tach needle.

### H3 — reach it via `logiWheelSetRpmLeds`
The game pushes normalized RPM 0..1 to Logitech shift-LEDs via a GetProcAddress'd call
(`logiWheelSetRpmLeds`, string @ RVA `0x2481e00`, [[Ghidra Functions|Ghidra-Functions]]); its
float arg is the cosmetic value's consumer — a way to trace back to the input, if one exists.

## P2 — Asset service: snapshot HUD atlas SRVs via DX11 device hooks

**Status:** proposed, not built. Hook `ID3D11Device::CreateShaderResourceView` (vtbl idx 7) /
`CreateTexture2D` (idx 5) on the shared device to capture the HUD atlas SRVs **by dimension**
(512×512 → `hud_lib_ia3`, …) — a Level-1 route around the undiscovered SRV last hop
([[Open Problems|Open-Problems]], [[Asset and HUD System|Asset-and-HUD-System]]).

## P3 — Auto-learn the action registry + hash-intercept service

**Status:** designed, not built/validated. A `RegisterAction`-logging hook to auto-learn the
full 222-action hash→handler map, plus a trampoline-swap "intercept action by hash" framework
service ([[Input System|Input-System]], [[SnowRunner+|SnowRunner-Plus]]). Related overlay idea:
redraw the gear strip with ImGui primitives skinned by extracted plates, bundling Play / Ubuntu
Mono as a stand-in for the commercial HUD font.

## Older empirical model (single-truck only)

The `RPM_frac(gear) = clamp(speed / cap[gear+1], idle, overRev)` ground-speed model in
[[RPM Derivation|RPM-Derivation]] was validated on **one** 6×6 test truck and was
user-confirmed smooth *there*. It did **not** generalize (the per-truck failure is what
motivated all of the above), so treat its universality as unconfirmed too.
