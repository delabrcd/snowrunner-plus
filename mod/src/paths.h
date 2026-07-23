// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.
#pragma once
#include <windows.h>
#include <cstdio>
#include <cstring>

// Runtime paths + feature switches resolved relative to the loaded .asi — nothing
// machine-specific is compiled into the binary. An optional snowrunner-engine.ini NEXT TO
// the .asi overrides them (plain key=value lines, no sections):
//   log=Z:\...\mod\mod.log        where logf() writes        (default: <asi dir>\snowrunner-engine.log)
//   data_dir=Z:\...\tools\dev     dir holding dash.json etc. (default: <asi dir>)
//   pak_dir=Z:\...\paks\client    dir holding the game .pak files (default: auto-discover
//                                 preload\paks\client relative to the game exe)
//   xaudio=off                    skip the XAudio2 hooks     (default on; OFF when the Frida
//                                 dev harness runs alongside — it owns those hooks, and
//                                 double-patching the same prologues would crash)
//   telemetry=off                 skip the mem telemetry thread (default on)
//   overlay=off                   skip the Present-hook overlay  (default on)
// install-mod.sh generates this ini for the dev setup; a public install ships none.

inline HINSTANCE g_hSelf = nullptr;   // set in DllMain
inline char g_logPath[MAX_PATH] = {0};
inline char g_dashPath[MAX_PATH] = {0};
inline char g_uiCfgPath[MAX_PATH] = {0};   // overlay layout/hotkeys (saved by the in-game config UI)
inline char g_pakDir[MAX_PATH] = {0};      // ini override for the game paks dir; "" = auto-discover
inline bool g_cfgXAudio = true;
inline bool g_cfgTelemetry = true;
inline bool g_cfgOverlay = true;

inline bool ini_on(const char* v) { return strcmp(v, "off") != 0 && strcmp(v, "0") != 0; }

inline void paths_init() {
    char dir[MAX_PATH] = {0};
    GetModuleFileNameA(g_hSelf, dir, MAX_PATH);
    char* s = strrchr(dir, '\\');
    if (s) *s = 0;
    snprintf(g_logPath, MAX_PATH, "%s\\snowrunner-engine.log", dir);
    snprintf(g_dashPath, MAX_PATH, "%s\\dash.json", dir);
    snprintf(g_uiCfgPath, MAX_PATH, "%s\\snowrunner-overlay.cfg", dir);

    char ini[MAX_PATH];
    snprintf(ini, MAX_PATH, "%s\\snowrunner-engine.ini", dir);
    FILE* f = fopen(ini, "r");
    if (!f) return;
    char line[MAX_PATH + 32];
    while (fgets(line, sizeof(line), f)) {
        char* nl = strpbrk(line, "\r\n");
        if (nl) *nl = 0;
        if (!strncmp(line, "log=", 4) && line[4])
            snprintf(g_logPath, MAX_PATH, "%s", line + 4);
        else if (!strncmp(line, "data_dir=", 9) && line[9])
            snprintf(g_dashPath, MAX_PATH, "%s\\dash.json", line + 9);
        else if (!strncmp(line, "pak_dir=", 8) && line[8])
            snprintf(g_pakDir, MAX_PATH, "%s", line + 8);
        else if (!strncmp(line, "xaudio=", 7))
            g_cfgXAudio = ini_on(line + 7);
        else if (!strncmp(line, "telemetry=", 10))
            g_cfgTelemetry = ini_on(line + 10);
        else if (!strncmp(line, "overlay=", 8))
            g_cfgOverlay = ini_on(line + 8);
    }
    fclose(f);
}
