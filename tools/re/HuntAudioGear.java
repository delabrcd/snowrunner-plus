// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.
// Approach from the audio side + the effects dispatcher.
//  A) xrefs to UpdateSound(0xdff1e0) and SetVoiceVolPitch(0xdfb2f0): decompile callers, flag gear/oneshot.
//  B) decompile FUN_6ffffbc0c870 (effects parallel dispatch called by ASYNC_TRUCKS_EFFECTS_UPDATE::run).
//  C) list callees of each; flag any callee referencing gear offsets 0x70/0x74.
import ghidra.app.script.GhidraScript;
import ghidra.app.decompiler.*;
import ghidra.program.model.address.Address;
import ghidra.program.model.listing.*;
import ghidra.program.model.symbol.*;
import java.util.*;

public class HuntAudioGear extends GhidraScript {
    Address base; DecompInterface dec;
    long rva(Address a){ return a.subtract(base); }
    String dc(Function f){ DecompileResults r=dec.decompileFunction(f,180,monitor); return (r!=null&&r.decompileCompleted())?r.getDecompiledFunction().getC():null; }

    void show(Function f,String why){
        if(f==null){println("// null "+why);return;}
        String c=dc(f);
        println("\n// ===== "+f.getName()+" @ rva 0x"+Long.toHexString(rva(f.getEntryPoint()))+" ["+why+"] =====");
        if(c==null){println("// decompile failed");return;}
        int g70=count(c,"0x70"), g74=count(c,"0x74");
        println("//  refs: 0x70="+g70+" 0x74="+g74+" 'rand'="+c.contains("rand()")+" sizeHint(50666/49742)="+(c.contains("50666")||c.contains("49742")||c.contains("c5aa")||c.contains("c24e")));
        println(c);
    }
    int count(String h,String n){int i=0,c=0;while((i=h.indexOf(n,i))>=0){c++;i+=n.length();}return c;}

    void callers(long targetRva,String tag){
        Function t=getFunctionContaining(base.add(targetRva));
        println("\n// ---- callers of "+ (t!=null?t.getName():"?") +" @ 0x"+Long.toHexString(targetRva)+" ("+tag+") ----");
        Set<Function> seen=new LinkedHashSet<>();
        if(t!=null){
            for(Reference r: getReferencesTo(t.getEntryPoint())){
                Function c=getFunctionContaining(r.getFromAddress());
                if(c!=null) seen.add(c);
                println("//   xref from 0x"+Long.toHexString(rva(r.getFromAddress()))+(c!=null?" in "+c.getName()+" @0x"+Long.toHexString(rva(c.getEntryPoint())):""));
            }
        }
        for(Function c:seen) show(c,"caller of "+tag);
    }

    public void run() throws Exception {
        base=currentProgram.getImageBase();
        dec=new DecompInterface(); dec.openProgram(currentProgram);
        callers(0xdff1e0L,"UpdateSound");
        callers(0xdfb2f0L,"SetVoiceVolPitch");
        show(getFunctionContaining(base.add(0xbc0c870L)),"effects parallel dispatch (job::run body)");
    }
}
