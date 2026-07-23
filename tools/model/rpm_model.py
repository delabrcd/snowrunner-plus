#!/usr/bin/env python3
"""
rpm_model.py — the gear-aware RPM -> engine-pitch model, as an offline simulator.

Validates the core thesis and produces the EXPECTED frequency-ratio curve that the mod
must reproduce (and that the trace analyzer asserts against). The headline result: at each
upshift, wheel angular velocity is continuous but gear-aware RPM DROPS -> pitch drops.
That drop is exactly what SnowRunner is missing today.

    rpm_norm = clamp(idle_norm, 1.0, wheel_angvel / AngVel(current_gear))

No wheel radius / final drive needed (both terms are angular velocities; radius cancels),
and rpm_norm is already normalized (0..1) to match the game's tach 'rpm' gauge input.

Outputs (in tools/model/): expected_curve.csv, expected_curve.png, and a console summary
with a pass/fail assertion that the fix produces shift-drops the buggy mapping does not.
"""
import csv
import os
import numpy as np

# --- representative gearbox (AngVel = per-gear wheel-speed cap, from the game's XML model).
# Placeholder ratios pending the real per-truck gearbox; structure is what matters.
GEARBOX = {
    'R':  -3.0,
    1:     5.0,
    2:     9.0,
    3:    14.0,
    4:    20.0,
}
IDLE_NORM = 0.15          # engine never below idle
# audio mapping: how normalized RPM maps to XAudio2 SetFrequencyRatio for the main layer.
# Anchored to what recon-run-01 observed on the engine layer (continuous ~0.746..1.184).
RATIO_AT_IDLE, RATIO_AT_REDLINE = 0.75, 1.18


def gear_angvel(g):
    return abs(GEARBOX[g])


def rpm_norm(wheel_angvel, gear):
    """Gear-aware normalized engine RPM (the fix)."""
    frac = abs(wheel_angvel) / gear_angvel(gear)
    return float(np.clip(frac, IDLE_NORM, 1.0))


def rpm_norm_buggy(wheel_angvel, top_angvel=22.0):
    """The bug: pitch follows raw wheel speed, gear-unaware -> no shift drop."""
    return float(np.clip(abs(wheel_angvel) / top_angvel, IDLE_NORM, 1.0))


def norm_to_ratio(n):
    return RATIO_AT_IDLE + n * (RATIO_AT_REDLINE - RATIO_AT_IDLE)


# --- scenario mirrors tools/frida-drive-harness.js SCENARIO (times in seconds here).
# (t_s, throttle, gear)  gear given as selected gear at/after this time.
SCENARIO = [
    (0.0,  0.0, 1),   # idle
    (5.0,  1.0, 1),   # (rev in neutral ~ throttle up, still gear 1 for the sim)
    (9.0,  0.0, 1),
    (12.0, 1.0, 1),   # accelerate in gear 1
    (20.0, 1.0, 2),   # UPSHIFT 1->2
    (28.0, 1.0, 3),   # UPSHIFT 2->3
    (34.0, 0.0, 3),   # coast
    (40.0, 0.0, 3),
]

DT = 0.05
TAU = 1.2   # wheel-speed first-order time constant toward throttle*cap


def scenario_at(t):
    thr, gear = SCENARIO[0][1], SCENARIO[0][2]
    for (ts, th, g) in SCENARIO:
        if t >= ts:
            thr, gear = th, g
    return thr, gear


def simulate():
    t_end = SCENARIO[-1][0]
    ts = np.arange(0.0, t_end, DT)
    wheel = 0.0
    rows = []
    for t in ts:
        thr, gear = scenario_at(t)
        target = thr * gear_angvel(gear)          # per-gear wheel-speed cap under throttle
        wheel += (target - wheel) * (DT / TAU)     # first-order approach
        n_fix = rpm_norm(wheel, gear)
        n_bug = rpm_norm_buggy(wheel)
        rows.append((t, thr, gear, wheel, n_fix, n_bug,
                     norm_to_ratio(n_fix), norm_to_ratio(n_bug)))
    return rows


def detect_shift_drops(rows):
    """Return (fixed_drops, buggy_drops): count of downward RPM steps at gear changes."""
    fix_drops = bug_drops = 0
    prev_gear = rows[0][2]
    for i in range(1, len(rows)):
        gear = rows[i][2]
        if gear != prev_gear:
            # compare rpm just before vs just after the change
            if rows[i][4] < rows[i - 1][4] - 0.03:
                fix_drops += 1
            if rows[i][5] < rows[i - 1][5] - 0.03:
                bug_drops += 1
        prev_gear = gear
    return fix_drops, bug_drops


def main():
    here = os.path.dirname(os.path.abspath(__file__))
    rows = simulate()

    csv_path = os.path.join(here, 'expected_curve.csv')
    with open(csv_path, 'w', newline='') as f:
        w = csv.writer(f)
        w.writerow(['t_s', 'throttle', 'gear', 'wheel_angvel',
                    'rpm_norm_fixed', 'rpm_norm_buggy', 'ratio_fixed', 'ratio_buggy'])
        for r in rows:
            w.writerow([f'{r[0]:.3f}', f'{r[1]:.2f}', r[2], f'{r[3]:.4f}',
                        f'{r[4]:.4f}', f'{r[5]:.4f}', f'{r[6]:.4f}', f'{r[7]:.4f}'])

    fix_drops, bug_drops = detect_shift_drops(rows)
    n_shifts = sum(1 for i in range(1, len(rows)) if rows[i][2] != rows[i - 1][2])

    # plot
    try:
        import matplotlib
        matplotlib.use('Agg')
        import matplotlib.pyplot as plt
        t = [r[0] for r in rows]
        fig, ax = plt.subplots(3, 1, figsize=(10, 8), sharex=True)
        ax[0].plot(t, [r[3] for r in rows], color='tab:blue')
        ax[0].set_ylabel('wheel angvel'); ax[0].set_title('Wheel speed (continuous across shifts)')
        ax[1].plot(t, [r[4] for r in rows], label='FIXED (gear-aware RPM)', color='tab:green')
        ax[1].plot(t, [r[5] for r in rows], label='BUGGY (wheel-speed pitch)', color='tab:red', ls='--')
        ax[1].set_ylabel('rpm_norm'); ax[1].legend(); ax[1].set_title('Normalized RPM: fixed drops at each shift; buggy does not')
        ax[2].step(t, [r[2] if isinstance(r[2], (int, float)) else 0 for r in rows], where='post', color='tab:purple')
        ax[2].set_ylabel('gear'); ax[2].set_xlabel('time (s)'); ax[2].set_title('Selected gear')
        for a in ax:
            for i in range(1, len(rows)):
                if rows[i][2] != rows[i - 1][2]:
                    a.axvline(rows[i][0], color='gray', alpha=0.3, lw=0.8)
        fig.tight_layout()
        png = os.path.join(here, 'expected_curve.png')
        fig.savefig(png, dpi=110)
        plot_note = f'plot -> {png}'
    except Exception as e:
        plot_note = f'(plot skipped: {e})'

    print('=== rpm_model simulation ===')
    print(f'steps={len(rows)} gearbox={GEARBOX}')
    print(f'gear changes in scenario: {n_shifts}')
    print(f'shift-drops detected  FIXED={fix_drops}  BUGGY={bug_drops}')
    print(f'csv  -> {csv_path}')
    print(plot_note)
    ok = (fix_drops == n_shifts and bug_drops == 0)
    print(f'ASSERT fix produces a drop at every shift and buggy at none: {"PASS" if ok else "FAIL"}')
    return 0 if ok else 1


if __name__ == '__main__':
    raise SystemExit(main())
