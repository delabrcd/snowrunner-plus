// Find the live AngVel source. (1) The debug HUD string @0x2222160 ("%s %.1f m/s .. AngVel %.1f
// (delta %.3f)") -- decompile whoever references it; it reads ground speed + AngVel + delta(slip)
// from memory. (2) g_fAngVel @0x2287f60 -- list all xrefs (writers = the value's producer) and
// decompile them. Report the exact memory field each reads/writes.
import ghidra.app.script.GhidraScript;
import ghidra.app.decompiler.DecompInterface;
import ghidra.app.decompiler.DecompileResults;
import ghidra.program.model.address.Address;
import ghidra.program.model.listing.*;
import ghidra.program.model.symbol.*;
import java.util.LinkedHashSet;
import java.util.Set;

public class DecompAngVelSource extends GhidraScript {
    long[] DATA = { 0x2222160L, 0x2287f60L };

    public void run() throws Exception {
        Address base = currentProgram.getImageBase();
        FunctionManager fm = currentProgram.getFunctionManager();
        ReferenceManager rm = currentProgram.getReferenceManager();
        DecompInterface dec = new DecompInterface();
        dec.toggleCCode(true);
        dec.openProgram(currentProgram);
        Set<Function> funcs = new LinkedHashSet<>();
        for (long rva : DATA) {
            Address d = base.add(rva);
            println("\n// ==== xrefs to 0x" + Long.toHexString(rva) + " ====");
            ReferenceIterator it = rm.getReferencesTo(d);
            int c = 0;
            while (it.hasNext() && c < 40) {
                Reference r = it.next();
                Address from = r.getFromAddress();
                Function f = fm.getFunctionContaining(from);
                String fn = f == null ? "(none)" : f.getName() + " @0x" + Long.toHexString(f.getEntryPoint().subtract(base));
                println("//   " + r.getReferenceType() + " from 0x" + Long.toHexString(from.subtract(base)) + " in " + fn);
                if (f != null && f.getBody().getNumAddresses() <= 24000) funcs.add(f);
                c++;
            }
        }
        for (Function f : funcs) {
            long r = f.getEntryPoint().subtract(base);
            println("\n// ===== " + f.getName() + " @ rva 0x" + Long.toHexString(r) + " size=" + f.getBody().getNumAddresses() + " =====");
            DecompileResults res = dec.decompileFunction(f, 240, monitor);
            if (res != null && res.decompileCompleted()) println(res.getDecompiledFunction().getC());
            else println("// decompile failed: " + (res != null ? res.getErrorMessage() : "null"));
        }
    }
}
