// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.
import ghidra.app.script.GhidraScript;
import ghidra.app.decompiler.*;
import ghidra.program.model.address.Address;
import ghidra.program.model.listing.*;
import ghidra.program.model.symbol.*;
import java.util.*;

public class TraceDispatch2 extends GhidraScript {
    DecompInterface dec; Address base; FunctionManager fm; Set<Long> done=new HashSet<>();
    void decompRva(long rva,String why){
        Function f=fm.getFunctionContaining(base.add(rva));
        if(f==null){println("// no func @0x"+Long.toHexString(rva)+" ("+why+")");return;}
        long er=f.getEntryPoint().subtract(base);
        if(!done.add(er)){println("// (dup "+f.getName()+" "+why+")");return;}
        println("\n// ===== "+f.getName()+" @ rva 0x"+Long.toHexString(er)+" size="+f.getBody().getNumAddresses()+"  ("+why+") =====");
        DecompileResults r=dec.decompileFunction(f,150,monitor);
        if(r!=null&&r.decompileCompleted()) println(r.getDecompiledFunction().getC());
        else println("// decompile failed");
    }
    void callers(long rva,String name){
        Function f=fm.getFunctionContaining(base.add(rva)); if(f==null)return;
        println("\n// ## callers of "+name+" (0x"+Long.toHexString(rva)+") ##");
        ReferenceIterator it=currentProgram.getReferenceManager().getReferencesTo(f.getEntryPoint());
        int n=0;
        while(it.hasNext()&&n<20){ Reference ref=it.next();
            if(!ref.getReferenceType().isCall())continue;
            Function c=fm.getFunctionContaining(ref.getFromAddress());
            if(c!=null){println("//   "+c.getName()+"@0x"+Long.toHexString(c.getEntryPoint().subtract(base))+" (site 0x"+Long.toHexString(ref.getFromAddress().subtract(base))+")");n++;}
        }
    }
    public void run() throws Exception {
        base=currentProgram.getImageBase(); fm=currentProgram.getFunctionManager();
        dec=new DecompInterface(); dec.openProgram(currentProgram);
        decompRva(0xb71f20L,"RegisterAction helper (hash,A,B,slot)");
        decompRva(0xb7ae20L,"AWD handlerA (FUN_b1eae20)");
        callers(0xb5a2b0L,"ActionRegistryBuild");
    }
}
