#pragma once
#include <cstdio>
#include <cstdarg>
#include <windows.h>

// Minimal thread-safe file logger. Writes to a fixed Z: path so it lands in the repo.
// NB: `inline` (not `static`) so all translation units SHARE one g_log — with `static` each
// .cpp gets its own copy, so log_init() in one TU wouldn't enable logging in another.
inline FILE* g_log = nullptr;
inline CRITICAL_SECTION g_logcs;
inline bool g_logcs_init = false;

inline void log_init(const char* path) {
    if (!g_logcs_init) { InitializeCriticalSection(&g_logcs); g_logcs_init = true; }
    g_log = fopen(path, "w");
}

inline void logf(const char* fmt, ...) {
    if (!g_log) return;
    EnterCriticalSection(&g_logcs);
    va_list a; va_start(a, fmt);
    vfprintf(g_log, fmt, a);
    va_end(a);
    fputc('\n', g_log);
    fflush(g_log);
    LeaveCriticalSection(&g_logcs);
}
