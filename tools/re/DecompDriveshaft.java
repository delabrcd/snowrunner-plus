// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.
// Ghidra headless: find the game's single-source DRIVESHAFT / output angular velocity.
// Anchors (VA; RVA = VA - 0x140000000):
//   0x142222160  debug HUD "%s %.1f m/s (%.1f km/h)\r\nAngVel %.1f (delta %.3f)"  <- prints the value
//   0x142287f60  "g_fAngVel"  (current angular velocity float; grouped with mesh/visual params)
//   0x142265608  "MaxDeltaAngVel"  (the per-tick delta cap => an integrator writes the angvel)
//   0x1422657e8  "AngVel"      (per-gear cap parser)
// Known funcs: DrivetrainUpdate_ApplyGear @0xc404f0, ParseGearbox_AngVel @0xd072c0.
// Reuse cached program:
//   analyzeHeadless <proj> snowrunner -process snowrunner-fixed.bin -noanalysis \
//     -scriptPath tools/re -postScript DecompDriveshaft.java
import ghidra.app.script.GhidraScript;
import ghidra.app.decompiler.*;
import ghidra.program.model.address.Address;
import ghidra.program.model.listing.*;
import ghidra.program.model.symbol.*;
import java.util.*;

public class DecompDriveshaft extends GhidraScript {
    Address base; DecompInterface dec; FunctionManager fm; Set<Long> done = new HashSet<>();
    long rva(Address a) { return a.subtract(base); }

    void dumpFunc(Function f, String why) {
        if (f == null) { println("// null func: " + why); return; }
        long er = rva(f.getEntryPoint());
        if (!done.add(er)) { println("// (dup " + f.getName() + " @0x" + Long.toHexString(er) + " -- " + why + ")"); return; }
        println("\n// ===== " + f.getName() + " @ rva 0x" + Long.toHexString(er) + "  size=" + f.getBody().getNumAddresses() + "  (" + why + ") =====");
        DecompileResults r = dec.decompileFunction(f, 180, monitor);
        if (r != null && r.decompileCompleted()) println(r.getDecompiledFunction().getC());
        else println("// decompile failed: " + (r != null ? r.getErrorMessage() : "null"));
    }

    void xrefDecomp(long va, String why, int maxFns) {
        Address a = base.add(va - 0x140000000L);
        println("\n// #### xrefs -> " + why + " @ VA 0x" + Long.toHexString(va) + " ####");
        ReferenceIterator it = currentProgram.getReferenceManager().getReferencesTo(a);
        Set<Long> fns = new LinkedHashSet<>(); int n = 0;
        while (it.hasNext() && n < 60) { Reference r = it.next(); Function f = fm.getFunctionContaining(r.getFromAddress()); if (f != null) fns.add(rva(f.getEntryPoint())); n++; }
        println("// " + n + " refs in " + fns.size() + " distinct funcs");
        int c = 0; for (long er : fns) { if (c++ >= maxFns) { println("// ...(" + (fns.size() - maxFns) + " more)"); break; } dumpFunc(fm.getFunctionContaining(base.add(er)), why + " xref"); }
    }

    public void run() throws Exception {
        base = currentProgram.getImageBase(); fm = currentProgram.getFunctionManager();
        dec = new DecompInterface(); dec.openProgram(currentProgram);
        println("// imageBase=0x" + Long.toHexString(base.getOffset()));
        xrefDecomp(0x142222160L, "debugHUD_AngVel", 4);   // THE readout of the value we want
        xrefDecomp(0x142287f60L, "g_fAngVel", 4);
        xrefDecomp(0x142265608L, "MaxDeltaAngVel", 4);    // integrator that writes current angvel
        dumpFunc(fm.getFunctionContaining(base.add(0xc404f0L)), "DrivetrainUpdate_ApplyGear");
        dumpFunc(fm.getFunctionContaining(base.add(0xd072c0L)), "ParseGearbox_AngVel");
    }
}
