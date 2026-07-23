// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.
// Ghidra headless: (1) decompile the action-handler registration fn 0xb5a2b0; (2) dump the
// handler pointer table in .data (0x2c471000..0x2c478200) resolving each qword to a function;
// (3) decompile gear-core caller 0xadd5a0; (4) find the axis/handbrake applier: functions that
// read Vehicle+0x68 AND write byte +0x48 (handbrake) AND dword/float +0x44 (accel).
import ghidra.app.script.GhidraScript;
import ghidra.app.decompiler.*;
import ghidra.program.model.address.Address;
import ghidra.program.model.lang.Register;
import ghidra.program.model.listing.*;
import ghidra.program.model.scalar.Scalar;
import java.util.*;

public class FinalTrace extends GhidraScript {
    DecompInterface dec; Address base; FunctionManager fm; Set<Long> done=new HashSet<>();

    void decompRva(long rva,String why){
        Function f=fm.getFunctionContaining(base.add(rva));
        if(f==null){println("// no func @0x"+Long.toHexString(rva)+" ("+why+")");return;}
        long er=f.getEntryPoint().subtract(base);
        if(!done.add(er)){println("// (dup "+f.getName()+" "+why+")");return;}
        println("\n// ===== "+f.getName()+" @ rva 0x"+Long.toHexString(er)+" size="+f.getBody().getNumAddresses()+"  ("+why+") =====");
        DecompileResults r=dec.decompileFunction(f,180,monitor);
        if(r!=null&&r.decompileCompleted()) println(r.getDecompiledFunction().getC());
        else println("// decompile failed");
    }

    boolean opDisp(Instruction insn,int op,long disp){
        Object[] objs; try{objs=insn.getOpObjects(op);}catch(Exception e){return false;}
        boolean reg=false; Scalar sc=null;
        for(Object o:objs){ if(o instanceof Register){String n=((Register)o).getName(); if(n.equals("RSP")||n.equals("RBP"))return false; reg=true;} else if(o instanceof Scalar) sc=(Scalar)o; }
        return reg&&sc!=null&&sc.getUnsignedValue()==disp;
    }

    public void run() throws Exception {
        base=currentProgram.getImageBase(); fm=currentProgram.getFunctionManager();
        dec=new DecompInterface(); dec.openProgram(currentProgram);

        decompRva(0xb5a2b0L,"action-handler registration");
        decompRva(0xadd5a0L,"gear-core caller (ShiftGear public?)");
        decompRva(0xa56b90L,"gear-core caller");

        // dump handler pointer table
        println("\n// --- handler table dump 0x2c47100..0x2c47820 (qwords pointing into code) ---");
        for(long a=0x2c47100L; a<0x2c47820L; a+=8){
            try{
                long v=currentProgram.getMemory().getLong(base.add(a));
                long rva=v-base.getOffset();
                if(rva>0x1000 && rva<0x2000000){
                    Function f=fm.getFunctionContaining(base.add(rva));
                    if(f!=null) println("//   [0x"+Long.toHexString(a)+"] -> 0x"+Long.toHexString(rva)+"  "+f.getName()+"@0x"+Long.toHexString(f.getEntryPoint().subtract(base)));
                }
            }catch(Exception e){}
        }

        // axis/handbrake applier: reads +0x68, writes byte +0x48 AND writes +0x44
        println("\n// --- functions: read +0x68 AND write +0x48 AND write +0x44 (axis/handbrake applier) ---");
        Map<Function,Boolean> r68=new HashMap<>(), w48=new HashMap<>(), w44=new HashMap<>();
        InstructionIterator it=currentProgram.getListing().getInstructions(true);
        while(it.hasNext()){
            Instruction insn=it.next();
            Function f=fm.getFunctionContaining(insn.getAddress());
            if(f==null)continue;
            for(int op=0;op<insn.getNumOperands();op++) if(opDisp(insn,op,0x68)){r68.put(f,true);break;}
            if(insn.getMnemonicString().equals("MOV")){
                if(opDisp(insn,0,0x48)) w48.put(f,true);
                if(opDisp(insn,0,0x44)) w44.put(f,true);
            }
        }
        List<Function> hits=new ArrayList<>();
        for(Function f:w48.keySet()) if(w44.containsKey(f)&&r68.containsKey(f)) hits.add(f);
        hits.sort(Comparator.comparingLong(f->f.getBody().getNumAddresses()));
        for(Function f:hits) println("//   "+f.getName()+"@0x"+Long.toHexString(f.getEntryPoint().subtract(base))+" size="+f.getBody().getNumAddresses());
        println("// (decompiling up to 6 compact hits)");
        int n=0;
        for(Function f:hits){ if(f.getBody().getNumAddresses()>500)continue; if(n++>=6)break; decompRva(f.getEntryPoint().subtract(base),"axis/handbrake applier"); }
    }
}
