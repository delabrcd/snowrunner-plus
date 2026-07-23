#!/usr/bin/env python3
# This Source Code Form is subject to the terms of the Mozilla Public
# License, v. 2.0. If a copy of the MPL was not distributed with this
# file, You can obtain one at https://mozilla.org/MPL/2.0/.
"""
make_synthetic_trace.py — emit a fake xrecon-events.csv in the real harness format, so the
analyzer can be tested without the game. Models a BUGGY trace: the engine voice's frequency
ratio tracks wheel speed (no shift drop), plus a couple of pinned voices and input events.
"""
import csv, os, sys
sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), 'model'))
import rpm_model as m

OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'staging', 'xrecon-events.synthetic.csv')

def main():
    rows = m.simulate()               # (t_s, thr, gear, wheel, n_fix, n_bug, ratio_fix, ratio_bug)
    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    ev = []
    last_gear = rows[0][2]
    last_thr = None
    for r in rows:
        t_ms = int(r[0] * 1000)
        # engine voice #7: BUGGY pitch (tracks wheel speed) -> what the game does today
        ev.append((t_ms, 'freq', 7, f'{r[7]:.5f}', 'SnowRunner.exe+0xdfb32f'))
        # a pinned "low" layer voice #3 at 0.75, "high" layer voice #2 at 1.20
        ev.append((t_ms, 'freq', 3, '0.75000', 'SnowRunner.exe+0xdfb32f'))
        ev.append((t_ms, 'freq', 2, '1.20000', 'SnowRunner.exe+0xdfb32f'))
        # an ambient voice #99 pinned at 1.0 (non-engine)
        ev.append((t_ms, 'freq', 99, '1.00000', 'SnowRunner.exe+0x4a1200'))
        # input rows: throttle changes + gear changes
        if r[1] != last_thr:
            ev.append((t_ms, 'input', '', f'throttle={r[1]:.2f}', 'override')); last_thr = r[1]
        if r[2] != last_gear:
            ev.append((t_ms, 'input', '', 'gear_up', 'applied')); last_gear = r[2]

    ev.sort(key=lambda e: e[0])
    with open(OUT, 'w', newline='') as f:
        w = csv.writer(f); w.writerow(['t_ms', 'event', 'voice', 'value', 'caller'])
        for e in ev: w.writerow(e)
    print(f'wrote {len(ev)} events -> {OUT}')

if __name__ == '__main__':
    main()
