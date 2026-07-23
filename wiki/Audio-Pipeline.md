# Audio Pipeline

How SnowRunner produces engine sound and the shift "clunk", and the exact seams the mod hooks
to fix them. Two parts: the **continuous engine loop** (pitch/crossfade) and the **one-shot
shift clunk**.

## Engine loop — the continuous pitch that's wrong

- Per truck: PCM loop layers (idle / low / high), MS-ADPCM ~44.1 kHz mono, recorded at
  different base engine speeds (`ank_mk38`: idle ~79 Hz, low ~78 Hz, high ~108 Hz firing).
  For a 6-cyl 4-stroke, firing freq = RPM/60 × 3, so ~79 Hz ≈ 1580 RPM (idle) and ~108 Hz ≈
  2160 RPM (high) — a believable diesel band. (Idle's dominant spectral peak is actually its
  2nd harmonic ~151 Hz; fundamentals recovered via Harmonic Product Spectrum.)
- The game renders a target engine speed by **choosing a layer + pitch-shifting it** via
  XAudio2 `SetFrequencyRatio` (observed range ~0.746–1.184) and **crossfading** adjacent
  layers by `SetVolume`. Both are driven by the **ground-speed** value → the pitch **pins
  through an upshift** instead of dropping. Measured live (below).

### Live-measured behavior (✅)

Frida XAudio2 trace under Proton (GE-Proton10-34). Frida-gum confirmed working under Wine;
we hook at the **COM vtable** level, so both the redist and Wine's builtin `xaudio2_9.dll`
impl (the redist forwards to it under Proton) are captured. `SetFrequencyRatio` census over
one drive:

| Ratio | Calls | Meaning |
|---|---|---|
| exactly `1.0000` | 6347 (82%) | ambient / SFX / one-shot voices, native pitch |
| exactly `0.7500` | 607 | an engine layer pinned to its base offset (down) |
| exactly `1.2000` | 128 | an engine layer pinned to its base offset (up) |
| continuous `0.7457`–`1.1839` | 660 | the engine layer tracking its input (wheel speed today) |

Engine voices: MS-ADPCM (`formatTag=2`, 4-bit), ~44.1 kHz (per-voice 44007–44201 Hz),
infinite-loop (`loop=Y`), no XAudio2 callback. The continuously-modulated engine layer is
source **voice #13**. So the mechanism is pitched loop layers **+ continuous frequency-ratio
modulation + volume crossfade**, together.

**Pinned-pitch-through-upshift, measured (✅ recon-run-02):** fully autonomous drive (screen
capture + virtual keyboard + trace-only gadget, zero game-code hooks), engine pitch bracketed
against gear-HUD screenshots across a **1→2 upshift**:

| CSV row | Gear (HUD) | Engine pitch ratio |
|---|---|---|
| 484204 | 1 | 1.200 (capped) |
| 492225 | 2 | 1.200 (unbroken — **no drop across the shift**) |
| 501801 | 2 | 1.000 (later — deceleration into a building, not a shift) |

Pitch held a solid 1.200 from csv 479309→492756 with zero dips while the transmission changed
gear. A real drivetrain drops RPM on upshift; SnowRunner holds the cap. Bug confirmed on live
data, not inferred.

### Code path (🟢)

```
hi_UpdateSound @ 0xdff1e0     reads pitch off SoundObj+0x58
   → hi_SetVoiceVolPitch @ 0xdfb2f0
        voice vtable +0x60 = SetVolume
        voice vtable +0xd0 = SetFrequencyRatio   ← the engine-pitch write (vector B target)
```

Live-validated call sites (✅ recon-run-01): the engine-voice `SetFrequencyRatio` write is
`0xdfb32f` (6012 of 6022 calls; sibling `0xdfb4f7`), and every engine source voice is created
at `0xdfb4a1`. Those three sites span 456 bytes = one tight audio subsystem. Overriding the
ratio at `0xdfb32f` (or the vtable slot) rewrites the entire engine pitch.

Continuous engine-loop update also lives at `EngineLoopSoundUpdate @ 0x892f00` (engine voice
at `soundComp+0x840`, pitch → `soundObj+0x58`). No wheel data flows through the audio path —
as expected, the fix must *inject* our RPM here. See [[Ghidra Functions|Ghidra-Functions]].

### The fix, in these terms

```
target_firing_freq = firing_freq( idle_RPM + rpm_norm * (redline_RPM − idle_RPM) )
for each engine layer L:  L.SetFrequencyRatio = clamp(target_firing_freq / base_freq[L], …)
crossfade layer volumes by proximity of target to each layer's base
```

where `rpm_norm` is our derived RPM ([[RPM Derivation|RPM-Derivation]]). **Minimal version
needs no base-freq table:** just scale the game's own computed ratio to reintroduce the
shift-drop — `ratio *= rpm_norm_new / rpm_norm_old`. (A per-truck base-freq table was built
but is **not authoritative** — octave-ambiguous on broadband diesel loops; only 18% pass the
idle≤low≤high sanity check. Don't rely on it.)

### Two mod vectors (both hook this pipeline)

- **Vector A — XAudio2 proxy DLL:** the game imports `XAudio2_9Redist.dll` by name → drop a
  proxy that hooks the source-voice vtable (`SetFrequencyRatio`/`SetVolume`/
  `SubmitSourceBuffer`). Version-robust (COM vtable), ships as the public default.
- **Vector B — binary patch** of the RPM float feeding `SetFrequencyRatio`. Root-cause,
  advanced/opt-in.

### XAudio2 source-voice vtable — the hook surface (🟢)

Zero-based slots, declaration order, x64 (byte offset = slot × 8; `this` in RCX). Verified
against xaudio2.h declaration order, NOT MSDN's alphabetical method tables.

| Slot | +off | Method | Used for |
|---|---|---|---|
| 12 | +0x60 | `SetVolume(float XMM1, u32 OpSet)` → void | layer crossfade |
| 18 | +0x90 | `DestroyVoice` | voice teardown |
| 19 / 20 | +0x98 / +0xA0 | `Start` / `Stop` | |
| 21 | +0xA8 | `SubmitSourceBuffer(XAUDIO2_BUFFER* RDX, ...)` → HRESULT | clunk PCM submit (current mute point) |
| 25 | +0xC8 | `GetState` | |
| 26 | +0xd0 | `SetFrequencyRatio(float XMM1, u32 OpSet)` → void | engine-pitch write |
| 27 | +0xD8 | `GetFrequencyRatio(float* RDX)` | |

`IXAudio2::CreateSourceVoice` is **IXAudio2 slot 5**. Clunk-size detection reads
`XAUDIO2_BUFFER.AudioBytes` (u32 @ +4; `pAudioData` @ +8) — the 50666 / 49742 sizes. Voice
format from `WAVEFORMATEX` (`nChannels` u16 @ +2, `nSamplesPerSec` u32 @ +4; `formatTag` @ 0).

**Float-arg gotcha:** `SetFrequencyRatio` / `SetVolume` pass the float in **XMM1** (Win64: arg
slot 1 → XMM1). Frida `Interceptor.attach` fills `args[]` from integer regs/stack only and
never reads XMM, so `args[1]` is garbage; use `Interceptor.replace` with a typed
`NativeCallback([..., 'float', 'uint32'], 'win64')` to decode XMM1. `Get*` take a `float*` in
RDX (readable via deref).

## Shift clunk — the one-shot sound

The clunk is **not** fired by the drivetrain physics. ApplyGear (`0xc404f0`) and
DrivetrainWheelGearSync (`0xc3fe20`) only do the torque jolt — no audio call. The clunk is a
**hashed sound EVENT** fired by the truck sound component:

```
gear-change edge  OR  gearshift-anim keyframe
   → PlaySoundEventByHash(soundComp, eventHash)   @ 0xc5d460   (explicit path)
   → OR AnimEventSoundPlayer keyframe crossing     @ 0xc5c960   (animation path)
        both look up the event in soundComp+0x130 hashmap, then for each SOUND_OBJECT:
   → StartSoundObject(soundObj, flags…)            @ 0xdfe630   ← single choke point ⭐
        rand()-selects a variant (→ the two known clunk buffer sizes 50666 / 49742)
   → … → IXAudio2SourceVoice::SubmitSourceBuffer
```

### Recommended hook: `StartSoundObject @ 0xdfe630`

Single sink every clunk variant passes through, one layer above `SubmitSourceBuffer`, and it
exposes the persistent `SOUND_OBJECT*` (rcx) *before* the buffer is allocated.

1. **Identify the clunk object once:** in the hook, remember the last `rcx`; when the next
   `SubmitSourceBuffer` matches a clunk size (50666/49742), that `soundObj` IS the clunk
   (stable for the truck's lifetime). Cache it.
2. **Suppress on demand:** during a clutch→neutral window (the harness commands the shift, so
   it knows the frame), `return 0` when `rcx == cachedClunkObj`. Cleaner than swallowing at
   the buffer layer, and covers both trigger paths.
3. **Replay later:** call `StartSoundObject(cachedClunkObj, 1, 0, 0)` to play it when you
   actually engage the target gear.

The current harness already learns/mutes/replays the clunk at the `SubmitSourceBuffer` layer
(vtable slot 21); `StartSoundObject` is the cleaner graduation point.

Both paths share the `soundComp+0x130` event hashmap and iterate the event's SOUND_OBJECT
array (stride `0x68`, obj ptr at `+0x60`), calling `StartSoundObject(obj,0,0,0)`.
`StartSoundObject` (`char(SOUND_OBJECT* rcx, char playFlag dl, …)`) has 24 distinct callers
across all one-shot SFX and picks a variant via `rand() % nVariants` — which is exactly what
produces the two clunk buffer sizes. The animation path is confirmed *live*: `0xc5c960` is
called every frame by the truck animation update `0xbdab80`, comparing the current keyframe
index to the previous one cached at `comp+0x1f4`.

**Open (🟡):** exact upstream trigger = explicit (`PlaySoundEventByHash`) vs animation
keyframe. The gear-shift event hash is data-driven (baked from the truck XML sound-event
name), not a static code constant, and `PlaySoundEventByHash` has **no direct call xref**
(only `.pdata` RUNTIME_FUNCTION entries; dispatched indirectly) → the hash needs one runtime
correlation to disambiguate. If disambiguated to the explicit path, suppress semantically by
`edx == gearHash` instead of pointer-matching.

_Function labels, AOBs and RTTI anchors: [[Ghidra Functions|Ghidra-Functions]]. RPM math:
[[RPM Derivation|RPM-Derivation]]. Reproduction: DSP tool `tools/model/analyze_engine_audio.py`
(+ `build_base_freq_table.py` → `engine_base_freqs.json`); Frida trace `tools/frida-trace-xaudio.js`
(raw `tools/staging/xrecon.log`, `xrecon-events.csv`, both git-ignored); clunk hunt scripts in
`tools/re/`. See also [[RE Toolchain|RE-Toolchain]]._
