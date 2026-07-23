// Ghidra headless: find writers of the TruckAction control fields so we can identify the
// SwitchAWD / diff-lock / handbrake / manual-shift setters on the CURRENT build.
// Strategy: single pass over all instructions; collect every MOV whose DESTINATION is a
// memory operand [reg(+reg)+disp8] with disp in the interesting TruckAction offset set.
// Group by containing function, report which offsets each touches (+ whether it also reads
// Vehicle+0x68 = ->TruckAction), then decompile the strongest candidates.
//   analyzeHeadless reference/ghidra-proj snowrunner -process snowrunner-fixed.bin -noanalysis \
//     -scriptPath tools/re -postScript HuntInputSetters.java
import ghidra.app.script.GhidraScript;
import ghidra.app.decompiler.DecompInterface;
import ghidra.app.decompiler.DecompileResults;
import ghidra.program.model.address.Address;
import ghidra.program.model.lang.Register;
import ghidra.program.model.listing.*;
import ghidra.program.model.scalar.Scalar;
import java.util.*;

public class HuntInputSetters extends GhidraScript {
    DecompInterface dec;
    Address base;
    FunctionManager fm;

    void decomp(Function f, String why) {
        long rva = f.getEntryPoint().subtract(base);
        println("\n// ===== " + f.getName() + " @ rva 0x" + Long.toHexString(rva) + "  (" + why + ") =====");
        DecompileResults r = dec.decompileFunction(f, 120, monitor);
        if (r != null && r.decompileCompleted()) println(r.getDecompiledFunction().getC());
        else println("// decompile failed: " + (r != null ? r.getErrorMessage() : "null"));
    }

    public void run() throws Exception {
        base = currentProgram.getImageBase();
        fm = currentProgram.getFunctionManager();
        dec = new DecompInterface();
        dec.openProgram(currentProgram);

        // interesting TruckAction offsets: 0x38 PowerCoef, 0x3c IsInAutoMode, 0x48 Handbrake,
        // 0x49 AWD, 0x4a Diff, 0x70 current gear, 0x74 commanded gear
        Set<Long> want = new TreeSet<>(Arrays.asList(0x38L,0x3cL,0x48L,0x49L,0x4aL,0x70L,0x74L));

        Map<Function,TreeSet<Long>> touched = new LinkedHashMap<>();
        Map<Function,List<String>> sites = new HashMap<>();

        InstructionIterator it = currentProgram.getListing().getInstructions(true);
        long count = 0;
        while (it.hasNext()) {
            Instruction insn = it.next();
            count++;
            if (!insn.getMnemonicString().equals("MOV")) continue;
            // destination = operand 0. Store => op0 is memory: has a base Register AND a Scalar disp.
            Object[] objs;
            try { objs = insn.getOpObjects(0); } catch (Exception e) { continue; }
            Scalar sc = null; boolean hasReg = false;
            for (Object o : objs) {
                if (o instanceof Scalar) sc = (Scalar) o;
                else if (o instanceof Register) hasReg = true;
            }
            if (sc == null || !hasReg) continue;
            long v = sc.getUnsignedValue();
            if (!want.contains(v)) continue;
            Function f = fm.getFunctionContaining(insn.getAddress());
            if (f == null) continue;
            touched.computeIfAbsent(f, k -> new TreeSet<>()).add(v);
            sites.computeIfAbsent(f, k -> new ArrayList<>())
                 .add("0x" + Long.toHexString(insn.getAddress().subtract(base)) + "  " + insn.toString());
        }
        println("// scanned " + count + " instructions");

        // Report functions that write a *control* field (0x48/0x49/0x4a) or commanded gear (0x74).
        Set<Long> control = new TreeSet<>(Arrays.asList(0x48L,0x49L,0x4aL,0x74L));
        List<Function> candidates = new ArrayList<>();
        println("\n// ==== functions writing control/shift fields ====");
        for (Map.Entry<Function,TreeSet<Long>> e : touched.entrySet()) {
            boolean hit = false;
            for (Long o : e.getValue()) if (control.contains(o)) hit = true;
            if (!hit) continue;
            Function f = e.getKey();
            long rva = f.getEntryPoint().subtract(base);
            StringBuilder sb = new StringBuilder();
            for (Long o : e.getValue()) sb.append("+0x").append(Long.toHexString(o)).append(" ");
            println("// FUNC " + f.getName() + " @ rva 0x" + Long.toHexString(rva) + "  touches: " + sb);
            for (String s : sites.get(f)) println("//     " + s);
            candidates.add(f);
        }

        // Decompile: small setters first (likely the toggles), cap total.
        candidates.sort(Comparator.comparingLong(f -> f.getBody().getNumAddresses()));
        int n = 0;
        for (Function f : candidates) {
            if (n++ >= 30) { println("\n// ...(" + (candidates.size()-30) + " more candidates not decompiled)"); break; }
            decomp(f, "size=" + f.getBody().getNumAddresses());
        }
    }
}
