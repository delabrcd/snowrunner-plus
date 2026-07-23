// Ghidra headless: decompile the containing functions of the interesting control-field write
// sites found by HuntInputSetters, plus known anchors, plus callers/callees of GetMaxGear
// (the shift cluster). Read-only; -noanalysis.
import ghidra.app.script.GhidraScript;
import ghidra.app.decompiler.DecompInterface;
import ghidra.app.decompiler.DecompileResults;
import ghidra.program.model.address.Address;
import ghidra.program.model.listing.*;
import ghidra.program.model.symbol.Reference;
import ghidra.program.model.symbol.ReferenceIterator;
import java.util.*;

public class DecompInputMap extends GhidraScript {
    DecompInterface dec;
    Address base;
    FunctionManager fm;
    Set<Long> done = new HashSet<>();

    void decompRva(long rva, String why) {
        Function f = fm.getFunctionContaining(base.add(rva));
        if (f == null) { println("// no function @ rva 0x" + Long.toHexString(rva) + " (" + why + ")"); return; }
        long er = f.getEntryPoint().subtract(base);
        if (!done.add(er)) { println("// (already dumped " + f.getName() + " @ 0x" + Long.toHexString(er) + " -- " + why + ")"); return; }
        println("\n// ===== " + f.getName() + " @ rva 0x" + Long.toHexString(er) + "  size=" + f.getBody().getNumAddresses() + "  (" + why + ") =====");
        DecompileResults r = dec.decompileFunction(f, 120, monitor);
        if (r != null && r.decompileCompleted()) println(r.getDecompiledFunction().getC());
        else println("// decompile failed: " + (r != null ? r.getErrorMessage() : "null"));
    }

    public void run() throws Exception {
        base = currentProgram.getImageBase();
        fm = currentProgram.getFunctionManager();
        dec = new DecompInterface();
        dec.openProgram(currentProgram);

        // ---- known anchors ----
        decompRva(0xd72300L, "GetMaxGear (known)");
        decompRva(0xd72640L, "gear-param lookup (known)");
        decompRva(0xd71750L, "gear-param lookup (known)");

        // ---- candidate control-field writers (triple copy handbrake/AWD/diff) ----
        long[] cands = {
            0xacb9ecL, // near old SetCurrentVehicle 0xacbb90 -- triple copy 0x48/49/4a
            0xa03389L, 0xa03fbcL, 0xa7e1ecL, 0xaab3a9L, 0xaab5d7L, // other triple-copy sites
            0x90b9eL,  // writes +0x49 (R8B) and +0x48 (AL) and +0x3c -- combined setter
            0x4321e9L, // [RCX+0x49]=0  AWD reset
            0x8567d7L, // [R15+0x4a]=0  diff reset
            0x9efa2dL, 0x9efcd0L, // [RSI+0x48]=0 / [RSI+0x4a]=1
            0x92fd67L, 0x9e8c97L, 0x121e40L, // RBX triple writers
            0xad642cL, 0xbfac12L, 0xb01494L, // handbrake=1/1/0 single writers
            0x54e847L, 0x52bee1L, 0x566f43L, 0x57706aL, // other 0x48 byte writers
        };
        for (long a : cands) decompRva(a, "control-writer @0x" + Long.toHexString(a));

        // ---- callers of GetMaxGear = the shift cluster ----
        Function gmg = fm.getFunctionContaining(base.add(0xd72300L));
        if (gmg != null) {
            println("\n// ##### CALLERS of GetMaxGear (0xd72300) -- the shift functions #####");
            ReferenceIterator it = currentProgram.getReferenceManager().getReferencesTo(gmg.getEntryPoint());
            Set<Address> seen = new HashSet<>();
            int n = 0;
            while (it.hasNext() && n < 20) {
                Reference ref = it.next();
                Function c = fm.getFunctionContaining(ref.getFromAddress());
                if (c != null && seen.add(c.getEntryPoint())) {
                    long cr = c.getEntryPoint().subtract(base);
                    println("//   caller " + c.getName() + " @ rva 0x" + Long.toHexString(cr));
                    n++;
                }
            }
        }
    }
}
