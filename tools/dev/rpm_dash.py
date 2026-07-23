#!/usr/bin/env python3
"""Virtual dashboard for the engine-mix tuner. Reads dash.json (written by memexplore.js @~7Hz):
a tach arc for the mixed RPM + gear/speed, and live bars for every diagnostic signal so we can
SEE which candidate float behaves like RPM (rises in-gear, drops on upshift) while driving.
  DISPLAY=:0 python3 tools/dev/rpm_dash.py &
"""
import os, json, math, tkinter as tk

HERE = os.path.dirname(os.path.abspath(__file__))
DASH = os.path.join(HERE, 'dash.json')

root = tk.Tk()
root.title('engine dashboard')
root.attributes('-topmost', True)
root.geometry('420x560+430+40')
BG = '#0d0d0f'
root.configure(bg=BG)
# draggable
root.bind('<Button-1>', lambda e: setattr(root, '_d', (e.x, e.y)))
root.bind('<B1-Motion>', lambda e: root.geometry(f'+{root.winfo_pointerx()-root._d[0]}+{root.winfo_pointery()-root._d[1]}'))

tach = tk.Canvas(root, width=420, height=230, bg=BG, highlightthickness=0)
tach.pack()

# diagnostic bars: (json key, label, color).
CHANNELS = [
    ('mix_rpm',   'RPM (caps-based, gear-aware)', '#4f8'),
    ('torque_b4', 'engine torque ta+0xB4 (load)', '#f84'),
    ('throttle',  'throttle', '#59f'),
    ('mix_load',  'mix LOAD', '#c6f'),
]
bars = tk.Canvas(root, width=420, height=230, bg=BG, highlightthickness=0)
bars.pack()
hint = tk.Label(root, text='Watch while driving: the bar that RISES in a gear and DROPS at each\nupshift is the true RPM. torque jumps UP at upshift.',
                fg='#888', bg=BG, font=('DejaVu Sans', 8), justify='left')
hint.pack(anchor='w', padx=12)
mixlbl = tk.Label(root, text='', fg='#aaa', bg=BG, font=('DejaVu Sans Mono', 10))
mixlbl.pack(anchor='w', padx=12, pady=4)


def col(f):
    return '#4f8' if f < 0.55 else '#fd4' if f < 0.82 else '#f54'


OVER = 1.15   # over-rev ceiling: rpm=1.0 is the shift point, sweep goes to OVER so redline is a zone, not the max

def draw_tach(rpm, gear, speed, wheel_rate, box='game', upthr=0, dnthr=0):
    c = tach; c.delete('all')
    cx, cy, r = 210, 150, 100
    START, SWEEP = 225.0, 270.0                      # 270deg gauge, bottom-left -> bottom-right, clockwise
    rpm = max(0.0, rpm)
    frac = min(rpm / OVER, 1.0)                       # arc position; shift point (rpm=1.0) sits at 1/OVER
    shift_frac = 1.0 / OVER                           # where the redline zone begins
    c.create_arc(cx - r, cy - r, cx + r, cy + r, start=START, extent=-SWEEP, style='arc', outline='#2a2a30', width=18)
    # redline zone (shift point -> top) drawn in red
    c.create_arc(cx - r, cy - r, cx + r, cy + r, start=START - SWEEP * shift_frac, extent=-SWEEP * (1 - shift_frac), style='arc', outline='#611', width=18)
    if frac > 0.001:
        c.create_arc(cx - r, cy - r, cx + r, cy + r, start=START, extent=-SWEEP * frac, style='arc', outline=col(rpm), width=18)
    for t in range(0, 11):                            # tick marks
        aa = math.radians(START - SWEEP * (t / 10.0))
        c.create_line(cx + (r - 22) * math.cos(aa), cy - (r - 22) * math.sin(aa),
                      cx + (r - 12) * math.cos(aa), cy - (r - 12) * math.sin(aa), fill='#555', width=1)
    if box == 'ours':                                 # our auto-box: live shift-point markers
        for f_, colr in ((dnthr, '#59f'), (upthr, '#f84')):
            if f_ and f_ > 0:
                aa = math.radians(START - SWEEP * min(f_ / OVER, 1.0))
                c.create_line(cx + (r - 32) * math.cos(aa), cy - (r - 32) * math.sin(aa),
                              cx + (r + 11) * math.cos(aa), cy - (r + 11) * math.sin(aa), fill=colr, width=2)
    a = math.radians(START - SWEEP * frac)
    c.create_line(cx, cy, cx + (r - 20) * math.cos(a), cy - (r - 20) * math.sin(a), fill='#fff', width=3)
    c.create_oval(cx - 5, cy - 5, cx + 5, cy + 5, fill='#fff', outline='')
    g = 'R' if isinstance(gear, (int, float)) and gear < 0 else ('N' if gear == 0 else str(gear))
    c.create_text(cx, cy + 34, text=g, fill='#fff', font=('DejaVu Sans Mono', 34, 'bold'))
    c.create_text(cx, cy + 66, text=f'{int(rpm*100)}% rpm', fill=col(rpm), font=('DejaVu Sans Mono', 12, 'bold'))
    # side readouts
    c.create_text(40, 30, text=f'{speed*3.6:0.0f}', anchor='w', fill='#9cf', font=('DejaVu Sans Mono', 20, 'bold'))
    c.create_text(40, 52, text='km/h', anchor='w', fill='#567', font=('DejaVu Sans', 8))
    c.create_text(380, 30, text=f'{wheel_rate*3.6:0.0f}', anchor='e', fill='#9f9', font=('DejaVu Sans Mono', 20, 'bold'))
    c.create_text(380, 52, text='redline km/h', anchor='e', fill='#585', font=('DejaVu Sans', 8))


def draw_bars(d):
    c = bars; c.delete('all')
    y = 16
    for key, label, color in CHANNELS:
        v = float(d.get(key, 0) or 0)
        f = max(0.0, min(1.0, v))
        c.create_text(12, y, text=label, anchor='w', fill='#bbb', font=('DejaVu Sans Mono', 9))
        c.create_rectangle(12, y + 12, 408, y + 26, outline='#333', fill='#1a1a1e')
        c.create_rectangle(12, y + 12, 12 + 396 * f, y + 26, outline='', fill=color)
        c.create_text(404, y + 3, text=f'{v:.3f}', anchor='e', fill=color, font=('DejaVu Sans Mono', 9))
        y += 44


def poll():
    try:
        d = json.load(open(DASH))
        draw_tach(float(d.get('mix_rpm', 0)), d.get('gear', 0), float(d.get('speed', 0)), float(d.get('redline_mps', 0)),
                  d.get('box', 'game'), float(d.get('upThr', 0) or 0), float(d.get('dnThr', 0) or 0))
        draw_bars(d)
        caps = d.get('caps')
        capstr = ('[' + ','.join(str(c) for c in caps) + ']') if caps else '(reading…)'
        mixlbl.config(text=f"caps {capstr}\n"
                           f"mode {d.get('mode','?')}   pitch {d.get('pitch','?')}   vol {d.get('vol','?')}   "
                           f"bright {d.get('bright','?')}   voices {d.get('voices','?')}\n"
                           f"box {d.get('box','?')}   dn@{d.get('dnThr','-')} ↓  up@{d.get('upThr','-')} ↑")
    except Exception:
        mixlbl.config(text='(no telemetry — is the game + mixer running?)')
    root.after(90, poll)


poll()
root.mainloop()
