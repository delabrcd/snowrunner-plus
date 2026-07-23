# Distribution and Portability

How the mod is packaged, shipped, and kept alive across SnowRunner patches. Public distribution (native Windows **and** Proton) is a first-class constraint that drives real design decisions — see [[Feasibility-and-Plan]] for how it shapes the attack vectors and [[Architecture]] for the framework/module split.

## Platform reality

The shippable artifact is a **Windows PE DLL** (`XAudio2_9Redist.dll` proxy) that lives in the game's `Sources/Bin/` folder and runs inside the game process. It is therefore native on Windows and runs under Proton/Wine unchanged.

- **Windows is the easier target** — native XAudio2, native loader, no translation layer.
- **Proton is the harder-compat case** — DLL load order, the `xaudio2_9="disabled"` Wine override, FAudio-vs-redist routing. If it works on Proton it almost certainly works on Windows — but not the reverse.

**Rule:** develop on Linux/Proton (daily driver + harder case), but **every release gets a native-Windows validation pass** before publishing.

## Design choices forced by distribution

The mod runs on machines we cannot debug, across unseen game versions, for users who will (rightly) blame us if their game crashes. That forces **robustness over cleverness**:

1. **Prefer the audio-proxy vector (A) as the distributable core.** It hooks stable COM vtables (`IXAudio2SourceVoice`), not game-specific code offsets, so it survives updates. The root-cause binary patch (B) depends on offsets/signatures that shift every update — keep it opt-in/advanced or a later phase, not the v1 default. (Vectors A/B: [[Feasibility-and-Plan]].)
2. **Derive inputs from inside the intercepted calls, not from memory offsets.** Recover throttle / gear / wheel speed from values already flowing through hooked audio calls (self-contained, version-robust, cross-platform). **Avoid** version-fragile pointer-path memory reads in the shipped build — the #1 thing that breaks on update and can't be hotfixed remotely. If a memory read is unavoidable, signature-scan and fail safe.
3. **Fail safe, always.** If voice fingerprinting fails, a signature isn't found, or state can't be read: **pass through to the game's original behavior.** A mod that silently does nothing on an unrecognized version is acceptable; one that crashes someone's game is not.
4. **Dependency-light.** Static-link the CRT so the DLL loads on a clean Windows install with no VC++ redist prompt.
5. **User config.** Ship an `.ini`/`.toml` beside the DLL: enable/disable, redline, idle, shift-drop amount, per-truck overrides, and a master "audio-only vs. also-physics" toggle. Users want knobs without recompiling.
6. **No machine paths in the binary.** The DLL must contain no hardcoded absolute install paths — resolve everything relative to its own load location / the game dir so it works on any user's machine.

## Legal / packaging — the installer contract

The installer only ever **adds** files and is fully reversible:

- **Never redistribute the game's `XAudio2_9Redist.dll`.** The installer renames the user's existing copy (`→ XAudio2_9Redist_real.dll`) and drops our proxy alongside; our proxy forwards to theirs. (XAudio2 redist is freely redistributable if we ever must bundle it, but renaming-in-place avoids the question entirely.)
- **Never ship game assets** (`.pak`, `.pcm`) — already git-ignored.
- **Clean uninstall** — restore the original DLL name, remove the proxy.
- **Idempotent and reversible** — detect an already-installed state; don't double-rename.

## Multiplayer / ToS posture

SnowRunner has EOS crossplay + online co-op. Client-side **cosmetic** changes (engine sound, tach needle, wheel LEDs) are low-risk. The **gearbox/torque physics** parts of the QOL scope could desync co-op sessions or read as cheating, and public distribution raises visibility.

**Posture: cosmetic-first, physics gated off by default.** Decisions to enforce before shipping any physics change:

- Gate physics tweaks behind an explicit opt-in, **off by default**.
- Auto-disable non-cosmetic changes when a session is online/co-op, if detectable.
- Document clearly that physics changes are single-player-oriented.

## Distribution channel

A native DLL proxy is a **manual/external mod** — it cannot go through the in-game mod.io browser (that channel is data-only XML/asset mods, no native code). Realistic channels: **NexusMods** and the SnowRunner modding forums, distributed as a zip + installer/instructions.

## Portability / versioning strategy

This concerns the **shipped native mod**, not the live research scripts (`memexplore.js` etc.) — those are the *tools that generate the data* the mod consumes (see [[RE-Toolchain]]).

**The problem:** a memory mod that hardcodes addresses breaks on every update — the compiler regenerates code and data at new addresses each patch. We must resolve everything at runtime, or from a version-keyed table, so a new build either "just works" or is a data-only update.

**SnowRunner specifics that shape the approach:**
- **SteamStub DRM** — `.text` is encrypted on disk, decrypted in memory at runtime → all pattern scanning happens **at runtime, in-process** (fine — we inject). Offline offset extraction uses a decrypted process dump (`tools/re/`, `reference/snowrunner-fixed.bin`).
- **RTTI present** — the binary ships real C++ class names (`TRUCK_CONTROL@combine@@`, etc.), a strong durable anchor most games don't give you. Lead with it.
- **No native-code mod support** — mod.io is content-only; native code ships as an injected DLL (like Ferrster's), distributed outside mod.io.

### The strategy — layered, most-durable first

1. **RTTI-based resolution (primary anchor).** Resolve a class by its RTTI name → its vtable → the globals/instances that use it. Class names survive patches even when addresses **and** struct layouts shift. Resolve `TRUCK_CONTROL@combine@@` this way ahead of the AOB anchor.
2. **AOB / pattern scanning (fallback).** Ship byte **patterns**, never raw addresses; scan on load. When the game patches, the code around a pattern usually stays similar, so it re-finds the target at its new address. Already done for the anchor (`memexplore.js ANCHOR`).
3. **Offsets as DATA, version-keyed (not code).** Mod **code** stays stable; **offsets/signatures** live in an external config keyed by exe version/hash. On launch: detect version → load its table (fast path); unknown version → fall back to RTTI/AOB scan and optionally write a new entry. **Porting becomes a data update, not a recompile** — and the community can contribute entries.
4. **Stable ABIs for API hooks.** XAudio2 is COM — a fixed vtable ABI across DLL versions. Hook by **vtable index** (`SetVolume` = 12, `SetFrequencyRatio` = 26), never a DLL file offset. Removes an entire class of version fragility for free.
5. **Validate-and-degrade, never crash.** On load, sanity-check every resolved address against what it *should* look like (chassis linVel is a small float triple; gear is `-1..N`; gearbox caps are increasing floats; `q_VehStateFlags` toggles bit0 with ignition). On failure, **disable that feature and log which signature broke** instead of crashing. Optional: self-heal small shifts by scanning a ±0x40 window for the expected pattern.

### Fragility audit of current dependencies

| Dependency | Now | Portability |
|---|---|---|
| `TRUCK_CONTROL` global | AOB signature | robust; upgrade to RTTI for best durability |
| Vehicle/TruckAction/wheels/chassis pointers | struct offsets off the anchor | mostly survive (5C8→5D0 was a small shift); validate + self-heal |
| `q_VehStateFlags` (engine), gear, gearbox caps | struct offsets | mostly survive; validate |
| XAudio2 `SetFrequencyRatio` | hardcoded **DLL offset** | ⚠️ moves per DLL version → resolve via a live voice's **vtable[26]** |
| Engine-voice identification | hardcoded **caller RVA region** (`ENG_LO/HI`) | ❌ breaks every patch → replace with a behavioral/parameter-based ID |

The **drivetrain/tach/shifter reads are already well-anchored** (one signature + relative struct offsets). The two genuinely fragile spots are both **audio-side** (the DLL offset and the engine-voice caller region) — fix them with the vtable-index approach and a behavioral voice ID.

### Shippable architecture

- **Native C++ DLL**, injected via **Ultimate ASI Loader** (already used for the Frida gadget) or the game's loader; **MinHook** for function hooks (scaffolded in `mod/`).
- **On load:** RTTI-resolve the anchor (primary) → AOB-scan (fallback) → version-table (override / fast path) → validate all → degrade gracefully on any failure.
- **Struct offsets** in an editable, version-keyed table with self-validation.
- **XAudio2** hooked via vtable indices.
- The distributed mod **consumes** the offset table; `memexplore.js` + the Ghidra project (`tools/re/`) are the **research tools** that **produce** it. When a patch moves something, the watchpoint→decompile→label loop re-finds it in minutes and the Ghidra struct map ports the understanding even when addresses move.

### Porting workflow ("trivial to port")

1. New game build lands.
2. Run the mod; the resolver validates. Everything survived → done, no work.
3. A signature/offset failed → the log names it. Use the research tools (dump → Ghidra structs + labels → watchpoint the field → read the new offset) to re-map just that one thing.
4. Add/update the version-table entry (data only). Ship the updated table — no recompile.

**Highest-leverage next step:** prove out **RTTI resolution** for `TRUCK_CONTROL` (replace the AOB anchor with the class-name lookup). It's the durable foundation everything hangs off, and the one piece that most reduces per-patch maintenance.

## Release checklist (draft)

- [ ] Works on Linux/Proton (dev target).
- [ ] Validated on a native Windows install (clean, no dev tools).
- [ ] Survives a game update, or fails safe (passthrough) if signatures miss.
- [ ] Idempotent install + working uninstall.
- [ ] Config file documented.
- [ ] Multiplayer behavior decided + documented.
- [ ] No game assets or third-party DLLs bundled.
