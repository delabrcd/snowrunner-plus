// Per-wheel physics/state update helpers from the drivetrain sync loop. Goal: find who WRITES
// wheel+0x16c (and what it derives from -- a Havok body angVel read = true wheel speed; a constant =
// a flag) and any read of a rigid-body angVel (+0x240) or motion angVel (+0xf0). RVAs (imagebase
// 0x6ffffa670000): 0xc26160 per-wheel update (FUN_..296160), 0xc26080 shift-test (FUN_..296080),
// 0xd71850 wheel getter (FUN_..3e1850), 0xd72890 (FUN_..3e2890).
import ghidra.app.script.GhidraScript;
import ghidra.app.decompiler.DecompInterface;
import ghidra.app.decompiler.DecompileResults;
import ghidra.program.model.address.Address;
import ghidra.program.model.listing.Function;
import ghidra.program.model.listing.FunctionManager;

public class DecompWheelUpdate extends GhidraScript {
    long[] ADDRS = { 0xc26160L, 0xc26080L, 0xd71850L, 0xd72890L };

    public void run() throws Exception {
        Address base = currentProgram.getImageBase();
        FunctionManager fm = currentProgram.getFunctionManager();
        DecompInterface dec = new DecompInterface();
        dec.toggleCCode(true);
        dec.openProgram(currentProgram);
        for (long rva : ADDRS) {
            Function f = fm.getFunctionContaining(base.add(rva));
            if (f == null) { println("// no function @ rva 0x" + Long.toHexString(rva)); continue; }
            long r = f.getEntryPoint().subtract(base);
            long sz = f.getBody().getNumAddresses();
            println("\n// ===== " + f.getName() + " @ rva 0x" + Long.toHexString(r) + " size=" + sz + " =====");
            if (sz > 24000) { println("// SKIP too big " + sz); continue; }
            DecompileResults res = dec.decompileFunction(f, 240, monitor);
            if (res != null && res.decompileCompleted()) println(res.getDecompiledFunction().getC());
            else println("// decompile failed: " + (res != null ? res.getErrorMessage() : "null"));
        }
    }
}
