// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.
// Headless: decompile the texture-manager getter chain (Level 1) and hunt the GFx capture / RTT path (Level 3).
import ghidra.app.script.GhidraScript;
import ghidra.app.decompiler.*;
import ghidra.program.model.address.*;
import ghidra.program.model.listing.*;
import ghidra.program.model.symbol.*;
import java.util.*;

public class TexGetter extends GhidraScript {
    Address base; DecompInterface dec; Set<Long> done = new HashSet<>();
    long rva(Address a){ return a.subtract(base); }

    void decompRva(long r, String why){
        Function f = getFunctionContaining(base.add(r));
        if (f==null){ println("// no func @0x"+Long.toHexString(r)+" ("+why+")"); return; }
        long er=rva(f.getEntryPoint());
        if(!done.add(er)){ println("// (dup @0x"+Long.toHexString(er)+" "+why+")"); return; }
        println("\n// ===== FUN @0x"+Long.toHexString(er)+" size="+f.getBody().getNumAddresses()+"  ("+why+") =====");
        DecompileResults res=dec.decompileFunction(f,90,monitor);
        if(res!=null&&res.decompileCompleted()) println(res.getDecompiledFunction().getC());
        else println("// decompile failed");
    }

    // find containing funcs of xrefs to any defined string == m, optionally decompile
    void strXref(String m, boolean decomp){
        DataIterator di=currentProgram.getListing().getDefinedData(true);
        Set<Long> fns=new LinkedHashSet<>();
        while(di.hasNext()){
            Data d=di.next();
            if(!d.hasStringValue()) continue;
            Object v=d.getValue(); if(v==null) continue;
            if(!v.toString().equals(m)) continue;
            println("\n// marker \""+m+"\" @0x"+Long.toHexString(rva(d.getAddress())));
            ReferenceIterator ri=currentProgram.getReferenceManager().getReferencesTo(d.getAddress());
            while(ri.hasNext()){
                Reference r=ri.next();
                Function f=getFunctionContaining(r.getFromAddress());
                println("//   xref 0x"+Long.toHexString(rva(r.getFromAddress()))+(f!=null?" in FUN@0x"+Long.toHexString(rva(f.getEntryPoint())):" (no func)"));
                if(f!=null) fns.add(rva(f.getEntryPoint()));
            }
        }
        if(decomp) for(long r:fns) decompRva(r,"xref of \""+m+"\"");
    }

    public void run() throws Exception {
        base=currentProgram.getImageBase();
        dec=new DecompInterface(); dec.openProgram(currentProgram);

        // Level 1: texture-manager getter chain (from resLOADER_PCT::Load)
        decompRva(0x14c8710L, "TexMgr::GetTextureByName (FUN_..bb38710)");
        decompRva(0x14c96f0L, "TexMgr bind/register (FUN_..bb396f0)");

        // Level 1 bridge: GFx external-image resolution + not-implemented getImageReference site
        strXref("Failed to load texture '%s'", false);
        strXref("Loading texture: '%s'", false);

        // Level 3: GFx capture / render-to-texture
        strXref("GPU_CRASH_ID_MR2_PRERECORD_GFX", true);
    }
}
