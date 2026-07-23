# RE Toolchain

How to reproduce or extend any finding in this wiki. Four halves: **static** (Ghidra on the
dumped binary), **live** (Frida under Proton), a **machine-controllable driving harness**, and
an **autonomous-ops** loop that drives all of it hands-off. Everything feeds the same knowledge
base.

## The binary (static)

- SnowRunner's `.text` is **SteamStub-encrypted** on disk (entropy 8.0) — you can't
  disassemble the shipped exe directly. It's decrypted in the live process.
- We dump the decrypted module via Frida (`tools/dev/memexplore.js dumpModule`, one-shot) →
  `reference/snowrunner-dump.bin`, then realign PE headers (file-offset = RVA) with
  `tools/re/unmap_pe.py` → **`reference/snowrunner-fixed.bin`**.
- Load with the Ghidra PE loader or `r2 -B 0`. No Denuvo/EAC/VMProtect — SteamStub only.

## Ghidra (headless, cached project)

- Ghidra 12.1.2 headless at `~/.local/opt`, JDK 21 (`~/.local/opt/jdk-21.0.11+10`, via
  `JAVA_HOME_OVERRIDE` in `support/launch.properties`).
- **Analyzed project is cached** in `reference/ghidra-proj` (program `snowrunner-fixed.bin`,
  ~706 MB DB). **Never re-import** — that re-analyzes from scratch. Reuse with:
  ```
  -process snowrunner-fixed.bin -noanalysis
  ```
- **Image base `0x6ffffa670000` → `rva = ghidra_VA − 0xa670000`.**
- Scripts in `tools/re/` (all reuse-only): `DefineStructs.java` (adds Vehicle/TruckAction/
  Gearbox types), plus the `Decomp*`/`Hunt*` decompile-and-search scripts.
- **Use the `ghidra-re` skill** for any decompile work. It mandates persisting every
  identified function/variable as a **confidence-labeled** name so passes don't re-derive
  `FUN_xxx`. After labeling in the DB, mirror the fact into [[Ghidra Functions|Ghidra-Functions]].

## Frida (live, under Proton)

- **Frida-gum works under Wine/GE-Proton** (the one unverified assumption — confirmed live).
  Native-Linux Frida is a dead end (ELF view); inject via **proxy-DLL + frida-gadget**, which
  is also the shipping loader.
- **The live explorer** is `tools/dev/src/*.js`, concatenated into `memexplore.js` by
  `tools/dev/build.sh` (numeric prefixes = load order: `00-core`, `10-vehicle`, `20-rpm`,
  `30-gearbox`, `40-audio`, `50-recon`, `55-diag`, `60-shm`, `70-framehook`, `90-main`).
  Hot-reloads on the gadget.
- **HW watchpoints work under Wine** (`Thread.setHardwareWatchpoint` on all threads +
  `Process.setExceptionHandler`). The standing method is **watchpoint → decompile → label**:
  watch a field to catch its writer, decompile the writer in Ghidra, label it.
- **Frame sync:** `tick()` is driven by `Interceptor.attach` on `hi_DrivetrainUpdate_ApplyGear`
  (0xc404f0) so telemetry matches the game's 60 Hz drivetrain step. Safety rails: attach (not
  replace), install-once after anchor resolution, verify a 32-byte prologue signature, timer
  fallback if the hook goes quiet.

### Injecting under GE-Proton (proxy-DLL + gadget)

The injection mechanism doubles as the shipping mod's loader.

**Why native Linux Frida fails.** `frida -R`/`-p` enumerates the process as an ELF
(`wine64-preloader` + libc), so `Module.getExportByName("kernel32.dll", …)` → null →
`TypeError: not a function` (frida issues #3339, #3617). It sees ELF/libc, not the PE modules
Wine maps. Staying entirely in the Windows/PE world avoids this. Approach ranking:

| Approach | Loads via | Verdict |
|---|---|---|
| Linux-native Frida (`frida -R`/`-p`) | ptrace into the ELF Wine process | ✗ Sees ELF/libc, not PE modules. **Don't.** |
| Windows `frida-server.exe` inside Wine, spawn | cross-process CreateRemoteThread+LoadLibrary | ~ Plausible; the injector is fragile under Wine. Second choice. |
| **`frida-gadget.dll` via a proxy DLL at start** | Wine's normal PE loader, in-process | ✓ **Recommended.** No ptrace, no injection. |
| **Pure proxy DLL, no Frida** (hook `XAudio2Create` in C) | same proxy | ✓✓ Most robust for the audio goal — and *is* the shipping-mod architecture. |

**Audio routing — the hook lands (redist, not FAudio).** The game loads its own native
Microsoft `xaudio2_9redist.dll` from `Sources/Bin/`. Wine ships builtins `xaudio2_0`…
`xaudio2_9` (FAudio-backed) but **no `xaudio2_9redist`**, and nothing overrides the name — so
Wine loads the real Microsoft PE, which runs under Wine and forwards to `mmdevapi`/WASAPI →
PipeWire. **It does NOT go through FAudio.** Therefore hooking `XAudio2Create` + the returned
COM vtables inside `xaudio2_9redist.dll` intercepts the game's real audio. (The
`"xaudio2_9"="disabled"` once seen in `user.reg` is under `AppDefaults\diabotical.exe`, **not
SnowRunner** — irrelevant.)

**Paths.** Install locations are machine-specific — set these for your own system (the repo's
scripts resolve them via `$SR_GAME`, see `.env.local.example`):
```bash
SR_GAME=/path/to/SteamLibrary/steamapps/common/SnowRunner   # your install root
STEAM=${XDG_DATA_HOME:-$HOME/.local/share}/Steam

GAME_DIR="$SR_GAME/Sources/Bin"
APPID=1465360
COMPATDATA="$SR_GAME/../../compatdata/$APPID"               # sibling of steamapps/common
PROTON="$STEAM/compatibilitytools.d/GE-Proton10-34/proton"  # reference runtime
```

**Step 1 — verify the loaded DLL (do first).** Steam → Properties → Launch Options:
`WINEDEBUG=+loaddll PROTON_LOG=1 %command%`, play until audio starts, quit, then:
```bash
grep -iE 'loaddll.*(xaudio|faudio|mmdevapi)' ~/steam-1465360.log 2>/dev/null
# expect:  Loaded L"...\Bin\xaudio2_9redist.dll" ... : native
```
`native` on `xaudio2_9redist.dll` = the game's own MS PE (the path we hook). You will NOT see
`xaudio2_9.dll : builtin` used for playback.

**Step 2 — proxy DLL that loads the gadget.** The game loads `xaudio2_9redist.dll` by name from
its own folder, so make that DLL a proxy: forward all real exports to a renamed original, and
`LoadLibrary("FridaGadget.dll")` from `DllMain` (on a fresh thread — never under loader lock).
This loads the gadget the instant the game touches XAudio2, before `XAudio2Create`.
```bash
cd "$GAME_DIR"
cp xaudio2_9redist.dll xaudio2_9redist_real.dll     # keep original, renamed
"$PROTON"/../files/bin/wine64 winedump -j export xaudio2_9redist_real.dll | grep -iE 'XAudio|X3DAudio|Create'
```
`proxy.c` → built to `xaudio2_9redist.dll` (adjust `/export:` lines to the real DLL's exports):
```c
#include <windows.h>
#pragma comment(linker, "/export:XAudio2Create=xaudio2_9redist_real.XAudio2Create,@1")
#pragma comment(linker, "/export:CreateAudioReverb=xaudio2_9redist_real.CreateAudioReverb,@2")
#pragma comment(linker, "/export:CreateAudioVolumeMeter=xaudio2_9redist_real.CreateAudioVolumeMeter,@3")
#pragma comment(linker, "/export:CreateFX=xaudio2_9redist_real.CreateFX,@4")
#pragma comment(linker, "/export:X3DAudioInitialize=xaudio2_9redist_real.X3DAudioInitialize,@5")
#pragma comment(linker, "/export:X3DAudioCalculate=xaudio2_9redist_real.X3DAudioCalculate,@6")
static DWORD WINAPI load_gadget(LPVOID p){ LoadLibraryA("FridaGadget.dll"); return 0; }
BOOL WINAPI DllMain(HINSTANCE h, DWORD reason, LPVOID r){
  if (reason==DLL_PROCESS_ATTACH){ DisableThreadLibraryCalls(h);
    CreateThread(NULL,0,load_gadget,NULL,0,NULL); }   // never LoadLibrary under loader lock
  return TRUE;
}
```
Build (MinGW on Linux):
`x86_64-w64-mingw32-gcc -shared -O2 proxy.c -o xaudio2_9redist.dll -Wl,--enable-stdcall-fixup`

Gadget files next to it: `FridaGadget.dll` (frida-gadget-<ver>-**windows-x86_64**) plus
`FridaGadget.config`:
```jsonc
{ "interaction": { "type": "script",
  "path": "Z:\\path\\to\\SnowRunner\\Sources\\Bin\\frida-trace-xaudio.js",
  "on_change": "reload" } }
```
Path is a **Windows** path (`Z:\` = Linux `/`), backslash-escaped — i.e. `$GAME_DIR` with `/`
→ `\` and a `Z:` prefix. `tools/install-recon.sh` generates this for you rather than having
anyone hand-write a machine path.

> **The dinput8 variant (compile-free).** When no MinGW is available, the same idea runs
> through the **Ultimate ASI Loader**: prebuilt `dinput8.dll` (which the game imports) → loads
> `frida.asi` (the gadget) → runs the harness. Only *adds* files to `Bin/` → clean uninstall.
> This is the route `tools/install-recon.sh` / `install-devmod.sh` use.

**Step 3 — launch.** Via Steam (easiest, DRM-friendly): launch normally, keep
`PROTON_LOG=1 %command%`, `tail -f ~/steam-1465360.log` and watch for `[xrecon]` lines. Manual
(iterate without the UI):
```bash
STEAM_COMPAT_DATA_PATH="$COMPATDATA" \
STEAM_COMPAT_CLIENT_INSTALL_PATH="$STEAM" \
SteamAppId=1465360 SteamGameId=1465360 \
"$PROTON" run "$GAME_DIR/SnowRunner.exe"
```
Steam client must be running (SteamStub's `SteamAPI_RestartAppIfNecessary`); `SteamAppId=1465360`
(and a `steam_appid.txt` with `1465360` in `Bin/`) makes the restart check pass.

**Fallback — pure proxy, no Frida.** If frida-gum misbehaves under Wine: keep the proxy, but
make `XAudio2Create` a real export that calls the renamed original via `GetProcAddress`, then
`VirtualProtect` + swap the `IXAudio2` vtable's `CreateSourceVoice` slot and the source-voice
`SetFrequencyRatio` slot, logging in C. No ptrace/libc/Frida — most robust, at the cost of
hand-writing the COM wrapping. This is also the natural shape of the shipping mod (see
[[Distribution and Portability|Distribution-and-Portability]]).

**Gotchas.**
- **SteamStub** wraps only `SnowRunner.exe` (decrypts before audio init); hooking
  `xaudio2_9redist.dll` never touches the protected module — no anti-tamper trip. Keep Steam
  running.
- **EOS** (`EOSSDK-Win64-Shipping.dll`) is online-services, not kernel anti-cheat — doesn't
  fight in-process DLL loading. Test offline/SP if it ever interferes.
- **fsync** (GE-Proton): no known conflict with in-process gadget hooking.
- **Arch/version:** x64 → `windows-x86_64` gadget; keep gadget + any client on one Frida version.
- Sources: frida issues #3339/#3617, [Frida Gadget docs](https://frida.re/docs/gadget/),
  [Proton #8730](https://github.com/ValveSoftware/Proton/issues/8730),
  [UniversalProxyDLL](https://github.com/techiew/UniversalProxyDLL).

## Machine-controllable driving harness

Drive vehicles through **reproducible, no-hands scenarios** to (1) correlate engine-audio
behavior against *known* throttle/gear inputs, and (2) run **automated regression tests** on
the mod ("ratio drops at every upshift", "pitch tracks the RPM formula within tolerance")
without a human at the wheel. Two layers; build L1 first.

### L1 — In-process Frida override harness (primary)
Runs in the **same Frida session as the audio tracer**, so input and audio events share one
clock and one CSV — perfect correlation, zero external plumbing, no Steam Input to fight. It
**intercepts the game's own per-frame drivetrain-input call and substitutes values** rather
than calling game functions from a foreign thread:

- Hook **`SetPowerCoef`** (SMT AOB `48 8B 41 68 F3 0F 11 48 38 C3` = `mov rax,[rcx+0x68];
  movss [rax+0x38],xmm1` → writes `TruckAction.PowerCoef`). This is the game applying throttle
  every frame, **on the game thread**. In the hook: capture the vehicle/controller pointer
  (`rcx`), override the throttle float (`xmm1`) with the scenario target, and drain any **queued
  gear action** here (game-thread-safe) via `DisableAutoAndShift` / `ShiftToHigh` /
  `ShiftToReverse` (SMT AOBs).
- The **scenario runner** lives on Frida's JS thread (`setTimeout`) and only sets
  `targetThrottle` / pushes gear actions to a queue — it never calls game code directly, so no
  cross-thread race.

Deterministic, thread-safe, reuses SMT (MIT) with attribution. The AOB `[rcx+0x68]` also
resolves the `TruckAction` offset ambiguity: **it's +0x68 on the current build.**

### L2 — Linux uinput virtual gamepad (realism / final validation)
A userspace **evdev/uinput** virtual Xbox360 pad (`tools/vgamepad.py`, pure-Python; `/dev/uinput`
writable here) driven by a scenario runner. Drives the game through its **normal input path**
(SDL/Steam Input sees a real controller), enabling **steering, analog throttle, full routes**
and validating the shipped mod end-to-end without relying on our RE being correct. Setup
friction: Steam Input mapping + confirming the game binds the virtual pad. `--selftest` passes
(creates the pad, kernel registers it, emits events, destroys cleanly).

**Why L1 first:** the immediate question (does engine pitch track wheel-speed and miss the
shift drop?) needs precise, deterministic throttle+gear on the audio clock — L1 delivers that
and reuses RE we need anyway. L2 is the black-box realism layer.

### Scenario format (shared by both layers)
```js
// timed steps; harness interpolates/holds between them
const SCENARIO = [
  { t: 0,     throttle: 0.0, gear: 'N',  note: 'idle baseline' },
  { t: 4000,  throttle: 1.0,             note: 'rev in neutral' },
  { t: 8000,  throttle: 0.0, gear: 1,    note: 'select low' },
  { t: 10000, throttle: 1.0,             note: 'accelerate in gear 1' },
  { t: 16000, shift: 'up',               note: 'UPSHIFT — watch for ratio drop' },
  { t: 22000, throttle: 0.0, brake: 1.0, note: 'coast to stop' },
  { t: 26000, gear: 'R', throttle: 0.6,  note: 'reverse' },
  { t: 30000, throttle: 0.0,             note: 'done' },
];
```

### Correlation & regression (the payoff)
Both layers write `input` rows into the same `xrecon-events.csv`
(`t_ms,event,voice,value,caller`) that already carries `freq`/`vol` rows. `tools/analyze-trace.py`
then overlays the engine-voice `freq` ratio against `input` throttle/gear on one timeline and:
- **asserts the bug**: through an `up`-shift the ratio climbs monotonically (no drop);
- later **asserts the fix**: the ratio steps down at each shift and matches
  `clamp(idle,1,wheel_angvel/AngVel(gear))` within tolerance.

That assertion script becomes the mod's automated regression test — run a scenario, diff the
trace against expected, pass/fail. (Ground-truth curve is emitted by `tools/model/rpm_model.py`
→ `expected_curve.{csv,png}`.)

### Safety / unknowns (L1)
- **Thread safety:** all game-function calls happen inside the `SetPowerCoef` hook (game
  thread). The JS thread only mutates plain vars/queues — never call game code from `setTimeout`.
- **Fail-safe:** if AOBs don't resolve, the harness disables itself and the audio tracer still
  runs. Autodrive is **off by default** (`DRIVE=false`).
- **To verify live:** does `SetPowerCoef` fire every frame incl. at idle (needed to hold
  throttle)? does overriding throttle alone move the truck (must be in-mission, in a truck,
  engine on)? do `ShiftToHigh`/etc. expect the same pointer as `SetPowerCoef`'s `rcx`?

## Autonomous operations (hands-off loop)

The agent can run the whole recon loop hands-off: **launch → see → act → dump → detect health →
stop**. Primitives live in `tools/auto/`; validated on KDE Wayland (2560×1440, NVIDIA) + Steam
Proton (GE-Proton10-34).

| Capability | Tool | Notes |
|---|---|---|
| **See the screen** | `tools/auto/shot.sh [name]` | KDE `spectacle -b -n -f -o` → full-res PNG the agent `Read`s. XWayland `x11grab`/`import` capture BLACK — must use spectacle. |
| **Health / state** | `tools/auto/health.sh` | game pid/alive, steam up, harness installed?, xrecon.log + events.csv status, crash-dump hint. |
| **Launch** | `tools/auto/launch.sh` | `steam steam://rungameid/1465360` (Steam handles Proton + SteamStub). Waits for the process. |
| **Stop** | `tools/auto/stop.sh` | `steam://stop` → SIGTERM → SIGKILL on `SnowRunner.exe`. |
| **Keyboard input** | `tools/auto/uinput_kbd.py` | pure-Python uinput kbd; `--tap ENTER`, `--hold W 3`, `--seq "DOWN DOWN ENTER"`. Menu nav + keyboard driving. |
| **Gamepad input** | `tools/vgamepad.py` | pure-Python uinput X360 pad; analog throttle/steer for driving. |
| **Game data dump** | Frida gadget → `tools/staging/xrecon.log` + `xrecon-events.csv` | XAudio2 pitch/voice trace (+ autodrive input events when enabled). |
| **Analyze** | `tools/analyze-trace.py` | verdict + plot from the CSV. |

Input note: uinput devices sit **below** the compositor, so keys/pad reach whatever window is
focused. A launched game grabs focus, so input lands on it — the agent's own tool calls don't
need terminal focus. Steam Input may intercept the virtual **gamepad**; the **keyboard** path is
not intercepted and is the reliable default for menus.

The loop (every step observable — screenshot + health + log tail — so the agent adapts instead
of running blind):
```
install trace-only  ->  launch.sh  ->  [poll: health.sh + shot.sh, Read the PNG]
  ->  navigate menus (uinput_kbd --seq, guided by screenshots)
  ->  in a truck: drive (uinput_kbd --hold W / vgamepad) while the tracer records
  ->  stop.sh  ->  uninstall-recon.sh  ->  analyze-trace.py
```
On a crash: `health.sh` shows the game gone / a crash dump; revert to stock with
`uninstall-recon.sh` and diagnose from `xrecon.log`.

**Safety rails.** Trace-only never touches game code (pure XAudio2 hooks) — the crash-free path.
Autodrive (`--drive`) is experimental (hooks `SetPowerCoef`) and gated to load only when
explicitly enabled. The harness only ADDS files to `Bin/`; `uninstall-recon.sh` fully restores
stock. `stop.sh` + `uninstall-recon.sh` return the machine to a clean state at any time.

## IPC to the overlay

Frida writer ↔ C++ ASI overlay share a named shm mapping (`Local\srdt_telemetry`), layout in
`mod/src/telemetry.h` (magic / layout-version / seqlock header). Same-process, so a fixed struct
+ seqlock beats serialization. A reverse block (`SRDC`) carries overlay→harness config.

## Diagnostic switches (turn OFF for normal play)

- `tools/dev/src/55-diag.js` (`CFG.diagAngvel`) — angvel/island probes.
- `CFG.boxPassive` — hands the gearbox back to the game (so the game's own shift points are
  the reference).

## Reference mods (facts/AOBs only)

- **SMT** (drafty46, MIT) — AOB anchors + Detours; source of the TRUCK_CONTROL AOB and
  throttle/gear offsets. Local copy: `reference/Snowrunner-Manual-Gearbox-Mod`.
- **Ferrster** (MIT) — `q_VehStateFlags@0x768`, `Accel@0x44`, `PowerCoef@0x38`,
  `IsInAutoMode@0x3C`, `Gear_1@0x70`, `NextGear@0xE0`.
- **doski2 `snowrunner-real`** (unlicensed → facts/offsets only) — the current-build Havok
  map. Local: `reference/snowrunner-real`.
- **Noclip `mappings.md`** — patch-18, **stale**; cross-check only.

_Deep dives: [[Ghidra Functions|Ghidra-Functions]], `.claude/skills/ghidra-re/`._
