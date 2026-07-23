# Asset & HUD System

How SnowRunner's pak/asset pipeline and its Scaleform (GFx/Flash) HUD work, as
reverse-engineered. This backs the [[SnowRunner+|SnowRunner-Plus]] framework's **asset
service** and the [[Overlay|Feature-Overlay]]'s stock-widget occlusion (so our tach/gear
widget can replace the game's without visual mismatch). See also [[Game Model|Game-Model]]
and [[Ghidra Functions|Ghidra-Functions]].

- **Static-RE binary:** `reference/snowrunner-fixed.bin` (file-offset == RVA).
- **Image base in the DB:** `0x6ffffa670000` → `rva = ghidra_VA − 0xa670000`. Every RVA below
  is directly the module RVA at runtime (`GetModuleHandle("SnowRunner.exe") + RVA`).
- Every AOB was verified to match **exactly once** in the 48 MB image.
- Confidence: ✅ live-validated · 🟢 high (decompiled) · 🟡 medium · 🔴 open/unknown.

## Pak & asset structure 🟢

Paks live in `preload/paks/client/*.pak`. All are **plain ZIP**; entry paths use `\`
separators, so match names verbatim (path handling is separator-agnostic). Compression:
`gfx.pak` / `boot.pak` are almost entirely **STORED** (reads ≈ memcpy); `editor.pak` /
`shared_textures.pak` mix DEFLATE + STORED (miniz handles both).

The 2D UI is **Scaleform GFx (Flash)**:

- `gfx.pak : [gfx]\gfxbundle.gfxbundle` (55 MB) — a Saber **`S3DB`** bundle of 112 named
  `.gfx` movies (uncompressed GFx-SWF, magic `GFX`, SWF v10). Layout: `'S3DB' + 16-byte
  prelude`; at offset 20 a table of 112 `u32 len + name` strings; then 1 byte; then 112 `u32`
  sizes; then the file blobs concatenated in name order (data starts at 2680). Key movies:
  `hud_lib.gfx`, `in_game.gfx`, `minimap.gfx`, `navigation_legend.gfx`, `gamepad_icons.gfx`,
  `icons_lib.gfx`, `common_lib.gfx`, `ui_root.gfx`, `font_en.gfx` (+jp/kr/sc/tc),
  `region_map.gfx`, `truck_attach_points.gfx`.
- Movie bitmaps were exported at build time as **external textures**:
  `gfx.pak : [textures]\ui\flash_auto\<movie>_i<hexid>.pct` (706 textures + 706 `.pct_header`).
  GFx `DefineExternalImage2` (tag 1009) records reference them by `<name>.tga`.
  `[ps]\_\ui_textures.mml_cfg` is a JSON load-on-demand manifest.
- A second, simpler texture family for 3D/world-space sprites:
  `boot.pak : [textures]\pct\gui_*.pct` — and `editor.pak : [textures]\dds\` holds
  **plain-DDS twins** of every one of these (13,263 dds), the easiest extraction source.

### `.pct` format (Saber texture container) 🟢

- `.pct_header` zip entry = byte-for-byte copy of the `.pct` header; its size = where pixel
  data starts (82 bytes for all flash_auto UI textures; 130–170 for mipped).
- Header: magic **`TCIP`** @ offset 6; `u32 width` @16, `u32 height` @20; format code `u32`
  @38 (12=DXT1, 15=DXT3, 0/22=uncompressed, **51/52=BC7** in current builds); mip count `u32`
  @48 (82-byte headers always 1 for UI).
- Pixel data = `pct[header_len : file_len − 6]` (6-byte footer tag). All 46 UI textures
  decode as **BC7** (16-byte blocks, dims multiples of 4, single mip); verified via Pillow
  `bcn` mode 7. Upload as `DXGI_FORMAT_BC7_UNORM` immutable `ID3D11Texture2D`
  (pitch = `(w/4)*16`) → SRV → `ImTextureID`, no decode step needed.
- `.gfx` movies: plain SWF v10 with `GFX` magic; standard SWF tag stream plus GFx tags 1000
  (ExporterInfo), 1008 (**DefineSubImage**), 1009 (**DefineExternalImage2** → `<texname>.tga`).

## Scaleform GFx runtime — engine is NOT stripped 🟢

**GFx 4.6** is linked with full MSVC C++ RTTI/symbols (build path `.../lib_3dpart/src/gfx4.6/`,
engine "MR2"/MudRunner2, Saber `combine::` namespace). Recognisable classes in the image:
`Scaleform::GFx::Loader`, `gfxMOVIE`, `gfxTEXTURE`, `gfxTEXTURE_REQUEST`,
`mrGFX_TEXTURE_REQUEST`, `EXTERNAL_TEXTURE_PROVIDER`, `resLOADER_GFX_BUNDLE`,
`GFX_CAPTURE_JOB`, `rendPRERECORD_GFX_JOB`, plus Saber's UI wrapper (`UiMovieDef`,
`UiLoadMovieDefFromMemPtr`). The prior Ghidra analysis did **not** apply these C++ symbols
(everything was `FUN_...`); anchors below were reached through string/RTTI xrefs.

**Renderer is a DX11 + Vulkan abstraction** (glslang + SPIRV-Cross linked; textures behind a
backend-agnostic RHI wrapper). GPU handles at the engine-object level are therefore **not**
raw `ID3D11ShaderResourceView*` — they sit one indirection down in the RHI. At runtime our
overlay hooks `IDXGISwapChain::Present` and shares an `ID3D11Device`, so the **DX11 backend
is active** (SRVs exist, just wrapped).

## Engine asset seams (labeled functions) 🟢

Named + commented in the Ghidra DB via `tools/re/LabelAssets.java`.

| Name | RVA | Role | Conf |
|---|---|---|---|
| `TexMgr_GetTexture` | `0x14c8710` | By-name texture registry getter: `(texMgr, SFStringRef* name, u64 flags, char createIfMissing, void* remap)` → engine-texture* (0 if absent & !create) | 🟢 |
| `TexMgr_LookupTextureByName` | `0x14c8b60` | Pure-lookup binary search over `texMgr[+0x240]` (array) / `[+0x248]` (count), `CritSec` @`+0x320`, `_stricmp` vs `tex+0x10` | 🟢 |
| `TexMgr_ReleaseGpuTexture` | `0x14c96f0` | Zeroes engine-tex `+0xa8` (RHI handle) on unbind | 🟢 |
| `RhiTexture_FreeGpuHandles` | `0x14b12c0` | Destroys RHI backend handles; reveals RHI-tex layout | 🟢 |
| `resLOADER_PCT_Load` | `0x127df00` | The `.pct` loader (tagged `"res/deprecated loader"`); builds a name, calls `TexMgr_GetTexture`, logs `"Failed to load texture '%s'"` | 🟢 |
| `resLOADER_PCT_HEADER_Load` | `0x14d50c0` | `.pct_header` loader | 🟢 |
| `resLOADER_BUNDLE_BASE_Load` | `0x1750670` | Generic bundle loader; vtable iterator `&PTR_FUN_6ffffc9fdc20`, dispatch at `this+0x18`; logs `"Failed to load bundle resource '%s' : %s"` | 🟢 |
| `UiMovieDef_GetByName` | `0x104b740` | MovieDef registry getter `(out, SFStringRef* name)`; name hashed, bucket chain @mgr`+0x180`/count`+0x188`; state @`+0x70` (0=loading,1=loaded,2=ready); `"UiMovieDef '%s' not found"` | 🟢 |
| `UiLoadMovieDefFromMemPtr` | `0x104acb0` | Load a MovieDef from memory | 🟢 |

**Globals:** `g_TextureManager` `0x2b17220` · `g_UiMovieDefManager` `0x2ab3630` ·
`g_RhiResourceDevice` `0x2b17348`.

**RTTI job classes (real, instantiated):** `combine::GFX_CAPTURE_JOB` (typeDesc `0x2a16d10`),
`combine::rendPRERECORD_GFX_JOB` (typeDesc `0x2a16d40`); GFx is drawn in a dedicated pass
(confirmed by GPU-crash marker enum `GPU_CRASH_ID_MR2_PRERECORD_{SHADOWMAP,PRE_SSAO,
COMPOSITION,GFX,LAST}`, table @ `0x29d6760`). External-image bridge:
`EXTERNAL_TEXTURE_PROVIDER@gfxTEXTURE` (typeDesc `0x2a16c80`, vtable ~`0x21d45c8`) resolves a
movie's `DefineExternalImage2` `<name>.tga` records to engine textures — i.e. the
`<movie>_i<hex>.pct` names ARE the keys GFx uses.

### Engine-texture object layout 🟢

- `+0x08` name (SF string) · `+0x34` creation flags · `+0x98` 64-bit state/usage bits
- `+0xa8` (`tex[0x15]`) → **RHI texture** (GPU-side; zeroed on unbind by `TexMgr_ReleaseGpuTexture`)
- RHI texture: `+0x120` descriptor, `+0x128` → array of backend resource handles, count at
  `+0x10`, each destroyed via `g_RhiResourceDevice` vtbl+8. Those entries are the backend
  SRV / image-view handles.

### Key AOB signatures (verified unique)

```
TexMgr_GetTexture          @0x14c8710  48 89 5C 24 08 48 89 74 24 18 48 89 7C 24 20 48 89 54 24 10 55 41 54 41 55 41 56 41 57 48 8D 6C 24 D1
TexMgr_LookupTextureByName @0x14c8b60  4C 8B DC 53 48 83 EC 50 49 89 6B 08 48 8D 99 20 03 00 00 49 89 73 10 48 8D 05 0D 7F D0 00
resLOADER_BUNDLE_BASE_Load @0x1750670  48 89 5C 24 18 48 89 54 24 10 48 89 4C 24 08 55 56 57 41 54 41 55 41 56 41 57 48 8D AC 24 60 FE
resLOADER_PCT_Load         @0x127df00  48 8B C4 55 53 57 41 55 48 8D A8 D8 FE FF FF 48 81 EC 08 02 00 00 48 89 70 08 4C 89 60 10
UiMovieDef_GetByName       @0x104b740  40 55 53 56 57 41 56 48 8D 6C 24 C9 48 81 EC A0 00 00 00 48 8B 1D D6 7E A6 01
UiLoadMovieDefFromMemPtr   @0x104acb0  48 89 5C 24 08 48 89 74 24 10 48 89 7C 24 20 55 41 54 41 55 41 56 41 57 48 8D 6C 24 C9 48 81 EC 00 01 00 00 48
```

### Reuse verdicts (which seams the framework adopts) 🟢

| Level | Seam | Verdict |
|---|---|---|
| 1 — reuse loaded textures | `TexMgr_GetTexture` (+ lookup) | **Optional fallback only.** Getter is clean, but engine-tex `+0xa8` → RHI-tex `+0x128[]` last hop to a raw `ID3D11ShaderResourceView*` is a *wrapped* handle with no RTTI (🔴). |
| 2 — pak/bundle file load | `resLOADER_*::Load` (all `"deprecated"`) | **Reject.** No clean `read(name)->bytes`; live path is async hash-keyed VFS on `fio*` + `dsHASHED_STRING`. The self-contained STORED-ZIP reader wins. |
| 3 — drive GFx to render a symbol | `UiMovieDef_GetByName`, `UiLoadMovieDefFromMemPtr`, `GFX_CAPTURE_JOB` | **Reject.** ≥5 unlabelled objects (MovieView, Renderer, RT, RHI device, job) to wire; the capture path is whole-composition anyway, and we want our own widget. |

**Decision:** the asset service keeps a self-contained loader (miniz STORED-ZIP + native BC7
upload) — simpler, backend-independent, no live-engine state. Locate the install dir from the
`SnowRunner.exe` module path → `preload/paks/client/`; open `gfx.pak` (UI skin) and optionally
`boot.pak` (gui_rpm arc); minimal PCT loader per the format above.

## HUD widget & asset map 🟢

### Gear-selector (transmission) widget — lives in `hud_lib.gfx`

Exported symbols (ExportAssets): `gearBoxContainer`, `hud_transmission`,
`hud_transmission_runner`; per-gear cells `hud_lib_fla.hud_transmission_pass_a_80` (A),
`_pass_n_old_82` (N), `_pass_l_79` (L), `_pass_h_85` (H), `_pass_r_83` (R); shift chevrons
`_link_up_88` / `_link_down_89`; gear track `_way_75` / `_way_exp_74` / `_end_77`; plus
`_status_91`, `hud_lib_fla.gear_anim_18`. Related HUD symbols: `vehicleTransmission` /
`imgTransmission` (damage panel), `fuelMeterContainer`, `damageBar`, `hudCompass`,
`hudDiffBtn` / `diffBtnImg`, `hudWdBtn` (AWD), `hudBrakeBtn`, `func_panel_backdrop`,
`rightHudPanelCont`.

The gear letters/track are mostly **vector shapes** (DefineShape); pct textures carry the
grunge panels, icons and atlases. For the overlay we redraw the strip with ImGui primitives
skinned by the extracted plates/panels — visual match is easy (dark plates, rounded rects,
grunge alpha edges, TT Lakes Compressed lettering).

### Best texture candidates (exact pak paths, all `gfx.pak [textures]\ui\flash_auto\`, BC7, 1 mip)

| entry | px | content |
|---|---|---|
| `hud_lib_i7.pct` | 512×164 | rounded-rect button/cell plates (gearbox cells, function buttons), grunge strips, damage/repair glyphs |
| `hud_lib_ia3.pct` | 512×512 | HUD atlas: grunge bg, splatter mask, avatar frame, warning, damage icons, red gear cog, AWD/diff icons, compass chevron, H-shifter icon |
| `hud_lib_i104.pct` | 596×200 | horizontal panel gradients (top bars) |
| `hud_lib_i209.pct` | 684×80 | black grunge brush-stroke bar (header underlay) |
| `hud_lib_id4.pct` | 812×148 | soft elliptical drop shadow |
| `in_game_ic.pct` | 464×284 | red damage/status icons incl. H-pattern gear-shift, engine, tire, warning triangle |
| `minimap_i78/_i79` etc. | up to 400×1180 | minimap + tall 9-slice-able panel frames |
| `gauge/dial` | — | `editor.pak [textures]\dds\gui_rpm__d_a.dds` (256×256 DXT3, 9 mips) — **red RPM arc gauge segment with ticks**, best ready-made dial element (also `boot.pak ...\gui_rpm__d_a.pct`). Truck cockpit clusters: `editor.pak ...\trucks_<truck>_gauges__d.dds` (+`__em_d` emissive, `_glass__d_a`), ~140 trucks. |

**Fonts** (from `font_en.gfx` DefineFont3 + ExportAssets — vector outlines, no bitmap font
textures): `$TitleFont`=TT Lakes Compressed, `$NormalFont`=…DemiBold, `$SmallFont`=…Light
(all commercial, TypeType); `$SystemFont`=Ubuntu Mono, `$ChatFont`=Play (both free/bundleable).
The overlay bundles Play + Ubuntu Mono and stands in a free condensed sans for TT Lakes.

## Tachometer / gear-widget draw recipes 🟢

Extracted **offline / read-only** from `reference/hud-assets/gfx/hud_lib.gfx` (uncompressed
GFx, ver 10, 335,532 bytes) by **`reference/parse_hud_gfx.py`** (regenerate:
`python3 reference/parse_hud_gfx.py`). These are the game's exact textures/rects/colors so the
overlay reproduces them rather than eyeballing.

**Subimage resolution:** bitmap fills reference the 5 atlases indirectly. GFx inserts a
**DefineSubImage** layer (tag 1008, 48 of them): `id, parentImageId, x0,y0,x1,y1`. A fill's
`bitmapId` is a subimage id → resolves to `parent atlas + pixel rect`. All 48 subimages
validated in-bounds; all 17 textured rects below lie inside their parent atlas (0 out-of-bounds).

**Parent atlases (DefineExternalImage2, dims verified):** `hud_lib_ia3.tga` 512×512 ·
`hud_lib_i7.tga` 512×164 · `hud_lib_id4.tga` 812×148 · `hud_lib_i104.tga` 596×200 ·
`hud_lib_i209.tga` 684×80.

**Two facts that matter most:**
- **Panel background** `func_panel_backdrop` (charID 499) is a **TEXTURE** blit (not a vector
  gradient): atlas `hud_lib_ia3.tga`, rect **(x=0, y=260, w=205, h=147)**, drawn into a
  205×181.6 px box. (A second `0xFFFF` no-texture placeholder fill — ignore.)
- **Gear cells** (`hud_transmission_pass_*`) are **VECTOR**: solid white rounded-square shapes
  at fixed sizes, **tinted at runtime** by placement color-transforms to show gear state. Base
  cell = 20×20 px `#FFFFFF` alpha 180 + white (alpha 255) glyph on top. Redraw white, multiply
  by the state color.

Notes: `DefineShape`/`Shape2` fills carry RGB (alpha forced 255); `Shape3`/`Shape4` carry
RGBA. Bitmap fill mode is `clipped-hard` (SWF fill type 0x43). Shapes at **alpha 0** (e.g.
`#FF5588`/`#FF5599`) are invisible Flash registration / hit-area swatches — listed but not drawn.

### Element recipes

| element (charID) | kind | recipe |
|---|---|---|
| `func_panel_backdrop` (499) | TEXTURE | ia3 (0,260,205,147) into 205×181.6 |
| `rightHudPanelTextBg` (389) | VECTOR | `#000000` alpha 127 rect, 190×80 |
| `hudBtnBg` (281) | TEXTURE | shared button pill i7 (248,0,200,44) |
| `gearBoxContainer` dial (382) | TEXTURE | ia3 (260,0,240,240) — 240×240 circular gearbox dial/ring (shape 309) |
| `gearBoxContainer` overlays | VECTOR | ~32 white shapes (gear cells, tick bars, links, ways, runner); `#FFFFFF` a180/a255, alpha-64 dots, one linear shadow gradient |
| `hud_transmission` (381) | composite | 32 child shapes; treat via children |
| `hud_transmission_runner` (380) | VECTOR | `#FF5599` 50×50 core + white 20×20 / 20×30 / 20×40 / 24×24 needle |
| `hud_transmission_status_91` (368) | VECTOR gradient | linear `#000000` a153 → a0, 70×24 (fade behind status text) |

### Gear cells — all VECTOR (white, runtime-tinted)

| symbol | charID | recipe (px) |
|---|---|---|
| `hud_transmission_pass_a_80` | 337 | base 20×20 `#FFFFFF` a180 (×2) + glyph 8×10 a255 + 20×20 a255 |
| `hud_transmission_pass_n_old_82` | 342 | 20×20 `#FFFFFF` a180 (×3) |
| `hud_transmission_pass_l_79` | 331 | 20×20 `#FFFFFF` a180 (×3) |
| `hud_transmission_pass_r_83` | 347 | base 20×20 a180 (×2) + glyph 7×10 a255 + 20×20 a255 |
| `hud_transmission_pass_h_85` | 351 | base 20×20 a180 (×2) + two 7×10 glyphs a255 + 20×20 a255 |
| `hud_transmission_link_up_88` | 358 | 6×6 dot a64 (×2) + 6×6 a255 + invisible 10×10 hit box |
| `hud_transmission_link_down_89` | 362 | 6×2 bar a64 (×2) + 5×34 bar a255 + invisible 10×10 hit box |
| `hud_transmission_way_75` | 320 | 2×35 bar a180 (×2) + 2×35 a255 (thin connector) |
| `hud_transmission_way_exp_74` | 317 | 4×35 bars a180/a255 + 2×35 a180 (branch connector) |
| `hud_transmission_end_77` | 325 | 10×10 a180 (×2) + 20×20 cap a255 + invisible 121×121 hit box |

Base geometry = a 20×20 rounded square at alpha 180 with a white glyph (A/L/R/H) at alpha 255;
N (`pass_n_old`) is just the base square. Runtime placement color-transforms recolor to the
active/inactive/warning state color.

### Buttons / icons (each = pill bg + icon + glow + alpha-0 runtime state tints)

| button (charID) | pill | icon | glow |
|---|---|---|---|
| `hudDiffBtn` (307) | i7 (248,0,200,44) | i7 (376,92,28,30) | ia3 (252,412,58,59) |
| `diffBtnImg` (306) | — | i7 (376,92,28,30) | ia3 (252,412,58,59) |
| `hudWdBtn` AWD (300) | i7 (248,0,200,44) | i7 (408,92,26,30) | ia3 (316,412,58,60) + ia3 (364,352,44,46) |
| `hudBrakeBtn` (291) | i7 (248,0,200,44) | ia3 (448,328,30,20) | i7 (452,0,48,36) |
| `brakeBtnImg` (287) | — | ia3 (448,328,30,20) | i7 (452,0,48,36) |

## Artifacts & tools

- **`reference/parse_hud_gfx.py`** — the offline SWF/GFx tag parser (rasterises/measures
  shapes; dev-time only, never redistributed).
- `reference/hud-assets/gfx/` — 11 extracted movies; `reference/hud-assets/png/` — 64 previews
  (46 flash_auto UI textures + 14 gui_* sprites + `gui_rpm__d_a.png` + gauge clusters).
- `tools/re/LabelAssets.java` — applies the function/global labels above to the Ghidra DB.

_Sources: [[Asset and HUD System|Asset-and-HUD-System]], [[Asset and HUD System|Asset-and-HUD-System]], [[Asset and HUD System|Asset-and-HUD-System]]._
