# Feasibility and Plan

The feasibility verdict for the [[drivetrain / RPM / engine-audio module|Features]] plus the concrete attack plan to build it. See also [[Game-Model]], [[RPM-Derivation]], [[Audio-Pipeline]], and [[Prior-Art]].

## Verdict: feasible

The target is a standard, unprotected x64 game with a clean injection seam and an already-existing (mis-computed) RPM signal. The commonly repeated *"SnowRunner has no RPM so this is impossible"* is wrong: it conflates *the physics has no powertrain* (true) with *the game can't know engine RPM* (false — RPM is derivable from state it already tracks). See [[RPM-Derivation]] for the math.

### Evidence

All verified on the local x64 `SnowRunner.exe` (`evidence/exe-strings.txt`).

| Fact | Evidence | Implication |
|---|---|---|
| x64 PE, 8 std sections | header parse | Mainstream toolchain applies. |
| **No Denuvo / VMProtect / Themida / EAC / BattlEye** | string scan clean; only `SteamAPI_*` | Runtime hooking is unobstructed. |
| `.bind` = SteamStub license wrapper | section name | Decrypts in memory at launch; irrelevant to runtime hooks. Use **Steamless** to unwrap for static RE. |
| **Imports `XAudio2_9Redist.dll` by name** | import string | **Proxy-DLL injection is trivial** — the primary seam. |
| Engine voice **already pitch-shifted** | `Sounds/DisableReversePitch`, `IsFixedPitch`, `pitch` | Re-derive the existing `SetFrequencyRatio` input; no need to add pitching. |
| **Internal RPM float already exists** | `logiWheelSetRpmLeds`, `rpm` gauge, `gui/rpm__d_a.tga` | Fix its formula once → tach + wheel LEDs + sound correct together. |
| Descriptive asserts ("Husky"/MudRunner2, `IsEngineEnabled`) | leaked source paths | Static RE in Ghidra is materially easier. |
| Community CE tables map the vehicle struct | FearlessRevolution / cheatengine.net | Known pointer path to per-truck state — a head start (see [[Prior-Art]]). |

**Frida-under-Proton confirmed:** native Linux Frida does **not** attach to this process — you must spawn via the frida-gadget (proxy-DLL / ASI loader), not attach. `tickelton`'s trainer independently confirms Frida works against this binary. Protocol in [[RE Toolchain|RE-Toolchain]].

### What this does / does not achieve

- **Does:** engine note tracks a real, gear-aware RPM; audible RPM drop on every shift; correct tach + steering-wheel shift LEDs; end of the continuous-drone / electric feel.
- **Does not (without deeper work):** rebuild the drivetrain into a simulated powertrain. Gears stay speed caps, torque stays a scalar. We **synthesize a faithful RPM from existing state**, not simulate a crankshaft. For the stated complaint that is a complete fix; a full physics overhaul is a separate, larger effort.

### Risk / unknowns

- **Voice identification** — must fingerprint which XAudio2 source voices are engine layers (by the PCM buffers they submit). Low risk; layer filenames are known.
- **Where the ratio is computed** — must confirm the caller that sets the engine voice's frequency ratio and what it reads. Frida trace resolves this directly.
- **Game updates** — SteamStub + shifting offsets make static byte patches brittle; prefer signature-scanned runtime hooks so it survives patches (see [[Distribution-and-Portability]]).
- **Proton specifics** — DLL load order and the `xaudio2_9="disabled"` Wine override in the prefix registry could affect proxy loading; must be validated on Linux.

## The two attack vectors

> **Distribution constraint** (see [[Distribution-and-Portability]]): the mod must be publicly distributable and run on native Windows, on machines we can't debug, across unseen game versions. This makes vector A the shippable core (COM-vtable hooks survive updates), pushes us to derive inputs from *inside* the hooked calls rather than fragile memory offsets, and requires fail-safe passthrough on anything unrecognized.

Both vectors share the same RPM math ([[RPM-Derivation]]); only the delivery differs.

### Vector A — Audio proxy (recommended first; fastest to a working prototype)

Wrap the game's own `XAudio2_9Redist.dll`.

1. Rename `Sources/Bin/XAudio2_9Redist.dll` → `XAudio2_9Redist_real.dll`.
2. Drop in a proxy `XAudio2_9Redist.dll` that forwards all exports to the real one, hooks `XAudio2Create`, and vtable-hooks each returned `IXAudio2SourceVoice`.
3. Fingerprint the engine-layer voices by the PCM buffers they `SubmitSourceBuffer` (idle/low/high loop names are known from the truck XML).
4. Read live truck state (throttle, selected gear, wheel angular velocity). **For the shipped build, prefer recovering these from values already flowing through the hooked audio calls** (self-contained, version-robust). Fall back to a signature-scanned memory read only if unavoidable, and fail safe if it misses. The community CE pointer path is fine for *recon*, but a raw offset is too fragile to ship.
5. Run the RPM integrator in the proxy and **override** `SetFrequencyRatio` (vtable index 26) + per-layer volumes (`SetVolume` = 12) so pitch/crossfade follow gear-aware RPM with shift discontinuities.

Fixes the **sound** without touching physics. Portable Windows↔Proton (just a DLL in the game dir). Does **not** by itself fix the tach needle / wheel LEDs.

### Vector B — Root-cause patch (the "real" fix; deeper RE)

**Prerequisite (confirmed by static RE):** `.text` is SteamStub-encrypted at rest (entropy 8.0) — static disassembly is impossible on the raw file. **Steamless-unwrap or dump the decrypted image from memory first**, then load into Ghidra. Runtime hooking is unaffected (code decrypts in-memory at launch); only offline analysis needs the unwrap.

Then locate two things, using the RTTI/string anchors the static pass found (see [[Ghidra-Functions]]):

- **The RPM float** (numerator = `g_fAngVel` wheel angular velocity): targets `GAME_HUSKY_UPDATE_JOB@combine` / `mrPHYSICS_UPDATE_JOB@combine` (per-tick truck/physics update; physics is Havok), and the `logiWheelSetRpmLeds` call site (its float arg is the normalized RPM — the most direct localizer).
- **The engine-voice pitch computation:** targets `ASYNC_TRUCKS_EFFECTS_UPDATE@combine`, `SOUND_EMITTER@combine`, `AUDIO_DEVICE_CONTROLLER@combine` (owns the XAudio2 mastering voice), anchored by `Sounds/DisableReversePitch` / `pitch` / `IsFixedPitch`. (TrueForce wheel haptics run off an XAudio2 *submix* voice + effect chain fed by the engine audio — the RPM signal fans out to tach, wheel LEDs, pitch, and haptics.)

**Localization shortcut:** the Frida recon prints the *live* caller address of `SetFrequencyRatio`; subtract the module base and map that offset onto the unwrapped/dumped image to jump straight to the pitch function — no blind xref hunt.

Replace the RPM computation with the gear-aware integrator. Because tach, wheel LEDs, pitch (and haptics) all read that value, one correct source fixes everything coherently. Ship as a signature-scanned runtime hook (MinHook/Detours in an injected DLL), not static bytes, so it survives updates.

### Recommended path

**Frida recon spike → prototype vector A → graduate to vector B** for full coherence (tach + LEDs).

## First step — Frida recon spike

- **Script:** `tools/frida-trace-xaudio.js` (+ `tools/README.md` driving protocol).
- **Injection:** proxy-DLL + frida-gadget under Proton — see [[RE Toolchain|RE-Toolchain]] (native Linux Frida does NOT work; spawn via the gadget, don't attach).

Running it while driving yields: (a) which voices are the engine layers, (b) the frequency-ratio time-series (watch for the missing shift discontinuity), (c) the **live caller address of `SetFrequencyRatio`** = the vector-B pitch function. Reading throttle/gear/wheel-speed live is solved via the ported SMT AOB anchor ([[Prior-Art]]).

## Toolchain

- **Ghidra** — static RE (free, cross-platform, scriptable). Primary disassembler. See [[RE-Toolchain]].
- **Steamless** — strip SteamStub from a dumped exe for clean static analysis.
- **Frida** — scriptable dynamic instrumentation for the recon spike and for shipping B.
- **Cheat Engine / PINCE / scanmem** — find the vehicle struct + pointer path to inputs.
- **MinHook or Microsoft Detours** — the runtime hook library for the shipped DLL.
- Community **CE tables** (FearlessRevolution, cheatengine.net) — existing vehicle-struct offsets as a starting point.

## Dev platform — Windows vs Linux

**The shipped artifact is identical either way** (a Windows PE DLL in the game dir; runs the same under native Windows and Proton/Wine). The only question is where to *develop and do live dynamic recon*.

- **Static RE:** do it anywhere. Ghidra/Steamless are cross-platform → **do it on Linux**.
- **Live dynamic recon (the hard part):** needs the game running with a GPU while you attach instrumentation and drive.
  - **Linux-primary (recommended default):** run on Proton (native GPU, exact ship target); run Windows hacking tools inside the game's Wine prefix (Frida-Windows in-prefix, CE-in-prefix), or native `scanmem`/PINCE. Rougher attach, but you develop against the real runtime and catch Proton quirks (DLL load order, `xaudio2_9="disabled"`) early.
  - **Windows dual-boot (accelerator):** native CE / x64dbg / Frida / ReClass.NET attach painlessly with a real GPU — smoothest ergonomics. Cost: context-switch, and you must re-validate on Proton anyway.
  - **Windows VM:** not viable for live recon (no GPU → can't drive). Fine for static work only.

**Decision:** stay Linux-primary; ship/test on Proton always (mandatory — that's where it runs). Keep a Windows dual-boot as an optional accelerator *only if* in-prefix dynamic tooling proves too painful. Revisit after the Frida recon spike quantifies the attach friction.
