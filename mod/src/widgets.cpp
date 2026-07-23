#include <cfloat>
#include <cmath>
#include <cstdio>
#include "widgets.h"
#include "log.h"

// ---------------- font ladder ----------------
// One 18px bake scaled up is blurry. Bake a ladder of sizes instead and always render
// with the smallest bake >= the requested px: GPU downscale keeps glyphs crisp, and we
// only ever upscale beyond the top rung (72px, where it barely shows).
static const int kFontN = 4;
static const float kFontPx[kFontN] = {16, 24, 40, 72};
static ImFont* g_fonts[kFontN] = {};
static int g_nFonts = 0;

bool uiFontsInit() {
    ImGuiIO& io = ImGui::GetIO();
    // a real TTF if the prefix has one (wine ships liberation-metric substitutes); else default
    const char* cands[] = {"C:\\windows\\Fonts\\tahoma.ttf", "C:\\windows\\Fonts\\arial.ttf",
                           "C:\\windows\\Fonts\\segoeui.ttf"};
    for (const char* fp : cands) {
        FILE* t = fopen(fp, "rb");
        if (!t) continue;
        fclose(t);
        for (int i = 0; i < kFontN; i++) {
            ImFont* fn = io.Fonts->AddFontFromFileTTF(fp, kFontPx[i]);
            if (fn) g_fonts[g_nFonts++] = fn;
        }
        if (g_nFonts) { logf("widgets: font %s (%d sizes)", fp, g_nFonts); break; }
    }
    if (!g_nFonts) g_fonts[g_nFonts++] = io.Fonts->AddFontDefault();   // 13px bitmap fallback
    io.FontDefault = g_fonts[0];   // config UI text
    return g_nFonts > 0;
}

static ImFont* fontFor(float px) {
    // FontSize (not kFontPx) so the AddFontDefault fallback path works the same way
    for (int i = 0; i < g_nFonts; i++)
        if (g_fonts[i]->FontSize >= px - 0.01f) return g_fonts[i];
    return g_fonts[g_nFonts - 1];   // above the ladder: upscale the biggest rung
}

void uiText(ImDrawList* dl, float px, ImVec2 pos, ImU32 col, const char* txt) {
    dl->AddText(fontFor(px), px, pos, col, txt);
}
ImVec2 uiTextSize(float px, const char* txt) {
    return fontFor(px)->CalcTextSizeA(px, FLT_MAX, 0.0f, txt);
}

// ---------------- arcs ----------------
ImVec2 arcPt(ImVec2 c, float r, float degMath) {
    float a = degMath * 3.14159265f / 180.0f;
    return ImVec2(c.x + r * cosf(a), c.y - r * sinf(a));
}
void arcSeg(ImDrawList* dl, ImVec2 c, float r, float f0, float f1, ImU32 col, float th) {
    const float START = 225.0f, SWEEP = 270.0f;
    int n = (int)(40 * (f1 - f0)) + 2;
    dl->PathClear();
    for (int i = 0; i <= n; i++) {
        float f = f0 + (f1 - f0) * i / n;
        dl->PathLineTo(arcPt(c, r, START - SWEEP * f));
    }
    dl->PathStroke(col, 0, th);
}
ImU32 rpmCol(float f) {
    if (f < 0.55f) return IM_COL32(68, 255, 136, 255);
    if (f < 0.82f) return IM_COL32(255, 221, 68, 255);
    return IM_COL32(255, 85, 68, 255);
}
