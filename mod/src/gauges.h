// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.
#pragma once
#include <cstdint>
#include "imgui.h"
#include "telemetry.h"

// Gauge panels + in-game config UI (F8 toggles config; F9 toggles visibility —
// handled in overlay.cpp). Panels are ImGui windows: locked during play, draggable
// AND resizable while the config UI is open. Layout, bindings, uiScale and custom
// gauges persist to g_uiCfgPath; bindings + modePolicy are mirrored to the harness
// via the shm config block (SrdtOverlayCfg).

struct DashData {
    float rpm = 0, load = 0, thr = 0, speed = 0, upThr = 0, dnThr = 0, grip = 0, redlineMps = 0;
    float wav = 0;              // wheel angular velocity rad/s (custom gauges)
    int gear = 0;               // -1 R, 0 N, 1..n; carries the SELECTION while clutched
    int gameGear = 0;           // ACTUAL engaged gear (differs from 'gear' mid-clutch)
    int gearMax = 0;            // top forward gear; 0 = unknown (shifter falls back to 8)
    uint32_t gearFlags = 0;     // special-gear presence bits (telemetry.h); 0 until mapped
    bool engineOn = true, clutched = false, inTruck = false, selNeutral = false;
    char box[16] = "?";
    bool valid = false;
    uint64_t lastChange = 0;
};
extern DashData g_dash;

// User-added generic gauge: one stat, arc or bar, own window geometry.
static const int SRDT_MAX_GAUGES = 8;
struct GaugeCfg {
    int stat = 0;               // index into the stat table in gauges.cpp
    int style = 0;              // 0 = arc, 1 = horizontal bar
    bool label = true;
    float x = -1, y = -1;       // -1 = default placement
    float w = 150, h = 150;     // stored UNSCALED; drawn at w*uiScale x h*uiScale
    int uid = -1;               // runtime-only: stable ImGui window id across removals
};

struct OverlayCfg {
    bool showTach = true, showSpeed = true, showBars = true, showGearPanel = true, showBoxBadge = true;
    bool hideStockGear = false;             // gear panel goes fully opaque = occludes the stock widget
    uint32_t keyConfig = 0x77;              // F8; local keyboard-only toggle, NOT published to shm
    float uiScale = 1.0f;                   // 0.6..2.5 global multiplier on panel sizes (=> text too)
    float tachX = -1, tachY = -1, tachW = 260, tachH = 240;   // -1 = default placement
    float gearX = -1, gearY = -1, gearW = 340, gearH = 110;
    uint32_t modePolicy = 0;                // 0 hot-swap, 1 force ours-auto, 2 force manual, 3 force stock-auto
    uint32_t binds[SRDT_ACT_COUNT][2] = {}; // (type<<16)|code per telemetry.h; 0 = unbound
    int gaugeCount = 0;
    GaugeCfg gauges[SRDT_MAX_GAUGES];
    OverlayCfg() {                          // slot-0 keyboard defaults; slot 1 unbound
        binds[SRDT_ACT_SHIFT_UP][0]   = srdtBind(1, 0xDD);   // ]
        binds[SRDT_ACT_SHIFT_DOWN][0] = srdtBind(1, 0xDB);   // [
        binds[SRDT_ACT_MODE_CYCLE][0] = srdtBind(1, 0xDC);   // backslash
        binds[SRDT_ACT_CLUTCH][0]     = srdtBind(1, 0x56);   // V
    }
};
extern OverlayCfg g_ucfg;

void gauges_init();                                   // load g_uiCfgPath
void gauges_draw();                                   // call inside an ImGui frame
bool gauges_config_open();
void gauges_toggle_config();                          // also saves cfg on close
void gauges_set_shm_cfg(volatile SrdtOverlayCfg* c);  // overlay.cpp passes mapping+SRDT_CFG_OFF
