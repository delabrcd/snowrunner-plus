#!/usr/bin/env python3
# This Source Code Form is subject to the terms of the Mozilla Public
# License, v. 2.0. If a copy of the MPL was not distributed with this
# file, You can obtain one at https://mozilla.org/MPL/2.0/.
"""Always-on-top RPM gauge. Reads tools/dev/rpm.txt (written by memexplore.js) ~12Hz.
Drag it anywhere; positioned near the top-left by default."""
import re, os, tkinter as tk

RPM_TXT = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'rpm.txt')

root = tk.Tk()
root.title('engine sim — RPM')
root.attributes('-topmost', True)
root.geometry('380x150+60+60')
root.configure(bg='#111')
# draggable
def start(e): root._x, root._y = e.x, e.y
def drag(e): root.geometry(f'+{root.winfo_pointerx()-root._x}+{root.winfo_pointery()-root._y}')
root.bind('<Button-1>', start); root.bind('<B1-Motion>', drag)

pctlbl = tk.Label(root, text='--', fg='#4f8', bg='#111', font=('DejaVu Sans Mono', 34, 'bold'))
pctlbl.place(x=12, y=6)
gearlbl = tk.Label(root, text='N', fg='#fff', bg='#111', font=('DejaVu Sans Mono', 34, 'bold'))
gearlbl.place(x=300, y=6)
tk.Label(root, text='RPM', fg='#888', bg='#111', font=('DejaVu Sans', 10)).place(x=150, y=20)
tk.Label(root, text='GEAR', fg='#888', bg='#111', font=('DejaVu Sans', 9)).place(x=300, y=54)
bar = tk.Canvas(root, width=356, height=26, bg='#222', highlightthickness=0)
bar.place(x=12, y=78)
detail = tk.Label(root, text='', fg='#aaa', bg='#111', font=('DejaVu Sans Mono', 10))
detail.place(x=12, y=112)

def color(p):
    if p < 0.55: return '#4f8'
    if p < 0.82: return '#fd4'
    return '#f54'

def tick():
    try:
        s = open(RPM_TXT).read()
        pct = int(re.search(r'RPM\s+(\d+)%', s).group(1))
        load = int(re.search(r'LOAD\s+(\d+)%', s).group(1))
        gear = re.search(r'gear\s+(\S+)', s).group(1)
        pitch = re.search(r'pitch\s+([\d.]+)', s).group(1)
        vol = re.search(r'vol\s+([\d.]+)', s).group(1)
        f = pct / 100.0
        pctlbl.config(text=f'{pct}', fg=color(f))
        gearlbl.config(text=gear)
        bar.delete('all')
        bar.create_rectangle(0, 0, 356 * f, 13, fill=color(f), width=0)          # RPM (top half)
        bar.create_rectangle(0, 13, 356 * (load / 100.0), 26, fill='#59f', width=0)  # LOAD (bottom half)
        detail.config(text=f'LOAD {load}%   pitch {pitch}   vol {vol}')
    except Exception:
        pctlbl.config(text='--')
    root.after(80, tick)

tick()
root.mainloop()
