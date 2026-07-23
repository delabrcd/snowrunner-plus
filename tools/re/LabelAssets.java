// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.
// Headless: apply persistent names + plate comments to the asset/texture/GFx functions and singletons
// discovered during the HUD-asset RE pass. Run WITHOUT -readOnly so the project DB is committed.
import ghidra.app.script.GhidraScript;
import ghidra.program.model.address.*;
import ghidra.program.model.listing.*;
import ghidra.program.model.symbol.*;

public class LabelAssets extends GhidraScript {
    Address base;
    void nameFn(long rva, String nm, String cmt){
        Function f=getFunctionContaining(base.add(rva));
        if(f==null){ println("// no func @0x"+Long.toHexString(rva)+" for "+nm); return; }
        try{ f.setName(nm, SourceType.USER_DEFINED);
             if(cmt!=null) f.setComment(cmt);
             println("// named 0x"+Long.toHexString(rva)+" -> "+nm);
        }catch(Exception e){ println("// FAIL "+nm+": "+e); }
    }
    void nameData(long rva, String nm, String cmt){
        Address a=base.add(rva);
        try{ createLabel(a, nm, true, SourceType.USER_DEFINED);
             if(cmt!=null) setPlateComment(a, cmt);
             println("// label 0x"+Long.toHexString(rva)+" -> "+nm);
        }catch(Exception e){ println("// FAIL data "+nm+": "+e); }
    }
    public void run() throws Exception {
        base=currentProgram.getImageBase();
        // ---- Level 1: texture registry / manager ----
        nameFn(0x14c8710L,"TexMgr_GetTexture",
          "Level1 HUD-asset RE. Texture registry getter. (this=g_TextureManager, SFStringRef* name{char* @0, u32 len/hash @8}, u64 flags, char createIfMissing, void* remap). Returns engine-texture* or 0. Looks up via TexMgr_LookupTextureByName; if createIfMissing, builds via vtbl+0x10 and inserts (sorted, _stricmp on name@+8). Engine-tex: name@+8, flags@+0x34, statebits@+0x98, RHI-tex@+0xa8.");
        nameFn(0x14c8b60L,"TexMgr_LookupTextureByName",
          "Level1. Pure registry lookup (no create). Binary search over sorted array this[+0x240]/count[+0x248], _stricmp on tex name (@+0x10 inline or *@+0x10 if len@+0xc==0). CritSec@this+0x320.");
        nameFn(0x14c96f0L,"TexMgr_ReleaseGpuTexture",
          "Unbinds/frees the RHI GPU handle of an engine-texture (calls RhiTexture_FreeGpuHandles on tex[0x15]=+0xa8).");
        nameFn(0x14b12c0L,"RhiTexture_FreeGpuHandles",
          "Frees RHI texture backend handles: descr@+0x120, handle-array@+0x128 count@+0x10, each destroyed via g_RhiResourceDevice vtbl+8. array elements = backend SRV/imageview handles.");
        // ---- Level 2: resource loaders (deprecated path) ----
        nameFn(0x127df00L,"resLOADER_PCT_Load",
          "Level2 (DEPRECATED 'res/deprecated loader'). PCT texture loader. Resolves name then calls TexMgr_GetTexture(g_TextureManager,name,flags,0,0); null -> 'Failed to load texture %s'.");
        nameFn(0x14d50c0L,"resLOADER_PCT_HEADER_Load","Level2 (deprecated). .pct_header loader.");
        nameFn(0x1750670L,"resLOADER_BUNDLE_BASE_Load",
          "Level2 (deprecated). Generic bundle loader: iterates bundle entries via vtable(&PTR_FUN_6ffffc9fdc20) and dispatches per-entry to this+0x18. 'Failed to load bundle resource %s'.");
        // ---- Level 3: GFx movie registry ----
        nameFn(0x104b740L,"UiMovieDef_GetByName",
          "Level3. GFx MovieDef registry getter. this=g_UiMovieDefManager, param=SFStringRef name. Hash (SF_NameHash) -> bucket chain @[+0x180]/count[+0x188], cmp via FUN_6ffffbf197c0. MovieDef state@+0x70 (0=loading,1=loaded,2=ready). 'UiMovieDef %s not found'.");
        nameFn(0x104acb0L,"UiLoadMovieDefFromMemPtr",
          "Level3. Loads a GFx MovieDef from an in-memory buffer. 'Empty memBuffer passed to UiLoadMovieDefFromMemPtr'.");
        nameFn(0xafa7de0L,"SF_NameHash","String hasher used by UiMovieDef_GetByName registry.");
        // ---- singletons ----
        nameData(0x2b17220L,"g_TextureManager","ptr-global -> texture manager. arg0 to TexMgr_GetTexture/LookupTextureByName.");
        nameData(0x2ab3630L,"g_UiMovieDefManager","ptr-global -> GFx MovieDef registry (used by UiMovieDef_GetByName).");
        nameData(0x2b17348L,"g_RhiResourceDevice","ptr-global -> RHI resource device (vtbl+8 = destroy handle).");
        println("// done labeling");
    }
}
