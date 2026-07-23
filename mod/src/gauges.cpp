#include <windows.h>
#include <cfloat>
#include <cmath>
#include <cstdio>
#include <cstring>
#include "gauges.h"
#include "widgets.h"
#include "bindings.h"
#include "paths.h"
#include "assets.h"
#include "log.h"

DashData g_dash;
OverlayCfg g_ucfg;

static bool g_cfgOpen = false;
// uiScale slider: panels normally keep user-dragged geometry while the config UI is open
// (cond Appearing), so a scale change must force one cond-Always frame to re-push sizes.
static bool g_scaleDirty = false;   // set by the slider this frame
static bool g_scaleApply = false;   // consumed by panels next frame
// bind capture: which action/slot is listening. CAP_CONFIG = the local config-toggle key.
static const int CAP_CONFIG = (int)SRDT_ACT_COUNT;
static int g_capAct = -1, g_capSlot = 0;
static uint32_t g_padPrev = 0;      // pad buttons held when capture started (require a NEW press)
static int g_gaugeUid = 0;
static volatile SrdtOverlayCfg* g_shmCfg = nullptr;

static const float OVERREV = 1.15f;

// ---- custom-gauge stat table (fixed display ranges, all starting at 0) ----
static const int STAT_N = 6;
static const char* kStatCombo[STAT_N] = {"Speed (km/h)", "RPM (%)", "Load",
                                         "Throttle", "Wheel vel (rad/s)", "Grip RPM (%)"};
static const char* kStatLbl[STAT_N] = {"SPEED", "RPM", "LOAD", "THR", "WHEEL", "GRIP"};
static const float kStatHi[STAT_N] = {100.0f, OVERREV, 1.0f, 1.0f, 60.0f, OVERREV};

static float statValue(int s) {
    const DashData& d = g_dash;
    switch (s) {
        case 0: return d.speed * 3.6f;
        case 1: return d.rpm;
        case 2: return d.load;
        case 3: return d.thr;
        case 4: return d.wav;
        default: return d.grip;
    }
}
static ImU32 statCol(int s, float v) {
    switch (s) {
        case 1: case 5: return rpmCol(v);                       // rpm-like: green->red
        case 2: return IM_COL32(255, 136, 68, 255);             // load: orange (matches tach bar)
        default: return IM_COL32(85, 153, 255, 255);            // speed/thr/wheel: blue
    }
}
static void statText(int s, float v, char* out, int n) {
    if (s == 0) snprintf(out, n, "%.0f", v);
    else if (s == 4) snprintf(out, n, "%.1f", v);
    else snprintf(out, n, "%d%%", (int)(v * 100));
}

// ---------------- persistence (key=value, same style as snowrunner-engine.ini) ----------------
static void saveCfg() {
    FILE* f = fopen(g_uiCfgPath, "w");
    if (!f) return;
    fprintf(f, "showTach=%d\nshowSpeed=%d\nshowBars=%d\nshowGearPanel=%d\nshowBoxBadge=%d\n",
            g_ucfg.showTach, g_ucfg.showSpeed, g_ucfg.showBars, g_ucfg.showGearPanel, g_ucfg.showBoxBadge);
    fprintf(f, "hideStockGear=%d\nkeyConfig=%u\nuiScale=%.2f\nmodePolicy=%u\n",
            g_ucfg.hideStockGear, g_ucfg.keyConfig, g_ucfg.uiScale, g_ucfg.modePolicy);
    fprintf(f, "tachX=%.0f\ntachY=%.0f\ntachW=%.0f\ntachH=%.0f\n",
            g_ucfg.tachX, g_ucfg.tachY, g_ucfg.tachW, g_ucfg.tachH);
    fprintf(f, "gearX=%.0f\ngearY=%.0f\ngearW=%.0f\ngearH=%.0f\n",
            g_ucfg.gearX, g_ucfg.gearY, g_ucfg.gearW, g_ucfg.gearH);
    for (int a = 0; a < (int)SRDT_ACT_COUNT; a++)
        fprintf(f, "bind%d_0=%u\nbind%d_1=%u\n", a, g_ucfg.binds[a][0], a, g_ucfg.binds[a][1]);
    fprintf(f, "gaugeCount=%d\n", g_ucfg.gaugeCount);
    for (int i = 0; i < g_ucfg.gaugeCount; i++) {
        const GaugeCfg& g = g_ucfg.gauges[i];
        fprintf(f, "gauge%d_stat=%d\ngauge%d_style=%d\ngauge%d_label=%d\n", i, g.stat, i, g.style, i, g.label);
        fprintf(f, "gauge%d_x=%.0f\ngauge%d_y=%.0f\ngauge%d_w=%.0f\ngauge%d_h=%.0f\n",
                i, g.x, i, g.y, i, g.w, i, g.h);
    }
    fclose(f);
}

static void publishShmCfg() {
    if (!g_shmCfg) return;
    g_shmCfg->magic = SRDC_MAGIC;
    g_shmCfg->layoutVersion = SRDC_LAYOUT_V;
    g_shmCfg->flags = (g_cfgOpen ? 1u : 0u) | ((g_ucfg.modePolicy & 3u) << 4);
    for (int a = 0; a < (int)SRDT_ACT_COUNT; a++)
        for (int s = 0; s < 2; s++) g_shmCfg->binds[a][s] = g_ucfg.binds[a][s];   // volatile: element-wise
    g_shmCfg->seq = g_shmCfg->seq + 1;
}

void gauges_init() {
    FILE* f = fopen(g_uiCfgPath, "r");
    if (!f) return;
    char line[160];
    while (fgets(line, sizeof(line), f)) {
        char* eq = strchr(line, '=');
        if (!eq) continue;
        *eq = 0;
        float v = (float)atof(eq + 1);
        int ai, si;
        char fld[8];
        if (sscanf(line, "bind%d_%d", &ai, &si) == 2) {
            if (ai >= 0 && ai < (int)SRDT_ACT_COUNT && (si == 0 || si == 1))
                g_ucfg.binds[ai][si] = (uint32_t)v;
        } else if (sscanf(line, "gauge%d_%7s", &ai, fld) == 2 && ai >= 0 && ai < SRDT_MAX_GAUGES) {
            GaugeCfg& g = g_ucfg.gauges[ai];
            int iv = (int)v;
            if (!strcmp(fld, "stat")) g.stat = iv < 0 ? 0 : (iv >= STAT_N ? STAT_N - 1 : iv);
            else if (!strcmp(fld, "style")) g.style = v != 0 ? 1 : 0;
            else if (!strcmp(fld, "label")) g.label = v != 0;
            else if (!strcmp(fld, "x")) g.x = v;
            else if (!strcmp(fld, "y")) g.y = v;
            else if (!strcmp(fld, "w")) g.w = v > 40 ? v : 150;
            else if (!strcmp(fld, "h")) g.h = v > 24 ? v : 150;
        }
        else if (!strcmp(line, "showTach")) g_ucfg.showTach = v != 0;
        else if (!strcmp(line, "showSpeed")) g_ucfg.showSpeed = v != 0;
        else if (!strcmp(line, "showBars")) g_ucfg.showBars = v != 0;
        else if (!strcmp(line, "showGearPanel")) g_ucfg.showGearPanel = v != 0;
        else if (!strcmp(line, "showBoxBadge")) g_ucfg.showBoxBadge = v != 0;
        else if (!strcmp(line, "hideStockGear")) g_ucfg.hideStockGear = v != 0;
        else if (!strcmp(line, "keyConfig")) g_ucfg.keyConfig = (uint32_t)v;
        else if (!strcmp(line, "uiScale")) g_ucfg.uiScale = v < 0.6f ? 0.6f : (v > 2.5f ? 2.5f : v);
        else if (!strcmp(line, "modePolicy")) g_ucfg.modePolicy = (uint32_t)v & 3u;
        else if (!strcmp(line, "gaugeCount")) g_ucfg.gaugeCount = (int)v < 0 ? 0 : ((int)v > SRDT_MAX_GAUGES ? SRDT_MAX_GAUGES : (int)v);
        else if (!strcmp(line, "tachX")) g_ucfg.tachX = v;
        else if (!strcmp(line, "tachY")) g_ucfg.tachY = v;
        else if (!strcmp(line, "tachW")) g_ucfg.tachW = v > 60 ? v : 260;
        else if (!strcmp(line, "tachH")) g_ucfg.tachH = v > 55 ? v : 240;
        else if (!strcmp(line, "gearX")) g_ucfg.gearX = v;
        else if (!strcmp(line, "gearY")) g_ucfg.gearY = v;
        else if (!strcmp(line, "gearW")) g_ucfg.gearW = v > 40 ? v : 340;
        else if (!strcmp(line, "gearH")) g_ucfg.gearH = v > 30 ? v : 110;
        // v1 cfg migration: old single keyboard hotkeys become bind slot 0
        else if (!strcmp(line, "keyUp")) g_ucfg.binds[SRDT_ACT_SHIFT_UP][0] = srdtBind(1, (uint16_t)v);
        else if (!strcmp(line, "keyDown")) g_ucfg.binds[SRDT_ACT_SHIFT_DOWN][0] = srdtBind(1, (uint16_t)v);
        else if (!strcmp(line, "keyMode")) g_ucfg.binds[SRDT_ACT_MODE_CYCLE][0] = srdtBind(1, (uint16_t)v);
        else if (!strcmp(line, "keyClutch")) g_ucfg.binds[SRDT_ACT_CLUTCH][0] = srdtBind(1, (uint16_t)v);
    }
    fclose(f);
    logf("gauges: cfg loaded (%s)", g_uiCfgPath);
}

bool gauges_config_open() { return g_cfgOpen; }
void gauges_toggle_config() {
    g_cfgOpen = !g_cfgOpen;
    g_capAct = -1;
    if (!g_cfgOpen) saveCfg();   // persist layout/binds on close
    publishShmCfg();             // config-open flag + binds reach the harness immediately
}
void gauges_set_shm_cfg(volatile SrdtOverlayCfg* c) {
    g_shmCfg = c;
    publishShmCfg();             // push persisted binds to the harness on connect
}

// ---------------- window helpers ----------------
static ImGuiWindowFlags panelFlags() {
    ImGuiWindowFlags f = ImGuiWindowFlags_NoTitleBar | ImGuiWindowFlags_NoScrollbar |
                         ImGuiWindowFlags_NoCollapse | ImGuiWindowFlags_NoSavedSettings |
                         ImGuiWindowFlags_NoFocusOnAppearing | ImGuiWindowFlags_NoResize;
    if (!g_cfgOpen) f |= ImGuiWindowFlags_NoMove | ImGuiWindowFlags_NoInputs;
    return f;
}
// While configuring, panels keep user-dragged geometry (Appearing); in play they are
// pinned (Always). g_scaleApply forces one Always frame so a scale change resizes live.
static ImGuiCond posCond() { return g_cfgOpen ? ImGuiCond_Appearing : ImGuiCond_Always; }
static ImGuiCond sizeCond() { return (g_cfgOpen && !g_scaleApply) ? ImGuiCond_Appearing : ImGuiCond_Always; }

// config-mode drag: snap the stored panel position to a tidy pixel grid
static const float GRID_SNAP = 16.0f;
static float snapCfg(float v) { return roundf(v / GRID_SNAP) * GRID_SNAP; }

// ---------------- HUD skin (runtime-loaded from the player's own paks) ----------------
// Every overlay panel shares one native chrome: SnowRunner's torn grunge panel, 9-sliced
// behind the panel content via the mod-agnostic asset service (assets.h). The handle is 0
// when the paks are absent, and the draw is guarded so panels fall back to a subtle flat
// fill unchanged. This is the standard SnowRunner+ panel look.
//
// Backdrop: gfx.pak "[textures]\ui\flash_auto\minimap_i79.pct" (400x1180 BC7), a torn
// grunge panel; its lower box (y 278..1166) is 9-sliced behind each panel.
static const char* PAK_GFX      = "gfx.pak";
static const char* TEX_BACKDROP = "[textures]\\ui\\flash_auto\\hud_lib_ia3.pct";
// The GEAR SELECTOR'S OWN backdrop: hud_lib.gfx symbol `gearBoxContainer` (grunge dial panel
// behind the stock transmission). The gfx rect (260,0,240,240) has the grunge off-centre with
// dead transparent margins on the bottom/right, so we use its TIGHT content bbox (262,0,219,207)
// — that recentres it. Plain stretched blit (soft-edged fill, not 9-sliced), drawn inset by
// PANEL_PAD so there's breathing room around the edges.
static const float BD_X0 = 262, BD_Y0 = 0, BD_X1 = 481, BD_Y1 = 207;
static const float CONTENT_PAD = 0.14f;   // punch content in from the panel edges by this fraction of the shorter side

static ImTextureID s_texBackdrop = 0;
static int s_bdW = 0, s_bdH = 0;
static bool s_skinTried = false;

static void gearSkinInit() {   // lazy: g_dev must be up (asset service inited in overlay.cpp)
    if (s_skinTried) return;
    s_skinTried = true;
    s_texBackdrop = assets_load_pct(PAK_GFX, TEX_BACKDROP, &s_bdW, &s_bdH);
}

// 9-slice a texture (source rect + border in px) into dst [pMin,pMax] keeping the grunge
// edges at ~dBorder px so a wide/short panel doesn't smear the torn borders.
// 9-slice helper — retained for framed elements (button pills etc.); the grunge panels use a
// plain stretch instead. [[maybe_unused]] so it doesn't warn while only the pills are pending.
[[maybe_unused]] static void image9(ImDrawList* dl, ImTextureID tex, float texW, float texH,
                   float sx0, float sy0, float sx1, float sy1, float sBorder,
                   ImVec2 pMin, ImVec2 pMax, float dBorder, ImU32 tint) {
    float halfW = (pMax.x - pMin.x) * 0.5f, halfH = (pMax.y - pMin.y) * 0.5f;
    if (dBorder > halfW) dBorder = halfW;
    if (dBorder > halfH) dBorder = halfH;
    const float xs[4] = {pMin.x, pMin.x + dBorder, pMax.x - dBorder, pMax.x};
    const float ys[4] = {pMin.y, pMin.y + dBorder, pMax.y - dBorder, pMax.y};
    const float us[4] = {sx0 / texW, (sx0 + sBorder) / texW, (sx1 - sBorder) / texW, sx1 / texW};
    const float vs[4] = {sy0 / texH, (sy0 + sBorder) / texH, (sy1 - sBorder) / texH, sy1 / texH};
    for (int r = 0; r < 3; r++)
        for (int c = 0; c < 3; c++)
            dl->AddImage(tex, ImVec2(xs[c], ys[r]), ImVec2(xs[c + 1], ys[r + 1]),
                         ImVec2(us[c], vs[r]), ImVec2(us[c + 1], vs[r + 1]), tint);
}

// Shared native panel background. The ImGui window bg is transparent (alpha 0), so this
// grunge 9-slice IS each panel's background. Falls back to a subtle flat dark fill when
// the player's paks are absent so nothing breaks.
static void drawPanelChrome(ImDrawList* dl, ImVec2 pos, ImVec2 sz) {
    gearSkinInit();
    if (s_texBackdrop) {
        // The backdrop fills the WHOLE panel window (so the asset is never smaller than the
        // content); the content is punched in instead (CONTENT_PAD, see drawGearPanel).
        ImVec2 uv0(BD_X0 / (float)s_bdW, BD_Y0 / (float)s_bdH);
        ImVec2 uv1(BD_X1 / (float)s_bdW, BD_Y1 / (float)s_bdH);
        dl->AddImage(s_texBackdrop, pos, ImVec2(pos.x + sz.x, pos.y + sz.y),
                     uv0, uv1, IM_COL32(255, 255, 255, 230));
    } else {
        dl->AddRectFilled(pos, ImVec2(pos.x + sz.x, pos.y + sz.y),
                          IM_COL32(10, 10, 14, 176), 8.0f);
    }
}

// ---------------- tach panel ----------------
static void drawTachPanel(bool stale) {
    const DashData& d = g_dash;
    ImGuiIO& io = ImGui::GetIO();
    const float S = g_ucfg.uiScale;
    ImVec2 wsz(g_ucfg.tachW * S, g_ucfg.tachH * S);
    ImVec2 def(g_ucfg.tachX >= 0 ? g_ucfg.tachX : io.DisplaySize.y * 0.30f,
               g_ucfg.tachY >= 0 ? g_ucfg.tachY : io.DisplaySize.y - wsz.y - 20);
    ImGui::SetNextWindowPos(def, posCond());
    ImGui::SetNextWindowSize(wsz, sizeCond());
    ImGui::SetNextWindowSizeConstraints(ImVec2(120, 110), ImVec2(FLT_MAX, FLT_MAX));
    ImGui::PushStyleColor(ImGuiCol_WindowBg, ImVec4(0, 0, 0, 0));   // transparent: grunge chrome is the bg
    ImGui::PushStyleVar(ImGuiStyleVar_WindowRounding, 10.0f);
    ImGuiWindowFlags fl = panelFlags();
    if (g_cfgOpen) fl &= ~ImGuiWindowFlags_NoResize;   // resizable while configuring
    ImGui::Begin("##srdt_tach", nullptr, fl);
    ImVec2 pos = ImGui::GetWindowPos(), sz = ImGui::GetWindowSize();
    if (g_cfgOpen) {
        g_ucfg.tachX = snapCfg(pos.x);
        g_ucfg.tachY = snapCfg(pos.y);
        if (!g_scaleApply) { g_ucfg.tachW = sz.x / S; g_ucfg.tachH = sz.y / S; }   // store unscaled
    }
    ImDrawList* dl = ImGui::GetWindowDrawList();
    drawPanelChrome(dl, pos, sz);

    // all geometry maps the original 260x240 design through one uniform factor k,
    // centred in the window — any window size / uiScale keeps proportions, text stays crisp
    // punch the dial in from the edges (same CONTENT_PAD as the gear panel) so it sits within
    // the grunge backdrop rather than filling the window edge-to-edge
    const float cm = (sz.x < sz.y ? sz.x : sz.y) * CONTENT_PAD;
    const float iw = sz.x - 2 * cm, ih = sz.y - 2 * cm;
    const float k = fminf(iw / 260.0f, ih / 240.0f);
    const ImVec2 o(pos.x + cm + (iw - 260 * k) / 2, pos.y + cm + (ih - 240 * k) / 2);
    auto P = [&](float x, float y) { return ImVec2(o.x + x * k, o.y + y * k); };

    ImVec2 c = P(130, 118);
    const float R = 78 * k, START = 225.0f, SWEEP = 270.0f;
    float rpm = d.rpm < 0 ? 0 : d.rpm;
    float frac = rpm / OVERREV;
    if (frac > 1) frac = 1;
    float shiftFrac = 1.0f / OVERREV;
    arcSeg(dl, c, R, 0.0f, shiftFrac, IM_COL32(42, 42, 48, 255), 13 * k);
    arcSeg(dl, c, R, shiftFrac, 1.0f, IM_COL32(102, 17, 17, 255), 13 * k);
    if (frac > 0.005f) arcSeg(dl, c, R, 0.0f, frac, rpmCol(rpm), 13 * k);
    for (int t = 0; t <= 10; t++) {
        float ft = t / 10.0f;
        dl->AddLine(arcPt(c, R - 16 * k, START - SWEEP * ft), arcPt(c, R - 9 * k, START - SWEEP * ft),
                    IM_COL32(85, 85, 85, 255), 1.0f);
    }
    if (strcmp(d.box, "ours") == 0) {
        struct { float v; ImU32 col; } m[2] = {{d.dnThr, IM_COL32(85, 153, 255, 255)}, {d.upThr, IM_COL32(255, 136, 68, 255)}};
        for (auto& mk : m) {
            if (mk.v <= 0) continue;
            float ff = mk.v / OVERREV;
            if (ff > 1) ff = 1;
            dl->AddLine(arcPt(c, R - 24 * k, START - SWEEP * ff), arcPt(c, R + 9 * k, START - SWEEP * ff), mk.col, 2.0f);
        }
    }
    ImVec2 tip = arcPt(c, R - 15 * k, START - SWEEP * frac);
    dl->AddLine(c, tip, IM_COL32(255, 255, 255, 255), 2.5f * k);
    dl->AddCircleFilled(c, 4.0f * k, IM_COL32(255, 255, 255, 255));

    char line[64];
    snprintf(line, sizeof(line), "%d%%", (int)(rpm * 100));
    uiText(dl, 15 * k, ImVec2(c.x - 14 * k, c.y + 30 * k), rpmCol(rpm), line);
    if (g_ucfg.showSpeed) {
        snprintf(line, sizeof(line), "%.0f km/h", d.speed * 3.6f);
        uiText(dl, 15 * k, P(14, 12), IM_COL32(153, 204, 255, 255), line);
    }
    if (g_ucfg.showBoxBadge) {
        const char* boxTxt = strcmp(d.box, "ours") == 0 ? "AUTO*" : (strcmp(d.box, "manual") == 0 ? "MAN" : "AUTO");
        ImU32 boxCol = strcmp(d.box, "ours") == 0 ? IM_COL32(68, 255, 136, 255) : IM_COL32(170, 170, 170, 255);
        ImVec2 bsz = uiTextSize(15 * k, boxTxt);
        uiText(dl, 15 * k, ImVec2(o.x + 260 * k - bsz.x - 14 * k, o.y + 12 * k), boxCol, boxTxt);
    }
    if (!d.engineOn) uiText(dl, 13 * k, P(14, 30), IM_COL32(255, 85, 68, 255), "ENGINE OFF");
    if (g_ucfg.showBars) {
        struct { const char* lbl; float v; ImU32 col; } bars[2] = {
            {"thr", d.thr, IM_COL32(85, 153, 255, 255)}, {"load", d.load, IM_COL32(255, 136, 68, 255)}};
        float by = 204;   // design coords: 240 - 36
        for (auto& b : bars) {
            float v = b.v < 0 ? 0 : (b.v > 1 ? 1 : b.v);
            uiText(dl, 12 * k, P(14, by - 1), IM_COL32(170, 170, 170, 255), b.lbl);
            dl->AddRectFilled(P(48, by + 2), P(246, by + 10), IM_COL32(26, 26, 30, 255), 2.0f * k);
            dl->AddRectFilled(P(48, by + 2), P(48 + 198 * v, by + 10), b.col, 2.0f * k);
            by += 16;
        }
    }
    if (stale) uiText(dl, 13 * k, P(14, 180), IM_COL32(255, 221, 68, 255), "waiting for telemetry...");
    ImGui::End();
    ImGui::PopStyleVar();
    ImGui::PopStyleColor();
}

// ---------------- shifter strip (gear panel) ----------------
// Game-style strip: [L] R N 1..gearMax [H]. H/L slots exist only once telemetry
// gearFlags maps them (arrives 0 today, so they simply don't appear yet). With
// hideStockGear it renders fully OPAQUE so it can be dragged/resized over the game's
// own gear-select widget and simply covers it — no HUD reverse-engineering required.
static void drawGearPanel() {
    const DashData& d = g_dash;
    ImGuiIO& io = ImGui::GetIO();
    const float S = g_ucfg.uiScale;
    ImVec2 wsz(g_ucfg.gearW * S, g_ucfg.gearH * S);
    ImVec2 def(g_ucfg.gearX >= 0 ? g_ucfg.gearX : io.DisplaySize.x * 0.62f,
               g_ucfg.gearY >= 0 ? g_ucfg.gearY : io.DisplaySize.y * 0.86f);
    ImGui::SetNextWindowPos(def, posCond());
    ImGui::SetNextWindowSize(wsz, sizeCond());
    ImGui::SetNextWindowSizeConstraints(ImVec2(120, 60), ImVec2(FLT_MAX, FLT_MAX));
    ImGui::PushStyleColor(ImGuiCol_WindowBg, ImVec4(0, 0, 0, 0));   // transparent: grunge chrome is the bg
    ImGui::PushStyleVar(ImGuiStyleVar_WindowRounding, 8.0f);
    ImGuiWindowFlags fl = panelFlags();
    if (g_cfgOpen) fl &= ~ImGuiWindowFlags_NoResize;
    ImGui::Begin("##srdt_gear", nullptr, fl);
    ImVec2 pos = ImGui::GetWindowPos(), sz = ImGui::GetWindowSize();
    if (g_cfgOpen) {
        g_ucfg.gearX = snapCfg(pos.x);
        g_ucfg.gearY = snapCfg(pos.y);
        if (!g_scaleApply) { g_ucfg.gearW = sz.x / S; g_ucfg.gearH = sz.y / S; }
    }
    ImDrawList* dl = ImGui::GetWindowDrawList();

    // ---- native HUD backdrop (grunge panel), behind everything ----
    // hideStockGear wants to fully occlude the stock gear widget, but the grunge texture
    // has translucent torn edges — lay an opaque dark fill under it in that mode.
    if (g_ucfg.hideStockGear)
        dl->AddRectFilled(pos, ImVec2(pos.x + sz.x, pos.y + sz.y), IM_COL32(8, 8, 11, 255), 8.0f);
    drawPanelChrome(dl, pos, sz);

    // ---- slot list ----
    int gmax = d.gearMax > 0 ? d.gearMax : 8;   // gearMax=0 until telemetry maps it
    if (gmax > 20) gmax = 20;
    char names[24][12];
    int n = 0, idxR, idxN, idxG1;
    if (d.gearFlags & 2) strcpy(names[n++], "L");   // TODO: map current gear onto L/H once gearFlags carries state
    strcpy(names[n], "R"); idxR = n++;
    strcpy(names[n], "N"); idxN = n++;
    idxG1 = n;
    for (int g = 1; g <= gmax; g++) { snprintf(names[n], sizeof(names[n]), "%d", g); n++; }
    if (d.gearFlags & 1) strcpy(names[n++], "H");

    auto slotOf = [&](int gear) {
        if (gear < 0) return idxR;
        if (gear == 0) return idxN;
        int i = idxG1 + gear - 1;
        return i < idxG1 + gmax ? i : idxG1 + gmax - 1;
    };

    // content is punched in from the panel edges so it sits WITHIN the grunge asset (which
    // fills the whole window) instead of spilling to the edges.
    float cm = (sz.x < sz.y ? sz.x : sz.y) * CONTENT_PAD;
    float cx = pos.x + cm, cy = pos.y + cm, cw = sz.x - 2 * cm, ch = sz.y - 2 * cm;

    // ---- geometry: big glyph on top, mode label, strip along the bottom ----
    float stripH = ch * 0.34f, padX = cw * 0.02f, gap = 2.0f * S;
    float y0 = cy + ch - stripH;
    float slotW = (cw - 2 * padX - gap * (n - 1)) / n;
    auto slotRect = [&](int i, ImVec2* a, ImVec2* b) {
        a->x = cx + padX + i * (slotW + gap);
        a->y = y0;
        b->x = a->x + slotW;
        b->y = y0 + stripH;
    };

    // flags bit5 = player-selected neutral; while clutched 'gear' is the SELECTION
    int tgt = d.selNeutral ? idxN : slotOf(d.gear);
    int act = slotOf(d.gameGear);
    if (tgt >= n) tgt = n - 1;   // slot count shrank under us (truck swap)
    if (act >= n) act = n - 1;

    // arrival glow: a short fading pulse on the lit circle when the selection changes
    static int prevTgt = -1;
    static uint64_t tgtT0 = 0;
    uint64_t now = GetTickCount64();
    if (tgt != prevTgt) { prevTgt = tgt; tgtT0 = now; }
    float glow = 1.0f - (float)(now - tgtT0) / 300.0f;
    if (glow < 0) glow = 0;

    // ---- gear slots as circles, matched to the stock shifter: muted gray rings with the
    // glyph inside; the selected gear is a lit near-white (amber while clutched) circle.
    // No rectangular plates, no box highlight — the light IS the selection.
    float glyphPx = fminf(stripH * 0.50f, slotW * 0.66f);
    for (int i = 0; i < n; i++) {
        ImVec2 a, b;
        slotRect(i, &a, &b);
        ImVec2 cc((a.x + b.x) * 0.5f, (a.y + b.y) * 0.5f);
        float r = fminf(slotW, stripH) * 0.45f;
        bool sel = (i == tgt);
        ImU32 ring, glyphCol;
        float th;
        if (sel) {
            if (d.clutched) { ring = IM_COL32(255, 200, 90, 255); glyphCol = IM_COL32(255, 240, 210, 255); }
            else            { ring = IM_COL32(235, 240, 250, 255); glyphCol = IM_COL32(255, 255, 255, 255); }
            th = fmaxf(1.5f, r * 0.14f);
            dl->AddCircleFilled(cc, r - th * 0.5f, (ring & 0xFFFFFFu) | (30u << 24), 32);   // faint lit disc
        } else {
            ring = IM_COL32(150, 160, 175, 180);
            glyphCol = IM_COL32(150, 160, 175, 205);
            th = fmaxf(1.0f, r * 0.10f);
        }
        dl->AddCircle(cc, r, ring, 32, th);
        // clutched: the ACTUAL engaged gear (differs from the selection) gets a subtle 2nd ring
        if (d.clutched && i == act && !sel)
            dl->AddCircle(cc, r, IM_COL32(255, 255, 255, 110), 32, fmaxf(1.0f, r * 0.09f));
        // arrival glow around the lit circle
        if (sel && glow > 0.0f) {
            ImU32 gc = (ring & 0xFFFFFFu) | ((uint32_t)(120 * glow) << 24);
            dl->AddCircle(cc, r + 3 * S, gc, 32, fmaxf(1.0f, r * 0.08f));
        }
        ImVec2 tsz = uiTextSize(glyphPx, names[i]);
        uiText(dl, glyphPx, ImVec2(cc.x - tsz.x / 2, cc.y - tsz.y / 2), glyphCol, names[i]);
    }

    // ---- big current-gear glyph + mode label ----
    char gearStr[16];
    if (d.gear < 0) strcpy(gearStr, "R");
    else if (d.gear == 0) strcpy(gearStr, "N");
    else snprintf(gearStr, sizeof(gearStr), "%d", d.gear);
    float big = ch * 0.34f;
    ImVec2 gsz = uiTextSize(big, gearStr);
    ImU32 gcol = d.clutched ? IM_COL32(255, 221, 68, 255) : IM_COL32(255, 255, 255, 255);
    uiText(dl, big, ImVec2(cx + (cw - gsz.x) / 2, cy), gcol, gearStr);
    const char* mode = d.clutched ? "CLUTCH"
                       : (strcmp(d.box, "ours") == 0 ? "AUTO*" : (strcmp(d.box, "manual") == 0 ? "MANUAL" : "AUTO"));
    float mpx = ch * 0.12f;
    ImVec2 msz = uiTextSize(mpx, mode);
    uiText(dl, mpx, ImVec2(cx + (cw - msz.x) / 2, cy + ch * 0.40f), IM_COL32(150, 160, 175, 255), mode);
    ImGui::End();
    ImGui::PopStyleVar();
    ImGui::PopStyleColor();
}

// ---------------- generic user-added gauges ----------------
static void drawGauge(int i) {
    GaugeCfg& g = g_ucfg.gauges[i];
    if (g.uid < 0) g.uid = g_gaugeUid++;   // stable window id: removals don't remap geometry
    ImGuiIO& io = ImGui::GetIO();
    const float S = g_ucfg.uiScale;
    ImVec2 wsz(g.w * S, g.h * S);
    ImVec2 def(g.x >= 0 ? g.x : io.DisplaySize.x * 0.05f + i * 40, g.y >= 0 ? g.y : io.DisplaySize.y * 0.45f);
    char id[32];
    snprintf(id, sizeof(id), "##srdt_g%d", g.uid);
    ImGui::SetNextWindowPos(def, posCond());
    ImGui::SetNextWindowSize(wsz, sizeCond());
    ImGui::SetNextWindowSizeConstraints(ImVec2(60, 30), ImVec2(FLT_MAX, FLT_MAX));
    ImGui::PushStyleColor(ImGuiCol_WindowBg, ImVec4(0, 0, 0, 0));   // transparent: grunge chrome is the bg
    ImGui::PushStyleVar(ImGuiStyleVar_WindowRounding, 8.0f);
    ImGuiWindowFlags fl = panelFlags();
    if (g_cfgOpen) fl &= ~ImGuiWindowFlags_NoResize;
    ImGui::Begin(id, nullptr, fl);
    ImVec2 pos = ImGui::GetWindowPos(), sz = ImGui::GetWindowSize();
    if (g_cfgOpen) {
        g.x = snapCfg(pos.x);
        g.y = snapCfg(pos.y);
        if (!g_scaleApply) { g.w = sz.x / S; g.h = sz.y / S; }
    }
    ImDrawList* dl = ImGui::GetWindowDrawList();
    drawPanelChrome(dl, pos, sz);

    // punch content in from the edges so it sits within the grunge backdrop
    float cm = (sz.x < sz.y ? sz.x : sz.y) * CONTENT_PAD;
    ImVec2 ip(pos.x + cm, pos.y + cm);
    ImVec2 is(sz.x - 2 * cm, sz.y - 2 * cm);

    float v = statValue(g.stat);
    float frac = v / kStatHi[g.stat];
    if (frac < 0) frac = 0;
    if (frac > 1) frac = 1;
    ImU32 col = statCol(g.stat, v);
    char val[24];
    statText(g.stat, v, val, sizeof(val));

    if (g.style == 0) {   // arc: same 270-degree dial as the tach
        float m = fminf(is.x, is.y);
        ImVec2 c(ip.x + is.x / 2, ip.y + is.y * 0.54f);
        float R = m * 0.36f, th = R * 0.18f;
        arcSeg(dl, c, R, 0.0f, 1.0f, IM_COL32(42, 42, 48, 255), th);
        if (frac > 0.005f) arcSeg(dl, c, R, 0.0f, frac, col, th);
        float vpx = m * 0.17f;
        ImVec2 vsz = uiTextSize(vpx, val);
        uiText(dl, vpx, ImVec2(c.x - vsz.x / 2, c.y - vsz.y / 2), IM_COL32(255, 255, 255, 255), val);
        if (g.label) {
            float lpx = m * 0.10f;
            ImVec2 lsz = uiTextSize(lpx, kStatLbl[g.stat]);
            uiText(dl, lpx, ImVec2(c.x - lsz.x / 2, ip.y + is.y * 0.06f), IM_COL32(150, 160, 175, 255), kStatLbl[g.stat]);
        }
    } else {              // horizontal bar with label + value on the line above
        float px2 = is.x * 0.06f, top = ip.y + is.y * 0.12f;
        float lpx = is.y * 0.28f;
        float barY0 = ip.y + is.y * 0.52f, barY1 = ip.y + is.y * 0.86f;
        if (g.label) uiText(dl, lpx, ImVec2(ip.x + px2, top), IM_COL32(150, 160, 175, 255), kStatLbl[g.stat]);
        ImVec2 vsz = uiTextSize(lpx, val);
        uiText(dl, lpx, ImVec2(ip.x + is.x - px2 - vsz.x, top), col, val);
        dl->AddRectFilled(ImVec2(ip.x + px2, barY0), ImVec2(ip.x + is.x - px2, barY1), IM_COL32(26, 26, 30, 255), 3.0f);
        dl->AddRectFilled(ImVec2(ip.x + px2, barY0), ImVec2(ip.x + px2 + (is.x - 2 * px2) * frac, barY1), col, 3.0f);
    }
    ImGui::End();
    ImGui::PopStyleVar();
    ImGui::PopStyleColor();
}

// ---------------- bind capture ----------------
static void pollBindCapture() {
    if (g_capAct < 0) return;
    if (GetAsyncKeyState(VK_ESCAPE) & 0x8000) { g_capAct = -1; return; }
    // keyboard: scan the VK range, skipping mouse buttons (< 0x08 anyway), the panel
    // toggle (F9) and the config toggle so the UI keys can't eat themselves
    for (uint32_t vk = 0x08; vk <= 0xFE; vk++) {
        if (vk == VK_F9 || vk == g_ucfg.keyConfig) continue;
        if (!(GetAsyncKeyState(vk) & 0x8000)) continue;
        if (g_capAct == CAP_CONFIG) g_ucfg.keyConfig = vk;
        else g_ucfg.binds[g_capAct][g_capSlot] = srdtBind(1, (uint16_t)vk);
        g_capAct = -1;
        saveCfg();
        publishShmCfg();
        return;
    }
    if (g_capAct == CAP_CONFIG) return;   // config toggle stays keyboard-only
    uint32_t cur = padButtons(), newly = cur & ~g_padPrev;   // edge-detect vs capture start
    g_padPrev = cur;
    if (!newly) return;
    uint16_t bit = 0;
    while (!(newly & (1u << bit))) bit++;
    g_ucfg.binds[g_capAct][g_capSlot] = srdtBind(2, bit);
    g_capAct = -1;
    saveCfg();
    publishShmCfg();
}

// ---------------- config UI ----------------
static void bindRow(const char* label, int act) {
    ImGui::Text("%s", label);
    ImGui::SameLine(140);
    for (int s = 0; s < 2; s++) {
        char name[48], btn[96];
        ImGui::PushID(act * 2 + s);
        if (g_capAct == act && g_capSlot == s) snprintf(btn, sizeof(btn), "press key/button...");
        else { bindName(g_ucfg.binds[act][s], name, sizeof(name)); snprintf(btn, sizeof(btn), "%s", name); }
        if (ImGui::Button(btn, ImVec2(108, 0))) {
            if (g_capAct == act && g_capSlot == s) g_capAct = -1;   // click again = cancel
            else { g_capAct = act; g_capSlot = s; g_padPrev = padButtons(); }
        }
        ImGui::SameLine(0, 2);
        if (ImGui::SmallButton("x")) { g_ucfg.binds[act][s] = 0; saveCfg(); publishShmCfg(); }
        ImGui::PopID();
        if (s == 0) ImGui::SameLine(0, 10);
    }
}

static void drawConfig() {
    pollBindCapture();
    ImGuiIO& io = ImGui::GetIO();
    ImGui::SetNextWindowPos(ImVec2(io.DisplaySize.x * 0.5f - 225, 90), ImGuiCond_Appearing);
    ImGui::SetNextWindowSizeConstraints(ImVec2(450, 0), ImVec2(450, io.DisplaySize.y - 140));
    ImGui::SetNextWindowSize(ImVec2(450, 0), ImGuiCond_Always);
    bool open = true;
    ImGui::Begin("Drivetrain overlay — config", &open, ImGuiWindowFlags_NoCollapse | ImGuiWindowFlags_NoSavedSettings);
    bool ch = false;

    ImGui::SeparatorText("Gauges");
    ch |= ImGui::Checkbox("Tachometer", &g_ucfg.showTach);
    ImGui::SameLine(170); ch |= ImGui::Checkbox("Speed", &g_ucfg.showSpeed);
    ch |= ImGui::Checkbox("Thr/load bars", &g_ucfg.showBars);
    ImGui::SameLine(170); ch |= ImGui::Checkbox("Box badge", &g_ucfg.showBoxBadge);
    ch |= ImGui::Checkbox("Gear panel", &g_ucfg.showGearPanel);
    ch |= ImGui::Checkbox("Opaque gear panel (covers the stock gear UI)", &g_ucfg.hideStockGear);
    ImGui::SetNextItemWidth(200);
    ImGui::SliderFloat("UI scale", &g_ucfg.uiScale, 0.6f, 2.5f, "%.2f", ImGuiSliderFlags_AlwaysClamp);
    if (ImGui::IsItemEdited()) g_scaleDirty = true;               // panels re-push sizes next frame
    if (ImGui::IsItemDeactivatedAfterEdit()) ch = true;           // save once, on release
    ImGui::TextDisabled("drag panels to move them; resize them while this window is open");

    ImGui::SeparatorText("Custom gauges");
    static const char* kStyleNames[2] = {"arc", "bar"};
    for (int i = 0; i < g_ucfg.gaugeCount; i++) {
        GaugeCfg& g = g_ucfg.gauges[i];
        ImGui::PushID(1000 + i);
        ImGui::SetNextItemWidth(150);
        ch |= ImGui::Combo("##stat", &g.stat, kStatCombo, STAT_N);
        ImGui::SameLine();
        ImGui::SetNextItemWidth(60);
        ch |= ImGui::Combo("##style", &g.style, kStyleNames, 2);
        ImGui::SameLine();
        ch |= ImGui::Checkbox("label", &g.label);
        ImGui::SameLine();
        bool rm = ImGui::SmallButton("remove");
        ImGui::PopID();
        if (rm) {   // shift down; uids move with their gauge so windows keep geometry
            for (int j = i; j < g_ucfg.gaugeCount - 1; j++) g_ucfg.gauges[j] = g_ucfg.gauges[j + 1];
            g_ucfg.gauges[g_ucfg.gaugeCount - 1] = GaugeCfg();
            g_ucfg.gaugeCount--;
            ch = true;
            i--;
        }
    }
    if (g_ucfg.gaugeCount < SRDT_MAX_GAUGES) {
        ImGui::SetNextItemWidth(150);
        if (ImGui::BeginCombo("##addgauge", "add gauge...")) {
            for (int s = 0; s < STAT_N; s++) {
                if (ImGui::Selectable(kStatCombo[s])) {
                    GaugeCfg ng;
                    ng.stat = s;
                    g_ucfg.gauges[g_ucfg.gaugeCount++] = ng;
                    ch = true;
                }
            }
            ImGui::EndCombo();
        }
    }

    ImGui::SeparatorText("Gearbox bindings");
    static const char* actLbl[7] = {"Shift up", "Shift down", "Gearbox mode", "Clutch (hold=N)",
                                    "Neutral", "Low gear", "High gear"};
    for (int a = 0; a < 7; a++) bindRow(actLbl[a], a);
    {   // config toggle: local field, keyboard-only, never published to shm
        char name[48], btn[96];
        ImGui::Text("Open this config");
        ImGui::SameLine(140);
        if (g_capAct == CAP_CONFIG) snprintf(btn, sizeof(btn), "press a key...##cfgk");
        else { keyNameOf(g_ucfg.keyConfig, name, sizeof(name)); snprintf(btn, sizeof(btn), "%s##cfgk", name); }
        if (ImGui::Button(btn, ImVec2(108, 0))) g_capAct = (g_capAct == CAP_CONFIG) ? -1 : CAP_CONFIG;
    }
    ImGui::TextDisabled("click a slot, then press a key or pad button (Esc cancels). Applies live.");

    ImGui::SeparatorText("Gearbox mode policy");
    int mp = (int)g_ucfg.modePolicy;
    ch |= ImGui::RadioButton("Hot-swap", &mp, 0);
    ImGui::SameLine(); ch |= ImGui::RadioButton("Ours auto", &mp, 1);
    ImGui::SameLine(); ch |= ImGui::RadioButton("Manual", &mp, 2);
    ImGui::SameLine(); ch |= ImGui::RadioButton("Stock auto", &mp, 3);
    g_ucfg.modePolicy = (uint32_t)mp;
    ImGui::TextDisabled("hot-swap: the mode bind cycles boxes; forced modes pin one box");

    ImGui::End();
    if (ch) { saveCfg(); publishShmCfg(); }
    if (!open) gauges_toggle_config();
}

void gauges_draw() {
    ImGuiIO& io = ImGui::GetIO();
    ImGui::GetStyle().WindowBorderSize = 0.0f;   // no ImGui 1px window outline — the grunge chrome is the whole panel
    io.MouseDrawCursor = g_cfgOpen;
    g_scaleApply = g_scaleDirty;   // slider moved last frame: panels re-apply size once
    g_scaleDirty = false;
    bool stale = !g_dash.valid || GetTickCount64() - g_dash.lastChange > 2000;
    // gauges only exist while driving; with the config UI open they stay visible anywhere
    // (placeholder data) so panels can be positioned from menus/garage too
    bool show = g_cfgOpen || (g_dash.valid && !stale && g_dash.inTruck);
    if (show && g_ucfg.showTach) drawTachPanel(stale);
    if (show && g_ucfg.showGearPanel) drawGearPanel();
    if (show)
        for (int i = 0; i < g_ucfg.gaugeCount; i++) drawGauge(i);
    if (g_cfgOpen) drawConfig();
}
