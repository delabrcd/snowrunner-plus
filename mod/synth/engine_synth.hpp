// engine_synth.hpp — procedural engine-audio synthesizer (Baldan physically-informed model).
// C++ port of DasEtwas/enginesound (MIT), which implements Baldan et al. 2015: intake/cylinder/
// exhaust modeled as digital-waveguide tubes + a multi-element muffler. Sample-free. Parameterized
// per engine (cylinders, pipe lengths, muffler, ignition) so different trucks sound different.
// Same code runs offline (synth_test) and real-time in the mod (fed live RPM/load).
#pragma once
#include <vector>
#include <cmath>
#include <cstdint>
#include <fstream>

namespace esynth {

static constexpr float PI2 = 6.28318530718f;
static constexpr float PI4 = 12.5663706144f;
static constexpr float WGMAX = 20.0f;   // waveguide amplitude clamp (anti-feedback)

static inline float frac(float x) { return x - std::floor(x); }
static inline float exhaust_valve(float c) { return (0.75f < c && c < 1.0f) ? -std::sin(c * PI4) : 0.0f; }
static inline float intake_valve(float c) { return (0.0f < c && c < 0.25f) ? std::sin(c * PI4) : 0.0f; }
static inline float piston_motion(float c) { return std::cos(c * PI4); }
static inline float fuel_ignition(float c, float it) {
    return (0.5f < c && c < it / 2.0f + 0.5f) ? std::sin(PI2 * ((c - 0.5f) / it)) : 0.0f;
}

// simple, fast, deterministic-ish white noise
struct Noise {
    uint32_t s = 0x9e3779b9u;
    float step() { s ^= s << 13; s ^= s >> 17; s ^= s << 5; return (float)s / 2147483648.0f - 1.0f; }
};

struct LoopBuffer {
    std::vector<float> data; size_t pos = 0;
    void init(size_t len) { data.assign(len < 1 ? 1 : len, 0.0f); pos = 0; }
    void push(float v) { data[pos % data.size()] = v; }
    float pop() { return data[(pos + 1) % data.size()]; }
    void advance() { pos++; }
};

struct LowPassFilter {
    float alpha = 0, last = 0;
    void init(float freq, float sr) { float x = PI2 * (1.0f / sr) * freq; alpha = x / (x + 1.0f); last = 0; }
    float filter(float s) { last = (s - last) * alpha + last; return last; }
};

struct WaveGuide {
    LoopBuffer c0, c1; float alpha = 0, beta = 0, c0_out = 0, c1_out = 0;
    void init(size_t delay, float a, float b) { c0.init(delay); c1.init(delay); alpha = a; beta = b; }
    struct Ret { float a, b; bool damp; };
    static float dampen(float s, bool& d) {
        float sa = std::fabs(s);
        if (sa > WGMAX) { d = true; return (s < 0 ? -1.0f : 1.0f) * (-1.0f / (sa - WGMAX + 1.0f) + 1.0f + WGMAX); }
        return s;
    }
    Ret pop() {
        bool d1 = false, d0 = false;
        c1_out = dampen(c1.pop(), d1);
        c0_out = dampen(c0.pop(), d0);
        return { c1_out * (1.0f - std::fabs(alpha)), c0_out * (1.0f - std::fabs(beta)), d1 || d0 };
    }
    void push(float x0_in, float x1_in) {
        float c0_in = c1_out * alpha + x0_in;
        float c1_in = c0_out * beta + x1_in;
        c0.push(c0_in); c1.push(c1_in); c0.advance(); c1.advance();
    }
};

struct Cylinder {
    float crank_offset = 0;
    WaveGuide exhaust_wg, intake_wg, extractor_wg;
    float intake_open_refl = 0, intake_closed_refl = 1, exhaust_open_refl = 0, exhaust_closed_refl = 0.7145f;
    float piston_motion_factor = 2.43f, ignition_factor = 5.0f, ignition_time = 0.069f;
    float cyl_sound = 0, extractor_exhaust = 0;
    struct Ret { float intake, exhaust, vib; bool damp; };
    Ret pop(float crank_pos, float exhaust_collector, float in_shift, float ex_shift) {
        float crank = frac(crank_pos + crank_offset);
        cyl_sound = piston_motion(crank) * piston_motion_factor + fuel_ignition(crank, ignition_time) * ignition_factor;
        float ev = exhaust_valve(frac(crank + ex_shift));
        float iv = intake_valve(frac(crank + in_shift));
        exhaust_wg.alpha = exhaust_closed_refl + (exhaust_open_refl - exhaust_closed_refl) * ev;
        intake_wg.alpha = intake_closed_refl + (intake_open_refl - intake_closed_refl) * iv;
        auto ex = exhaust_wg.pop();
        auto in = intake_wg.pop();
        auto ext = extractor_wg.pop();
        extractor_exhaust = ext.a;
        extractor_wg.push(ex.b, exhaust_collector);
        return { in.b, ext.b, cyl_sound, ex.damp || in.damp || ext.damp };
    }
    void push(float intake) {
        exhaust_wg.push((1.0f - std::fabs(exhaust_wg.alpha)) * cyl_sound * 0.5f, extractor_exhaust);
        intake_wg.push((1.0f - std::fabs(intake_wg.alpha)) * cyl_sound * 0.5f, intake);
    }
};

struct Engine {
    float rpm = 800, intake_volume = 0.325f, exhaust_volume = 0.639f, engine_vibrations_volume = 0.036f;
    std::vector<Cylinder> cylinders;
    Noise intake_noise, crankshaft_noise;
    float intake_noise_factor = 0.181f;
    LowPassFilter intake_noise_lp, engine_vibration_filter, crankshaft_fluctuation_lp;
    WaveGuide straight_pipe; std::vector<WaveGuide> muffler_elements;
    float intake_valve_shift = -0.0429f, exhaust_valve_shift = -0.0035f, crankshaft_fluctuation = 0.331f;
    float crankshaft_pos = 0, exhaust_collector = 0, intake_collector = 0;
};

// Diesel character layer added on top of the waveguide engine: a sharp combustion KNOCK
// (HF resonant burst pulsed at the firing rate = the diesel "nail/clatter") + turbo whine.
// This is the cue the base Baldan model underplays; it's what reads as a big diesel.
struct DieselFX {
    bool enable = false;
    int cylinders = 6;
    float knock_gain = 0.18f, knock_res = 1900.0f, knock_decay = 130.0f; // decay in Hz
    float turbo_gain = 0.16f, turbo_center = 2100.0f, turbo_bw = 450.0f;  // WHOOSH (noise), not a whistle
    float knock_bright = 0.5f;      // load raises this
    // state
    float fire_phase = 0, knock_env = 0, r_y1 = 0, r_y2 = 0, t_y1 = 0, t_y2 = 0;
    Noise noise;
    float step(float rpm, float load, float sr) {
        float f_fire = rpm / 60.0f * (cylinders / 2.0f);
        fire_phase += f_fire / sr;
        if (fire_phase >= 1.0f) { fire_phase -= 1.0f; knock_env = 1.0f; }
        knock_env *= std::exp(-knock_decay / sr);
        // combustion knock: resonant burst pulsed at firing rate (kept lower/darker for diesel growl)
        float w = PI2 * knock_res / sr, r = std::exp(-PI2 * knock_decay / sr);
        float y = noise.step() * knock_env + 2.0f * r * std::cos(w) * r_y1 - r * r * r_y2;
        r_y2 = r_y1; r_y1 = y;
        float knock = y * (1.0f - r) * knock_gain * (knock_bright + 0.6f * load);
        // turbo SPOOL WHOOSH: broadband band-passed noise (center rises slightly with rpm),
        // envelope spools up with rpm+load. NOT a tonal whistle (the P16 has no whistle).
        float tw = PI2 * (turbo_center + 500.0f * std::min(rpm / 2200.0f, 1.0f)) / sr;
        float tr = std::exp(-PI2 * turbo_bw / sr);
        float ty = noise.step() + 2.0f * tr * std::cos(tw) * t_y1 - tr * tr * t_y2;
        t_y2 = t_y1; t_y1 = ty;
        float spool = std::min(rpm / 1600.0f, 1.0f) * (0.25f + 0.85f * load);
        float turbo = ty * (1.0f - tr) * turbo_gain * spool;
        return knock + turbo;
    }
};

struct Generator {
    float volume = 0.1f, sample_rate = 44100.0f, load = 0.5f, darken = 3200.0f;
    DieselFX diesel;
    Engine engine; LowPassFilter dc_lp, out_lp;
    bool out_lp_ready = false;
    struct GenRet { float intake, vib, exhaust; };
    GenRet gen() {
        float in_noise = engine.intake_noise_lp.filter(engine.intake_noise.step()) * engine.intake_noise_factor;
        float vib = 0; float ncyl = (float)engine.cylinders.size();
        float last_ex = engine.exhaust_collector / ncyl;
        engine.exhaust_collector = 0; engine.intake_collector = 0;
        float cf = engine.crankshaft_fluctuation_lp.filter(engine.crankshaft_noise.step());
        for (auto& c : engine.cylinders) {
            auto r = c.pop(engine.crankshaft_pos + engine.crankshaft_fluctuation * cf, last_ex,
                           engine.intake_valve_shift, engine.exhaust_valve_shift);
            engine.intake_collector += r.intake; engine.exhaust_collector += r.exhaust; vib += r.vib;
        }
        auto sp = engine.straight_pipe.pop();
        float m0 = 0, m1 = 0;
        for (auto& m : engine.muffler_elements) { auto r = m.pop(); m0 += r.a; m1 += r.b; }
        for (auto& c : engine.cylinders)
            c.push(engine.intake_collector / ncyl + in_noise * intake_valve(frac(engine.crankshaft_pos + c.crank_offset)));
        engine.straight_pipe.push(engine.exhaust_collector, m0);
        engine.exhaust_collector += sp.a;
        float me = (float)engine.muffler_elements.size();
        for (auto& m : engine.muffler_elements) m.push(sp.b / me, 0.0f);
        vib = engine.engine_vibration_filter.filter(vib);
        return { engine.intake_collector, vib, m1 };
    }
    // fill n mono float samples at the current engine.rpm
    void generate(float* buf, int n) {
        float inc = engine.rpm / (sample_rate * 120.0f);
        for (int i = 0; i < n; i++) {
            engine.crankshaft_pos = frac(engine.crankshaft_pos + inc);
            auto ch = gen();
            float mixed = (ch.intake * engine.intake_volume + ch.vib * engine.engine_vibrations_volume
                           + ch.exhaust * engine.exhaust_volume) * volume;
            float out = mixed - dc_lp.filter(mixed);
            if (diesel.enable) out += diesel.step(engine.rpm, load, sample_rate);
            if (!out_lp_ready) { out_lp.init(darken, sample_rate); out_lp_ready = true; }
            buf[i] = out_lp.filter(out);   // darken to match a low-dominant diesel growl
        }
    }
};

// ---- per-truck engine parameters -> build a Generator ----
struct EngineParams {
    int cylinders = 4;
    float idle_rpm = 800;
    float pipe_scale = 1.0f;          // >1 = bigger/deeper engine (longer waveguides)
    float intake_volume = 0.325f, exhaust_volume = 0.639f, vibrations_volume = 0.036f;
    float ignition_factor = 5.0f, ignition_time = 0.069f, piston_factor = 2.43f;
    float straight_pipe_len = 0.006125f;  // seconds
    float master_volume = 0.32f;
};

inline Generator build(const EngineParams& p, float sr) {
    Generator g; g.sample_rate = sr; g.volume = p.master_volume;
    g.dc_lp.init(0.5f, sr);
    Engine& e = g.engine;
    e.rpm = p.idle_rpm;
    e.intake_volume = p.intake_volume; e.exhaust_volume = p.exhaust_volume; e.engine_vibrations_volume = p.vibrations_volume;
    e.intake_noise_lp.init(10940.0f, sr);           // 1/0.0000914
    e.engine_vibration_filter.init(92.3f, sr);      // 1/0.01083
    e.crankshaft_fluctuation_lp.init(57.2f, sr);    // 1/0.01747
    e.intake_noise.s = 0x1234567u; e.crankshaft_noise.s = 0x89abcdefu;
    auto D = [&](float sec) -> size_t { return (size_t)(sec * p.pipe_scale * sr); };
    for (int i = 0; i < p.cylinders; i++) {
        Cylinder c;
        c.crank_offset = (float)i / (float)p.cylinders;                 // even firing
        c.exhaust_wg.init(D(0.00060f), 0.7145f, 0.06f);
        c.intake_wg.init(D(0.00014f), 1.0f, -0.7576f);
        // extractor (header runner) length spreads across cylinders -> character
        float ext = 0.00058f + 0.00120f * ((float)i / std::max(1, p.cylinders - 1));
        c.extractor_wg.init(D(ext), 0.0f, -0.00081f);
        c.intake_open_refl = 0.00607f; c.intake_closed_refl = 1.0f;
        c.exhaust_open_refl = -0.00070f; c.exhaust_closed_refl = 0.7145f;
        c.piston_motion_factor = p.piston_factor; c.ignition_factor = p.ignition_factor; c.ignition_time = p.ignition_time;
        e.cylinders.push_back(c);
    }
    e.straight_pipe.init(D(p.straight_pipe_len), 0.0617f, 0.00165f);
    float mel[4] = { 0.00014583f, 0.00018750f, 0.00020833f, 0.00025000f };
    for (float m : mel) { WaveGuide w; w.init(D(m), 0.0f, -0.14208f); e.muffler_elements.push_back(w); }
    return g;
}

// ---- explicit engine (loaded from a .epreset = converted author-tuned .esc) ----
struct WGDef { float delay, alpha, beta; };
struct CylDef { float crank; WGDef ex, in, extr; float in_open, in_closed, ex_open, ex_closed, piston, ignf, ignt; };
struct ExplicitEngine {
    float rpm, volume, iv, ev, vv, nf, in_lp, vib_lp, crank_lp, ish, esh, cf;
    WGDef straight; std::vector<WGDef> muffler; std::vector<CylDef> cyl;
    bool load(const char* path) {
        std::ifstream f(path); if (!f) return false;
        f >> rpm >> volume >> iv >> ev >> vv >> nf >> in_lp >> vib_lp >> crank_lp >> ish >> esh >> cf;
        f >> straight.delay >> straight.alpha >> straight.beta;
        int nm; f >> nm; muffler.resize(nm);
        for (auto& m : muffler) f >> m.delay >> m.alpha >> m.beta;
        int nc; f >> nc; cyl.resize(nc);
        for (auto& c : cyl) f >> c.crank >> c.ex.delay >> c.ex.alpha >> c.ex.beta >> c.in.delay >> c.in.alpha >> c.in.beta
                              >> c.extr.delay >> c.extr.alpha >> c.extr.beta >> c.in_open >> c.in_closed >> c.ex_open >> c.ex_closed
                              >> c.piston >> c.ignf >> c.ignt;
        return (bool)f;
    }
};
inline Generator build_explicit(const ExplicitEngine& e, float sr) {
    Generator g; g.sample_rate = sr; g.volume = e.volume; g.dc_lp.init(0.5f, sr);
    Engine& E = g.engine;
    E.rpm = e.rpm; E.intake_volume = e.iv; E.exhaust_volume = e.ev; E.engine_vibrations_volume = e.vv;
    E.intake_noise_factor = e.nf;
    E.intake_noise_lp.init(e.in_lp, sr); E.engine_vibration_filter.init(e.vib_lp, sr); E.crankshaft_fluctuation_lp.init(e.crank_lp, sr);
    E.intake_valve_shift = e.ish; E.exhaust_valve_shift = e.esh; E.crankshaft_fluctuation = e.cf;
    E.intake_noise.s = 0x1234567u; E.crankshaft_noise.s = 0x89abcdefu;
    auto D = [&](float sec) -> size_t { return (size_t)(sec * sr); };
    for (auto& c : e.cyl) {
        Cylinder cy; cy.crank_offset = c.crank;
        cy.exhaust_wg.init(D(c.ex.delay), c.ex.alpha, c.ex.beta);
        cy.intake_wg.init(D(c.in.delay), c.in.alpha, c.in.beta);
        cy.extractor_wg.init(D(c.extr.delay), c.extr.alpha, c.extr.beta);
        cy.intake_open_refl = c.in_open; cy.intake_closed_refl = c.in_closed;
        cy.exhaust_open_refl = c.ex_open; cy.exhaust_closed_refl = c.ex_closed;
        cy.piston_motion_factor = c.piston; cy.ignition_factor = c.ignf; cy.ignition_time = c.ignt;
        E.cylinders.push_back(cy);
    }
    E.straight_pipe.init(D(e.straight.delay), e.straight.alpha, e.straight.beta);
    for (auto& m : e.muffler) { WaveGuide w; w.init(D(m.delay), m.alpha, m.beta); E.muffler_elements.push_back(w); }
    return g;
}

// convenient truck-class presets (tune freely)
inline EngineParams preset_scout()  { EngineParams p; p.cylinders = 4; p.idle_rpm = 750; p.pipe_scale = 0.85f; return p; }
inline EngineParams preset_diesel6(){ EngineParams p; p.cylinders = 6; p.idle_rpm = 600; p.pipe_scale = 1.20f; p.exhaust_volume = 0.7f; p.ignition_time = 0.08f; return p; }
inline EngineParams preset_bigV8()  { EngineParams p; p.cylinders = 8; p.idle_rpm = 550; p.pipe_scale = 1.45f; p.exhaust_volume = 0.75f; p.ignition_factor = 6.0f; return p; }
// Pacific P16: big diesel, matched to game analysis (idle firing ~48Hz @ 8cyl, low-dominant growl)
inline EngineParams preset_p16()    { EngineParams p; p.cylinders = 8; p.idle_rpm = 700; p.pipe_scale = 1.55f; p.exhaust_volume = 0.72f; p.ignition_factor = 5.5f; p.ignition_time = 0.09f; return p; }

} // namespace esynth
