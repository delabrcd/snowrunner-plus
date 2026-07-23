#!/usr/bin/env python3
# This Source Code Form is subject to the terms of the Mozilla Public
# License, v. 2.0. If a copy of the MPL was not distributed with this
# file, You can obtain one at https://mozilla.org/MPL/2.0/.
"""
analyze_engine_audio.py — extract a truck's engine loop layers from shared_sound.pak,
decode the MS-ADPCM via ffmpeg, and estimate each layer's fundamental (engine firing)
frequency. Reveals the recorded base pitches behind the 0.75/1.0/1.2 SetFrequencyRatio
offsets seen in the live trace, which informs the pitch/crossfade mapping the mod applies.

Writes nothing to the repo except a small summary + PNG in tools/model/ (audio stays in
the scratchpad — game assets are not committed).
"""
import os, re, sys, zipfile, subprocess, struct, pathlib
import numpy as np

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1]))
from srenv import game_dir, scratch_dir   # resolves the install path; never hardcode it

SR_GAME = game_dir()
SCRATCH = scratch_dir("engine_audio")
HERE = os.path.dirname(os.path.abspath(__file__))
TRUCK = sys.argv[1] if len(sys.argv) > 1 else "ank_mk38"
LAYERS = ["idle", "low", "high"]


def extract_and_decode():
    os.makedirs(SCRATCH, exist_ok=True)
    z = zipfile.ZipFile(SR_GAME + "/preload/paks/client/shared_sound.pak")
    names = z.namelist()
    out = {}
    for layer in LAYERS:
        # exact engine layer, not the _2d interior variant
        cand = [n for n in names
                if re.search(rf'trucks\\{TRUCK}\\{TRUCK}_{layer}\.pcm$', n, re.I)]
        if not cand:
            print(f'  {layer}: not found'); continue
        raw = os.path.join(SCRATCH, f'{TRUCK}_{layer}.wavadpcm')
        wav = os.path.join(SCRATCH, f'{TRUCK}_{layer}.wav')
        with open(raw, 'wb') as f:
            f.write(z.read(cand[0]))
        # decode ADPCM -> pcm_s16le mono via ffmpeg
        subprocess.run(['ffmpeg', '-y', '-loglevel', 'error', '-i', raw,
                        '-ac', '1', '-c:a', 'pcm_s16le', wav], check=True)
        out[layer] = wav
    return out


def load_wav(path):
    from scipy.io import wavfile
    sr, data = wavfile.read(path)
    if data.ndim > 1:
        data = data.mean(axis=1)
    data = data.astype(np.float64)
    data -= data.mean()
    return sr, data


def fundamental_autocorr(sr, x, fmin=20, fmax=400):
    """Estimate fundamental via autocorrelation (robust for broadband engine tone)."""
    x = x / (np.max(np.abs(x)) + 1e-9)
    # use a middle window to avoid loop-boundary artifacts
    n = len(x)
    seg = x[n // 4: n // 4 + min(n // 2, sr * 2)]
    ac = np.correlate(seg, seg, mode='full')[len(seg) - 1:]
    lag_min, lag_max = int(sr / fmax), int(sr / fmin)
    lag_max = min(lag_max, len(ac) - 1)
    if lag_max <= lag_min:
        return None
    peak = np.argmax(ac[lag_min:lag_max]) + lag_min
    return sr / peak


def dominant_low_peak(sr, x, fmax=500):
    """Dominant spectral peak below fmax (Hz)."""
    win = x[:min(len(x), sr * 4)] * np.hanning(min(len(x), sr * 4))
    spec = np.abs(np.fft.rfft(win))
    freqs = np.fft.rfftfreq(len(win), 1 / sr)
    mask = freqs <= fmax
    if not mask.any():
        return None
    i = np.argmax(spec[mask])
    return freqs[mask][i]


def main():
    print(f'=== engine audio analysis: {TRUCK} ===')
    try:
        wavs = extract_and_decode()
    except Exception as e:
        print(f'extract/decode failed: {e}'); return 1
    if not wavs:
        print('no layers decoded'); return 1

    res = {}
    for layer, path in wavs.items():
        sr, x = load_wav(path)
        f0 = fundamental_autocorr(sr, x)
        pk = dominant_low_peak(sr, x)
        dur = len(x) / sr
        res[layer] = dict(sr=sr, dur=dur, f0=f0, peak=pk)
        print(f'  {layer:>5}: sr={sr}Hz dur={dur:.2f}s  '
              f'fundamental~{f0:.1f}Hz  dominant_peak~{pk:.1f}Hz')

    if 'idle' in res and res['idle']['f0']:
        base = res['idle']['f0']
        print('\npitch ratios relative to idle fundamental:')
        for layer in LAYERS:
            if layer in res and res[layer]['f0']:
                print(f'  {layer:>5}: {res[layer]["f0"]/base:.3f}x')
        print('\n(Compare to the live SetFrequencyRatio offsets 0.75 / 1.0 / 1.2: the layers'
              '\n are recorded at different base RPMs, and the game pitches each around its'
              '\n base as engine load changes. The mod re-drives that pitch from gear-aware RPM.)')

    # spectra plot
    try:
        import matplotlib; matplotlib.use('Agg'); import matplotlib.pyplot as plt
        fig, ax = plt.subplots(figsize=(10, 5))
        for layer in LAYERS:
            if layer not in wavs: continue
            sr, x = load_wav(wavs[layer])
            win = x[:min(len(x), sr * 4)] * np.hanning(min(len(x), sr * 4))
            spec = 20 * np.log10(np.abs(np.fft.rfft(win)) + 1e-6)
            freqs = np.fft.rfftfreq(len(win), 1 / sr)
            m = freqs <= 1500
            ax.plot(freqs[m], spec[m], label=layer, lw=0.8)
        ax.set_xlabel('Hz'); ax.set_ylabel('dB'); ax.legend()
        ax.set_title(f'{TRUCK} engine layer spectra (0-1500 Hz)')
        out = os.path.join(HERE, f'engine_spectra_{TRUCK}.png')
        fig.tight_layout(); fig.savefig(out, dpi=110); print(f'\nplot -> {out}')
    except Exception as e:
        print(f'(plot skipped: {e})')
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
