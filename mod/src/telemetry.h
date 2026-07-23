// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.
#pragma once
#include <cstdint>

// Shared-memory telemetry block: named mapping "Local\\srdt_telemetry", written by the
// dev harness (tools/dev/src/60-shm.js) at ~30Hz, read lock-free by the overlay every
// frame. Same-process today (Frida gadget + ASI both live in SnowRunner.exe) but the
// named mapping also works cross-process for free (external dashboards, capture tools).
//
// Concurrency: seqlock. 'seq' is incremented to ODD before the writer touches the
// payload and to EVEN after; readers snapshot, then retry if seq was odd or changed.
//
// LAYOUT IS ABI — tools/dev/src/60-shm.js writes these exact byte offsets. Any change
// here must bump SRDT_LAYOUT_V and update that file in the same commit.
static const uint32_t SRDT_MAGIC = 0x54445253;   // 'SRDT'
static const uint32_t SRDT_LAYOUT_V = 2;

#pragma pack(push, 4)
struct SrdtTelemetry {
    uint32_t magic;          // +0   SRDT_MAGIC
    uint32_t layoutVersion;  // +4   SRDT_LAYOUT_V
    uint32_t seq;            // +8   seqlock counter (odd = writer mid-update)
    int32_t  gear;           // +12  -1 = R, 0 = N, 1..n
    float    rpm;            // +16  synthesized engine RPM, 0..~1.15 (1.0 = redline)
    float    load;           // +20  engine load 0..1
    float    thr;            // +24  throttle input 0..1
    float    speed;          // +28  ground speed m/s
    float    upThr;          // +32  auto-box upshift point (0 unless box = ours)
    float    dnThr;          // +36  auto-box downshift point (0 unless box = ours)
    float    rpmGrip;        // +40  wheelspin-immune RPM (ground-speed based)
    float    redlineMps;     // +44  static redline ground speed for current gear
    float    wav;            // +48  tire angular velocity rad/s (Havok, spinning-wheel cluster mean)
    uint32_t flags;          // +52  bit0 engineOn, bit1 box=ours, bit2 box=manual, bit3 clutch held,
                             //      bit4 in-truck, bit5 player-selected neutral
    uint32_t voices;         // +56  engine voices under audio takeover
    int32_t  capCount;       // +60  valid entries in caps[]
    float    caps[12];       // +64  gearbox AngVel caps [reverse, g1..gN]
    int32_t  gearMax;        // +112 top forward gear (capCount-1); 0 = unknown
    uint32_t gearFlags;      // +116 special gears present: bit0 high, bit1 low, bit2 low+, bit3 low- (0 until mapped)
    int32_t  gameGear;       // +120 ACTUAL current gear (the 'gear' field carries the SELECTION while clutched)
    float    rpmIdle;        // +124 idle floor incl. idle-hunt wobble (display aid)
};                           // = 128 bytes
#pragma pack(pop)

// ---- reverse channel: overlay -> harness, at +SRDT_CFG_OFF in the same mapping ----
// The C++ config UI owns this block; the JS harness polls it (hotkeys apply live, and the
// config-open flag suppresses shifter keys while the user is rebinding).
static const uint32_t SRDT_CFG_OFF = 2048;
static const uint32_t SRDC_MAGIC = 0x43445253;   // 'SRDC'
static const uint32_t SRDC_LAYOUT_V = 2;

// Gearbox actions, indexed into SrdtOverlayCfg::binds. Two bindings per action.
// NOTE: AWD/DIFF/HANDBRAKE + SRDC v3 are designed (docs/input-framework-design.md) but NOT
// yet applied here — the contract bump lands atomically with the C++ input service + the JS
// v3 reader, so the live v2 harness and the overlay stay in lockstep until then.
enum SrdtAction : uint32_t {
    SRDT_ACT_SHIFT_UP = 0, SRDT_ACT_SHIFT_DOWN, SRDT_ACT_MODE_CYCLE, SRDT_ACT_CLUTCH,
    SRDT_ACT_NEUTRAL, SRDT_ACT_GEAR_LOW, SRDT_ACT_GEAR_HIGH, SRDT_ACT_RESERVED,
    SRDT_ACT_COUNT
};
// One binding word: (type << 16) | code. type: 0 = unbound, 1 = keyboard VK code,
// 2 = XInput button (code = bit index into XINPUT_GAMEPAD::wButtons, 0..15).
static inline uint32_t srdtBind(uint16_t type, uint16_t code) { return ((uint32_t)type << 16) | code; }

// modePolicy (flags bits 4-5): 0 = hot-swap via MODE_CYCLE bind, 1 = forced ours-auto,
// 2 = forced manual, 3 = forced stock-auto.
#pragma pack(push, 4)
struct SrdtOverlayCfg {
    uint32_t magic;          // +0   SRDC_MAGIC
    uint32_t layoutVersion;  // +4   SRDC_LAYOUT_V
    uint32_t seq;            // +8   bumped on every change
    uint32_t flags;          // +12  bit0 config UI open; bits 4-5 modePolicy
    uint32_t binds[SRDT_ACT_COUNT][2];   // +16 .. +80  (0 = unbound; see srdtBind)
};
#pragma pack(pop)
