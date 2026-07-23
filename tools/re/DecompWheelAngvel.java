// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.
// Decompile the drivetrain functions to find the "current output angvel" the game compares against
// caps[gear] (the shift threshold) — that value, in cap units, is the true drivetrain angvel we want
// for RPM. Targets: DrivetrainWheelGearSync @0xc3fe20 (traction loop + shift compare) and
// DrivetrainUpdate_ApplyGear @0xc404f0 (reads wheelModel+0x16c). Also GetGearData @0xd72640.
import ghidra.app.script.GhidraScript;
import ghidra.app.decompiler.DecompInterface;
import ghidra.app.decompiler.DecompileResults;
import ghidra.program.model.address.Address;
import ghidra.program.model.listing.Function;
import ghidra.program.model.listing.FunctionManager;

public class DecompWheelAngvel extends GhidraScript {
    long[] ADDRS = { 0xc3fe20L, 0xc404f0L, 0xd72640L };

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
            if (sz > 24000) { println("// SKIP: too big to decompile safely (" + sz + " bytes)"); continue; }
            DecompileResults res = dec.decompileFunction(f, 240, monitor);
            if (res != null && res.decompileCompleted()) println(res.getDecompiledFunction().getC());
            else println("// decompile failed: " + (res != null ? res.getErrorMessage() : "null"));
        }
    }
}
