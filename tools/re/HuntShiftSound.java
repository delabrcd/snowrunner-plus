// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.
// Hunt the gear-shift sound trigger:
//  1. xref the "GearFail" / "Gear" sound-tag strings -> the truck <Sounds> parser -> learn
//     which sound-set field holds the Gear (shift clunk) sound object.
//  2. decompile hi_DrivetrainUpdate_ApplyGear @ rva 0xc404f0 (gear copy at 0xc4074e) — the
//     play call should be near the commanded->current gear copy.
//   analyzeHeadless <proj> snowrunner -process snowrunner-fixed.bin -noanalysis -postScript HuntShiftSound.java
import ghidra.app.script.GhidraScript;
import ghidra.app.decompiler.DecompInterface;
import ghidra.app.decompiler.DecompileResults;
import ghidra.program.model.address.Address;
import ghidra.program.model.listing.Function;
import ghidra.program.model.symbol.Reference;
import java.util.LinkedHashSet;
import java.util.Set;

public class HuntShiftSound extends GhidraScript {
    DecompInterface dec;

    void decomp(Function f, String why) {
        long rva = f.getEntryPoint().subtract(currentProgram.getImageBase());
        println("\n// ===== " + f.getName() + " @ rva 0x" + Long.toHexString(rva) + "  (" + why + ") =====");
        DecompileResults res = dec.decompileFunction(f, 240, monitor);
        if (res != null && res.decompileCompleted()) println(res.getDecompiledFunction().getC());
        else println("// decompile failed");
    }

    public void run() throws Exception {
        Address base = currentProgram.getImageBase();
        dec = new DecompInterface();
        dec.openProgram(currentProgram);

        // -- 1: string anchors --
        Set<Function> parsers = new LinkedHashSet<>();
        for (String tag : new String[]{"GearFail", "BrakePull"}) {   // two tags from the same <Sounds> block
            StringBuilder hex = new StringBuilder();
            for (char c : tag.toCharArray()) hex.append(String.format("%02x ", (int) c));
            hex.append("00");                            // NUL-terminated = the exact C string
            Address a = base;
            int n = 0;
            while ((a = findBytes(a.add(1), hex.toString())) != null && n++ < 8) {
                println("// string \"" + tag + "\" @ rva 0x" + Long.toHexString(a.subtract(base)));
                for (Reference r : getReferencesTo(a)) {
                    Function f = getFunctionContaining(r.getFromAddress());
                    println("//   xref from 0x" + Long.toHexString(r.getFromAddress().subtract(base)) +
                            (f != null ? " in " + f.getName() + " @ 0x" + Long.toHexString(f.getEntryPoint().subtract(base)) : " (no func)"));
                    if (f != null) parsers.add(f);
                }
            }
        }
        for (Function f : parsers) decomp(f, "sound-tag parser candidate");

        // -- 2: the gear-apply function --
        Function apply = getFunctionContaining(base.add(0xc404f0L));
        if (apply != null) decomp(apply, "hi_DrivetrainUpdate_ApplyGear");
        else println("// no function at 0xc404f0!");
    }
}
