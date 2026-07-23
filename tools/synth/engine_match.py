#!/usr/bin/env python3
# This Source Code Form is subject to the terms of the Mozilla Public
# License, v. 2.0. If a copy of the MPL was not distributed with this
# file, You can obtain one at https://mozilla.org/MPL/2.0/.
"""Source-filter engine synth MATCHED to a real game recording.
1. Extract the truck's spectral ENVELOPE (formant shape) from its game engine loops.
2. Excite with a harmonic impulse train (at the firing freq) + combustion noise = flat-ish source.
3. Filter the excitation by the measured envelope -> the excitation takes on the real timbre.
Driven by firing frequency (from RPM), so it revs naturally. No guessed params, no fake turbo.
"""
import os, re, zipfile, subprocess, sys, pathlib
import numpy as np
from scipy.io import wavfile
from scipy import signal, ndimage

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1]))
from srenv import scratch_dir   # keeps machine-specific paths out of the repo

SR = 44100
SCRATCH = scratch_dir("p16")
HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(HERE, 'out')


def load_game(layer):
    p = os.path.join(SCRATCH, layer + '.wav')
    sr, d = wavfile.read(p); x = d.astype(float); x -= x.mean(); x /= np.max(np.abs(x)) + 1e-9
    return sr, x


def envelope(x, sr, smooth_hz=120.0):
    """Smoothed magnitude spectral envelope (formant shape), harmonic ripple removed."""
    f, p = signal.welch(x, sr, nperseg=8192, noverlap=4096)
    mag = np.sqrt(p)
    # smooth in frequency to remove harmonic peaks, keep the formant envelope
    sigma = smooth_hz / (f[1] - f[0])
    env = ndimage.gaussian_filter1d(mag, sigma)
    env /= env.max() + 1e-12
    return f, env


def design_fir(f, env, ntaps=1025, sr=SR):
    freqs = f / (sr / 2)                      # normalize to [0,1]
    freqs = np.clip(freqs, 0, 1); freqs[0] = 0.0; freqs[-1] = 1.0
    # ensure strictly increasing
    freqs, idx = np.unique(freqs, return_index=True)
    gain = env[idx]
    gain[0] = gain[0] * 0.2                    # tame DC
    return signal.firwin2(ntaps, freqs, gain)


def synth_matched(env_f, env_vals, env_fir, f0_env, dur, noise_amt=0.18, K=48, seed=1):
    """Additive: explicit sine harmonics of the firing freq (amplitude from the measured P16
    envelope) = the tonal engine pitch/growl. Plus a small combustion-noise layer (envelope-
    shaped) for texture. Harmonics are sines -> they don't smear into noise like impulses do."""
    rng = np.random.default_rng(seed)
    N = int(dur * SR); t = np.arange(N) / SR
    f0 = np.interp(t, np.linspace(0, dur, len(f0_env)), f0_env)
    ph = 2 * np.pi * np.cumsum(f0) / SR
    sig = np.zeros(N)
    for k in range(1, K + 1):
        fk = k * f0
        Ak = np.interp(fk, env_f, env_vals, right=0.0)          # amplitude from the real envelope
        Ak = Ak * np.clip((SR / 2 - fk) / 1500.0, 0, 1)         # roll off near Nyquist
        # per-cylinder-ish slow amplitude wobble for life (not a pure synth tone)
        sig += Ak * np.sin(k * ph + rng.uniform(0, 2 * np.pi))
    # combustion noise texture, shaped by the same envelope, pulsed a bit at the firing rate
    frac = (np.cumsum(f0) / SR) % 1.0
    firegate = 0.6 + 0.4 * np.exp(-((frac) / 0.25) ** 2)
    noise = signal.lfilter(env_fir, 1.0, rng.standard_normal(N)) * firegate * noise_amt
    mix = sig + noise
    mix = signal.lfilter(*signal.butter(2, 55 / (SR / 2), 'high'), mix)   # kill sub-bass rumble
    mix = mix / (np.max(np.abs(mix)) + 1e-9) * 0.85
    return (mix * 32767).astype(np.int16)


def write(name, data):
    os.makedirs(OUT, exist_ok=True)
    wavfile.write(os.path.join(OUT, name), SR, data)
    print('  ' + os.path.join('out', name))


def main():
    # build the envelope from the P16's low+high loops (blend = a fuller formant model)
    sr, xl = load_game('low'); _, xh = load_game('high')
    fl, el = envelope(xl, sr); fh, eh = envelope(xh, sr)
    env = 0.5 * el + 0.5 * eh
    fir = design_fir(fl, env, sr=sr)
    print("built P16 formant filter from game low+high loops")

    # firing freq: idle ~45Hz, redline ~150Hz (8-cyl big diesel, matches measured range)
    E = (fl, env, fir)
    write('MATCH_P16_idle.wav', synth_matched(*E, [45, 46, 45], 3.0))
    write('MATCH_P16_rev.wav',  synth_matched(*E, [45, 150], 4.0))
    write('MATCH_P16_shifts.wav', synth_matched(*E, [45, 150, 95, 150, 105, 135, 115, 130], 7.0))
    write('MATCH_P16_steady.wav', synth_matched(*E, [96, 96], 3.0))   # matches game 'high' f0 for comparison

    # spectral comparison: our matched steady vs game high
    _, xo = load_game('high')  # game
    so, xs = wavfile.read(os.path.join(OUT, 'MATCH_P16_steady.wav'))
    xg = xo; xs = xs.astype(float)
    fg, pg = signal.welch(xg, sr, nperseg=8192); fo, po = signal.welch(xs, so, nperseg=8192)
    pg /= pg.sum(); po /= po.sum()
    import matplotlib; matplotlib.use('Agg'); import matplotlib.pyplot as plt
    plt.figure(figsize=(11, 5))
    plt.semilogy(fg, pg, label=f'GAME P16_high (cen {np.sum(fg*pg):.0f}Hz)', lw=1)
    plt.semilogy(fo, po, label=f'MATCHED synth (cen {np.sum(fo*po):.0f}Hz)', lw=1)
    plt.xlim(0, 6000); plt.legend(); plt.xlabel('Hz'); plt.title('P16: source-filter matched synth vs game')
    plt.tight_layout(); plt.savefig(os.path.join(HERE, 'p16_match2.png'), dpi=110)
    print(f"centroids: game {np.sum(fg*pg):.0f}Hz  matched {np.sum(fo*po):.0f}Hz  -> tools/synth/p16_match2.png")


if __name__ == '__main__':
    main()
