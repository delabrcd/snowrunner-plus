#!/usr/bin/env python3
# This Source Code Form is subject to the terms of the Mozilla Public
# License, v. 2.0. If a copy of the MPL was not distributed with this
# file, You can obtain one at https://mozilla.org/MPL/2.0/.
"""Parse enginesound .esc (RON) presets -> a flat .epreset the C++ synth loads.
Lets us render the author's HAND-TUNED engines through our port (validates the port +
gives good-sounding presets to map SnowRunner trucks onto)."""
import re, sys, os, glob

def tokenize(s):
    s = re.sub(r'//[^\n]*', '', s)                       # strip // comments
    return re.findall(r'[()\[\]:,]|-?\d[\d.eE+-]*|[A-Za-z_]\w*', s)

def parse(toks, i=0):
    t = toks[i]
    if t == '(':
        d = {}; i += 1
        while toks[i] != ')':
            key = toks[i]; assert toks[i+1] == ':', toks[i:i+3]; i += 2
            v, i = parse(toks, i); d[key] = v
            if toks[i] == ',': i += 1
        return d, i + 1
    if t == '[':
        a = []; i += 1
        while toks[i] != ']':
            v, i = parse(toks, i); a.append(v)
            if toks[i] == ',': i += 1
        return a, i + 1
    return float(t), i + 1

def wg(w):   # waveguide -> (delay_sec, alpha, beta)
    return (w['chamber0']['samples']['delay'], w['alpha'], w['beta'])

def convert(path, out):
    eng, _ = parse(tokenize(open(path).read()))
    L = []
    L.append("{:.6g} 0.1 {:.6g} {:.6g} {:.6g} {:.6g} {:.6g} {:.6g} {:.6g} {:.6g} {:.6g} {:.6g}".format(
        eng['rpm'], eng['intake_volume'], eng['exhaust_volume'], eng['engine_vibrations_volume'],
        eng['intake_noise_factor'], 1.0/eng['intake_noise_lp']['delay'],
        1.0/eng['engine_vibration_filter']['delay'], 1.0/eng['crankshaft_fluctuation_lp']['delay'],
        eng['intake_valve_shift'], eng['exhaust_valve_shift'], eng['crankshaft_fluctuation']))
    sp = wg(eng['muffler']['straight_pipe'])
    L.append("{:.6g} {:.6g} {:.6g}".format(*sp))
    mels = eng['muffler']['muffler_elements']
    L.append(str(len(mels)))
    for m in mels:
        L.append("{:.6g} {:.6g} {:.6g}".format(*wg(m)))
    cyls = eng['cylinders']
    L.append(str(len(cyls)))
    for c in cyls:
        ex, ii, ext = wg(c['exhaust_waveguide']), wg(c['intake_waveguide']), wg(c['extractor_waveguide'])
        L.append(" ".join("{:.6g}".format(x) for x in (
            c['crank_offset'], *ex, *ii, *ext,
            c['intake_open_refl'], c['intake_closed_refl'], c['exhaust_open_refl'], c['exhaust_closed_refl'],
            c['piston_motion_factor'], c['ignition_factor'], c['ignition_time'])))
    open(out, 'w').write("\n".join(L) + "\n")
    print(f"  {os.path.basename(path)} -> {out}  ({len(cyls)} cyl, {len(mels)} muffler, idle {eng['rpm']:.0f})")

def main():
    ref = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', '..', 'reference', 'enginesound')
    outdir = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'presets')
    os.makedirs(outdir, exist_ok=True)
    for esc in sorted(glob.glob(os.path.join(ref, 'src', 'default.esc')) + glob.glob(os.path.join(ref, 'example*.esc'))):
        name = os.path.splitext(os.path.basename(esc))[0]
        convert(esc, os.path.join(outdir, name + '.epreset'))

if __name__ == '__main__':
    main()
