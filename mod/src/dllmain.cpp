#include <windows.h>
#include "log.h"
#include "mem.h"
#include "paths.h"

void hook_start();     // xhook.cpp
void overlay_start();  // overlay.cpp — in-game ImGui dashboard (Present hook)

static DWORD WINAPI initThread(LPVOID) {
    paths_init();
    log_init(g_logPath);
    logf("snowrunner-engine mod v0.2 loaded (build %s %s)", __DATE__, __TIME__);
    logf("features: xaudio=%d telemetry=%d overlay=%d", g_cfgXAudio, g_cfgTelemetry, g_cfgOverlay);
    if (g_cfgXAudio) { hook_start(); logf("initThread: hook_start returned"); }
    if (g_cfgOverlay) { overlay_start(); logf("initThread: overlay_start returned"); }
    if (g_cfgTelemetry) mem_start_telemetry();   // read-only drivetrain telemetry + wide recon dumps
    return 0;
}

BOOL WINAPI DllMain(HINSTANCE h, DWORD reason, LPVOID) {
    if (reason == DLL_PROCESS_ATTACH) {
        g_hSelf = h;
        DisableThreadLibraryCalls(h);
        CreateThread(nullptr, 0, initThread, nullptr, 0, nullptr);
    }
    return TRUE;
}
