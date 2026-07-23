// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.
// Trace the drivetrain->event path.
//  A) callers of ApplyGear(0xc404f0) and DrivetrainWheelGearSync(0xc3fe20): decompile, to see whether
//     a gear-changed flag/event is posted after the +0x70 write.
//  B) Dump ALL callers of StartSoundObject(0xdfe630) that contain a comparison "!= " near the call and
//     read a 4-byte int field (candidate one-shot gear trigger). Print full body of any caller whose
//     size < 120 lines AND references both a comparison and StartSoundObject (likely a focused trigger).
import ghidra.app.script.GhidraScript;
import ghidra.app.decompiler.*;
import ghidra.program.model.address.Address;
import ghidra.program.model.listing.*;
import ghidra.program.model.symbol.*;
import java.util.*;

public class HuntGearEvent extends GhidraScript {
    Address base; DecompInterface dec;
    long rva(Address a){ return a.subtract(base); }
    String dc(Function f){ if(f==null)return null; DecompileResults r=dec.decompileFunction(f,180,monitor); return (r!=null&&r.decompileCompleted())?r.getDecompiledFunction().getC():null; }

    void callersOf(long tgt,String tag){
        Function t=getFunctionContaining(base.add(tgt));
        println("\n// ==== callers of "+tag+" ("+(t!=null?t.getName():"?")+" @0x"+Long.toHexString(tgt)+") ====");
        Set<Function> seen=new LinkedHashSet<>();
        if(t!=null) for(Reference r: getReferencesTo(t.getEntryPoint())){
            Function c=getFunctionContaining(r.getFromAddress());
            if(c!=null&&seen.add(c))
                println("//   "+c.getName()+" @0x"+Long.toHexString(rva(c.getEntryPoint())));
        }
        for(Function c:seen){ println("\n// --- "+c.getName()+" @0x"+Long.toHexString(rva(c.getEntryPoint()))+" ("+tag+" caller) ---"); println(dc(c)); }
    }

    public void run() throws Exception {
        base=currentProgram.getImageBase();
        dec=new DecompInterface(); dec.openProgram(currentProgram);
        callersOf(0xc404f0L,"ApplyGear");
        // full body of DrivetrainWheelGearSync
        Function sync=getFunctionContaining(base.add(0xc3fe20L));
        println("\n// ==== DrivetrainWheelGearSync @0xc3fe20 (full) ====");
        println(dc(sync));
    }
}
