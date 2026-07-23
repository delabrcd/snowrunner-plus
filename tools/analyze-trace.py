#!/usr/bin/env python3
# This Source Code Form is subject to the terms of the Mozilla Public
# License, v. 2.0. If a copy of the MPL was not distributed with this
# file, You can obtain one at https://mozilla.org/MPL/2.0/.
"""
analyze-trace.py — turn a raw xrecon-events.csv into findings.

Reads the harness CSV (t_ms,event,voice,value,caller) and:
  1. identifies the ENGINE voices (continuously-modulated frequency ratio, vs. voices pinned
     at 1.0 / 0.75 / 1.2 or one-shots),
  2. reconstructs the input timeline (throttle overrides, gear-change events),
  3. for the main engine voice, checks each gear change for a pitch DROP:
       - drop present  -> gear-aware (the FIX, or after the mod),
       - no drop       -> pitch follows wheel speed (the BUG, stock game),
  4. writes analysis.png (pitch vs input/gear overlay) and prints a verdict.

Usage:
  analyze-trace.py [path/to/xrecon-events.csv]
  (defaults to tools/staging/xrecon-events.csv)
"""
import csv, os, sys
from collections import defaultdict

HERE = os.path.dirname(os.path.abspath(__file__))
DEFAULT_CSV = os.path.join(HERE, 'staging', 'xrecon-events.csv')
PINNED = {0.75, 1.0, 1.2}          # known layer base-pitch offsets / native pitch
DROP_EPS = 0.03                    # min ratio fall to count as a shift-drop


def load(path):
    freq = defaultdict(list)       # voice -> [(t_ms, ratio)]
    inputs = []                    # (t_ms, value, caller)
    with open(path, newline='') as f:
        for row in csv.DictReader(f):
            ev = row['event']
            t = int(row['t_ms'])
            if ev == 'freq':
                try: freq[row['voice']].append((t, float(row['value'])))
                except ValueError: pass
            elif ev == 'input':
                inputs.append((t, row['value'], row['caller']))
    return freq, inputs


def classify_voices(freq):
    """Return list of dicts sorted by 'engine-likeness' (continuous modulation)."""
    out = []
    for v, series in freq.items():
        vals = [r for _, r in series]
        if not vals: continue
        lo, hi = min(vals), max(vals)
        distinct = set(round(x, 3) for x in vals)
        # continuously modulated = wide span AND many distinct values not all pinned
        nonpinned = [x for x in vals if round(x, 2) not in PINNED]
        span = hi - lo
        engine_score = span * (len(distinct) > 8) + 0.5 * (len(nonpinned) / max(1, len(vals)))
        out.append(dict(voice=v, n=len(vals), lo=lo, hi=hi, span=span,
                        distinct=len(distinct), nonpinned=len(nonpinned),
                        score=engine_score, series=series))
    out.sort(key=lambda d: (-d['score'], -d['n']))
    return out


def gear_events(inputs):
    return [t for (t, val, _c) in inputs if 'gear' in val.lower() or 'shift' in val.lower()]


def throttle_series(inputs):
    pts = []
    for (t, val, _c) in inputs:
        if val.startswith('throttle='):
            try: pts.append((t, float(val.split('=')[1])))
            except ValueError: pass
    return pts


def ratio_around(series, t, win=400):
    """(before, after) mean ratio in +-win ms around time t."""
    before = [r for (tt, r) in series if t - win <= tt < t]
    after = [r for (tt, r) in series if t <= tt <= t + win]
    mb = sum(before) / len(before) if before else None
    ma = sum(after) / len(after) if after else None
    return mb, ma


def main():
    path = sys.argv[1] if len(sys.argv) > 1 else DEFAULT_CSV
    if not os.path.exists(path):
        print(f'no trace at {path}\nRun a drive session first (see tools/README.md), or:')
        print('  python3 tools/make_synthetic_trace.py  &&  python3 tools/analyze-trace.py '
              'tools/staging/xrecon-events.synthetic.csv')
        return 2

    freq, inputs = load(path)
    voices = classify_voices(freq)
    gears = gear_events(inputs)
    thr = throttle_series(inputs)

    print(f'=== analyze-trace: {os.path.basename(path)} ===')
    print(f'voices with freq events: {len(voices)}   gear-change events: {len(gears)}   '
          f'throttle points: {len(thr)}')
    print('\ntop engine-voice candidates (by continuous-modulation score):')
    print('  voice   n     span     [lo..hi]        distinct  score')
    for d in voices[:6]:
        print(f'  {d["voice"]:>5}  {d["n"]:>5}  {d["span"]:.3f}  '
              f'[{d["lo"]:.3f}..{d["hi"]:.3f}]  {d["distinct"]:>6}   {d["score"]:.3f}')

    if not voices:
        print('no freq events — nothing to analyze'); return 1
    eng = voices[0]
    print(f'\n--> main engine voice: #{eng["voice"]} '
          f'(pitch {eng["lo"]:.3f}..{eng["hi"]:.3f}, {eng["n"]} calls)')

    # shift-drop check
    verdict = 'UNKNOWN'
    if gears:
        print('\nper-gear-change pitch behavior:')
        drops = 0
        for t in gears:
            mb, ma = ratio_around(eng['series'], t)
            if mb is None or ma is None:
                print(f'  t={t}ms: insufficient samples'); continue
            d = mb - ma
            tag = 'DROP (gear-aware)' if d > DROP_EPS else \
                  ('rise' if d < -DROP_EPS else 'flat (follows wheel speed)')
            if d > DROP_EPS: drops += 1
            print(f'  t={t}ms: before={mb:.3f} after={ma:.3f}  delta={d:+.3f}  {tag}')
        if drops == len(gears):
            verdict = 'FIXED: pitch drops at every shift (gear-aware RPM)'
        elif drops == 0:
            verdict = 'BUG CONFIRMED: pitch never drops at a shift (follows wheel speed)'
        else:
            verdict = f'PARTIAL: {drops}/{len(gears)} shifts show a drop'
    else:
        print('\nno gear-change events in trace — drive a scenario with shifts to test drop.')
    print(f'\nVERDICT: {verdict}')

    # plot
    try:
        import matplotlib; matplotlib.use('Agg'); import matplotlib.pyplot as plt
        fig, ax = plt.subplots(2, 1, figsize=(11, 6), sharex=True)
        s = eng['series']
        ax[0].plot([t/1000 for t, _ in s], [r for _, r in s], color='tab:green', lw=1)
        ax[0].set_ylabel('engine freq ratio'); ax[0].set_title(
            f'Engine voice #{eng["voice"]} pitch — {verdict}')
        if thr:
            ax[1].step([t/1000 for t, _ in thr], [v for _, v in thr], where='post', color='tab:orange')
        ax[1].set_ylabel('throttle'); ax[1].set_xlabel('time (s)')
        for a in ax:
            for t in gears:
                a.axvline(t/1000, color='tab:red', alpha=0.5, lw=1, ls='--')
        fig.tight_layout()
        out = os.path.join(os.path.dirname(path), 'analysis.png')
        fig.savefig(out, dpi=110); print(f'plot -> {out}')
    except Exception as e:
        print(f'(plot skipped: {e})')
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
