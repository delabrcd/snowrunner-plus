// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.
// Ghidra headless: decompile the confirmed/candidate drivetrain-input functions and list the
// CALLERS of the confirmed setters (SwitchAWD/SwitchDiff/DisableAuto) = the input dispatch layer.
import ghidra.app.script.GhidraScript;
import ghidra.app.decompiler.*;
import ghidra.program.model.address.Address;
import ghidra.program.model.listing.*;
import ghidra.program.model.symbol.*;
import java.util.*;

public class DecompCluster extends GhidraScript {
    DecompInterface dec; Address base; FunctionManager fm; Set<Long> done = new HashSet<>();

    void decompRva(long rva, String why) {
        Function f = fm.getFunctionContaining(base.add(rva));
        if (f==null){ println("// no func @0x"+Long.toHexString(rva)+" ("+why+")"); return; }
        long er=f.getEntryPoint().subtract(base);
        if(!done.add(er)){ println("// (dup "+f.getName()+" @0x"+Long.toHexString(er)+" "+why+")"); return; }
        println("\n// ===== "+f.getName()+" @ rva 0x"+Long.toHexString(er)+" size="+f.getBody().getNumAddresses()+"  ("+why+") =====");
        DecompileResults r=dec.decompileFunction(f,120,monitor);
        if(r!=null&&r.decompileCompleted()) println(r.getDecompiledFunction().getC());
        else println("// decompile failed");
    }

    void callers(long rva, String name) {
        Function f=fm.getFunctionContaining(base.add(rva));
        if(f==null){println("// no func @0x"+Long.toHexString(rva));return;}
        println("\n// ##### CALLERS of "+name+" (0x"+Long.toHexString(rva)+") #####");
        ReferenceIterator it=currentProgram.getReferenceManager().getReferencesTo(f.getEntryPoint());
        Set<Address> seen=new HashSet<>(); int n=0;
        while(it.hasNext()&&n<24){
            Reference ref=it.next();
            if(ref.getReferenceType()!=RefType.UNCONDITIONAL_CALL && ref.getReferenceType()!=RefType.CONDITIONAL_CALL && !ref.getReferenceType().isCall()) continue;
            Function c=fm.getFunctionContaining(ref.getFromAddress());
            if(c!=null&&seen.add(c.getEntryPoint())){
                println("//   caller "+c.getName()+" @ rva 0x"+Long.toHexString(c.getEntryPoint().subtract(base))+"  (call site 0x"+Long.toHexString(ref.getFromAddress().subtract(base))+")");
                n++;
            }
        }
        println("//   total distinct callers listed: "+n);
    }

    public void run() throws Exception {
        base=currentProgram.getImageBase(); fm=currentProgram.getFunctionManager();
        dec=new DecompInterface(); dec.openProgram(currentProgram);

        // candidate shift / setter functions in the drivetrain cluster
        decompRva(0xd72340L,"GetMaxGear caller, writes +0x3c +0x4a");
        decompRva(0xd73fe0L,"writes +0x49 (AWD?)");
        decompRva(0xd74130L,"writes +0x4a (diff?)");
        decompRva(0xd79490L,"writes veh+0xe8 (drivetrain mode)");
        decompRva(0xd76020L,"DisableAuto (+0x3c=0)");
        decompRva(0xd72570L,"helper called by DisableAuto");
        decompRva(0xc41ff0L,"writes +0x38 +0x3c +0x48 +0x4a");
        decompRva(0xc419b0L,"GetMaxGear caller (c region)");
        decompRva(0xcd0bd0L,"compact +0x48 writer (handbrake?)");
        decompRva(0xc4e350L,"+0x48 writer");
        decompRva(0xc25400L,"+0x38 +0x48 +0x74");

        // dispatch: who calls the confirmed setters
        callers(0xd7bc90L,"SwitchAWD");
        callers(0xd7bcf0L,"SwitchDiff");
        callers(0xd76020L,"DisableAuto");
        callers(0xd72340L,"ShiftCand_d72340");
    }
}
