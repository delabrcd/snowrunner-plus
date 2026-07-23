// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.
// Ghidra headless: identify the REAL TruckAction control setters by intersecting two facts
// per function: (a) it READS Vehicle+0x68 (-> TruckAction) somewhere, AND (b) it WRITES a
// control field on some pointer: byte +0x48/+0x49/+0x4a (handbrake/AWD/diff) or dword +0x74
// (commanded gear) / +0x3c (auto-mode). This kills the arena/constructor false positives that a
// bare offset scan produced. Prints matches with their write sites, sorted small->large, and
// decompiles the compact ones (likely the discrete setters).
import ghidra.app.script.GhidraScript;
import ghidra.app.decompiler.DecompInterface;
import ghidra.app.decompiler.DecompileResults;
import ghidra.program.model.address.Address;
import ghidra.program.model.lang.Register;
import ghidra.program.model.listing.*;
import ghidra.program.model.scalar.Scalar;
import java.util.*;

public class HuntTAWriters extends GhidraScript {
    DecompInterface dec; Address base; FunctionManager fm;

    boolean opHasDisp(Instruction insn, int opIdx, long disp) {
        Object[] objs;
        try { objs = insn.getOpObjects(opIdx); } catch (Exception e) { return false; }
        boolean reg=false; Scalar sc=null;
        for (Object o: objs){ if(o instanceof Register){ String n=((Register)o).getName(); if(n.equals("RSP")||n.equals("RBP")) return false; reg=true;} else if(o instanceof Scalar) sc=(Scalar)o; }
        return reg && sc!=null && sc.getUnsignedValue()==disp;
    }

    public void run() throws Exception {
        base = currentProgram.getImageBase();
        fm = currentProgram.getFunctionManager();
        dec = new DecompInterface(); dec.openProgram(currentProgram);

        Set<Long> ctrl = new TreeSet<>(Arrays.asList(0x48L,0x49L,0x4aL,0x74L,0x3cL,0x38L));
        Map<Function,Boolean> reads68 = new HashMap<>();
        Map<Function,TreeSet<Long>> writes = new LinkedHashMap<>();
        Map<Function,List<String>> sites = new HashMap<>();

        InstructionIterator it = currentProgram.getListing().getInstructions(true);
        while (it.hasNext()) {
            Instruction insn = it.next();
            Function f = fm.getFunctionContaining(insn.getAddress());
            if (f==null) continue;
            // (a) reads +0x68 : any operand memory with disp 0x68 (source side, opIdx 1 usually, or 0 for cmp)
            for (int op=0; op<insn.getNumOperands(); op++) if (opHasDisp(insn,op,0x68)) { reads68.put(f,true); break; }
            // (b) writes control field: MOV dest op0 memory with ctrl disp
            if (insn.getMnemonicString().equals("MOV")) {
                for (long d: ctrl) if (opHasDisp(insn,0,d)) {
                    writes.computeIfAbsent(f,k->new TreeSet<>()).add(d);
                    sites.computeIfAbsent(f,k->new ArrayList<>()).add("0x"+Long.toHexString(insn.getAddress().subtract(base))+"  "+insn.toString());
                }
            }
        }

        // intersection: functions that read +0x68 AND write a control field
        List<Function> hits = new ArrayList<>();
        for (Function f: writes.keySet()) if (reads68.containsKey(f)) hits.add(f);
        hits.sort(Comparator.comparingLong(f->f.getBody().getNumAddresses()));

        println("// ==== functions that READ Vehicle+0x68 AND write a control field ("+hits.size()+") ====");
        for (Function f: hits) {
            long rva=f.getEntryPoint().subtract(base);
            StringBuilder sb=new StringBuilder(); for(Long d: writes.get(f)) sb.append("+0x").append(Long.toHexString(d)).append(" ");
            println("// FUNC "+f.getName()+" @ rva 0x"+Long.toHexString(rva)+" size="+f.getBody().getNumAddresses()+"  writes: "+sb);
            for (String s: sites.get(f)) println("//     "+s);
        }

        // decompile the compact ones (<= 90 instructions) -- discrete setters live here
        println("\n// ==== decompiles of compact hits ====");
        int n=0;
        for (Function f: hits) {
            if (f.getBody().getNumAddresses() > 400) continue;
            if (n++ >= 24) { println("// ...more compact hits omitted"); break; }
            long rva=f.getEntryPoint().subtract(base);
            println("\n// ===== "+f.getName()+" @ rva 0x"+Long.toHexString(rva)+" size="+f.getBody().getNumAddresses()+" =====");
            DecompileResults r = dec.decompileFunction(f,120,monitor);
            if (r!=null && r.decompileCompleted()) println(r.getDecompiledFunction().getC());
            else println("// decompile failed");
        }
    }
}
