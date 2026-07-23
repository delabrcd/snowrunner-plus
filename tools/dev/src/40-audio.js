// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.
// 40-audio — engine-voice takeover (pitch/volume/filter via XAudio2 hooks).
// ---- engine voice takeover ----
const engineVoices = {};
const gameRatios = {};   // per-voice ORIGINAL ratio the game asked for = its engine-speed estimate
let g_volFn = null;                 // cached SetVolume NativeFunction (shared vtable)
const g_filterFns = {};             // SetFilterParameters NativeFunction cache by vtable-slot addr
const g_fparams = Memory.alloc(12); // XAUDIO2_FILTER_PARAMETERS {uint32 type; float freq; float oneOverQ}
function applyFilter(voice, cutoff) {
  try {
    const slot = voice.readPointer().add(VT_SETFILTER * 8).readPointer();
    let fn = g_filterFns[slot.toString()];
    if (!fn) { fn = new NativeFunction(slot, 'void', ['pointer', 'pointer', 'uint32'], 'win64'); g_filterFns[slot.toString()] = fn; }
    g_fparams.writeU32(0);                    // LowPassFilter
    g_fparams.add(4).writeFloat(cutoff);      // normalized cutoff (0..1)
    g_fparams.add(8).writeFloat(1.0);         // OneOverQ
    fn(voice, g_fparams, 0);
  } catch (e) {}
}
function hookVolume(voice) {
  if (g_volFn) return;
  const addr = voice.readPointer().add(VT_SETVOLUME * 8).readPointer();
  const orig = new NativeFunction(addr, 'void', ['pointer', 'float', 'uint32'], 'win64');
  g_volFn = orig;
  Interceptor.replace(addr, new NativeCallback(function (v, vol, op) {
    let o = vol;
    try {
      if (engineVoices[v.toString()]) o = CFG.mode === 'mute' ? 0.0 : (CFG.volOverride ? clamp(vol * g_vol, 0, 3) : vol);
    } catch (e) {}
    return orig(v, o, op);
  }, 'void', ['pointer', 'float', 'uint32'], 'win64'));
  out('hooked SetVolume @ ' + addr);
}
// ---- shift-sound control: the gearbox clunk is a one-shot buffer the game submits on a
// gear change, on a THROWAWAY voice (created per play, destroyed after — live-observed).
// Learning: during the clutch window (g_muteShiftUntil, set by 30-gearbox on the fake
// shift into N), a one-shot submit whose SIZE was seen in 2 windows is a clunk variant.
// Sizes are content-stable across runs (pointers are not) -> persisted to shiftsnd.json,
// so after the first session the clunk is muted from the very first clutch. Each learned
// variant's PCM is COPIED into our own memory (no dangling sound-bank pointers) for
// replay on gear-select while clutched. The first learned clunk voice is KEPT: its
// DestroyVoice is swallowed (game just drops the pointer; XAudio2 keeps the voice, its
// format/routing already correct) and it becomes our dedicated replay voice.
const VT_SUBMIT = 21, VT_START = 19, VT_DESTROY = 18;
const SND_PATH = BASE + 'shiftsnd.json';
let g_subFn = null, g_startFn = null, g_keepVoice = null;
const g_clunkSizes = {};          // size -> true (learned, persisted)
const g_clunkSeen = {};           // size -> sightings inside clutch windows (learning)
const g_clunkBufs = [];           // replay library: [{buf(48B), size}] with self-owned PCM
try { JSON.parse(File.readAllText(SND_PATH)).sizes.forEach(function (s) { g_clunkSizes[s] = true; }); } catch (e) {}
function saveClunkSizes() {
  try { const f = new File(SND_PATH, 'w'); f.write(JSON.stringify({ sizes: Object.keys(g_clunkSizes).map(Number) })); f.flush(); if (f.close) f.close(); } catch (e) {}
}
function captureClunk(v, buf, size) {
  if (!g_clunkBufs.some(function (b) { return b.size === size; }) && g_clunkBufs.length < 8) {
    const bytes = buf.add(4).readU32();
    const pcm = Memory.dup(buf.add(8).readPointer(), bytes);   // own the PCM
    const copy = Memory.alloc(48); Memory.copy(copy, buf, 48);
    copy.add(8).writePointer(pcm);
    g_clunkBufs.push({ buf: copy, size: size, _pcm: pcm });    // _pcm ref keeps the dup alive
    out('SHIFTSND captured variant size=' + size + ' (' + g_clunkBufs.length + ' in library)');
  }
  if (!g_keepVoice) { g_keepVoice = v; out('SHIFTSND keeping voice ' + v + ' for replay (its destroy will be swallowed)'); }
}
function hookSubmit(voice) {
  if (g_subFn) return;
  const vt = voice.readPointer();
  const addr = vt.add(VT_SUBMIT * 8).readPointer();
  g_startFn = new NativeFunction(vt.add(VT_START * 8).readPointer(), 'int', ['pointer', 'uint32', 'uint32'], 'win64');
  const orig = new NativeFunction(addr, 'int', ['pointer', 'pointer', 'pointer'], 'win64');
  g_subFn = orig;
  Interceptor.replace(addr, new NativeCallback(function (v, buf, wma) {
    try {
      if (buf && !buf.isNull() && Date.now() < g_muteShiftUntil && buf.add(32).readU32() === 0) {   // one-shot in a clutch window
        const size = buf.add(4).readU32();
        if (g_clunkSizes[size]) {                                    // known clunk: capture + swallow
          captureClunk(v, buf, size);
          return 0;
        }
        if (size < 20000 || size > 80000) return orig(v, buf, wma);   // outside the clunk family
        g_clunkSeen[size] = (g_clunkSeen[size] || 0) + 1;
        out('SHIFTSND cand size=' + size + ' seen=' + g_clunkSeen[size]);
        if (g_clunkSeen[size] >= 2) {
          g_clunkSizes[size] = true; saveClunkSizes();
          out('SHIFTSND learned size=' + size + ' (persisted)');
          captureClunk(v, buf, size);
          return 0;
        }
      }
    } catch (e) {}
    return orig(v, buf, wma);
  }, 'int', ['pointer', 'pointer', 'pointer'], 'win64'));
  // swallow DestroyVoice for OUR kept replay voice; everything else passes through
  const dAddr = vt.add(VT_DESTROY * 8).readPointer();
  const dOrig = new NativeFunction(dAddr, 'void', ['pointer'], 'win64');
  Interceptor.replace(dAddr, new NativeCallback(function (v) {
    try { if (g_keepVoice && v.equals(g_keepVoice)) { out('SHIFTSND destroy swallowed (replay voice kept)'); return; } } catch (e) {}
    return dOrig(v);
  }, 'void', ['pointer'], 'win64'));
  out('hooked SubmitSourceBuffer @ ' + addr + ' + DestroyVoice @ ' + dAddr);
}
let g_replayIdx = 0;
function playShiftSound() {
  if (!g_keepVoice || !g_clunkBufs.length || !g_subFn) return false;
  const b = g_clunkBufs[g_replayIdx++ % g_clunkBufs.length];
  try { g_subFn(g_keepVoice, b.buf, NULL); g_startFn(g_keepVoice, 0, 0); return true; } catch (e) { return false; }
}
function hookAudio() {
  const xa = Process.enumerateModules().find(m => /xaudio2_9\.dll$/i.test(m.name));
  const addr = xa.base.add(SETFREQ_OFF);
  const orig = new NativeFunction(addr, 'void', ['pointer', 'float', 'uint32'], 'win64');
  const lo = g_snow.base.add(ENG_LO), hi = g_snow.base.add(ENG_HI);
  Interceptor.replace(addr, new NativeCallback(function (voice, ratio, op) {
    let o = ratio;
    try {
      const caller = this.returnAddress;
      if (caller.compare(lo) >= 0 && caller.compare(hi) < 0) {     // engine voice (by pitch-caller)
        engineVoices[voice.toString()] = true; hookVolume(voice); hookSubmit(voice);
        gameRatios[voice.toString()] = ratio;                      // capture game's estimate BEFORE override
        if (CFG.mode !== 'mute') {
          o = g_pitch;
          if (CFG.filterOn) applyFilter(voice, g_cutoff);           // voice is alive during its own call
        }
      }
    } catch (e) {}
    return orig(voice, o, op);
  }, 'void', ['pointer', 'float', 'uint32'], 'win64'));
  out('hooked SetFrequencyRatio @ ' + addr + ' (engine caller region ' + lo + '..' + hi + ')');
}

