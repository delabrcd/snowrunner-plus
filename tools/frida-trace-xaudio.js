// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.
'use strict';
/*
 * frida-trace-xaudio.js — SnowRunner XAudio2 engine-audio recon
 * ============================================================
 * Goal of this script (recon spike, see ../docs/attack-plan.md):
 *   1. Enumerate every IXAudio2SourceVoice the game creates (format, loop flags,
 *      callback pointer, and WHO created it).
 *   2. Identify which voices are the *engine* layers (idle/low/high/...) — they are
 *      the ones whose SetFrequencyRatio / SetVolume get called continuously while
 *      driving, and whose buffers loop infinitely. SFX/one-shots set ratio once.
 *   3. Capture, for the engine voices, the CALLER of SetFrequencyRatio — i.e. the
 *      game-code address that computes the pitch from wheel speed. That caller is the
 *      vector-B target (the function to reverse and re-point at a real RPM).
 *   4. Log the frequency-ratio time-series so we can confirm it tracks wheel speed
 *      (continuous, no shift discontinuity) rather than RPM.
 *
 * Run:  see ../docs/frida-under-proton.md for how to inject under GE-Proton.
 *       Prefer SPAWN (not attach) so XAudio2Create is hooked before it's called.
 *
 * NOTE ON ASSUMPTIONS (being verified by parallel recon):
 *   - vtable indices below are the standard XAudio2 2.9 COM layout, CONFIRMED against
 *     xaudio2.h declaration order (see docs/reference/xaudio2-vtables.md).
 *   - Audio routing CONFIRMED: under GE-Proton the game loads its own native
 *     xaudio2_9redist.dll (not Wine builtin, not FAudio), so hooking XAudio2Create here
 *     intercepts real audio. Inject via proxy-DLL + frida-gadget (docs/frida-under-proton.md);
 *     native Linux Frida does NOT work (sees the ELF, not the PE modules).
 *   - Reading the `float Ratio` arg from Interceptor.attach is unreliable on x64
 *     (it's in XMM1, which attach args[] don't decode). We therefore default to a
 *     typed Interceptor.replace for SetFrequencyRatio to read the float correctly,
 *     while a lightweight attach captures the CALLER. Toggle via CONFIG.
 */

// ----------------------------------------------------------------------------
// CONFIG
// ----------------------------------------------------------------------------
const CONFIG = {
  dllCandidates: ['xaudio2_9redist.dll', 'xaudio2_9.dll', 'XAudio2_9Redist.dll'],
  summaryEverySec: 5,       // periodic voice table
  logEveryRatioCall: false, // true = firehose every SetFrequencyRatio; false = sampled/summary
  ratioSampleEveryN: 30,    // when not firehosing, log 1 of every N ratio calls per voice
};

// Mirror all output to a log file too — under Proton the gadget's stdout is often lost,
// so the file is the reliable capture. Windows path (Z: = Linux /). Set to null to disable.
// @@STAGE@@ is the Wine-visible tools/staging/ path, substituted by install-recon.sh at
// install time (same idiom as @@DEV@@ in tools/dev/build.sh) — don't hardcode it here.
const LOG_FILE = '@@STAGE@@xrecon.log';
// Machine-readable per-event trace for offline correlation (t_ms,event,voice,value,caller).
const CSV_FILE = '@@STAGE@@xrecon-events.csv';

const PSZ = Process.pointerSize; // 8 on x64

// Standard XAudio2 2.9 vtable indices (zero-based).
// IXAudio2 : IUnknown  -> QI/AddRef/Release at 0/1/2
// IXAudio2SourceVoice : IXAudio2Voice (NOT IUnknown) -> index 0 is GetVoiceDetails
const VT = {
  // IXAudio2
  CreateSourceVoice: 5,
  // IXAudio2SourceVoice
  SetVolume: 12,
  SubmitSourceBuffer: 21,
  GetState: 25,
  SetFrequencyRatio: 26,
  GetFrequencyRatio: 27,
};

// ----------------------------------------------------------------------------
// helpers
// ----------------------------------------------------------------------------
let _logf = null;
if (LOG_FILE) { try { _logf = new File(LOG_FILE, 'w'); } catch (e) { /* File API absent */ } }
function emit(line) {
  console.log(line);
  if (_logf) { try { _logf.write(line + '\n'); _logf.flush(); } catch (e) {} }
}
function log(msg) { emit('[xrecon] ' + msg); }

// CSV event trace + relative clock. Date.now() is available in Frida's runtime.
const T0 = Date.now();
let _csv = null;
if (CSV_FILE) {
  try { _csv = new File(CSV_FILE, 'w'); _csv.write('t_ms,event,voice,value,caller\n'); } catch (e) {}
}
function csv(event, voice, value, caller) {
  if (!_csv) return;
  try { _csv.write((Date.now() - T0) + ',' + event + ',' + voice + ',' + value + ',' + (caller || '') + '\n'); _csv.flush(); } catch (e) {}
}

function findAudioModule() {
  const mods = Process.enumerateModules();
  for (const cand of CONFIG.dllCandidates) {
    const m = mods.find(x => x.name.toLowerCase() === cand.toLowerCase());
    if (m) return m;
  }
  // loose match
  const m = mods.find(x => /xaudio2/i.test(x.name));
  return m || null;
}

function vtEntry(objPtr, index) {
  const vtbl = objPtr.readPointer();
  return vtbl.add(index * PSZ).readPointer();
}

// label a code address as "module.dll+0xOFFSET" (or raw if unknown)
function addrLabel(addr) {
  if (addr === null || addr.isNull()) return '<null>';
  const m = Process.findModuleByAddress(addr);
  if (!m) return addr.toString();
  return m.name + '+0x' + addr.sub(m.base).toString(16);
}

function readWaveFormat(pFmt) {
  if (pFmt.isNull()) return null;
  try {
    return {
      formatTag: pFmt.readU16(),
      channels: pFmt.add(2).readU16(),
      sampleRate: pFmt.add(4).readU32(),
      bitsPerSample: pFmt.add(14).readU16(),
    };
  } catch (e) { return null; }
}

// XAUDIO2_BUFFER: Flags(0,u32) AudioBytes(4,u32) pAudioData(8,ptr)
//                 PlayBegin(16) PlayLength(20) LoopBegin(24) LoopLength(28) LoopCount(32)
function readXaBuffer(pBuf) {
  if (pBuf.isNull()) return null;
  try {
    return {
      flags: pBuf.readU32(),
      audioBytes: pBuf.add(4).readU32(),
      pAudioData: pBuf.add(8).readPointer(),
      loopCount: pBuf.add(32).readU32(), // 255 (0xFF) = XAUDIO2_LOOP_INFINITE
    };
  } catch (e) { return null; }
}

// ----------------------------------------------------------------------------
// per-voice state
// ----------------------------------------------------------------------------
const voices = new Map(); // voicePtr(string) -> stats
let voiceSeq = 0;

function voiceStat(ptr) {
  const key = ptr.toString();
  let s = voices.get(key);
  if (!s) {
    s = {
      id: voiceSeq++, ptr: key, fmt: null, createdBy: null, callbackPtr: null,
      firstBufferBytes: null, loops: false,
      ratio: { count: 0, min: Infinity, max: -Infinity, last: null, callers: new Set() },
      vol:   { count: 0, last: null },
      submit: { count: 0 },
    };
    voices.set(key, s);
  }
  return s;
}

// Only hook each shared vtable method address once (all source voices share one vtable).
const hookedMethods = new Set();
function hookOnce(addr, name, cb) {
  const k = addr.toString();
  if (hookedMethods.has(k)) return;
  hookedMethods.add(k);
  cb(addr);
  log('hooked ' + name + ' @ ' + addrLabel(addr));
}

// ----------------------------------------------------------------------------
// hook the source-voice methods (idempotent per vtable)
// ----------------------------------------------------------------------------
function hookSourceVoiceMethods(voicePtr) {
  // SetFrequencyRatio — read the float correctly via typed replace, and grab caller.
  const setFreq = vtEntry(voicePtr, VT.SetFrequencyRatio);
  hookOnce(setFreq, 'SetFrequencyRatio', (addr) => {
    // SetFrequencyRatio returns void; float Ratio is in XMM1 (win64), so a typed
    // replace is the only reliable way to read it. 'win64' ABI is explicit for safety.
    const orig = new NativeFunction(addr, 'void', ['pointer', 'float', 'uint32'], 'win64');
    Interceptor.replace(addr, new NativeCallback(function (thiz, ratio, opSet) {
      try {
        const s = voiceStat(thiz);
        const r = Number(ratio);
        s.ratio.count++;
        if (Number.isFinite(r)) {
          s.ratio.last = r;
          s.ratio.min = Math.min(s.ratio.min, r);
          s.ratio.max = Math.max(s.ratio.max, r);
        }
        // this.returnAddress is available inside a replace callback's context
        const callerLbl = addrLabel(this.returnAddress);
        s.ratio.callers.add(callerLbl);
        csv('freq', s.id, r.toFixed(5), callerLbl);
        if (CONFIG.logEveryRatioCall ||
            (s.ratio.count % CONFIG.ratioSampleEveryN === 0)) {
          log('voice#' + s.id + ' SetFrequencyRatio=' + r.toFixed(4) + ' caller=' + callerLbl);
        }
      } catch (e) { /* never break the game */ }
      return orig(thiz, ratio, opSet);
    }, 'void', ['pointer', 'float', 'uint32'], 'win64'));
  });

  // SetVolume(this, float Volume, uint32 opSet) — crossfade gains between layers.
  const setVol = vtEntry(voicePtr, VT.SetVolume);
  hookOnce(setVol, 'SetVolume', (addr) => {
    const orig = new NativeFunction(addr, 'void', ['pointer', 'float', 'uint32'], 'win64');
    Interceptor.replace(addr, new NativeCallback(function (thiz, vol, opSet) {
      try {
        const s = voiceStat(thiz);
        const v = Number(vol);
        s.vol.count++; if (Number.isFinite(v)) s.vol.last = v;
        csv('vol', s.id, v.toFixed(5), '');
      } catch (e) {}
      return orig(thiz, vol, opSet);
    }, 'void', ['pointer', 'float', 'uint32'], 'win64'));
  });

  // SubmitSourceBuffer(this, XAUDIO2_BUFFER* pBuffer, ...) — fingerprint the layer:
  // engine loops submit an infinite-loop buffer; SFX are one-shots.
  const submit = vtEntry(voicePtr, VT.SubmitSourceBuffer);
  hookOnce(submit, 'SubmitSourceBuffer', (addr) => {
    Interceptor.attach(addr, {
      onEnter(args) {
        try {
          const s = voiceStat(args[0]);
          s.submit.count++;
          const b = readXaBuffer(args[1]);
          if (b) {
            if (s.firstBufferBytes === null) s.firstBufferBytes = b.audioBytes;
            if (b.loopCount === 0xFF || b.loopCount > 0) s.loops = true;
          }
        } catch (e) {}
      }
    });
  });
}

// ----------------------------------------------------------------------------
// hook IXAudio2::CreateSourceVoice to catch every voice + its creator
// ----------------------------------------------------------------------------
function hookXAudio2Instance(pXAudio2) {
  const create = vtEntry(pXAudio2, VT.CreateSourceVoice);
  hookOnce(create, 'IXAudio2::CreateSourceVoice', (addr) => {
    Interceptor.attach(addr, {
      // CreateSourceVoice(this, ppSourceVoice, pSourceFormat, Flags, MaxFreqRatio(float),
      //                   pCallback, pSendList, pEffectChain)
      onEnter(args) {
        this.ppVoice = args[1];
        this.pFmt = args[2];
        this.pCallback = args[5];
        this.caller = this.returnAddress;
      },
      onLeave(retval) {
        try {
          if (this.ppVoice.isNull()) return;
          const voicePtr = this.ppVoice.readPointer();
          if (voicePtr.isNull()) return;
          const s = voiceStat(voicePtr);
          s.fmt = readWaveFormat(this.pFmt);
          s.createdBy = addrLabel(this.caller);
          s.callbackPtr = this.pCallback.isNull() ? null : addrLabel(this.pCallback);
          log('CreateSourceVoice -> voice#' + s.id + ' @ ' + voicePtr +
              ' fmt=' + JSON.stringify(s.fmt) +
              ' cb=' + s.callbackPtr + ' by=' + s.createdBy);
          hookSourceVoiceMethods(voicePtr);
        } catch (e) { log('CreateSourceVoice onLeave err: ' + e); }
      }
    });
  });
}

// ----------------------------------------------------------------------------
// bootstrap: hook the XAudio2Create export, then the returned instance
// ----------------------------------------------------------------------------
function bootstrap() {
  const mod = findAudioModule();
  if (!mod) {
    log('!! no xaudio2 module loaded yet. If you ATTACHED, the DLL may load later — ' +
        'prefer spawn, or re-run this after audio init. Retrying in 2s...');
    setTimeout(bootstrap, 2000);
    return;
  }
  log('audio module: ' + mod.name + ' @ ' + mod.base + ' (size 0x' + mod.size.toString(16) + ')');

  // The redist's XAudio2Create is an inline wrapper around the real export
  // XAudio2CreateWithVersionInfo; a game built against the redist usually calls the
  // latter. Both take IXAudio2** as arg0, so the hook body is identical. Prefer it.
  let createExport = null, createName = null;
  for (const nm of ['XAudio2CreateWithVersionInfo', 'XAudio2Create']) {
    try { const e = Module.getExportByName(mod.name, nm); if (e) { createExport = e; createName = nm; break; } } catch (err) {}
  }
  if (!createExport) {
    log('!! neither XAudio2CreateWithVersionInfo nor XAudio2Create exported by ' + mod.name +
        ' — the game may obtain IXAudio2 via CoCreateInstance, or Wine routes ' +
        'XAudio2 to a builtin/FAudio. See docs/frida-under-proton.md (routing check).');
    return;
  }
  log(createName + ' @ ' + addrLabel(createExport));
  Interceptor.attach(createExport, {
    onEnter(args) { this.ppX = args[0]; }, // XAudio2Create(IXAudio2** ppXAudio2, Flags, Processor)
    onLeave(retval) {
      try {
        const pX = this.ppX.readPointer();
        if (pX.isNull()) { log('XAudio2Create returned null instance'); return; }
        log('IXAudio2 instance @ ' + pX);
        hookXAudio2Instance(pX);
      } catch (e) { log('XAudio2Create onLeave err: ' + e); }
    }
  });
}

// ----------------------------------------------------------------------------
// periodic summary — the payload we care about
// ----------------------------------------------------------------------------
function summary() {
  const rows = [...voices.values()].sort((a, b) => b.ratio.count - a.ratio.count);
  emit('\n================ VOICE SUMMARY (' + rows.length + ' voices) ================');
  emit('id  loop  rate    ratioN  ratio[min..max/last]        volN  submitN  createdBy');
  for (const s of rows) {
    const r = s.ratio;
    const rr = r.count
      ? (isFinite(r.min) ? r.min.toFixed(3) : '?') + '..' +
        (isFinite(r.max) ? r.max.toFixed(3) : '?') + '/' +
        (r.last === null ? '?' : r.last.toFixed(3))
      : '-';
    emit(
      String(s.id).padEnd(4) +
      (s.loops ? 'Y' : '.').padEnd(6) +
      String(s.fmt ? s.fmt.sampleRate : '?').padEnd(8) +
      String(r.count).padEnd(8) +
      rr.padEnd(28) +
      String(s.vol.count).padEnd(6) +
      String(s.submit.count).padEnd(9) +
      (s.createdBy || '?')
    );
  }
  // The engine-pitch callers = the vector-B targets. Surface them explicitly.
  const callers = new Set();
  for (const s of rows) if (s.ratio.count > 5) for (const c of s.ratio.callers) callers.add(c);
  if (callers.size) {
    emit('\n--- SetFrequencyRatio callers on actively-modulated voices ' +
         '(vector-B targets to reverse) ---');
    for (const c of callers) emit('    ' + c);
  }
  emit('=========================================================================\n');
}

// ----------------------------------------------------------------------------
log('SnowRunner XAudio2 recon starting. pointerSize=' + PSZ);
bootstrap();
setInterval(summary, CONFIG.summaryEverySec * 1000);
