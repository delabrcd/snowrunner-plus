#!/usr/bin/env python3
# This Source Code Form is subject to the terms of the Mozilla Public
# License, v. 2.0. If a copy of the MPL was not distributed with this
# file, You can obtain one at https://mozilla.org/MPL/2.0/.
"""
build_base_freq_table.py — batch the engine-audio DSP across ALL trucks and emit a
per-truck base-firing-frequency table (idle/low/high). The mod's pitch mapping uses these
to render a target RPM as SetFrequencyRatio = target_firing_freq / base_freq[layer].

Output: tools/model/engine_base_freqs.json  (committed; small, derived data — not audio).
Audio stays in scratchpad.
"""
import json, os, re, sys, zipfile, subprocess, pathlib
import numpy as np

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1]))
from srenv import game_dir, scratch_dir   # resolves the install path; never hardcode it

SR_GAME = game_dir()
SCRATCH = scratch_dir("engine_audio_batch")
HERE = os.path.dirname(os.path.abspath(__file__))
LAYERS = ["idle", "low", "high"]


def fundamental(sr, x, fmin=35, fmax=170, n_harm=5):
    """Harmonic Product Spectrum with a firing-freq search band. HPS multiplies integer-
    downsampled copies of the magnitude spectrum, reinforcing the true fundamental and
    suppressing the sub-harmonic (octave-down) errors that autocorrelation makes on diesel
    engine recordings."""
    x = x.astype(np.float64); x -= x.mean()
    n = len(x)
    seg = x[n // 4: n // 4 + min(3 * n // 4, sr * 4)]
    if len(seg) < sr // fmin:
        return None
    win = seg * np.hanning(len(seg))
    spec = np.abs(np.fft.rfft(win))
    freqs = np.fft.rfftfreq(len(win), 1.0 / sr)
    hps = spec.copy()
    for h in range(2, n_harm + 1):
        ds = spec[::h]
        hps[:len(ds)] *= ds
    band = (freqs >= fmin) & (freqs <= fmax)
    if not band.any():
        return None
    idx = np.where(band)[0]
    peak = idx[np.argmax(hps[idx])]
    return round(float(freqs[peak]), 1)


def main():
    os.makedirs(SCRATCH, exist_ok=True)
    from scipy.io import wavfile
    z = zipfile.ZipFile(SR_GAME + "/preload/paks/client/shared_sound.pak")
    names = z.namelist()
    # discover trucks that have an engine idle layer
    trucks = sorted(set(m.group(1) for n in names
                        for m in [re.search(r'trucks\\([^\\]+)\\\1_idle\.pcm$', n, re.I)] if m))
    print(f'trucks with engine idle layer: {len(trucks)}')
    table = {}
    for i, truck in enumerate(trucks):
        entry = {}
        for layer in LAYERS:
            cand = [n for n in names if re.search(rf'trucks\\{re.escape(truck)}\\{re.escape(truck)}_{layer}\.pcm$', n, re.I)]
            if not cand:
                continue
            raw = os.path.join(SCRATCH, 'a.wavadpcm'); wav = os.path.join(SCRATCH, 'a.wav')
            with open(raw, 'wb') as f:
                f.write(z.read(cand[0]))
            try:
                subprocess.run(['ffmpeg', '-y', '-loglevel', 'error', '-i', raw,
                                '-ac', '1', '-c:a', 'pcm_s16le', wav], check=True)
                sr, data = wavfile.read(wav)
                if data.ndim > 1:
                    data = data.mean(axis=1)
                f0 = fundamental(sr, data)
                if f0:
                    entry[layer] = f0
            except Exception as e:
                entry[layer] = None
        if entry:
            table[truck] = entry
        if (i + 1) % 20 == 0:
            print(f'  {i+1}/{len(trucks)} processed...')

    out = os.path.join(HERE, 'engine_base_freqs.json')
    with open(out, 'w') as f:
        json.dump(table, f, indent=1, sort_keys=True)

    # summary stats
    idles = [v['idle'] for v in table.values() if v.get('idle')]
    highs = [v['high'] for v in table.values() if v.get('high')]
    print(f'\nwrote {len(table)} trucks -> {out}')
    if idles:
        print(f'idle fundamental: min={min(idles):.1f} median={np.median(idles):.1f} max={max(idles):.1f} Hz')
    if highs:
        print(f'high fundamental: min={min(highs):.1f} median={np.median(highs):.1f} max={max(highs):.1f} Hz')
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
