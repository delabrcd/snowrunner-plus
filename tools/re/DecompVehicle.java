// Ghidra headless query #3: xref the TRUCK_CONTROL global (rva 0x2A8EDD8) -> the runtime
// vehicle-update functions -> the wheel loop (Vehicle+0x200). Decompile referencing functions and
// keep the ones that actually touch wheel offsets (0x200 / 0x60 / angular-velocity math).
//   analyzeHeadless <proj> snowrunner -process snowrunner-fixed.bin -noanalysis -postScript DecompVehicle.java
import ghidra.app.script.GhidraScript;
import ghidra.app.decompiler.DecompInterface;
import ghidra.app.decompiler.DecompileResults;
import ghidra.program.model.address.Address;
import ghidra.program.model.listing.Function;
import ghidra.program.model.listing.FunctionManager;
import ghidra.program.model.symbol.Reference;
import java.util.LinkedHashSet;
import java.util.Set;

public class DecompVehicle extends GhidraScript {
    public void run() throws Exception {
        Address base = currentProgram.getImageBase();
        FunctionManager fm = currentProgram.getFunctionManager();
        DecompInterface dec = new DecompInterface();
        dec.openProgram(currentProgram);

        Address global = base.add(0x2A8EDD8L);
        Reference[] refs = getReferencesTo(global);
        println("// TRUCK_CONTROL @ rva 0x2A8EDD8  refs=" + refs.length);
        Set<Function> funcs = new LinkedHashSet<>();
        for (Reference r : refs) {
            Function f = fm.getFunctionContaining(r.getFromAddress());
            if (f != null) funcs.add(f);
        }
        println("// distinct referencing functions: " + funcs.size());
        int printed = 0;
        for (Function f : funcs) {
            long rva = f.getEntryPoint().subtract(base);
            DecompileResults res = dec.decompileFunction(f, 90, monitor);
            if (res == null || !res.decompileCompleted()) { println("// " + f.getName() + " rva 0x" + Long.toHexString(rva) + " : decompile failed"); continue; }
            String c = res.getDecompiledFunction().getC();
            boolean wheel = c.contains("0x200") || c.contains("+ 0x60)") || c.contains("0x208");
            println("// FUN rva 0x" + Long.toHexString(rva) + "  len=" + c.length() + "  wheelish=" + wheel);
            if (wheel && printed < 8) {
                println("\n// ===== VEHICLE fn rva 0x" + Long.toHexString(rva) + " =====");
                println(c);
                printed++;
            }
        }
        println("\n// printed " + printed + " wheel-touching functions");
    }
}
