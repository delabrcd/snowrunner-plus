// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.
// Decompile a curated set of RVAs (the effects-update range fn + big emitter fn) and, for the range
// fn, list its callees so we can see the per-truck effects/sound path. RVA = FUN_VA - 0xa670000.
import ghidra.app.script.GhidraScript;
import ghidra.app.decompiler.*;
import ghidra.program.model.address.Address;
import ghidra.program.model.listing.*;
import java.util.*;

public class DecompRange extends GhidraScript {
    Address base; DecompInterface dec;
    long rva(Address a){ return a.subtract(base); }
    public void run() throws Exception {
        base=currentProgram.getImageBase();
        dec=new DecompInterface(); dec.openProgram(currentProgram);
        long[] addrs={0x159c870L, 0x845400L};   // effects range dispatch, and job::run
        for(long a: addrs){
            Function f=getFunctionContaining(base.add(a));
            if(f==null){println("// no func @ rva 0x"+Long.toHexString(a));continue;}
            println("\n// ===== "+f.getName()+" @ rva 0x"+Long.toHexString(rva(f.getEntryPoint()))+" =====");
            DecompileResults r=dec.decompileFunction(f,200,monitor);
            if(r!=null&&r.decompileCompleted()) println(r.getDecompiledFunction().getC());
            else println("// decompile failed");
        }
    }
}
