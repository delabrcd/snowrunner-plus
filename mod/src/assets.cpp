// Runtime asset service — see assets.h. A self-contained STORED-only ZIP reader plus a
// minimal Saber .pct -> ID3D11Texture2D loader. No external deps (miniz etc.): the mod
// links fully static, and every HUD-skin texture we need is STORED (compression 0), so a
// ~150-line central-directory reader + memcpy is all it takes. DEFLATE entries are
// explicitly reported and refused rather than silently mis-decoded.

#include <windows.h>
#include <d3d11.h>
#include <cstdint>
#include <cstdio>
#include <cstring>
#include <string>
#include <unordered_map>
#include "assets.h"
#include "paths.h"
#include "log.h"

// ---------------- state ----------------
static ID3D11Device* g_adev = nullptr;
static char g_pakBase[MAX_PATH] = {0};   // resolved dir containing the .pak files ("" = disabled)

struct CachedTex {
    ID3D11ShaderResourceView* srv = nullptr;   // null = load was attempted and failed
    int w = 0, h = 0;
};
static std::unordered_map<std::string, CachedTex> g_cache;

// ---------------- tiny endian-safe readers ----------------
static uint16_t rd16(const uint8_t* p) { return (uint16_t)(p[0] | (p[1] << 8)); }
static uint32_t rd32(const uint8_t* p) {
    return (uint32_t)p[0] | ((uint32_t)p[1] << 8) | ((uint32_t)p[2] << 16) | ((uint32_t)p[3] << 24);
}

// ---------------- STORED-only ZIP entry reader ----------------
// Opens <pakPath>, locates <entry> in the central directory (names matched verbatim,
// backslashes and all), and returns a malloc'd copy of the STORED bytes. Caller frees.
// Returns null on any failure; *outLen receives the byte count on success.
static uint8_t* zipReadStored(const char* pakPath, const char* entry, uint32_t* outLen) {
    *outLen = 0;
    FILE* f = fopen(pakPath, "rb");
    if (!f) { logf("assets: cannot open pak %s", pakPath); return nullptr; }

    // locate End Of Central Directory (scan the tail for the PK\x05\x06 signature)
    fseek(f, 0, SEEK_END);
    long fsize = ftell(f);
    long tailLen = fsize < 65557 ? fsize : 65557;   // 64KB comment max + EOCD
    fseek(f, fsize - tailLen, SEEK_SET);
    uint8_t* tail = (uint8_t*)malloc(tailLen);
    if (!tail) { fclose(f); return nullptr; }
    if ((long)fread(tail, 1, tailLen, f) != tailLen) { free(tail); fclose(f); return nullptr; }
    long eocd = -1;
    for (long i = tailLen - 22; i >= 0; i--)
        if (tail[i] == 'P' && tail[i + 1] == 'K' && tail[i + 2] == 5 && tail[i + 3] == 6) { eocd = i; break; }
    if (eocd < 0) { logf("assets: no EOCD in %s", pakPath); free(tail); fclose(f); return nullptr; }
    uint32_t cdSize = rd32(tail + eocd + 12);
    uint32_t cdOff = rd32(tail + eocd + 16);
    free(tail);
    if (cdOff == 0xFFFFFFFFu) { logf("assets: %s is ZIP64 (unsupported)", pakPath); fclose(f); return nullptr; }

    // read the central directory into memory and walk it
    uint8_t* cd = (uint8_t*)malloc(cdSize);
    if (!cd) { fclose(f); return nullptr; }
    fseek(f, cdOff, SEEK_SET);
    if (fread(cd, 1, cdSize, f) != cdSize) { free(cd); fclose(f); return nullptr; }

    size_t entryLen = strlen(entry);
    uint8_t* result = nullptr;
    uint32_t p = 0;
    while (p + 46 <= cdSize) {
        if (!(cd[p] == 'P' && cd[p + 1] == 'K' && cd[p + 2] == 1 && cd[p + 3] == 2)) break;
        uint16_t method = rd16(cd + p + 10);
        uint32_t compSize = rd32(cd + p + 20);
        uint16_t nameLen = rd16(cd + p + 28);
        uint16_t extraLen = rd16(cd + p + 30);
        uint16_t commLen = rd16(cd + p + 32);
        uint32_t localOff = rd32(cd + p + 42);
        const char* name = (const char*)(cd + p + 46);
        if (nameLen == entryLen && memcmp(name, entry, entryLen) == 0) {
            if (method != 0) {   // all HUD-skin textures are STORED; DEFLATE => report, refuse
                logf("assets: entry %s is DEFLATE (method %u) — unsupported", entry, method);
                break;
            }
            // local header: recompute the data offset (its name/extra lengths can differ)
            uint8_t lh[30];
            fseek(f, localOff, SEEK_SET);
            if (fread(lh, 1, 30, f) == 30 && lh[0] == 'P' && lh[1] == 'K' && lh[2] == 3 && lh[3] == 4) {
                uint16_t lNameLen = rd16(lh + 26);
                uint16_t lExtraLen = rd16(lh + 28);
                long dataOff = (long)localOff + 30 + lNameLen + lExtraLen;
                uint8_t* buf = (uint8_t*)malloc(compSize);
                if (buf) {
                    fseek(f, dataOff, SEEK_SET);
                    if (fread(buf, 1, compSize, f) == compSize) { result = buf; *outLen = compSize; }
                    else free(buf);
                }
            }
            break;
        }
        p += 46 + nameLen + extraLen + commLen;
    }
    free(cd);
    fclose(f);
    return result;
}

// ---------------- .pct header parse + GPU upload ----------------
// Saber .pct container: magic 'TCIP' @6, u32 width @16, u32 height @20, u32 format @38.
// Pixel data = pct[header_len : filelen-6]; header_len = size of the sibling .pct_header
// entry (82 for these single-mip UI textures). Format 52/51 = BC7, 12 = BC1, 15 = BC2 —
// all block-compressed and GPU-native, so upload straight to an immutable texture.
static ID3D11ShaderResourceView* uploadPct(const uint8_t* pct, uint32_t len, uint32_t headerLen,
                                           const char* entry, int* outW, int* outH) {
    if (len < 48 || headerLen + 6 > len) { logf("assets: %s too small", entry); return nullptr; }
    if (memcmp(pct + 6, "TCIP", 4) != 0) { logf("assets: %s bad magic", entry); return nullptr; }
    uint32_t w = rd32(pct + 16), h = rd32(pct + 20), fmt = rd32(pct + 38);

    DXGI_FORMAT dxfmt;
    uint32_t blockBytes;
    switch (fmt) {
        case 52: case 51: dxfmt = DXGI_FORMAT_BC7_UNORM; blockBytes = 16; break;
        case 12:          dxfmt = DXGI_FORMAT_BC1_UNORM; blockBytes = 8;  break;
        case 15:          dxfmt = DXGI_FORMAT_BC2_UNORM; blockBytes = 16; break;
        default: logf("assets: %s unsupported format code %u", entry, fmt); return nullptr;
    }
    if (w == 0 || h == 0 || (w & 3) || (h & 3)) { logf("assets: %s bad dims %ux%u", entry, w, h); return nullptr; }

    const uint8_t* pix = pct + headerLen;
    uint32_t pixLen = len - headerLen - 6;
    uint32_t expect = (w / 4) * (h / 4) * blockBytes;
    if (pixLen < expect) { logf("assets: %s short pixel data (%u < %u)", entry, pixLen, expect); return nullptr; }
    uint32_t pitch = (w / 4) * blockBytes;

    D3D11_TEXTURE2D_DESC td = {};
    td.Width = w; td.Height = h; td.MipLevels = 1; td.ArraySize = 1;
    td.Format = dxfmt; td.SampleDesc.Count = 1;
    td.Usage = D3D11_USAGE_IMMUTABLE; td.BindFlags = D3D11_BIND_SHADER_RESOURCE;
    D3D11_SUBRESOURCE_DATA init = {}; init.pSysMem = pix; init.SysMemPitch = pitch;

    ID3D11Texture2D* tex = nullptr;
    if (FAILED(g_adev->CreateTexture2D(&td, &init, &tex)) || !tex) {
        logf("assets: %s CreateTexture2D failed (%ux%u fmt=%u)", entry, w, h, fmt);
        return nullptr;
    }
    D3D11_SHADER_RESOURCE_VIEW_DESC sd = {};
    sd.Format = dxfmt; sd.ViewDimension = D3D11_SRV_DIMENSION_TEXTURE2D; sd.Texture2D.MipLevels = 1;
    ID3D11ShaderResourceView* srv = nullptr;
    HRESULT hr = g_adev->CreateShaderResourceView(tex, &sd, &srv);
    tex->Release();   // the SRV holds its own reference
    if (FAILED(hr) || !srv) { logf("assets: %s CreateSRV failed", entry); return nullptr; }

    if (outW) *outW = (int)w;
    if (outH) *outH = (int)h;
    logf("assets: loaded %s (%ux%u fmt=%u)", entry, w, h, fmt);
    return srv;
}

// ---------------- install / pak discovery ----------------
static bool fileExists(const char* path) {
    FILE* f = fopen(path, "rb");
    if (f) { fclose(f); return true; }
    return false;
}

// Resolve the dir holding the .pak files: honour pak_dir= first, else walk up from the
// game exe looking for preload\paks\client\gfx.pak (exe is <root>\Sources\Bin\SnowRunner.exe).
static bool discoverPakDir(char* out) {
    char probe[MAX_PATH];
    if (g_pakDir[0]) {
        snprintf(probe, MAX_PATH, "%s\\gfx.pak", g_pakDir);
        if (fileExists(probe)) { snprintf(out, MAX_PATH, "%s", g_pakDir); return true; }
        logf("assets: pak_dir=%s has no gfx.pak — falling back to auto-discover", g_pakDir);
    }
    char dir[MAX_PATH];
    if (!GetModuleFileNameA(nullptr, dir, MAX_PATH)) return false;
    char* s = strrchr(dir, '\\');
    if (s) *s = 0;   // strip exe name -> exe dir
    for (int up = 0; up < 6; up++) {
        snprintf(probe, MAX_PATH, "%s\\preload\\paks\\client\\gfx.pak", dir);
        if (fileExists(probe)) {
            snprintf(out, MAX_PATH, "%s\\preload\\paks\\client", dir);
            return true;
        }
        char* p = strrchr(dir, '\\');
        if (!p) break;
        *p = 0;   // ascend one directory
    }
    return false;
}

// ---------------- public API ----------------
void assets_init(ID3D11Device* dev) {
    g_adev = dev;
    if (!dev) { logf("assets: no D3D device — asset service disabled"); return; }
    if (discoverPakDir(g_pakBase)) logf("assets: paks at %s", g_pakBase);
    else { g_pakBase[0] = 0; logf("assets: paks not found — HUD skinning disabled (vector fallback)"); }
}

void assets_shutdown() {
    for (auto& kv : g_cache)
        if (kv.second.srv) kv.second.srv->Release();
    g_cache.clear();
    g_adev = nullptr;
}

ImTextureID assets_load_pct(const char* pakName, const char* entry, int* outW, int* outH) {
    if (outW) *outW = 0;
    if (outH) *outH = 0;
    if (!g_adev) return 0;

    std::string key = std::string(pakName) + ":" + entry;
    auto it = g_cache.find(key);
    if (it != g_cache.end()) {   // cached (including remembered failures)
        if (outW) *outW = it->second.w;
        if (outH) *outH = it->second.h;
        return (ImTextureID)it->second.srv;
    }

    CachedTex ct;   // default = failure; stored either way so we never retry the disk
    if (g_pakBase[0]) {
        char pakPath[MAX_PATH];
        snprintf(pakPath, MAX_PATH, "%s\\%s", g_pakBase, pakName);
        char hdrEntry[512];
        snprintf(hdrEntry, sizeof(hdrEntry), "%s_header", entry);

        uint32_t hlen = 0;
        uint8_t* hbuf = zipReadStored(pakPath, hdrEntry, &hlen);   // .pct_header: length is the header size
        if (hbuf) {
            free(hbuf);
            uint32_t plen = 0;
            uint8_t* pbuf = zipReadStored(pakPath, entry, &plen);
            if (pbuf) {
                ct.srv = uploadPct(pbuf, plen, hlen, entry, &ct.w, &ct.h);
                free(pbuf);
            }
        }
    }

    g_cache[key] = ct;
    if (outW) *outW = ct.w;
    if (outH) *outH = ct.h;
    return (ImTextureID)ct.srv;
}
