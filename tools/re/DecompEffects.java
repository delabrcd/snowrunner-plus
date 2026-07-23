// Decompile the 3 vtable methods of combine::ASYNC_TRUCKS_EFFECTS_UPDATE (vtable @ rva 0x21d10b8):
//   [0]0x8454d0  [1]0x845400  [2]0x9144d0
// For each, scan the decompiled body for calls; report callees and whether the body/callees touch
// TruckAction+0x70 (gear) or known audio funcs. Also decompile any direct callee that references +0x70.
import ghidra.app.script.GhidraScript;
import ghidra.app.decompiler.*;
import ghidra.program.model.address.Address;
import ghidra.program.model.listing.*;
import java.util.*;

public class DecompEffects extends GhidraScript {
    Address base; DecompInterface dec;
    long rva(Address a){ return a.subtract(base); }

    String decomp(Function f){
        DecompileResults r = dec.decompileFunction(f,240,monitor);
        return (r!=null && r.decompileCompleted())? r.getDecompiledFunction().getC() : null;
    }
    void show(Function f, String why){
        if(f==null){println("// null "+why);return;}
        String c=decomp(f);
        println("\n// ===== "+f.getName()+" @ rva 0x"+Long.toHexString(rva(f.getEntryPoint()))+" ["+why+"] =====");
        if(c==null){println("// decompile failed");return;}
        println("//  gearHint(0x70)="+ (c.contains("0x70")) +"  soundHint="+(c.toLowerCase().contains("sound")||c.toLowerCase().contains("voice"))
                +"  callsUpdateSound="+c.contains("FUN_6ffffb4")); // placeholder
        println(c);
    }
    public void run() throws Exception {
        base=currentProgram.getImageBase();
        dec=new DecompInterface(); dec.openProgram(currentProgram);
        long[] methods={0x8454d0L,0x845400L,0x9144d0L};
        for(long m:methods){
            Function f=getFunctionContaining(base.add(m));
            show(f,"vtable method");
        }
    }
}
