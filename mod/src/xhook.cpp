// XAudio2 hook chain: XAudio2Create -> IXAudio2::CreateSourceVoice (vtbl[5]) ->
// IXAudio2SourceVoice::SetFrequencyRatio (vtbl[26], shared function, hooked once).
// Phase 2: identity pass-through + sampled logging. Later phases override the ratio from
// the engine RPM/load simulation.
#include <windows.h>
#include <xaudio2.h>
#include "MinHook.h"
#include "log.h"
#include "mem.h"

// vtable indices (verified in docs/reference/xaudio2-vtables.md)
static const int VT_CREATE_SOURCE_VOICE = 5;   // IXAudio2
static const int VT_SET_FREQUENCY_RATIO = 26;  // IXAudio2SourceVoice

typedef HRESULT (WINAPI* XAudio2Create_t)(IXAudio2**, UINT32, XAUDIO2_PROCESSOR);
typedef HRESULT (WINAPI* CreateSourceVoice_t)(IXAudio2*, IXAudio2SourceVoice**,
        const WAVEFORMATEX*, UINT32, float, IXAudio2VoiceCallback*,
        const XAUDIO2_VOICE_SENDS*, const XAUDIO2_EFFECT_CHAIN*);
typedef void (WINAPI* SetFrequencyRatio_t)(IXAudio2SourceVoice*, float, UINT32);

static XAudio2Create_t     oXAudio2Create     = nullptr;
static CreateSourceVoice_t oCreateSourceVoice = nullptr;
static SetFrequencyRatio_t oSetFreq           = nullptr;
static volatile LONG       g_freqHooked       = 0;

static inline void** vtable_of(void* obj) { return *reinterpret_cast<void***>(obj); }

// --- SetFrequencyRatio: identity + sampled log (the future override point) ---
static void WINAPI hSetFreq(IXAudio2SourceVoice* self, float ratio, UINT32 op) {
    static LONG n = 0;
    if ((InterlockedIncrement(&n) % 300) == 0)
        logf("SetFrequencyRatio self=%p ratio=%.4f", (void*)self, ratio);
    oSetFreq(self, ratio, op);   // pass-through for now
}

// --- CreateSourceVoice: capture a voice, hook the shared SetFrequencyRatio once ---
static HRESULT WINAPI hCreateSourceVoice(IXAudio2* self, IXAudio2SourceVoice** ppv,
        const WAVEFORMATEX* fmt, UINT32 flags, float maxfr, IXAudio2VoiceCallback* cb,
        const XAUDIO2_VOICE_SENDS* sends, const XAUDIO2_EFFECT_CHAIN* fx) {
    HRESULT hr = oCreateSourceVoice(self, ppv, fmt, flags, maxfr, cb, sends, fx);
    if (SUCCEEDED(hr) && ppv && *ppv &&
        InterlockedCompareExchange(&g_freqHooked, 1, 0) == 0) {
        void* pSet = vtable_of(*ppv)[VT_SET_FREQUENCY_RATIO];
        if (MH_CreateHook(pSet, (void*)hSetFreq, (void**)&oSetFreq) == MH_OK &&
            MH_EnableHook(pSet) == MH_OK) {
            logf("hooked SetFrequencyRatio @ %p (via voice %p)", pSet, (void*)*ppv);
        } else {
            logf("FAILED to hook SetFrequencyRatio @ %p", pSet);
            g_freqHooked = 0;
        }
    }
    return hr;
}

// --- XAudio2Create: get IXAudio2, hook its CreateSourceVoice ---
static HRESULT WINAPI hXAudio2Create(IXAudio2** pp, UINT32 flags, XAUDIO2_PROCESSOR proc) {
    HRESULT hr = oXAudio2Create(pp, flags, proc);
    logf("XAudio2Create -> hr=0x%lx inst=%p", (unsigned long)hr, pp ? (void*)*pp : nullptr);
    if (SUCCEEDED(hr) && pp && *pp) {
        void* pCSV = vtable_of(*pp)[VT_CREATE_SOURCE_VOICE];
        if (MH_CreateHook(pCSV, (void*)hCreateSourceVoice, (void**)&oCreateSourceVoice) == MH_OK &&
            MH_EnableHook(pCSV) == MH_OK)
            logf("hooked CreateSourceVoice @ %p", pCSV);
        else
            logf("FAILED to hook CreateSourceVoice @ %p", pCSV);
    }
    return hr;
}

// Entry from the init thread. Waits for xaudio2_9redist, hooks XAudio2Create.
void hook_start() {
    logf("hook_start: begin");
    MH_STATUS s = MH_Initialize();
    logf("hook_start: MH_Initialize = %d", (int)s);
    if (s != MH_OK && s != MH_ERROR_ALREADY_INITIALIZED) { logf("MH_Initialize failed"); return; }
    mem_init();  // resolve TRUCK_CONTROL anchor (read-only)
    logf("hook_start: polling for xaudio2_9redist.dll ...");
    HMODULE m = nullptr;
    for (int i = 0; i < 600 && !m; i++) { m = GetModuleHandleA("xaudio2_9redist.dll"); if (!m) Sleep(100); }
    logf("hook_start: module handle = %p", (void*)m);
    if (!m) { logf("xaudio2_9redist.dll never loaded"); return; }
    void* p = (void*)GetProcAddress(m, "XAudio2Create");
    logf("hook_start: XAudio2Create addr = %p", p);
    if (!p) { logf("XAudio2Create export not found"); return; }
    if (MH_CreateHook(p, (void*)hXAudio2Create, (void**)&oXAudio2Create) == MH_OK &&
        MH_EnableHook(p) == MH_OK)
        logf("hooked XAudio2Create @ %p", p);
    else
        logf("FAILED to hook XAudio2Create @ %p", p);
}
