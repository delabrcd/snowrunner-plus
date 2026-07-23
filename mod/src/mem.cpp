// Read-only drivetrain telemetry + memory explorer.
// - Resolves the TRUCK_CONTROL singleton via the SMT AOB anchor (attribution: drafty46/SMT,
//   Ferrster — MIT). No game-code hooks (those crashed before); pure reads.
// - Every deref goes through ReadProcessMemory on our own process, which RETURNS FALSE on a
//   bad pointer instead of faulting -> crash-proof even if an offset/resolve is wrong.
// - Beyond the few fields the sim needs, it dumps WIDE regions (TruckAction, Havok bodies,
//   wheels) so we can survey what data exists for a future driving-physics overhaul.
#include <windows.h>
#include <cstdint>
#include <cmath>
#include "mem.h"
#include "log.h"

// ---- safe reads ----------------------------------------------------------------------
static inline bool rd(const void* addr, void* out, size_t n) {
    SIZE_T got = 0;
    return addr && ReadProcessMemory(GetCurrentProcess(), addr, out, n, &got) && got == n;
}
static inline void* rdptr(const void* a) { void* p = nullptr; return rd(a, &p, 8) ? p : nullptr; }
static inline int   rdi32(const void* a) { int v = 0;   rd(a, &v, 4); return v; }
static inline float rdf32(const void* a) { float v = 0; rd(a, &v, 4); return v; }
static inline uint8_t* AT(void* base, size_t off) { return (uint8_t*)base + off; }

// ---- offsets (from docs/prior-art.md; +0x68 TruckAction confirmed by SetPowerCoef AOB) ---
static const size_t OFF_TRUCKACTION = 0x68;   // vehicle -> combineTruckAction*
static const size_t TA_POWERCOEF    = 0x38;   // float
static const size_t TA_ISAUTO       = 0x3C;   // bool
static const size_t TA_ACCEL        = 0x44;   // float (throttle input)
static const size_t TA_GEAR         = 0x70;   // int32 (-1=R,0=N,1..)
static const size_t TA_GEAR2        = 0x74;   // int32
static const size_t OFF_CHASSISBODY = 0x5D0;  // vehicle -> hkpRigidBody* (current build; live-validated)
static const size_t HK_LINVEL       = 0x230;  // float x,y,z (stable across builds)
static const size_t HK_ANGVEL       = 0x240;  // float pitch,yaw,roll
static const size_t OFF_WHEELVEC    = 0x200;  // vehicle -> std::vector<TRUCK_WHEEL_MODEL*> (current build)

// ---- resolved global ----
static void* g_globalAddr = nullptr;   // address of the TRUCK_CONTROL pointer variable
static const char* ANCHOR = "40 53 48 83 EC 20 48 8B D9 E8 ?? ?? ?? ?? 33 C9 48 89 18";

// ---- AOB scan over the main module image ----
static bool parse_pat(const char* s, uint8_t* pat, uint8_t* msk, int* len) {
    int n = 0;
    for (const char* p = s; *p; ) {
        if (*p == ' ') { p++; continue; }
        if (*p == '?') { pat[n] = 0; msk[n] = 0; n++; p++; if (*p == '?') p++; continue; }
        auto hex = [](char c)->int { if (c>='0'&&c<='9') return c-'0'; c|=32; if (c>='a'&&c<='f') return c-'a'+10; return -1; };
        int hi = hex(p[0]), lo = hex(p[1]); if (hi<0||lo<0) return false;
        pat[n] = (uint8_t)(hi*16+lo); msk[n] = 1; n++; p += 2;
    }
    *len = n; return true;
}

static uint8_t* scan(uint8_t* base, size_t size, const char* patStr) {
    uint8_t pat[256], msk[256]; int len = 0;
    if (!parse_pat(patStr, pat, msk, &len) || len == 0) return nullptr;
    for (size_t i = 0; i + len <= size; i++) {
        bool ok = true;
        for (int j = 0; j < len; j++) if (msk[j] && base[i+j] != pat[j]) { ok = false; break; }
        if (ok) return base + i;
    }
    return nullptr;
}

static bool module_range(uint8_t** base, size_t* size) {
    HMODULE h = GetModuleHandleA(nullptr);
    if (!h) return false;
    auto dos = (IMAGE_DOS_HEADER*)h;
    auto nt = (IMAGE_NT_HEADERS*)((uint8_t*)h + dos->e_lfanew);
    if (nt->Signature != IMAGE_NT_SIGNATURE) return false;
    *base = (uint8_t*)h;
    *size = nt->OptionalHeader.SizeOfImage;
    return true;
}

void mem_init() {
    uint8_t* base; size_t size;
    if (!module_range(&base, &size)) { logf("mem: no module range"); return; }
    logf("mem: scanning %s image base=%p size=0x%zx for TRUCK_CONTROL anchor", "SnowRunner.exe", base, size);
    uint8_t* a = scan(base, size, ANCHOR);
    if (!a) { logf("mem: TRUCK_CONTROL anchor NOT found (offsets may have shifted) -> telemetry disabled"); return; }
    // anchor: ... E8 rel32 (call) at a+9 ; resolve callee, find lea rax,[rip+disp] -> &global
    int32_t rel = 0; rd(a + 10, &rel, 4);
    uint8_t* callee = a + 14 + rel;
    logf("mem: anchor @ %p  callee @ %p", (void*)a, (void*)callee);
    // scan the callee prologue for  48 8D 05 xx xx xx xx  (lea rax,[rip+disp])
    for (int k = 0; k < 48; k++) {
        if (callee[k] == 0x48 && callee[k+1] == 0x8D && callee[k+2] == 0x05) {
            int32_t disp = 0; rd(callee + k + 3, &disp, 4);
            g_globalAddr = callee + k + 7 + disp;
            logf("mem: resolved &TRUCK_CONTROL global @ %p (lea at callee+0x%x)", g_globalAddr, k);
            break;
        }
    }
    if (!g_globalAddr) logf("mem: could not resolve global from callee (no lea rax found)");
}

// current vehicle pointer via the resolved global: [global] -> control, control+0x8 -> vehicle
static void* current_vehicle() {
    if (!g_globalAddr) return nullptr;
    void* control = rdptr(g_globalAddr);
    if (!control) return nullptr;
    return rdptr(AT(control, 0x08));
}

bool mem_read(DrivetrainState* out) {
    *out = DrivetrainState{};
    void* veh = current_vehicle();
    if (!veh) return false;
    void* ta = rdptr(AT(veh, OFF_TRUCKACTION));
    if (!ta) return false;
    out->gear     = rdi32(AT(ta, TA_GEAR));
    out->throttle = rdf32(AT(ta, TA_POWERCOEF));
    out->accel    = rdf32(AT(ta, TA_ACCEL));
    void* body = rdptr(AT(veh, OFF_CHASSISBODY));
    if (body) {
        float vx = rdf32(AT(body, HK_LINVEL + 0));
        float vz = rdf32(AT(body, HK_LINVEL + 8));
        out->speed = std::sqrt(vx*vx + vz*vz);
    }
    out->valid = true;
    return true;
}

// ---- WIDE recon dump: survey what data exists (for the physics-overhaul question) -------
void mem_dump() {
    void* veh = current_vehicle();
    if (!veh) { logf("DUMP: no current vehicle"); return; }
    logf("==== DUMP vehicle=%p ====", veh);

    void* ta = rdptr(AT(veh, OFF_TRUCKACTION));
    logf("  TruckAction=%p", ta);
    if (ta) {
        // interpret TruckAction 0x30..0xF0 as float AND int to spot RPM/torque/load fields
        for (size_t o = 0x30; o <= 0xF0; o += 4) {
            float f = rdf32(AT(ta, o)); int i = rdi32(AT(ta, o));
            if (f != 0.0f || i != 0)
                logf("    TA+0x%03zx  f=%-12.4f i=%d", o, f, i);
        }
    }
    // Havok chassis body: linear + angular velocity (angular = body spin, a wheel-spin proxy)
    void* body = rdptr(AT(veh, OFF_CHASSISBODY));
    logf("  chassisBody=%p", body);
    if (body) {
        logf("    linVel=(%.3f, %.3f, %.3f)", rdf32(AT(body,HK_LINVEL)), rdf32(AT(body,HK_LINVEL+4)), rdf32(AT(body,HK_LINVEL+8)));
        logf("    angVel=(%.3f, %.3f, %.3f)", rdf32(AT(body,HK_ANGVEL)), rdf32(AT(body,HK_ANGVEL+4)), rdf32(AT(body,HK_ANGVEL+8)));
    }
    // wheel vector (std::vector<TRUCK_WHEEL_MODEL*> = {begin,end,cap})
    void* wbegin = rdptr(AT(veh, OFF_WHEELVEC));
    void* wend   = rdptr(AT(veh, OFF_WHEELVEC + 8));
    if (wbegin && wend && wend > wbegin) {
        size_t cnt = ((uint8_t*)wend - (uint8_t*)wbegin) / 8;
        logf("  wheels: %zu (vec %p..%p)", cnt, wbegin, wend);
        if (cnt > 32) cnt = 32;
        for (size_t w = 0; w < cnt && w < 2; w++) {   // dump first 2 wheels wide to hunt angvel
            void* wheel = rdptr(AT(wbegin, w * 8));
            logf("    wheel[%zu]=%p", w, wheel);
            if (wheel) for (size_t o = 0x00; o <= 0xC0; o += 4) {
                float f = rdf32(AT(wheel, o));
                if (f != 0.0f && std::fabs(f) < 1e6f) logf("      w%zu+0x%03zx f=%.4f", w, o, f);
            }
        }
    }
}

// ---- pattern-based explorer: find velocity/wheel offsets independent of version drift ----
// Run while the truck is MOVING or its wheels are SPINNING so velocities are nonzero.
void mem_explore() {
    void* veh = current_vehicle();
    if (!veh) { logf("EXPLORE: no vehicle"); return; }
    logf("==== EXPLORE vehicle=%p ====", veh);

    // (1) std::vector<T*> candidates: 3 consecutive ptrs {begin,end,cap}, begin<=end<=cap,
    //     span a small multiple of 8, first element itself a readable pointer -> wheel/addon vec.
    for (size_t o = 0x40; o <= 0xA00; o += 8) {
        void* b = rdptr(AT(veh, o)); void* e = rdptr(AT(veh, o + 8)); void* c = rdptr(AT(veh, o + 16));
        if (!b || !e || !c || e < b || c < e) continue;
        uintptr_t span = (uint8_t*)e - (uint8_t*)b;
        if (span == 0 || span > 8 * 40 || (span % 8)) continue;
        void* el0 = rdptr(b);
        if (el0) logf("  VEC @+0x%03zx  count=%zu begin=%p el0=%p", o, (size_t)(span / 8), b, el0);
    }
    // (2) Havok-body candidates: a pointer field whose +0x230 (linVel) or +0x240 (angVel)
    //     holds a plausible nonzero float triple -> chassis/wheel rigid body.
    for (size_t o = 0x40; o <= 0xA00; o += 8) {
        void* p = rdptr(AT(veh, o));
        if (!p) continue;
        float lx, ly, lz, ax, ay, az;
        bool lv = rd(AT(p, 0x230), &lx, 4) && rd(AT(p, 0x234), &ly, 4) && rd(AT(p, 0x238), &lz, 4);
        bool av = rd(AT(p, 0x240), &ax, 4) && rd(AT(p, 0x244), &ay, 4) && rd(AT(p, 0x248), &az, 4);
        if (!lv) continue;
        float lmag = std::sqrt(lx*lx + ly*ly + lz*lz);
        float amag = av ? std::sqrt(ax*ax + ay*ay + az*az) : 0;
        if ((lmag > 0.05f && lmag < 300.f) || (amag > 0.2f && amag < 500.f))
            logf("  BODY? @+0x%03zx ptr=%p lin=(%.2f,%.2f,%.2f)|%.2f ang=(%.2f,%.2f,%.2f)|%.2f",
                 o, p, lx, ly, lz, lmag, ax, ay, az, amag);
    }
}

// ---- background telemetry thread ----
static DWORD WINAPI telemetry_thread(LPVOID) {
    int tick = 0;
    for (;;) {
        DrivetrainState s;
        if (mem_read(&s))
            logf("TELEM t=%d gear=%d throttle=%.2f accel=%.2f speed=%.3f", tick, s.gear, s.throttle, s.accel, s.speed);
        if ((tick % 4) == 0) { mem_dump(); mem_explore(); }   // wide recon every ~4s
        tick++;
        Sleep(1000);
    }
    return 0;
}
void mem_start_telemetry() { CreateThread(nullptr, 0, telemetry_thread, nullptr, 0, nullptr); }
