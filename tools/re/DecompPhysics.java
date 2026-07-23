// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.
// Ghidra headless query #2: find the WHEEL/PHYSICS code (not audio). Anchors on strings we know
// exist — g_fAngVel (wheel angular velocity shader uniform), AngVel, wheel/traction/slip/soft —
// lists the functions that reference them, and decompiles the strongest wheel-angvel candidates.
//   analyzeHeadless <proj> snowrunner -process snowrunner-fixed.bin -noanalysis -postScript DecompPhysics.java
import ghidra.app.script.GhidraScript;
import ghidra.app.decompiler.DecompInterface;
import ghidra.app.decompiler.DecompileResults;
import ghidra.program.model.address.Address;
import ghidra.program.model.data.StringDataInstance;
import ghidra.program.model.listing.Data;
import ghidra.program.model.listing.DataIterator;
import ghidra.program.model.listing.Function;
import ghidra.program.model.listing.FunctionManager;
import ghidra.program.model.symbol.Reference;
import java.util.LinkedHashSet;
import java.util.Set;

public class DecompPhysics extends GhidraScript {
    DecompInterface dec;
    Address base;
    FunctionManager fm;

    String[] KEYS = { "g_fAngVel", "AngVel", "WheelAngular", "wheelParams", "traction", "Traction",
                      "slip", "Slip", "wheelSpeed", "WheelSpeed", "g_softParams", "differential" };

    long rva(Address a) { return a.subtract(base); }

    void decompile(Function f, String tag) {
        long r = rva(f.getEntryPoint());
        println("\n// ===== " + tag + " : " + f.getName() + " @ rva 0x" + Long.toHexString(r) + " =====");
        DecompileResults res = dec.decompileFunction(f, 120, monitor);
        if (res != null && res.decompileCompleted()) println(res.getDecompiledFunction().getC());
        else println("// decompile failed");
    }

    public void run() throws Exception {
        base = currentProgram.getImageBase();
        fm = currentProgram.getFunctionManager();
        dec = new DecompInterface();
        dec.openProgram(currentProgram);

        Set<Function> hits = new LinkedHashSet<>();
        DataIterator di = currentProgram.getListing().getDefinedData(true);
        int strchecked = 0;
        while (di.hasNext() && hits.size() < 40) {
            Data d = di.next();
            StringDataInstance sd = StringDataInstance.getStringDataInstance(d);
            String s = sd != null ? sd.getStringValue() : null;
            if (s == null || s.length() < 3) continue;
            strchecked++;
            boolean match = false;
            for (String k : KEYS) if (s.contains(k)) { match = true; break; }
            if (!match) continue;
            Reference[] refs = getReferencesTo(d.getAddress());
            if (refs.length == 0) continue;
            println("// STRING @ rva 0x" + Long.toHexString(rva(d.getAddress())) + "  \"" +
                    (s.length() > 60 ? s.substring(0, 60) + "..." : s) + "\"  refs=" + refs.length);
            for (Reference ref : refs) {
                Function f = fm.getFunctionContaining(ref.getFromAddress());
                if (f != null) { hits.add(f); println("//    <- " + f.getName() + " @ rva 0x" + Long.toHexString(rva(f.getEntryPoint()))); }
            }
        }
        println("\n// scanned " + strchecked + " strings; decompiling " + hits.size() + " referencing functions\n");
        int n = 0;
        for (Function f : hits) { decompile(f, "phys#" + n); n++; if (n >= 12) break; }
    }
}
