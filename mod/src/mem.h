// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.
#pragma once

// Live drivetrain state, read read-only from game memory. All fields best-effort.
struct DrivetrainState {
    bool  valid;      // vehicle pointer chain resolved this read
    int   gear;       // -1=R, 0=N, 1..n
    float throttle;   // PowerCoef (TruckAction+0x38)
    float accel;      // Accel input (TruckAction+0x44)
    float speed;      // chassis linear speed (Havok), m/s-ish
};

// Resolve the TRUCK_CONTROL global via the SMT AOB anchor (read-only). Safe to call once.
void mem_init();
// Fill `out` from the current vehicle. Returns out->valid. Never faults (ReadProcessMemory).
bool mem_read(DrivetrainState* out);
// Wide read-only recon dump (TruckAction / Havok / wheels) to the log.
void mem_dump();
// Pattern-based explorer: find velocity/wheel offsets by structure (version-robust).
void mem_explore();
// Background thread: compact TELEM line every ~1s + wide dump every ~5s.
void mem_start_telemetry();
