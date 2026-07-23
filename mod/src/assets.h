// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.
#pragma once
#include "imgui.h"   // ImTextureID

// -----------------------------------------------------------------------------
// Runtime asset service — mod-agnostic.
//
// Loads textures from the player's OWN game paks at runtime; the mod ships no game
// assets. This is written as a generic pak+texture loader (no drivetrain / gear
// assumptions) so it can be lifted verbatim into the future SnowRunner+ platform's
// "asset service". Callers name a pak + a ZIP entry; the specific texture choices
// (which atlas, which sub-rect) live in the caller, not here.
//
// Degrades gracefully: if the paks can't be found (or the device is null, or an
// entry/format is unsupported) every load returns 0 and the caller falls back to its
// own rendering. Nothing here ever throws or crashes; each failure logs one line.
// -----------------------------------------------------------------------------

struct ID3D11Device;

// Call once after the game's D3D11 device is available (e.g. just after
// ImGui_ImplDX11_Init). Discovers <install>\preload\paks\client relative to the game
// exe, honouring an optional `pak_dir=` ini override (paths.h). `dev` may be null ->
// the service stays disabled and every load returns 0.
void assets_init(ID3D11Device* dev);

// Release every cached texture and drop the device reference. Must run BEFORE the
// D3D11 device is released. Safe to call when nothing was ever loaded.
void assets_shutdown();

// Load a Saber `.pct` texture from <pakName> (e.g. "gfx.pak") at ZIP entry <entry>
// (backslash-separated, matched verbatim, e.g. "[textures]\\ui\\flash_auto\\hud_lib_i7.pct").
// Returns an ImTextureID (an ID3D11ShaderResourceView*) ready for ImDrawList::AddImage,
// or 0 on ANY failure. Results — including failures — are cached by "pak:entry", so
// repeated per-frame calls are cheap and never re-hit the filesystem. `outW`/`outH`,
// when non-null, receive the texture's pixel dimensions (0 on failure) for UV math.
ImTextureID assets_load_pct(const char* pakName, const char* entry, int* outW = nullptr, int* outH = nullptr);
