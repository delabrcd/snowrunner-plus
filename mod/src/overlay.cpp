// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.
// In-game overlay (Steam/Discord-overlay style): MinHook on IDXGISwapChain::Present +
// Dear ImGui rendered inside the game's frame. Works identically under DXVK/Proton and
// native Windows because it lives in-process, downstream of the game's own D3D11 calls.
//
// Panels + in-game config UI live in gauges.cpp. F9 toggles visibility; Insert opens the
// config UI (WndProc-hooked input: ImGui gets mouse/keyboard while config is open, the
// game is shielded from them). Hotkeys configured in-game flow to the Frida harness
// through the shm config block (telemetry.h, SRDT_CFG_OFF).
//
// Data source, in order of preference:
//   1. shared memory "Local\srdt_telemetry" (telemetry.h, seqlock) — written ~30Hz by the
//      Frida dev harness, read fresh EVERY frame, no filesystem in the loop.
//   2. tools/dev/dash.json at 10Hz — legacy fallback, also feeds the tkinter tools.
//
// Present is hooked by CODE PATCH (MinHook), found via a dummy device+swapchain vtable —
// so it catches the game's swapchain no matter when it was created.

#include <windows.h>
#include <d3d11.h>
#include <dxgi.h>
#include <cmath>
#include <cstdint>
#include <cstring>
#include <cstdio>
#include "MinHook.h"
#include "log.h"
#include "paths.h"
#include "telemetry.h"
#include "gauges.h"
#include "widgets.h"
#include "assets.h"

#include "imgui.h"
#include "imgui_impl_dx11.h"
#include "imgui_impl_win32.h"

// ---------------- dash.json polling (flat file, ad-hoc parser — no JSON lib) ----------------
static bool jnum(const char* buf, const char* key, float* out) {
    const char* p = strstr(buf, key);
    if (!p) return false;
    *out = (float)atof(p + strlen(key));
    return true;
}

// ---- source 1: shared-memory seqlock reader (telemetry.h) ----
static const SrdtTelemetry* g_tel = nullptr;

static bool openShm() {
    HANDLE h = OpenFileMappingA(FILE_MAP_ALL_ACCESS, FALSE, "Local\\srdt_telemetry");
    if (!h) return false;
    void* v = MapViewOfFile(h, FILE_MAP_ALL_ACCESS, 0, 0, 0);
    CloseHandle(h);   // the view keeps the section alive
    if (!v) return false;
    const SrdtTelemetry* t = (const SrdtTelemetry*)v;
    if (t->magic != SRDT_MAGIC || t->layoutVersion != SRDT_LAYOUT_V) {
        logf("overlay: shm magic/layout mismatch (%08x v%u)", t->magic, t->layoutVersion);
        UnmapViewOfFile((void*)v);
        return false;
    }
    g_tel = t;
    gauges_set_shm_cfg((volatile SrdtOverlayCfg*)((uint8_t*)v + SRDT_CFG_OFF));   // reverse channel
    logf("overlay: shm telemetry connected");
    return true;
}

static bool pollShm() {
    static uint64_t lastOpenTry = 0;
    uint64_t now = GetTickCount64();
    if (!g_tel) {
        if (now - lastOpenTry < 1000) return false;   // writer not up yet: retry 1Hz
        lastOpenTry = now;
        if (!openShm()) return false;
    }
    SrdtTelemetry t;
    const volatile uint32_t* seqp = &g_tel->seq;
    bool ok = false;
    for (int i = 0; i < 4 && !ok; i++) {              // seqlock snapshot
        uint32_t s1 = *seqp;
        if (s1 & 1) continue;
        memcpy(&t, (const void*)g_tel, sizeof(t));
        ok = (*seqp == s1);
    }
    if (!ok) return true;                             // writer busy this frame: keep last data
    static uint32_t lastSeq = 0;
    if (t.seq != lastSeq) { lastSeq = t.seq; g_dash.lastChange = now; }
    DashData d;
    d.rpm = t.rpm; d.load = t.load; d.thr = t.thr; d.speed = t.speed;
    d.upThr = t.upThr; d.dnThr = t.dnThr; d.grip = t.rpmGrip; d.redlineMps = t.redlineMps;
    d.wav = t.wav;
    d.gear = t.gear; d.gameGear = t.gameGear;
    d.gearMax = t.gearMax; d.gearFlags = t.gearFlags;
    d.engineOn = (t.flags & 1) != 0;
    d.clutched = (t.flags & 8) != 0;
    d.inTruck = (t.flags & 16) != 0;
    d.selNeutral = (t.flags & 32) != 0;
    strcpy(d.box, (t.flags & 2) ? "ours" : (t.flags & 4) ? "manual" : "game");
    d.valid = true;
    d.lastChange = g_dash.lastChange;
    g_dash = d;
    return true;
}

// ---- source 2: dash.json fallback (legacy; also what the tkinter tools consume) ----
static void pollDash() {
    static uint64_t lastPoll = 0;
    static char prev[2048] = {0};
    uint64_t now = GetTickCount64();
    if (now - lastPoll < 100) return;   // 10Hz is plenty (writer is ~7Hz)
    lastPoll = now;
    FILE* f = fopen(g_dashPath, "rb");
    if (!f) return;
    char buf[2048];
    size_t n = fread(buf, 1, sizeof(buf) - 1, f);
    fclose(f);
    buf[n] = 0;
    if (n < 10) return;
    if (strcmp(buf, prev) != 0) { g_dash.lastChange = now; memcpy(prev, buf, n + 1); }
    DashData d = g_dash;
    float fv;
    if (!jnum(buf, "\"mix_rpm\":", &d.rpm)) return;   // partial write mid-read: keep last good
    if (jnum(buf, "\"gear\":", &fv)) d.gear = (int)fv;
    jnum(buf, "\"speed\":", &d.speed);
    jnum(buf, "\"throttle\":", &d.thr);
    jnum(buf, "\"mix_load\":", &d.load);
    jnum(buf, "\"upThr\":", &d.upThr);
    jnum(buf, "\"dnThr\":", &d.dnThr);
    jnum(buf, "\"rpm_grip\":", &d.grip);
    jnum(buf, "\"redline_mps\":", &d.redlineMps);
    d.engineOn = strstr(buf, "\"engineOn\":true") != nullptr;
    d.inTruck = true;   // legacy file feed has no flag; assume driving
    const char* b = strstr(buf, "\"box\":\"");
    if (b) { b += 7; size_t i = 0; while (b[i] && b[i] != '"' && i < 15) { d.box[i] = b[i]; i++; } d.box[i] = 0; }
    d.valid = true;
    g_dash = d;
}

static void pollTelemetry() {
    if (pollShm()) return;   // shm connected (fresh or holding last snapshot)
    pollDash();
}

// ---------------- Present hook ----------------
typedef HRESULT(STDMETHODCALLTYPE* Present_t)(IDXGISwapChain*, UINT, UINT);
typedef HRESULT(STDMETHODCALLTYPE* ResizeBuffers_t)(IDXGISwapChain*, UINT, UINT, UINT, DXGI_FORMAT, UINT);
static Present_t oPresent = nullptr;
static ResizeBuffers_t oResizeBuffers = nullptr;

extern IMGUI_IMPL_API LRESULT ImGui_ImplWin32_WndProcHandler(HWND, UINT, WPARAM, LPARAM);
static WNDPROC oWndProc = nullptr;
static LRESULT CALLBACK hkWndProc(HWND h, UINT m, WPARAM w, LPARAM l) {
    ImGui_ImplWin32_WndProcHandler(h, m, w, l);
    if (gauges_config_open()) {   // config UI open: keep clicks/keys away from the game
        bool mouseMsg = m >= WM_MOUSEFIRST && m <= WM_MOUSELAST;
        bool keyMsg = m >= WM_KEYFIRST && m <= WM_KEYLAST;
        if (mouseMsg || keyMsg) return 0;
    }
    return CallWindowProcA(oWndProc, h, m, w, l);
}

static ID3D11Device* g_dev = nullptr;
static ID3D11DeviceContext* g_ctx = nullptr;
static ID3D11RenderTargetView* g_rtv = nullptr;
static HWND g_hwnd = nullptr;
static bool g_imguiInit = false, g_initFailed = false, g_visible = true;

static void createRTV(IDXGISwapChain* sc) {
    ID3D11Texture2D* back = nullptr;
    if (SUCCEEDED(sc->GetBuffer(0, __uuidof(ID3D11Texture2D), (void**)&back)) && back) {
        g_dev->CreateRenderTargetView(back, nullptr, &g_rtv);
        back->Release();
    }
}

static bool initImGui(IDXGISwapChain* sc) {
    if (FAILED(sc->GetDevice(__uuidof(ID3D11Device), (void**)&g_dev)) || !g_dev) return false;
    g_dev->GetImmediateContext(&g_ctx);
    DXGI_SWAP_CHAIN_DESC desc;
    if (FAILED(sc->GetDesc(&desc)) || !desc.OutputWindow) return false;
    g_hwnd = desc.OutputWindow;
    createRTV(sc);
    if (!g_rtv) return false;

    ImGui::CreateContext();
    ImGuiIO& io = ImGui::GetIO();
    io.IniFilename = nullptr;                       // no imgui.ini litter in the game dir
    io.ConfigFlags |= ImGuiConfigFlags_NoMouseCursorChange;
    // crisp text at any size: bake the TTF at a ladder of sizes (widgets.cpp); the
    // helpers there pick the right bake per drawn px, with an AddFontDefault fallback
    uiFontsInit();
    if (!ImGui_ImplWin32_Init(g_hwnd)) return false;
    if (!ImGui_ImplDX11_Init(g_dev, g_ctx)) return false;
    assets_init(g_dev);   // runtime HUD-skin loader (uses the game's own device); degrades to null
    oWndProc = (WNDPROC)SetWindowLongPtrA(g_hwnd, GWLP_WNDPROC, (LONG_PTR)hkWndProc);
    gauges_init();
    logf("overlay: ImGui up (hwnd=%p dev=%p)", (void*)g_hwnd, (void*)g_dev);
    return true;
}

static HRESULT STDMETHODCALLTYPE hkPresent(IDXGISwapChain* sc, UINT sync, UINT flags) {
    if (!g_initFailed) {
        if (!g_imguiInit) {
            g_imguiInit = initImGui(sc);
            if (!g_imguiInit) { g_initFailed = true; logf("overlay: init failed, passthrough"); }
        }
        if (g_imguiInit) {
            static bool pF9 = false, pIns = false;
            bool f9 = (GetAsyncKeyState(VK_F9) & 0x8000) != 0;
            bool ins = (GetAsyncKeyState(g_ucfg.keyConfig) & 0x8000) != 0;   // default F8; rebindable
            if (f9 && !pF9) g_visible = !g_visible;
            if (ins && !pIns) gauges_toggle_config();
            pF9 = f9; pIns = ins;
            if (g_visible) {
                if (!g_rtv) createRTV(sc);
                if (g_rtv) {
                    pollTelemetry();
                    ImGui_ImplDX11_NewFrame();
                    ImGui_ImplWin32_NewFrame();
                    ImGui::NewFrame();
                    // per-frame display smoothing lives here (data ticks at drivetrain
                    // rate ~60Hz, rendering at game fps): short exponential = needle inertia
                    {
                        static float sRpm = 0, sThr = 0, sLoad = 0, sSpeed = 0, sWav = 0, sGrip = 0;
                        static uint64_t lastMs = 0;
                        uint64_t nowMs = GetTickCount64();
                        float sdt = lastMs ? (nowMs - lastMs) / 1000.0f : 0.016f;
                        lastMs = nowMs;
                        float a = 1.0f - expf(-sdt * 20.0f);
                        sRpm += (g_dash.rpm - sRpm) * a;
                        sThr += (g_dash.thr - sThr) * a;
                        sLoad += (g_dash.load - sLoad) * a;
                        sSpeed += (g_dash.speed - sSpeed) * a;
                        sWav += (g_dash.wav - sWav) * a;
                        sGrip += (g_dash.grip - sGrip) * a;
                        DashData d = g_dash;      // smoothed copy for drawing only
                        d.rpm = sRpm; d.thr = sThr; d.load = sLoad; d.speed = sSpeed;
                        d.wav = sWav; d.grip = sGrip;
                        DashData raw = g_dash;
                        g_dash = d;
                        gauges_draw();
                        g_dash = raw;
                    }
                    ImGui::Render();
                    g_ctx->OMSetRenderTargets(1, &g_rtv, nullptr);
                    ImGui_ImplDX11_RenderDrawData(ImGui::GetDrawData());
                }
            }
        }
    }
    return oPresent(sc, sync, flags);
}

static HRESULT STDMETHODCALLTYPE hkResizeBuffers(IDXGISwapChain* sc, UINT n, UINT w, UINT h, DXGI_FORMAT fmt, UINT flags) {
    if (g_rtv) { g_rtv->Release(); g_rtv = nullptr; }   // recreated lazily next Present
    return oResizeBuffers(sc, n, w, h, fmt, flags);
}

// Grab Present/ResizeBuffers addresses from a throwaway device+swapchain (same vtable as the
// game's, since it's the same D3D11/DXGI implementation — DXVK's under Proton).
static bool hookPresent() {
    WNDCLASSEXA wc = {sizeof(wc), CS_CLASSDC, DefWindowProcA, 0, 0, GetModuleHandleA(nullptr),
                      nullptr, nullptr, nullptr, nullptr, "srdt_dummy", nullptr};
    RegisterClassExA(&wc);
    HWND hw = CreateWindowExA(0, wc.lpszClassName, "d", WS_OVERLAPPED, 0, 0, 64, 64, nullptr, nullptr, wc.hInstance, nullptr);
    if (!hw) return false;

    DXGI_SWAP_CHAIN_DESC sd = {};
    sd.BufferCount = 1;
    sd.BufferDesc.Format = DXGI_FORMAT_R8G8B8A8_UNORM;
    sd.BufferUsage = DXGI_USAGE_RENDER_TARGET_OUTPUT;
    sd.OutputWindow = hw;
    sd.SampleDesc.Count = 1;
    sd.Windowed = TRUE;
    sd.SwapEffect = DXGI_SWAP_EFFECT_DISCARD;

    IDXGISwapChain* sc = nullptr;
    ID3D11Device* dev = nullptr;
    ID3D11DeviceContext* ctx = nullptr;
    D3D_FEATURE_LEVEL fl;
    HRESULT hr = D3D11CreateDeviceAndSwapChain(nullptr, D3D_DRIVER_TYPE_HARDWARE, nullptr, 0, nullptr, 0,
                                               D3D11_SDK_VERSION, &sd, &sc, &dev, &fl, &ctx);
    if (FAILED(hr) || !sc) {
        logf("overlay: dummy swapchain failed hr=0x%08lx", (unsigned long)hr);
        DestroyWindow(hw); UnregisterClassA(wc.lpszClassName, wc.hInstance);
        return false;
    }
    void** vt = *(void***)sc;
    void* pPresent = vt[8];
    void* pResize = vt[13];
    sc->Release(); ctx->Release(); dev->Release();
    DestroyWindow(hw); UnregisterClassA(wc.lpszClassName, wc.hInstance);

    if (MH_CreateHook(pPresent, (void*)hkPresent, (void**)&oPresent) != MH_OK ||
        MH_EnableHook(pPresent) != MH_OK) { logf("overlay: Present hook failed"); return false; }
    if (MH_CreateHook(pResize, (void*)hkResizeBuffers, (void**)&oResizeBuffers) != MH_OK ||
        MH_EnableHook(pResize) != MH_OK) { logf("overlay: ResizeBuffers hook failed (non-fatal)"); }
    logf("overlay: Present hooked @ %p", pPresent);
    return true;
}

void overlay_start() {
    // MinHook already initialized by hook_start(); tolerate either order anyway
    MH_STATUS s = MH_Initialize();
    if (s != MH_OK && s != MH_ERROR_ALREADY_INITIALIZED) { logf("overlay: MH init %d", (int)s); return; }
    if (!hookPresent()) logf("overlay: disabled");
}
