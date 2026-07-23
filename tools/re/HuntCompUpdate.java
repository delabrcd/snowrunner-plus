// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.
// Find the truck sound-component per-frame Update: common caller(s) of the continuous-sound fn
// FUN_6ffffaf02f00(0x892f00) and the anim-event fn FUN_6ffffb2cc960(0xc5c960). Also list callers of
// PlaySoundEventByHash-inner helper FUN_6ffffaf247a0. Decompile shared parents; flag gear/drivetrain refs.
import ghidra.app.script.GhidraScript;
import ghidra.app.decompiler.*;
import ghidra.program.model.address.Address;
import ghidra.program.model.listing.*;
import ghidra.program.model.symbol.*;
import java.util.*;

public class HuntCompUpdate extends GhidraScript {
    Address base; DecompInterface dec;
    long rva(Address a){ return a.subtract(base); }
    String dc(Function f){ if(f==null)return null; DecompileResults r=dec.decompileFunction(f,180,monitor); return (r!=null&&r.decompileCompleted())?r.getDecompiledFunction().getC():null; }
    Set<Function> callersOf(long tgt){
        Set<Function> s=new LinkedHashSet<>();
        Function t=getFunctionContaining(base.add(tgt));
        if(t!=null) for(Reference r: getReferencesTo(t.getEntryPoint())){
            Function c=getFunctionContaining(r.getFromAddress()); if(c!=null) s.add(c);
        }
        return s;
    }
    public void run() throws Exception {
        base=currentProgram.getImageBase();
        dec=new DecompInterface(); dec.openProgram(currentProgram);
        Set<Function> a=callersOf(0x892f00L), b=callersOf(0xc5c960L);
        println("// callers of continuous-sound 0x892f00:");
        for(Function f:a) println("//   "+f.getName()+" @0x"+Long.toHexString(rva(f.getEntryPoint())));
        println("// callers of anim-event 0xc5c960:");
        for(Function f:b) println("//   "+f.getName()+" @0x"+Long.toHexString(rva(f.getEntryPoint())));
        Set<Function> both=new LinkedHashSet<>(a); both.retainAll(b);
        println("// SHARED parents (component Update):");
        for(Function f:both) println("//   "+f.getName()+" @0x"+Long.toHexString(rva(f.getEntryPoint())));
        // decompile union of parents, flag gear/drivetrain
        Set<Function> all=new LinkedHashSet<>(a); all.addAll(b);
        for(Function f:all){
            String s=dc(f); if(s==null) continue;
            boolean gear=s.contains("+ 0x70")||s.contains("+ 0x74")||s.contains("0xc404f0")||s.contains("gear");
            println("\n// --- "+f.getName()+" @0x"+Long.toHexString(rva(f.getEntryPoint()))+"  gearHint="+gear+" ---");
            println(s);
        }
    }
}
