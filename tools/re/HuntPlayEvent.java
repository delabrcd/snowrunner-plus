// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.
// FUN_6ffffb2cd460 = PlaySoundEventByHash(soundComp, eventHash). Find its callers and the constant
// hash each passes. Print the call-site disasm (to read the immediate hash in mov edx,IMM) + decompile
// callers so we can see the gear-change gating. Also do the same for neighbor FUN_6ffffb2cc960.
import ghidra.app.script.GhidraScript;
import ghidra.app.decompiler.*;
import ghidra.program.model.address.Address;
import ghidra.program.model.listing.*;
import ghidra.program.model.symbol.*;
import ghidra.program.model.lang.Register;
import java.util.*;

public class HuntPlayEvent extends GhidraScript {
    Address base; DecompInterface dec;
    long rva(Address a){ return a.subtract(base); }
    String dc(Function f){ if(f==null)return null; DecompileResults r=dec.decompileFunction(f,180,monitor); return (r!=null&&r.decompileCompleted())?r.getDecompiledFunction().getC():null; }

    void analyze(long tgt,String tag){
        Function t=getFunctionContaining(base.add(tgt));
        println("\n// ================= callers of "+tag+" ("+ (t!=null?t.getName():"?") +" @0x"+Long.toHexString(tgt)+") =================");
        Set<Function> callers=new LinkedHashSet<>();
        for(Reference r: getReferencesTo(t.getEntryPoint())){
            Address from=r.getFromAddress();
            Function c=getFunctionContaining(from);
            // walk back up to ~12 instrs to find "MOV EDX, imm" (2nd arg = hash) or MOV RDX
            String imm="?";
            Instruction ins=getInstructionAt(from);
            for(int k=0;k<14 && ins!=null;k++){
                ins=ins.getPrevious();
                if(ins==null) break;
                String m=ins.toString();
                if(m.startsWith("MOV EDX,") || m.startsWith("MOV RDX,") || m.startsWith("LEA RDX,")){ imm=m; break; }
            }
            println("//   call @0x"+Long.toHexString(rva(from))+" in "+(c!=null?c.getName()+" @0x"+Long.toHexString(rva(c.getEntryPoint())):"?")+"   arg2="+imm);
            if(c!=null) callers.add(c);
        }
        for(Function c:callers){ println("\n// --- "+c.getName()+" @0x"+Long.toHexString(rva(c.getEntryPoint()))+" ("+tag+" caller) ---"); println(dc(c)); }
    }
    public void run() throws Exception {
        base=currentProgram.getImageBase();
        dec=new DecompInterface(); dec.openProgram(currentProgram);
        analyze(0xc5d460L,"PlaySoundEventByHash");
    }
}
