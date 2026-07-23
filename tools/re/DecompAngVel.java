// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.
// Ghidra headless: locate the live output/driveshaft angular-velocity scalar (g_fAngVel).
// Strongest lead = debug-HUD format string @ VA 0x142222160 ("AngVel %.1f (delta %.3f)").
// Also chases g_fAngVel string @ 0x142287f60, its name block @ 0x142246e80, and decompiles the
// gearbox caps consumers (ParseGearbox_AngVel, DrivetrainUpdate_ApplyGear, GetMaxGear).
//   analyzeHeadless <proj> snowrunner -process snowrunner-fixed.bin -noanalysis \
//     -scriptPath tools/re -postScript DecompAngVel.java
import ghidra.app.script.GhidraScript;
import ghidra.app.decompiler.*;
import ghidra.program.model.address.Address;
import ghidra.program.model.listing.*;
import ghidra.program.model.symbol.*;
import java.util.*;

public class DecompAngVel extends GhidraScript {
    DecompInterface dec; Address base; FunctionManager fm; Set<Long> done = new HashSet<>();

    long rva(Address a){ return a.subtract(base); }
    Address va(long v){ return base.add(v - 0x140000000L); } // arg is a VA 0x142...

    void decompFunc(Function f, String why) {
        if (f == null) { println("// null func ("+why+")"); return; }
        long er = rva(f.getEntryPoint());
        if (!done.add(er)) { println("// (dup "+f.getName()+" @0x"+Long.toHexString(er)+" "+why+")"); return; }
        println("\n// ===== "+f.getName()+" @ rva 0x"+Long.toHexString(er)+" size="+f.getBody().getNumAddresses()+"  ("+why+") =====");
        DecompileResults r = dec.decompileFunction(f, 180, monitor);
        if (r!=null && r.decompileCompleted()) println(r.getDecompiledFunction().getC());
        else println("// decompile failed: "+(r!=null?r.getErrorMessage():"null"));
    }

    // find every reference to the data at VA, decompile each containing function
    void chaseVa(long vaddr, String why) {
        Address a = va(vaddr);
        println("\n// #### xrefs to VA 0x"+Long.toHexString(vaddr)+" (rva 0x"+Long.toHexString(rva(a))+")  ("+why+") ####");
        Reference[] refs = getReferencesTo(a);
        println("//   ref count = "+refs.length);
        Set<Long> funcs = new LinkedHashSet<>();
        for (Reference ref : refs) {
            Address from = ref.getFromAddress();
            Function f = fm.getFunctionContaining(from);
            println("//   <- from rva 0x"+Long.toHexString(rva(from))+"  type="+ref.getReferenceType()
                    +(f!=null?("  in "+f.getName()+" @0x"+Long.toHexString(rva(f.getEntryPoint()))):"  (no func)"));
            if (f!=null) funcs.add(rva(f.getEntryPoint()));
        }
        for (long fr : funcs) decompFunc(fm.getFunctionContaining(base.add(fr)), why+" xref");
    }

    void decompRva(long r, String why){ decompFunc(fm.getFunctionContaining(base.add(r)), why); }

    public void run() throws Exception {
        base = currentProgram.getImageBase(); fm = currentProgram.getFunctionManager();
        dec = new DecompInterface(); dec.openProgram(currentProgram);
        println("// image base = 0x"+Long.toHexString(base.getOffset()));

        // LEAD 1: debug HUD string (highest value)
        chaseVa(0x142222160L, "HUD-AngVel-delta");
        // LEAD 2: g_fAngVel global name string + the name block
        chaseVa(0x142287f60L, "g_fAngVel-string");
        chaseVa(0x142246e80L, "name-block g_wheelParams..g_fAngVel");
        // LEAD 3: gearbox caps consumers
        decompRva(0xd072c0L, "ParseGearbox_AngVel");
        decompRva(0xc404f0L, "DrivetrainUpdate_ApplyGear");
        decompRva(0xd72300L, "GetMaxGear");
    }
}
