# tools/

Recon + build tooling for the drivetrain mod.

## `frida-trace-xaudio.js`

XAudio2 engine-audio recon. Hooks `XAudio2Create` → `IXAudio2::CreateSourceVoice` →
each `IXAudio2SourceVoice`'s `SetFrequencyRatio` / `SetVolume` / `SubmitSourceBuffer`.

### What it answers
- **Which voices are the engine layers?** They loop infinitely (`loop=Y`) and their
  `SetFrequencyRatio` gets called continuously while driving (`ratioN` high). SFX voices
  set the ratio 0–1 times.
- **How is pitch currently computed?** The `ratio[min..max/last]` time-series shows the
  frequency ratio tracking wheel speed — watch for the *absence* of a discontinuity at a
  gearshift (that missing jump is the bug).
- **What is the vector-B target?** The summary prints the **`SetFrequencyRatio` callers**
  on actively-modulated voices — the game-code address(es) that compute the pitch. That
  caller is the function to reverse and re-point at a real gear-aware RPM.
- **Robustness question (for distribution):** does the pitch caller have the raw wheel
  speed / gear / throttle already in registers/stack at that call site? If the values we
  need are reachable from the hook context, the shipped mod can avoid fragile memory
  offsets entirely (see `../docs/distribution.md`).

### Running it
Injection under Proton is the fiddly part — see `../docs/frida-under-proton.md` (produced
by recon). **Prefer spawn over attach** so `XAudio2Create` is hooked before the game calls
it. Rough shape (confirm specifics from that doc):

```sh
# Windows-frida-in-prefix or frida-gadget; the doc has the exact runbook.
frida -f "<proton launch of SnowRunner>" -l frida-trace-xaudio.js --runtime=v8
```

If you can only attach after launch, the script retries finding the audio module and will
still hook voices created after attach (you may miss the very first ones).

### Driving protocol (run this while tracing)
Do these in order and note wall-clock so you can line them up with the logged time-series:

1. **Engine on, parked** — establishes the idle baseline ratio and which voices exist.
2. **Rev in neutral** (if possible) — isolates throttle→pitch with no wheel motion. If the
   ratio moves here, pitch has a throttle term; if not, it's purely wheel-speed driven.
3. **Low gear, slow crawl** — ratio should climb with wheel speed.
4. **Upshift low→high while moving** — THE key event. Wheel speed is continuous; a real RPM
   would drop. Watch whether `ratio.last` drops at the shift (it won't today — that's the
   fix target).
5. **Coast to stop, brake** — ratio falls back to idle.
6. **Reverse** — checks `DisableReversePitch` behavior.

Capture the console output to a file and drop it in `../docs/evidence/` (git-ignored `.log`,
so rename to `.md`/`.txt` if you want it committed).

### Tuning knobs
Top of the script (`CONFIG` / `VT`):
- `VT.*` — vtable indices. If the xaudio2-vtable reference doc disagrees, fix here only.
- `logEveryRatioCall` — firehose vs. sampled logging.
- `dllCandidates` — module name search (Wine may lowercase it).
