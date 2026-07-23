#!/usr/bin/env python3
"""Live engine-mix tuning panel. Sliders write cfg.json (polled by memexplore.js @4Hz);
bottom shows the live RPM/LOAD readout from rpm.txt. Tune by ear, no reload.
  DISPLAY=:0 python3 tools/dev/rpm_ui.py &
"""
import os, re, json, tkinter as tk

HERE = os.path.dirname(os.path.abspath(__file__))
CFG = os.path.join(HERE, 'cfg.json')
RPM_TXT = os.path.join(HERE, 'rpm.txt')

# (key, label, min, max, resolution) — must match CFG in memexplore.js
SLIDERS = [
    ('masterVol',    'master vol',        0.0, 2.0, 0.01),
    ('idlePitch',    'idle pitch',        0.5, 1.2, 0.01),
    ('redlinePitch', 'redline pitch',     1.0, 1.8, 0.01),
    ('revThrottle',  'throttle rev (no-load)', 0.0, 1.0, 0.01),
    ('rpmSmooth',    'rpm response (higher=snappier)', 0.05, 1.0, 0.01),
    ('rpmFloor',     'rpm floor (after upshift)', 0.1, 0.8, 0.01),
    ('loadSmooth',   'load smoothing',    0.03, 0.5, 0.01),
    ('volBase',      'vol: base',         0.0, 1.5, 0.01),
    ('volRpm',       'vol: +rpm',         0.0, 1.0, 0.01),
    ('volLoad',      'vol: +load',        0.0, 1.5, 0.01),
    ('filterBase',   'brightness: base',  0.05, 1.0, 0.01),
    ('loadBright',   'brightness: +load', 0.0, 1.0, 0.01),
    # our auto-box (\ key cycles game/ours): shift-point RPMs, blended by throttle
    ('upRpmLo',      'box: upshift rpm @ no throttle',   0.40, 1.00, 0.01),
    ('upRpmHi',      'box: upshift rpm @ full throttle', 0.50, 1.10, 0.01),
    ('dnRpmLo',      'box: downshift rpm @ no throttle', 0.10, 0.70, 0.01),
    ('dnRpmHi',      'box: downshift rpm @ full (kickdown)', 0.20, 0.90, 0.01),
    ('shiftHoldMs',  'box: hold after shift (ms)',       200, 3000, 50),
]
DEFAULTS = {
    'mode': 'takeover', 'masterVol': 1.0, 'idlePitch': 0.80, 'redlinePitch': 1.25,
    'revThrottle': 0.65, 'rpmSmooth': 0.35, 'rpmFloor': 0.25, 'loadSmooth': 0.12,
    'volBase': 0.6, 'volRpm': 0.3, 'volLoad': 0.5, 'rpmMode': 'pergear',
    'filterOn': True, 'filterBase': 0.35, 'loadBright': 0.6,
    'upRpmLo': 0.70, 'upRpmHi': 0.96, 'dnRpmLo': 0.32, 'dnRpmHi': 0.60, 'shiftHoldMs': 700,
}


def load_cfg():
    try:
        with open(CFG) as f:
            d = json.load(f)
        return {**DEFAULTS, **d}
    except Exception:
        return dict(DEFAULTS)


cfg = load_cfg()

root = tk.Tk()
root.title('engine mix — tuning')
root.attributes('-topmost', True)
root.geometry('340x920+40+40')
root.configure(bg='#161616')

FG, BG, AC = '#ddd', '#161616', '#4f8'


def write_cfg(*_):
    for key, var in vars_.items():
        cfg[key] = var.get()
    cfg['mode'] = mode_var.get()
    cfg['filterOn'] = bool(filter_var.get())
    cfg['rpmMode'] = 'pergear' if pergear_var.get() else 'raw'
    try:
        with open(CFG, 'w') as f:
            json.dump(cfg, f)
    except Exception:
        pass


# --- mode + filter toggles ---
top = tk.Frame(root, bg=BG); top.pack(fill='x', padx=10, pady=(10, 4))
mode_var = tk.StringVar(value=cfg['mode'])
tk.Label(top, text='MODE', fg='#888', bg=BG, font=('DejaVu Sans', 9)).pack(anchor='w')
for m in ('takeover', 'mute'):
    tk.Radiobutton(top, text=m, value=m, variable=mode_var, command=write_cfg,
                   fg=FG, bg=BG, selectcolor='#333', activebackground=BG, activeforeground=AC,
                   font=('DejaVu Sans Mono', 10)).pack(anchor='w')
filter_var = tk.IntVar(value=1 if cfg.get('filterOn') else 0)
tk.Checkbutton(top, text='load-brightness filter', variable=filter_var, command=write_cfg,
               fg=FG, bg=BG, selectcolor='#333', activebackground=BG, activeforeground=AC,
               font=('DejaVu Sans Mono', 10)).pack(anchor='w', pady=(2, 0))
pergear_var = tk.IntVar(value=1 if cfg.get('rpmMode', 'pergear') == 'pergear' else 0)
tk.Checkbutton(top, text='full rev sweep per gear', variable=pergear_var, command=write_cfg,
               fg=FG, bg=BG, selectcolor='#333', activebackground=BG, activeforeground=AC,
               font=('DejaVu Sans Mono', 10)).pack(anchor='w')

# --- sliders ---
vars_ = {}
sframe = tk.Frame(root, bg=BG); sframe.pack(fill='x', padx=10)
for key, label, lo, hi, res in SLIDERS:
    tk.Label(sframe, text=label, fg='#aaa', bg=BG, font=('DejaVu Sans Mono', 9)).pack(anchor='w', pady=(4, 0))
    var = tk.DoubleVar(value=float(cfg.get(key, DEFAULTS.get(key, lo))))
    vars_[key] = var
    tk.Scale(sframe, variable=var, from_=lo, to=hi, resolution=res, orient='horizontal',
             length=310, command=write_cfg, showvalue=True,
             fg=FG, bg=BG, troughcolor='#333', highlightthickness=0, sliderrelief='flat',
             font=('DejaVu Sans Mono', 8)).pack(fill='x')


def reset():
    for key, var in vars_.items():
        var.set(DEFAULTS.get(key, var.get()))
    mode_var.set(DEFAULTS['mode']); filter_var.set(1 if DEFAULTS['filterOn'] else 0)
    write_cfg()


tk.Button(root, text='reset defaults', command=reset, bg='#333', fg=FG,
          font=('DejaVu Sans Mono', 9), relief='flat').pack(pady=6)

# --- live readout ---
readout = tk.Label(root, text='--', fg=AC, bg=BG, font=('DejaVu Sans Mono', 11), justify='left')
readout.pack(fill='x', padx=10, pady=(2, 8))


def poll():
    try:
        s = open(RPM_TXT).read()
        rpm = re.search(r'RPM\s+(\d+)%', s).group(1)
        load = re.search(r'LOAD\s+(\d+)%', s).group(1)
        gear = re.search(r'gear\s+(\S+)', s).group(1)
        pitch = re.search(r'pitch\s+([\d.]+)', s).group(1)
        vol = re.search(r'vol\s+([\d.]+)', s).group(1)
        cut = re.search(r'cutoff\s+([\d.]+)', s).group(1)
        readout.config(text=f'RPM {rpm}%   LOAD {load}%   gear {gear}\npitch {pitch}   vol {vol}   bright {cut}')
    except Exception:
        readout.config(text='(no telemetry)')
    root.after(100, poll)


write_cfg()   # ensure cfg.json exists on launch
poll()
root.mainloop()
