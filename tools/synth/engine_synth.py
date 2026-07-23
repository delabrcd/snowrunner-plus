#!/usr/bin/env python3
# This Source Code Form is subject to the terms of the Mozilla Public
# License, v. 2.0. If a copy of the MPL was not distributed with this
# file, You can obtain one at https://mozilla.org/MPL/2.0/.
"""
engine_synth.py — procedural (sample-free) LARGE DIESEL engine synthesizer, offline prototype.
Generates audio from an RPM envelope + load envelope so we can iterate on the SOUND by ear
(writes WAVs) before porting the DSP to real-time C++.

Model: combustion impulse train at the firing frequency (with cylinder-to-cylinder jitter) ->
  - resonant "body" (a few low modal bandpass resonators) = the diesel chug
  - per-firing HF noise burst -> bright resonance = the diesel knock/clatter (scaled by load)
  - broadband mechanical noise floor
  - turbo whine (rpm-proportional tone) under load
"""
import os
import numpy as np
from scipy import signal
from scipy.io import wavfile

SR = 44100
OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'out')


def resonator(x, freq, bw):
    """2-pole resonant bandpass (biquad); bw = bandwidth in Hz (smaller = ringier)."""
    r = np.exp(-np.pi * bw / SR)
    w = 2 * np.pi * freq / SR
    b = [1 - r]
    a = [1.0, -2 * r * np.cos(w), r * r]
    return signal.lfilter(b, a, x)


def synth(rpm_env, load_env, cyl=6, dur=4.0, seed=1):
    """Additive-harmonic engine synth. The engine note = harmonics of the firing frequency,
    shaped by a formant envelope; combustion adds a grit texture; high-passed to kill the
    sub-bass 'fart'. Half-order content gives the diesel lope."""
    rng = np.random.default_rng(seed)
    N = int(SR * dur)
    t = np.arange(N) / SR
    rpm = np.interp(t, np.linspace(0, dur, len(rpm_env)), rpm_env)
    load = np.interp(t, np.linspace(0, dur, len(load_env)), load_env)
    f_fire = rpm / 60.0 * (cyl / 2.0)            # firings/sec (4-stroke)
    ph = 2 * np.pi * np.cumsum(f_fire) / SR       # instantaneous fundamental phase

    # --- additive harmonic tone ---
    sig = np.zeros(N)
    # include HALF-order harmonics (0.5, 1.5, ...) — the uneven combustion "lope" of a diesel
    orders = np.concatenate([np.arange(0.5, 0.6, 1), np.arange(1, 41)])
    for k in orders:
        fk = k * f_fire
        rolloff = 1.0 / (k ** 1.15)                                  # natural spectral rolloff
        formant = 0.25 + 1.2 * np.exp(-((fk - 320) / 380) ** 2)      # body formant ~320 Hz
        bright = 1.0 + 1.1 * load * np.clip((fk - 700) / 2500, 0, 1) # load opens up the highs
        band = np.clip((8500 - fk) / 2500, 0, 1)                     # roll off near Nyquist
        halford = 0.35 if (k % 1) else 1.0                           # half-orders quieter
        amp = rolloff * formant * bright * band * halford
        sig += amp * np.sin(k * ph + rng.uniform(0, 2 * np.pi))

    # --- combustion grit: mid/high noise pulsed at the firing rate (texture, not the tone) ---
    frac = (np.cumsum(f_fire) / SR) % 1.0
    firegate = np.exp(-((frac) / 0.18) ** 2) + 0.15 * np.exp(-((frac - 1) / 0.18) ** 2)
    gb, ga = signal.butter(2, [350 / (SR / 2), 3500 / (SR / 2)], 'band')
    grit = signal.lfilter(gb, ga, rng.standard_normal(N)) * firegate * (0.12 + 0.5 * load)

    # --- turbo whine under load ---
    turbo = np.sin(2 * np.pi * np.cumsum(9 * f_fire) / SR) * load * 0.04 * np.clip(rpm / 1400, 0, 1)

    mix = sig * 0.55 + grit + turbo
    mix = signal.lfilter(*signal.butter(2, 70 / (SR / 2), 'high'), mix)   # kill sub-bass fart
    mix = signal.lfilter(*signal.butter(2, 7500 / (SR / 2), 'low'), mix)  # tame harshness
    mix = mix / (np.max(np.abs(mix)) + 1e-9) * 0.82
    return (mix * 32767).astype(np.int16)


def write(name, data):
    os.makedirs(OUT, exist_ok=True)
    path = os.path.join(OUT, name)
    wavfile.write(path, SR, data)
    print('  ' + path)


def main():
    print('generating WAVs -> ' + OUT)
    write('idle_600.wav',    synth([600, 610, 600, 615], [0.0, 0.0], dur=3))
    write('cruise_1400.wav', synth([1400, 1400], [0.4, 0.4], dur=3))
    write('pull_600_2400.wav', synth([600, 2400], [1.0, 1.0], dur=4))          # a rev-up
    write('lift_2400_800.wav', synth([2400, 800], [1.0, 0.0], dur=3))          # off-throttle down
    # simulate gear shifts: rev up, DROP at shift, rev up... (what the mod produces)
    write('shifts.wav', synth([600, 2300, 1500, 2300, 1650, 2300, 1750, 2100],
                              [1, 1, 0.9, 1, 0.9, 1, 0.9, 0.8], dur=7))
    print('done. play with: paplay / mpv / vlc')


if __name__ == '__main__':
    main()
