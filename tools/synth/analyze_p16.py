#!/usr/bin/env python3
# This Source Code Form is subject to the terms of the Mozilla Public
# License, v. 2.0. If a copy of the MPL was not distributed with this
# file, You can obtain one at https://mozilla.org/MPL/2.0/.
"""Extract + analyze the Pacific P16 engine layers from the game to match our synth.
Finds per-layer engine fundamental (firing freq) and the TURBO whine (a narrowband HF tone
that rises across idle->low->high), plus the overall spectral shape. Writes spectra PNGs."""
import os, re, zipfile, subprocess, sys, pathlib
import numpy as np
from scipy.io import wavfile
from scipy import signal

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1]))
from srenv import game_dir, scratch_dir   # resolves the install path; never hardcode it

SR_GAME = game_dir()
SCRATCH = scratch_dir("p16")
HERE = os.path.dirname(os.path.abspath(__file__))
TRUCK = "pacific_p16"
LAYERS = ["idle", "low", "high", "heavy"]


def extract():
    os.makedirs(SCRATCH, exist_ok=True)
    z = zipfile.ZipFile(SR_GAME + "/preload/paks/client/shared_sound.pak")
    names = z.namelist()
    out = {}
    for layer in LAYERS:
        cand = [n for n in names if re.search(rf'trucks\\{TRUCK}\\{TRUCK}_{layer}\.pcm$', n, re.I)]
        if not cand:
            continue
        raw = os.path.join(SCRATCH, f'{layer}.wavadpcm'); wav = os.path.join(SCRATCH, f'{layer}.wav')
        open(raw, 'wb').write(z.read(cand[0]))
        subprocess.run(['ffmpeg', '-y', '-loglevel', 'error', '-i', raw, '-ac', '1', '-c:a', 'pcm_s16le', wav], check=True)
        out[layer] = wav
    return out


def pspec(x, sr, nfft=16384):
    # averaged power spectrum over the whole loop
    f, p = signal.welch(x, sr, nperseg=nfft, noverlap=nfft // 2)
    return f, p


def fundamental(f, p, fmin=20, fmax=200):
    m = (f >= fmin) & (f <= fmax)
    return f[m][np.argmax(p[m])]


def turbo_peak(f, p, f0, fmin=1500, fmax=9000):
    """strongest narrowband peak in HF that is NOT near a low harmonic of f0."""
    m = (f >= fmin) & (f <= fmax)
    fs, ps = f[m], p[m].copy()
    # de-emphasize engine harmonics (multiples of f0) so the turbo tone stands out
    for k in range(1, int(fmax / f0) + 1):
        hk = k * f0
        ps[np.abs(fs - hk) < f0 * 0.15] *= 0.3
    i = np.argmax(ps)
    return fs[i], ps[i]


def main():
    print(f"=== Pacific P16 engine analysis ===")
    wavs = extract()
    if not wavs:
        print("no layers extracted"); return 1
    results = {}
    import matplotlib; matplotlib.use('Agg'); import matplotlib.pyplot as plt
    fig, ax = plt.subplots(figsize=(11, 6))
    for layer in LAYERS:
        if layer not in wavs: continue
        sr, d = wavfile.read(wavs[layer])
        x = d.astype(float); x -= x.mean(); x /= (np.max(np.abs(x)) + 1e-9)
        f, p = pspec(x, sr)
        f0 = fundamental(f, p)
        tf, tp = turbo_peak(f, p, f0)
        # firing freq -> RPM assuming diesel; P16 is a big engine. report both 6cyl and 8cyl guesses
        rpm6 = f0 * 60 / 3; rpm8 = f0 * 60 / 4
        results[layer] = dict(f0=f0, turbo=tf, rpm6=rpm6, rpm8=rpm8, dur=len(x) / sr)
        print(f"  {layer:6}: dur={len(x)/sr:.1f}s  fundamental={f0:6.1f}Hz  "
              f"turbo~{tf:6.0f}Hz  (RPM: {rpm6:.0f}@6cyl / {rpm8:.0f}@8cyl)")
        ax.semilogy(f, p, label=f'{layer} (f0={f0:.0f}Hz, turbo~{tf:.0f}Hz)', lw=0.8)
        ax.axvline(tf, color='gray', ls=':', alpha=0.4)
    ax.set_xlim(0, 10000); ax.set_xlabel('Hz'); ax.set_ylabel('power'); ax.legend(fontsize=8)
    ax.set_title('Pacific P16 engine layers — spectra (turbo tone marked)')
    fig.tight_layout(); png = os.path.join(HERE, 'p16_spectra.png'); fig.savefig(png, dpi=110)
    print(f"\nspectra plot -> {png}")

    # turbo vs rpm relationship
    if len(results) >= 2:
        print("\n-- turbo tracking (does the turbo tone rise with rpm?) --")
        for layer in LAYERS:
            if layer in results:
                r = results[layer]
                print(f"  {layer:6}: f0={r['f0']:.0f}Hz  turbo={r['turbo']:.0f}Hz  ratio turbo/f0={r['turbo']/r['f0']:.1f}")
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
