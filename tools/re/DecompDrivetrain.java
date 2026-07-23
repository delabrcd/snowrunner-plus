// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.
// Ghidra headless post-script: decompile the XAudio2 SetFrequencyRatio wrapper (RVA 0xdfb2f0)
// and the functions that CALL it (where the engine pitch ratio is actually computed), plus a
// couple of neighbors. Prints pseudo-C so we can read the real engine-speed source.
//   analyzeHeadless <proj> <name> -import snowrunner-fixed.bin -postScript DecompDrivetrain.java
import ghidra.app.script.GhidraScript;
import ghidra.app.decompiler.DecompInterface;
import ghidra.app.decompiler.DecompileResults;
import ghidra.program.model.address.Address;
import ghidra.program.model.listing.Function;
import ghidra.program.model.listing.FunctionManager;
import ghidra.program.model.symbol.Reference;
import ghidra.program.model.symbol.ReferenceIterator;
import java.util.HashSet;
import java.util.Set;

public class DecompDrivetrain extends GhidraScript {
    DecompInterface dec;

    void dump(Function f, String tag) {
        if (f == null) { println("// " + tag + ": no function"); return; }
        long rva = f.getEntryPoint().subtract(currentProgram.getImageBase());
        println("\n// ===== " + tag + " : " + f.getName() + " @ rva 0x" + Long.toHexString(rva) + " =====");
        DecompileResults r = dec.decompileFunction(f, 120, monitor);
        if (r != null && r.decompileCompleted()) println(r.getDecompiledFunction().getC());
        else println("// decompile failed: " + (r != null ? r.getErrorMessage() : "null"));
    }

    public void run() throws Exception {
        Address base = currentProgram.getImageBase();
        FunctionManager fm = currentProgram.getFunctionManager();
        dec = new DecompInterface();
        dec.openProgram(currentProgram);

        long[] targets = { 0xdfb2f0L, 0xdfb340L };
        for (long rva : targets) {
            Function f = fm.getFunctionContaining(base.add(rva));
            dump(f, "target 0x" + Long.toHexString(rva));
        }

        // callers of the pitch wrapper 0xdfb2f0 = where the engine ratio is computed
        Function wrapper = fm.getFunctionContaining(base.add(0xdfb2f0L));
        if (wrapper != null) {
            println("\n// ##### CALLERS of pitch wrapper " + wrapper.getName() + " #####");
            ReferenceIterator it = currentProgram.getReferenceManager().getReferencesTo(wrapper.getEntryPoint());
            Set<Address> seen = new HashSet<>();
            int n = 0;
            while (it.hasNext() && n < 14) {
                Reference ref = it.next();
                Function c = fm.getFunctionContaining(ref.getFromAddress());
                if (c != null && seen.add(c.getEntryPoint())) { dump(c, "caller#" + n); n++; }
            }
            println("\n// total distinct callers dumped: " + n);
        }
    }
}
