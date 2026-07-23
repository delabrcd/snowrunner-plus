// Ghidra headless: decompile the functions CONTAINING a list of RVAs. Used to decompile code
// addresses caught by runtime hardware watchpoints (e.g. the physics integrator that writes
// chassis/wheel velocity). Edit ADDRS to the RVAs of interest.
//   analyzeHeadless <proj> snowrunner -process snowrunner-fixed.bin -noanalysis -postScript DecompAddrs.java
import ghidra.app.script.GhidraScript;
import ghidra.app.decompiler.DecompInterface;
import ghidra.app.decompiler.DecompileResults;
import ghidra.program.model.address.Address;
import ghidra.program.model.listing.Function;
import ghidra.program.model.listing.FunctionManager;
import java.util.LinkedHashSet;
import java.util.Set;

public class DecompAddrs extends GhidraScript {
    // gear-field writers caught by the HW watchpoint: 0xc4074e = shift (5 writes = 5 shifts),
    // 0xc404cb = per-frame gear sync
    long[] ADDRS = { 0xc4074eL, 0xc404cbL };

    public void run() throws Exception {
        Address base = currentProgram.getImageBase();
        FunctionManager fm = currentProgram.getFunctionManager();
        DecompInterface dec = new DecompInterface();
        dec.openProgram(currentProgram);
        Set<Function> funcs = new LinkedHashSet<>();
        for (long rva : ADDRS) {
            Function f = fm.getFunctionContaining(base.add(rva));
            if (f == null) { println("// no function @ rva 0x" + Long.toHexString(rva)); continue; }
            println("// rva 0x" + Long.toHexString(rva) + " is inside " + f.getName() + " @ 0x" + Long.toHexString(f.getEntryPoint().subtract(base)));
            funcs.add(f);
        }
        for (Function f : funcs) {
            long r = f.getEntryPoint().subtract(base);
            println("\n// ===== " + f.getName() + " @ rva 0x" + Long.toHexString(r) + " =====");
            DecompileResults res = dec.decompileFunction(f, 180, monitor);
            if (res != null && res.decompileCompleted()) println(res.getDecompiledFunction().getC());
            else println("// decompile failed: " + (res != null ? res.getErrorMessage() : "null"));
        }
    }
}
