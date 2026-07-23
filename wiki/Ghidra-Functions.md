# Ghidra Functions

Every function we've labeled in the binary, with RVA, role, AOB signature, and confidence.
These are the **hook points SnowRunner+ exposes** — persist new labels here *and* in the
Ghidra DB (per the `ghidra-re` skill) so knowledge compounds.

- **Binary:** `reference/snowrunner-fixed.bin` (file-offset == RVA).
- **Image base in the DB:** `0x6ffffa670000` → `rva = ghidra_VA − 0xa670000`.
- **Reuse the cached project:** `-process snowrunner-fixed.bin -noanalysis`. Never re-import.

Confidence: 🟢 high (decompiled/verified) · 🟡 medium · ✅ live-validated behavior.

## Drivetrain / gearbox

| Name | RVA | Role | Conf |
|---|---|---|---|
| `hi_DrivetrainUpdate_ApplyGear` | `0xc404f0` | Copies commanded gear `TA+0x74` → current `TA+0x70` (the shift apply); holds auto-shift decision logic. tick() attaches here for frame sync | ✅🟢 |
| `md_DrivetrainWheelGearSync` | `0xc3fe20` | The shift/traction/torque loop; compares live output-angvel to `caps[gear]`. **Home of the open per-truck scale** ([[Open Problems|Open-Problems]]) | 🟡 |
| `hi_GetGearData` | `0xd72640` | `GetGearData(veh,gear,&torque,&thrDn,&cap,&thrUp,&distrib)`. `cap=caps[gear]`; `torque=Torque/sqrt(cap*k)`; `thrDn=cap*k1−k2`; `thrUp=2*cap+k3` ([[RPM Derivation|RPM-Derivation]]) | 🟢 |
| `hi_GetMaxGear` | `0xd72300` | max forward gear = caps count − 2 | 🟢 |
| `hi_Gearbox_PowerCoefPtr` | `0xd71750` | returns `&(TA+0x38)` = PowerCoef (L/L+/L− mult, NOT final drive) | 🟢 |
| `hi_ParseGearbox_AngVel` | `0xd072c0` | config parser for the gearbox `AngVel` caps | 🟢 |

## Audio

| Name | RVA | Role | Conf |
|---|---|---|---|
| `hi_SetVoiceVolPitch` | `0xdfb2f0` | voice vtable `+0x60`=SetVolume, `+0xd0`=SetFrequencyRatio (the engine-pitch write). Live: freq-ratio call site `0xdfb32f` (6012/6022 calls; sibling `0xdfb4f7`) | ✅🟢 |
| `EngineVoiceCreate` | `0xdfb4a1` | creates every engine source voice (MS-ADPCM `formatTag=2`, ~44.1 kHz, infinite-loop). 456 B span with the two above = one audio subsystem | ✅ |
| `hi_UpdateSound` | `0xdff1e0` | reads pitch from `SoundObj+0x58`; sole caller of the above | 🟢 |
| `EngineLoopSoundUpdate` | `0x892f00` | per-frame continuous engine-loop sound (`FUN_6ffffaf02f00`; voice at `soundComp+0x840`, pitch→`soundObj+0x58` via `FUN_…46c060`, vol via `FUN_…46e4a0`) | 🟢 |
| `StartSoundObject` ⭐ | `0xdfe630` | single sink for all one-shot SFX (`rcx`=SOUND_OBJECT, `dl`=playFlag); 24 callers; `rand()%nVariants` picks a variant (→ the two clunk sizes); **recommended clunk hook** | 🟢 |
| `PlaySoundEventByHash` | `0xc5d460` | `(comp rcx, eventHash edx)` → `comp+0x130` hashmap → StartSoundObject (explicit clunk path). **No direct xref** (`.pdata` only, Begin `0xc5d460`/End `0xc5d4f2`) → hash not a static constant | 🟢 |
| `AnimEventSoundPlayer` | `0xc5c960` | anim-timeline keyframe crossing → same `comp+0x130` hashmap → StartSoundObject (animation clunk path). Live: called each frame by truck anim update `0xbdab80`; prev keyframe idx at `comp+0x1f4` | 🟢 |

## Physics (Havok)

| Name | RVA | Role | Conf |
|---|---|---|---|
| `hi_Havok_ApplyImpulse` | `0x195f0d0` | Havok solver applyImpulse; caught writing chassis velocity (HW-watchpoint) | ✅ |

## Key AOB signatures (verified unique in the dump)

**TRUCK_CONTROL anchor** (resolve the singleton):
```
40 53 48 83 EC 20 48 8B D9 E8 ?? ?? ?? ?? 33 C9 48 89 18
```
follow `E8` → first `48 8D 05` in callee → `&TRUCK_CONTROL` (image+0x2A8EDD8).

**StartSoundObject @ 0xdfe630** (24 bytes, entry):
```
40 57 B8 90 10 00 00 E8 ?? ?? ?? ?? 48 2B E0 48 C7 44 24 68 FE FF FF FF
```

**PlaySoundEventByHash @ 0xc5d460** (40 bytes, entry, no wildcards):
```
48 89 6C 24 18 48 89 74 24 20 41 56 48 83 EC 40 8B F2 4C 8D 81 F0 01 00 00 4C 8B F1 48 8D 54 24 20 48 81 C1 30 01 00 00
```

**AnimEventSoundPlayer @ 0xc5c960** (28 bytes, entry):
```
4C 8B DC 53 55 48 81 EC 08 01 00 00 48 8B 99 80 00 00 00 48 8B E9 48 85 DB 0F 84
```

> **AOB anchors over static RVAs.** RVAs are for this dump; the shipping framework resolves
> functions by AOB so it survives game updates (SnowRunner+ design rule). Add a signature
> when you label a function you intend to hook.

## RTTI / string anchors (static)

The shipped `SnowRunner.exe` has its `.text` **SteamStub-encrypted at rest** (image base
`0x140000000`; entry inside `.bind` @ `0x142dc8310`, TLS callback array `0x1421c9130`), so no
xref is possible on-disk — it is unwrapped into `reference/snowrunner-fixed.bin` for static
analysis. String/RTTI RVAs below = `VA − 0x140000000`; DB function RVAs = `ghidra_VA − 0xa670000`
(same PE space). All first-party (extracted from the binary's `.rdata`/`.data`).

**RTTI type descriptor → vtable (`combine` = Saber engine):** 🟢
| Class | typedesc RVA | Notes |
|---|---|---|
| `ASYNC_TRUCKS_EFFECTS_UPDATE` | `0x2a16e28` | name `0x2a16e38`, COL `0x258fa30`, vtable `0x21d10b8`; `run()` = vtable[1] @ `0x845400` → deferred-task flush `0x159c870`. **Generic async-job wrapper, NOT the sound trigger — dead-ended.** |

Other audio/truck RTTI present as post-unwrap xref anchors (`.data`): `SOUND_SYSTEM`,
`SOUND_EMITTER`, `SOUND_OBJECT`, `AUDIO_DEVICE_CONTROLLER`, `combineXAudio2EngineCallback`,
`TRUCK_CONTROL`, `TRUCK_WHEEL_PARAMS`, `PHYSICS_MODEL`/`hskPHYSICS_MODEL`, Havok
`hkpVehicleViewer`/`hkpWheelConstraintData`. Update jobs: `GAME_HUSKY_UPDATE_JOB`,
`mrPHYSICS_UPDATE_JOB`.

**String-anchored leads (`.rdata`, RVA):** 🟢 string present · 🟡 localization lead
| RVA | String | Use |
|---|---|---|
| `0x2481e00` | `logiWheelSetRpmLeds` | game pushes normalized RPM 0..1 to Logitech shift-LEDs; dispatch table `0x2481bf8..0x2481e30`, resolved via GetProcAddress (not imported). 🟡 its call-site float arg is a lead for the RPM signal |
| `0x2287f60` | `g_fAngVel` | global current angular-velocity float (the RPM numerator) — see [[RPM Derivation|RPM-Derivation]] |
| `0x2222160` | `"%s %.1f m/s … AngVel %.1f (delta %.3f)"` | debug HUD; its xref reads live speed + AngVel near the truck update |
| `0x22657e8` | `AngVel` (parser cluster `0x22655f0..0x2265800`) | per-gear angular-velocity cap = the gear "ratio"; gearbox XML parser (`ReverseGear/AngVel`, `HighGear/AngVel`, `MaxDeltaAngVel`) |

**XAudio2 import seam (CONFIRMED):** exe imports `XAudio2_9Redist.dll` **by ordinal** —
1=`XAudio2Create`, 5=`X3DAudioCalculate`, 6=`X3DAudioInitialize`; IAT `0x21be8b0..0x21be8c0`.
The redist also exports these **by name** → a name-forwarding proxy works (Vector A seam). Only
DRM = SteamStub (no Denuvo/VMProtect/Themida/EAC in the import scan). See
[[Audio Pipeline|Audio-Pipeline]].

## Struct-typing helper

`tools/re/DefineStructs.java` adds `Vehicle` / `TruckAction` / `Gearbox` types so the
decompiler shows named fields. Hunt/decompile scripts live in `tools/re/` (reuse-only,
`-noanalysis`).

_Related: [[Memory Map|Memory-Map]] (offsets), [[Audio Pipeline|Audio-Pipeline]] (the audio
sinks and hook vectors), [[RE Toolchain|RE-Toolchain]]. Clunk-trace scripts (reuse-only,
`-noanalysis`) in `tools/re/`; struct/AOB checks against `reference/snowrunner-fixed.bin`._
