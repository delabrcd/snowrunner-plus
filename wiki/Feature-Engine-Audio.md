# Feature: Engine audio sync  🔨

Drive the engine sound off our [[gear-aware RPM|Feature-RPM]] instead of ground speed, and
reintroduce the **rev-drop on every upshift** the stock game is missing.

## What it does

- Overrides the engine-voice **pitch** (`SetFrequencyRatio`) so it tracks our RPM — pitch drops
  at an upshift and rises on wheelspin.
- **Shift-clunk control:** learns the one-shot gear-change "clunk" and can mute/replay it (used
  by the [[clutch|Feature-Clutch]] so a clutched fake-neutral doesn't clunk, and the real
  engagement does).

## How it's implemented

- XAudio2 source-voice vtable interception in `tools/dev/src/40-audio.js` (pitch = `SetFrequencyRatio`;
  clunk = `SubmitSourceBuffer`, vtable slot 21, keyed by PCM buffer size).
- Minimal fix scales the game's own computed ratio (`ratio *= rpm_new/rpm_old`) — no per-truck
  base-freq table needed. Pipeline + code path: [[Audio Pipeline|Audio-Pipeline]].
- Ships two ways: Frida harness (dev) and the XAudio2 proxy DLL / ASI (product).

## Status & open issues

🔨 Pitch override + shift-drop working; clunk learn/mute/replay working in the clutch window.
Remaining:
- **Layer crossfade** still partly the game's (ground-speed) blend — a blanket volume multiplier
  lifted faded layers, so `volOverride` is pitch-only for now; full fix = take over the layer
  crossfade by our RPM.
- **Graduate the clunk hook** from `SubmitSourceBuffer` to `StartSoundObject @ 0xdfe630` (cleaner
  single sink, exposes the persistent `SOUND_OBJECT*`). See [[Audio Pipeline|Audio-Pipeline]].
- Per-truck engine base-freq table exists but is **not authoritative** — don't rely on it
  ([[Open Problems|Open-Problems]]).
