// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.
#include <windows.h>
#include <xinput.h>
#include <cstdio>
#include "bindings.h"
#include "log.h"

// ---------------- keyboard ----------------
void keyNameOf(uint32_t vk, char* out_, int n) {
    UINT sc = MapVirtualKeyA(vk, MAPVK_VK_TO_VSC);
    LONG l = (LONG)(sc << 16);
    if ((vk >= VK_PRIOR && vk <= VK_DOWN) || vk == VK_INSERT || vk == VK_DELETE) l |= 1 << 24;
    if (!vk || !GetKeyNameTextA(l, out_, n)) snprintf(out_, n, "VK%02X", vk);
}

// ---------------- gamepad ----------------
// XInput is loaded dynamically so a prefix without the runtime just degrades to
// keyboard-only binds — never a hard link failure or crash.
typedef DWORD(WINAPI* XInputGetState_t)(DWORD, XINPUT_STATE*);
static XInputGetState_t g_xigs = nullptr;
static bool g_xiTried = false;

static void xiInit() {
    if (g_xiTried) return;
    g_xiTried = true;
    const char* dlls[] = {"xinput1_4.dll", "xinput1_3.dll", "xinput9_1_0.dll"};
    for (const char* dn : dlls) {
        HMODULE h = LoadLibraryA(dn);
        if (!h) continue;
        g_xigs = (XInputGetState_t)GetProcAddress(h, "XInputGetState");
        if (g_xigs) { logf("bindings: XInput via %s", dn); return; }   // keep h loaded for the fn ptr
        FreeLibrary(h);
    }
    logf("bindings: no XInput runtime, pad binds disabled");
}

uint32_t padButtons() {
    xiInit();
    if (!g_xigs) return 0;
    XINPUT_STATE st;
    if (g_xigs(0, &st) != ERROR_SUCCESS) return 0;
    return st.Gamepad.wButtons;
}

// wButtons bit index -> label (bits 10/11 are reserved in XINPUT_GAMEPAD)
static const char* kPadName[16] = {"DPadUp", "DPadDown", "DPadLeft", "DPadRight",
                                   "Start",  "Back",     "LS",       "RS",
                                   "LB",     "RB",       "Pad10",    "Pad11",
                                   "A",      "B",        "X",        "Y"};

void bindName(uint32_t bind, char* out_, int n) {
    uint16_t type = (uint16_t)(bind >> 16), code = (uint16_t)(bind & 0xFFFF);
    if (type == 1) keyNameOf(code, out_, n);
    else if (type == 2 && code < 16) snprintf(out_, n, "Pad %s", kPadName[code]);
    else snprintf(out_, n, "---");
}
