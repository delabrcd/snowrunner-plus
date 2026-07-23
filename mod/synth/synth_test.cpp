// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.
// synth_test.cpp — offline: generate WAVs from the engine synth for a few truck presets,
// so we can iterate on the SOUND by ear before wiring it into the game.
//   build: g++ -O2 -std=c++17 synth_test.cpp -o synth_test && ./synth_test
#include "engine_synth.hpp"
#include <cstdio>
#include <cstring>
#include <string>
#include <vector>

static const int SR = 44100;

static void write_wav(const std::string& path, const std::vector<float>& mono) {
    std::vector<int16_t> pcm(mono.size());
    for (size_t i = 0; i < mono.size(); i++) {
        float v = mono[i]; if (v > 1) v = 1; if (v < -1) v = -1;
        pcm[i] = (int16_t)(v * 32767.0f);
    }
    uint32_t dataBytes = (uint32_t)(pcm.size() * 2), byteRate = SR * 2, chunk = 36 + dataBytes;
    FILE* f = fopen(path.c_str(), "wb");
    fwrite("RIFF", 1, 4, f); fwrite(&chunk, 4, 1, f); fwrite("WAVE", 1, 4, f);
    fwrite("fmt ", 1, 4, f); uint32_t sz = 16; uint16_t fmt = 1, ch = 1, ba = 2, bps = 16; uint32_t sr = SR;
    fwrite(&sz, 4, 1, f); fwrite(&fmt, 2, 1, f); fwrite(&ch, 2, 1, f); fwrite(&sr, 4, 1, f);
    fwrite(&byteRate, 4, 1, f); fwrite(&ba, 2, 1, f); fwrite(&bps, 2, 1, f);
    fwrite("data", 1, 4, f); fwrite(&dataBytes, 4, 1, f);
    fwrite(pcm.data(), 2, pcm.size(), f); fclose(f);
    printf("  %s (%.1fs)\n", path.c_str(), (float)mono.size() / SR);
}

// generate with an RPM envelope (linear ramp between the given rpm points over dur seconds)
static std::vector<float> render(esynth::Generator g, std::vector<float> rpmPts, float dur) {
    int total = (int)(dur * SR);
    std::vector<float> out(total);
    // warm up the waveguides so it doesn't start silent
    { std::vector<float> warm(SR / 2); g.generate(warm.data(), (int)warm.size()); }
    const int BLK = 128;
    for (int i = 0; i < total; i += BLK) {
        int n = std::min(BLK, total - i);
        float t = (float)i / total * (rpmPts.size() - 1);
        int k = (int)t; float fr = t - k;
        float rpm = rpmPts[k] + (rpmPts[std::min(k + 1, (int)rpmPts.size() - 1)] - rpmPts[k]) * fr;
        g.engine.rpm = rpm;
        g.generate(out.data() + i, n);
    }
    return out;
}

int main() {
    std::string dir = "out/";
    printf("rendering AUTHOR-TUNED presets through our port -> mod/synth/%s\n", dir.c_str());
    const char* names[] = { "default", "example1", "example2", "example3", "example4", "example5", "example6" };
    for (const char* nm : names) {
        esynth::ExplicitEngine e;
        std::string path = std::string("../../tools/synth/presets/") + nm + ".epreset";
        if (!e.load(path.c_str())) { printf("  (skip %s — not found)\n", nm); continue; }
        auto g = esynth::build_explicit(e, SR);
        float idle = e.rpm, redline = e.rpm * 3.0f;   // examples are car engines; sweep to ~3x idle
        write_wav(dir + std::string(nm) + "_idle.wav", render(g, { idle, idle }, 3.0f));
        write_wav(dir + std::string(nm) + "_rev.wav",  render(g, { idle * 0.6f, redline }, 4.0f));
        printf("    %s: %zu cyl, idle %.0f\n", nm, e.cyl.size(), idle);
    }
    // ---- Pacific P16: matched to the game analysis (whoosh turbo, darkened growl) ----
    printf("  -- pacific P16 (matched) --\n");
    {
        auto g = esynth::build(esynth::preset_p16(), SR);
        g.diesel.enable = true; g.diesel.cylinders = 8; g.load = 0.9f;
        write_wav(dir + "P16_idle.wav",   render(g, { 700, 700 }, 3.0f));
        write_wav(dir + "P16_rev.wav",    render(g, { 700, 2100 }, 4.0f));
        write_wav(dir + "P16_shifts.wav", render(g, { 700, 2100, 1300, 2100, 1450, 1900, 1550, 1800 }, 7.5f));
        // steady 1400 rpm sample (matches the game 'high' loop RPM) for spectral comparison
        auto g2 = esynth::build(esynth::preset_p16(), SR); g2.diesel.enable = true; g2.diesel.cylinders = 8; g2.load = 0.6f;
        write_wav(dir + "P16_steady1400.wav", render(g2, { 1400, 1400 }, 3.0f));
    }
    printf("done. play: paplay mod/synth/out/P16_rev.wav\n");
    return 0;
}
