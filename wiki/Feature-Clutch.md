# Feature: Clutch  ✅

A real clutch: hold to disengage into a **held neutral** with gear pre-selection, release to
engage the chosen gear — with the shift-clunk handled so it feels right.

## What it does

- **Hold** = neutral with the current gear held as `g_selGear` (engine free-revs on throttle per
  the neutral RPM model). `]`/`[` while clutched **adjust the selection** without writing to the
  game. **Release** engages the selected gear.
- Telemetry carries the selected gear while clutched (flags bit3) → the gear panel shows it in
  yellow + CLUTCH.
- Auto-box suspends while held + a settle window after release.

## How it's implemented

- `tools/dev/src/30-gearbox.js` (clutch state machine); default bind `V`, rebindable.
- **Shift-clunk handling** (via [[Feature: Engine audio|Feature-Engine-Audio]]): during the
  ~400ms clutch window, the learned clunk is **swallowed** (real manual/auto shifts keep it) and
  **replayed** as feedback for each gear-select while clutched; first clutch-in plays it once
  (learning pass), silent after. `DestroyVoice` invalidates the saved voice.
- Releasing in stock-'game' mode restores `IsInAutoMode = 1`.

## Status & open issues

✅ Working (v2). The clunk suppression currently keys on `SubmitSourceBuffer` buffer size; the
cleaner graduation is the `StartSoundObject` sink ([[Audio Pipeline|Audio-Pipeline]]).
