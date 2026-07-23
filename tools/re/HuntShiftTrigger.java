// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.
// Pin the shift-sound trigger.
//  A) All callers of StartSoundObject (rva 0xdfe630). For each, decompile, flag references to gear
//     fields (0x70/0x74) and to 'rand'. Print full decompile ONLY for callers that reference gear.
//  B) Find the ctor(s) of ASYNC_TRUCKS_EFFECTS_UPDATE by xref'ing its vtable VA (base+0x21d10b8),
//     decompile to expose the per-item effects callback; then decompile that callback and scan it.
import ghidra.app.script.GhidraScript;
import ghidra.app.decompiler.*;
import ghidra.program.model.address.Address;
import ghidra.program.model.listing.*;
import ghidra.program.model.symbol.*;
import java.util.*;

public class HuntShiftTrigger extends GhidraScript {
    Address base; DecompInterface dec;
    long rva(Address a){ return a.subtract(base); }
    String dc(Function f){ if(f==null)return null; DecompileResults r=dec.decompileFunction(f,180,monitor); return (r!=null&&r.decompileCompleted())?r.getDecompiledFunction().getC():null; }
    int cnt(String h,String n){int i=0,c=0;while(h!=null&&(i=h.indexOf(n,i))>=0){c++;i+=n.length();}return c;}

    public void run() throws Exception {
        base=currentProgram.getImageBase();
        dec=new DecompInterface(); dec.openProgram(currentProgram);

        // ---- A: callers of StartSoundObject 0xdfe630 ----
        Function so=getFunctionContaining(base.add(0xdfe630L));
        println("// StartSoundObject = "+ (so!=null?so.getName():"?"));
        Set<Function> callers=new LinkedHashSet<>();
        for(Reference r: getReferencesTo(so.getEntryPoint())){
            Function c=getFunctionContaining(r.getFromAddress());
            if(c!=null) callers.add(c);
        }
        println("// "+callers.size()+" distinct callers of StartSoundObject:");
        List<Function> gearCallers=new ArrayList<>();
        for(Function c:callers){
            String s=dc(c);
            int g70=cnt(s,"+ 0x70"), g74=cnt(s,"+ 0x74"), gword=cnt(s,"gear")+cnt(s,"Gear");
            boolean gear = g70>0||g74>0||gword>0;
            println("//   "+c.getName()+" @0x"+Long.toHexString(rva(c.getEntryPoint()))+"  0x70="+g70+" 0x74="+g74+" gearWord="+gword+(gear?"   <== GEAR":""));
            if(gear) gearCallers.add(c);
        }
        for(Function c:gearCallers){
            println("\n// ===== [GEAR-CALLER of StartSoundObject] "+c.getName()+" @0x"+Long.toHexString(rva(c.getEntryPoint()))+" =====");
            println(dc(c));
        }

        // ---- B: ctor of the effects job (xref the vtable VA) ----
        long vtableVA = base.getOffset()+0x21d10b8L;
        println("\n// ---- xrefs to effects-job vtable VA 0x"+Long.toHexString(vtableVA)+" ----");
        Address vt=base.add(0x21d10b8L);
        Set<Function> ctors=new LinkedHashSet<>();
        for(Reference r: getReferencesTo(vt)){
            Function c=getFunctionContaining(r.getFromAddress());
            println("//   ref from 0x"+Long.toHexString(rva(r.getFromAddress()))+(c!=null?" in "+c.getName()+" @0x"+Long.toHexString(rva(c.getEntryPoint())):" (no func)"));
            if(c!=null) ctors.add(c);
        }
        for(Function c:ctors){
            println("\n// ===== [effects-job ctor/user] "+c.getName()+" @0x"+Long.toHexString(rva(c.getEntryPoint()))+" =====");
            println(dc(c));
        }
    }
}
