// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.
// Ghidra headless: decompile the STOCK TRANSMISSION cluster to get the exact cap<->physical relation.
// From hi_DrivetrainUpdate_ApplyGear (0xc404f0): GetGearData(gearbox,gear,...) returns cap-derived
// params, then they are scaled by a gearbox-level scalar *FUN_0xd71750(gearbox). That scalar is the
// suspected per-truck final-drive constant (why truck A caps ~= m/s but a crawler's are ~1/3 speed).
// Targets: the cap accessor, the scalar source, neighbors, and the callers of DrivetrainUpdate (the
// shift-decision / ground-speed comparison that writes the commanded gear).
//   analyzeHeadless <proj> snowrunner -process snowrunner-fixed.bin -noanalysis \
//     -scriptPath tools/re -postScript DecompTransmission.java
import ghidra.app.script.GhidraScript;
import ghidra.app.decompiler.*;
import ghidra.program.model.address.Address;
import ghidra.program.model.listing.*;
import ghidra.program.model.symbol.*;
import java.util.*;

public class DecompTransmission extends GhidraScript {
    Address base; DecompInterface dec; FunctionManager fm; Set<Long> done = new HashSet<>();
    long rva(Address a) { return a.subtract(base); }

    void dump(long rva, String why) {
        Function f = fm.getFunctionContaining(base.add(rva));
        if (f == null) { println("// null @0x" + Long.toHexString(rva) + " (" + why + ")"); return; }
        long er = rva(f.getEntryPoint());
        if (!done.add(er)) { println("// (dup " + f.getName() + " @0x" + Long.toHexString(er) + " -- " + why + ")"); return; }
        long sz = f.getBody().getNumAddresses();
        println("\n// ===== " + f.getName() + " @ rva 0x" + Long.toHexString(er) + " size=" + sz + " (" + why + ") =====");
        if (sz > 20000) { println("// (too large, skipped)"); return; }
        DecompileResults r = dec.decompileFunction(f, 120, monitor);
        println(r != null && r.decompileCompleted() ? r.getDecompiledFunction().getC() : "// decompile failed");
    }

    void callers(long rva, String name, int max) {
        Function f = fm.getFunctionContaining(base.add(rva));
        if (f == null) { println("// no func @0x" + Long.toHexString(rva)); return; }
        println("\n// #### CALLERS of " + name + " (0x" + Long.toHexString(rva) + ") ####");
        ReferenceIterator it = currentProgram.getReferenceManager().getReferencesTo(f.getEntryPoint());
        Set<Long> seen = new LinkedHashSet<>(); int n = 0;
        while (it.hasNext() && n < 30) { Reference r = it.next(); Function c = fm.getFunctionContaining(r.getFromAddress()); if (c != null) seen.add(rva(c.getEntryPoint())); n++; }
        println("// " + seen.size() + " distinct callers");
        int c = 0; for (long er : seen) { if (c++ >= max) break; dump(er, name + " caller"); }
    }

    public void run() throws Exception {
        base = currentProgram.getImageBase(); fm = currentProgram.getFunctionManager();
        dec = new DecompInterface(); dec.openProgram(currentProgram);
        println("// imageBase=0x" + Long.toHexString(base.getOffset()));
        // the cap accessor + the gearbox scalar (final-drive?) + drivetrain-update helpers
        dump(0xd72640L, "GetGearData_capParams");     // returns the per-gear cap-derived params
        dump(0xd71750L, "Gearbox_scalar_src");         // *result scales the gear params (final drive?)
        dump(0xd72300L, "GetMaxGear");
        dump(0xd719a0L, "DrivetrainUpdate_helper_19a0");
        dump(0xd62c00L, "Gearbox_obj_5e8_5f0");        // ratio = *(+0x5e8) / *(+0x5f0)
        dump(0xd06190L, "ParseEngine_MaxDeltaAngVel");
        // the shift DECISION lives in the caller(s) of the drivetrain update (writes commanded gear)
        callers(0xc404f0L, "DrivetrainUpdate_ApplyGear", 3);
    }
}
