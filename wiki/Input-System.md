# Input System

The reverse-engineered vehicle **input-action** system: how the game maps input → vehicle
actions (gear select, AWD, diff-lock, handbrake), the semantic drivetrain setters with
RVAs/AOBs, and how a mod can **suppress stock controls** and **own vehicle actions** faithfully.
This backs the [[SnowRunner+|SnowRunner-Plus]] framework's **input-interception service** and
the [[Feature: Input & binds|Feature-Input-Binds]] / [[Feature: Drivetrain controls|Feature-Drivetrain-Controls]]
features. See [[Memory Map|Memory-Map]] for the `Vehicle`/`combineTruckAction` layout and
[[Ghidra Functions|Ghidra-Functions]] for hook-point discipline.

- **Method:** static analysis only (Ghidra 12.1.2 headless, cached `snowrunner-fixed.bin`,
  image base `0x6ffffa670000`, **file-offset == RVA**). The live game was not touched.
  Scripts under `tools/re/`: `HuntInputSetters.java`, `HuntTAWriters.java`, `DecompInputMap.java`,
  `DecompCluster.java`, `TraceDispatch.java`, `FinalTrace.java`, `TraceDispatch2.java`.
- All AOBs byte-verified against the binary for **uniqueness (exactly 1 match)** unless noted.
- Confidence: ✅ live-validated · 🟢 high (decompiled) · 🟡 medium · 🔴 open/unknown.

## Architecture — a hash-addressed action registry 🟢

Vehicle input is a **hash-addressed action registry**, the same dispatch shape as the audio
system (see [[Audio Pipeline|Audio-Pipeline]]):

```
player key/button/axis
  → vehicle input-control component (0xb27xxx cluster)
  → registry lookup:  actionHash (uint32) → ActionBinding node
  → invoke the binding's SET handler(commandCtx)          [0xb8xxxx handler cluster]
       handler unpacks target Vehicle* from the command context, then calls…
  → the SEMANTIC drivetrain setter (Vehicle*, payload)     [0xd7xxxx drivetrain cluster]
       e.g. SwitchAWD / SwitchDiff / DisableAutoAndShift / ShiftToAutoGear / gear-core
  → writes the combineTruckAction field (Vehicle+0x68 → +0x48/49/4a/70/74/3c)
```

- **Action identity is a 32-bit hash** of the action NAME string (the plain strings are absent
  from the binary; same hashing family as audio events).
- The registry is a growable vector of **0x28-byte nodes**:
  `{ +0x00 vtable, +0x08 uint32 actionHash, +0x10 handler0, +0x18 handler1, +0x20 uint32 slot }`.
  The two handler slots are generic callbacks whose roles (onPress / onRelease / query) vary
  per action; the setter-bearing one is identified per action below.
- ~222 actions are registered at startup by `ActionRegistryBuild` via a `RegisterAction` helper.

Two clean interception surfaces: **(1) the semantic setters** (SMGM-style, one per drivetrain
control, `Vehicle*`+payload, lowest risk), and **(2) `RegisterAction`** (hook at startup to
learn the full hash→handler map and optionally swap any set-handler — the generic
"intercept action by hash" primitive).

## Semantic drivetrain setters 🟢

All operate on `Vehicle*` (rcx) and reach `combineTruckAction` via `Vehicle+0x68`. Field
offsets ([[Memory Map|Memory-Map]]): PowerCoef +0x38, IsInAutoMode +0x3c, Handbrake +0x48,
AWD +0x49, Diff +0x4a, CurrentGear +0x70, CommandedGear +0x74.

| Function | RVA | Sig | Behaviour | Conf |
|---|---|---|---|---|
| `GetMaxGear` | `0xd72300` | `int(Vehicle*)` | `(TA+0x60 − TA+0x58)>>2 − 2` over the gearbox AngVel-caps vector at TA+0x58 | 🟢 |
| `GearWriteCore` / `ShiftGear` | `0xd72570` | `bool(Vehicle*, int gear)` | clamps gear, writes **commanded gear TA+0x74**, notifies `FUN_0xb27b10`. Low-level "commit a shift". | 🟢 |
| `DisableAutoAndShift` | `0xd76020` | `void(Vehicle*, int)` | `TA+0x3c(IsInAutoMode)=0` then tail-jmp `GearWriteCore(veh,gear)` | 🟢 |
| `ShiftToAutoGear` | `0xd72340` | `void(Vehicle*)` | `TA+0x3c=1`, computes optimal auto gear from speed+wheel load, calls GearWriteCore, clears diff | 🟢 |
| `ShiftToHigh` | `0xb747f0` | `void(Vehicle*)` | `DisableAutoAndShift(veh, GetMaxGear(veh)+1)` | 🟢 |
| `ShiftToNeutral` | `0xb74910` | `void(Vehicle*)` | `DisableAutoAndShift(veh, 0)` | 🟢 |
| `ShiftToReverse` | `0xb74bd0` | `void(Vehicle*)` | `DisableAutoAndShift(veh, -1)` | 🟢 |
| `SwitchAWD` | `0xd7bc90` | `void(Vehicle*, bool)` | if a driven wheel exists (scans wheels veh+0x200/0x208, checks `wheel+0x2c8 → +0xe8`), writes **TA+0x49 = on** | 🟢 |
| `SwitchDiff` | `0xd7bcf0` | `void(Vehicle*, bool)` | guarded by `Vehicle+0xe8==0`; writes **TA+0x4a = dl** only if changed | 🟢 |
| `&PowerCoef getter` | `0xd71750` | `float*(Vehicle*)` | returns `&(TA+0x38)` — the address `SetPowerCoef` writes | 🟢 |

`SwitchDiff` decompile:
```c
if (*(int*)(veh+0xe8)==0 && *(char*)(*(veh+0x68)+0x4a) != dl)
    *(char*)(*(veh+0x68)+0x4a) = dl;
```
`Vehicle+0xe8` is the drivetrain **diff/AWD mode** dword (0/1/2), propagated to wheels
(`wheel+0x2c8 → +0xe8`); it gates `SwitchDiff`. Related mode helpers (write `+0xe8`, secondary,
not the TruckAction bool): `0xd74130` (clears TA+0x4a when no locking wheel), `0xd73fe0`
(updates AWD state / wheel `+0xe8=2`), `0xd79490` (`veh+0xe8 = !arg`).

### AOBs (entry, verified unique)
```
GetMaxGear           @0xd72300  48 8b 41 68 48 8b 50 58 48 8b 48 60 48 3b d1 75 03 33 c0 c3 48 2b ca 48
GearWriteCore/Shift  @0xd72570  48 89 74 24 10 48 89 7c 24 18 41 56 48 83 ec 20 48 8b 81 48 01 00 00 48
DisableAutoAndShift  @0xd76020  48 8b 41 68 c6 40 3c 00 e9 43 c5 ff ff
ShiftToAutoGear      @0xd72340  40 57 48 81 ec 80 00 00 00 48 8b 41 68 48 8b f9 48 89 9c 24 90 00 00 00
ShiftToHigh          @0xb747f0  40 53 48 83 ec 20 48 8b d9 e8 02 db 1f 00 48 8b cb 8d 50 01 48 83 c4 20
ShiftToNeutral       @0xb74910  33 d2 e9 09 17 20 00
ShiftToReverse       @0xb74bd0  ba ff ff ff ff e9 46 14 20 00
SwitchAWD            @0xd7bc90  4c 8b 89 00 02 00 00 33 c0 4c 8b 81 08 02 00 00 44 0f b6 da 4d 2b c1 4c
SwitchDiff           @0xd7bcf0  83 b9 e8 00 00 00 00 75 0c 48 8b 41 68 38 50 4a 74 03 88 50 4a c3
```

### Handbrake — no dedicated setter exists 🟡

`TA+0x48` (handbrake bool) is **not** written by a small analogous toggle. Its only writers are
the central per-frame vehicle sim/input-apply functions (the big `+0x38/+0x44/+0x48`
co-writers) and generic container code. There is no `SwitchHandbrake(Vehicle*,bool)` peer to
SwitchAWD/SwitchDiff (confidence the discrete function doesn't exist: **medium-high**, from an
exhaustive offset+xref scan). Own handbrake by **direct byte-write to `TA+0x48`** (SMGM writes
these fields directly — proven), or capture its action hash at runtime (below).

## Command handlers (layer b) 🟢

Cluster `0xb74xxx / 0xb89xxx / 0xb8bxxx / 0xb90xxx`. Each is a small callback
`handler(cmdCtx, …, payload*)` that unpacks `Vehicle*` from the command context
(`FUN_0xbcbf700(ctx+0x18)` variant accessor) then calls the setter. Note: handlers get the
target `Vehicle*` **from the command context**, not from the `g_TruckControl` global.

| handler RVA | calls | = action |
|---|---|---|
| `0xb8b240` | `SwitchAWD(veh, *bool)` | AWD toggle |
| `0xb90ec0` | `SwitchDiff(veh, *bool)` | diff-lock toggle |
| `0xb89d00` | DisableAuto / GearWriteCore | manual shift (press) |
| `0xb89db0` | `ShiftToAutoGear` | switch to auto |
| `0xb89f30` → `0xb747f0` | `ShiftToHigh` | top gear |
| `0xb8a380` → `0xb74910` | `ShiftToNeutral` | neutral |
| `0xb8a630` → `0xb74bd0` | `ShiftToReverse` | reverse |

## Registry & RegisterAction (layer c) 🟢

- **`ActionRegistryBuild @ 0xb5a2b0`** registers ~222 actions. AOB (32B, **6 matches — not
  unique**; anchor on an interior hash push if needed):
  `48 89 4c 24 08 57 48 83 ec 40 48 c7 44 24 30 fe ff ff ff 48 89 5c 24 58 48 8b d9 33 ff 48 89 39`.
  Called by the vehicle input-control component (`0xb27b10, 0xb28960, 0xb28be0, 0xb2a3b0,
  0xb6c8d0, …`).
- **`RegisterAction @ 0xb71f20`** (5-arg) and twin **`0xb72c10`** (6-arg, extra flag), sig
  `void(registry*, uint32 hash, handler0, handler1, uint32 slot)`. Allocates the 0x28-byte node
  and appends it. Prologue is generic — resolve via `ActionRegistryBuild`'s call sites, not a
  bare AOB.

### Confirmed action hashes (from the registration call site)

The **bold** handler carries the drivetrain setter; roles (onPress/onRelease/query) vary and
are disambiguated at runtime.

| action | 32-bit hash | handler0 | handler1 | register variant |
|---|---|---|---|---|
| **AWD toggle** | `0x716bfdbf` | 0xb7ae20 (→ GetAWD 0xd7bc80) | **0xb8b240 (→ SwitchAWD)** | 0xb72c10 (6-arg) |
| **Diff-lock toggle** | `0xda0c5d2d` | 0xb7f700 | **0xb90ec0 (→ SwitchDiff)** | 0xb72c10 (6-arg) |
| **Manual shift** | `0xc4c3af6b` | **0xb89d00 (→ DisableAutoAndShift)** | 0xb7d3d0 | 0xb71f20 (5-arg) |
| **Switch to auto** | `0xde225e27` | **0xb89db0 (→ ShiftToAutoGear)** | 0xb7d910 | 0xb71f20 |
| **Shift to high** | `0xf58a3043` | **0xb89f30 (→ ShiftToHigh)** | 0xb7d910 | 0xb71f20 |
| **Shift to reverse** | `0x6f4ce2c7` | **0xb8a630 (→ ShiftToReverse)** | 0xb7d910 | 0xb71f20 |
| **Shift to neutral** | `0x49877fd3` | **0xb8a380 (→ ShiftToNeutral)** | 0xb7d910 | 0xb71f20 |

Handbrake's hash was **not** isolated statically (🔴) — capture at runtime via the
`RegisterAction`-logging hook.

## Current-vehicle resolution (for injection) 🟢

- **`g_TruckControl` = `image + 0x2A8EDD8`** (combine_TRUCK_CONTROL singleton).
- Current vehicle = `*(Vehicle**)(*(void**)(image+0x2A8EDD8) + 0x08)`.
- The only reference to the global is its getter **`GetTruckControl @ 0x9ddcc0`**.
- Version-robust AOB (still valid): anchor
  `40 53 48 83 EC 20 48 8B D9 E8 ?? ?? ?? ?? 33 C9 48 89 18` → follow the `E8` call → first
  `48 8D 05` in the callee → `&g_TruckControl`.

The action-handler input path does not read this global (handlers get `Vehicle*` from the
command context); the global is the path to "the current vehicle without hooking" for
**injection**.

## Recommended framework hook architecture 🟢

Designed for extraction into [[SnowRunner+|SnowRunner-Plus]] (AOB-anchored, MinHook, crash-safe).
Resolve every target by its **unique entry AOB**, not the raw RVA.

**(a) SUPPRESS stock input — hook the SEMANTIC SETTERS** (SMGM-proven, lowest risk; one detour
each, `Vehicle*`+payload, no context plumbing): `SwitchAWD @0xd7bc90`, `SwitchDiff @0xd7bcf0`,
`DisableAutoAndShift @0xd76020` (covers all manual shifts incl. High/Neutral/Reverse since they
tail-call it), `ShiftToAutoGear @0xd72340`. In each detour consult framework state: **swallow**
(return without calling original) to suppress, or **call original** to pass through. Handbrake
has no setter → gate the **direct `TA+0x48` byte-write** in our own per-frame apply.

**(b) INJECT our own actions** — call the setters directly with a `Vehicle*` from
`g_TruckControl(0x2A8EDD8)->+0x08`: `SwitchAWD(veh,on)`, `SwitchDiff(veh,on)`,
`DisableAutoAndShift(veh,gear)`, `ShiftToAutoGear(veh)`, or `GearWriteCore(veh,gear)` for a raw
commanded-gear write. For handbrake (no function), byte-write `TA+0x48`.

**(c) GENERIC "intercept action by hash" primitive** — hook **`RegisterAction @ 0xb71f20`** once
at startup: log every `(hash, handler0, handler1, slot)` to auto-build the full action map (this
recovers the handbrake + any future action hash without guessing); for any hash a mod claims,
store the original set-handler and install a trampoline in the node that decides pass-through
vs. override.

**MinHook discipline:** attach (detour + keep trampoline-to-original), never blind replace;
always be able to call-original for pass-through; guard detours against re-entrancy and null
`Vehicle*`/`TA` (handlers already null-check the context — mirror that).

**Rank of hook points:** (1) semantic setters — start here (matches SMGM, trivially safe);
(2) `RegisterAction` — add for the generic hash primitive + action-map discovery; (3) the
per-frame dispatcher — not needed and higher risk.

## Open / deferred (needs live Frida confirmation) 🔴

- **SetPowerCoef / SetCurrentVehicle** not isolated as standalone functions on this build —
  SetPowerCoef appears inlined (its target `&TA+0x38` is exposed by getter `0xd71750`);
  SetCurrentVehicle unnecessary (current vehicle is a plain global read).
- **Handbrake action hash** and the exact **query-handler semantics** (return-value shape of
  the handler0 "A" handlers) — capture via the `RegisterAction`-logging hook; one short live
  session enumerates all 222 `(name-hash, handlers)` and disambiguates press/hold/toggle vs axis.
- The raw handler-pointer **table in `.data` (~0x2c47xxx)** is populated at runtime (static
  bytes zero; only relocation refs exist) — read live if a data-driven table hook is ever
  preferred over hooking `RegisterAction`.

_Source: [[Input System|Input-System]] (dated 2026-07-05). Field offsets:
[[Memory Map|Memory-Map]]._
