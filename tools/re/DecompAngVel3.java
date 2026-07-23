// Run 3: pinpoint the writer of the AngVel telemetry member. Require STORE to 0x17c AND 0x180
// AND 0x184 on the same function, plus a [reg+0x20] deref (Vehicle back-ptr). Decompile hits +
// the near-HUD candidate FUN @0xa5f950.
import ghidra.app.script.GhidraScript;
import ghidra.app.decompiler.*;
import ghidra.program.model.address.Address;
import ghidra.program.model.listing.*;
import java.util.*;

public class DecompAngVel3 extends GhidraScript {
    DecompInterface dec; Address base; FunctionManager fm; Set<Long> done = new HashSet<>();
    long rva(Address a){ return a.subtract(base); }

    void decompRva(long r, String why){
        Function f=fm.getFunctionContaining(base.add(r));
        if(f==null){println("// no func @0x"+Long.toHexString(r));return;}
        long er=rva(f.getEntryPoint());
        if(!done.add(er)){println("// (dup "+f.getName()+" @0x"+Long.toHexString(er)+")");return;}
        println("\n// ===== "+f.getName()+" @ rva 0x"+Long.toHexString(er)+" size="+f.getBody().getNumAddresses()+"  ("+why+") =====");
        DecompileResults res=dec.decompileFunction(f,150,monitor);
        if(res!=null&&res.decompileCompleted()) println(res.getDecompiledFunction().getC());
        else println("// decompile failed: "+(res!=null?res.getErrorMessage():"null"));
    }

    boolean storeTo(Instruction in, String disp){
        String m=in.getMnemonicString();
        if(!(m.startsWith("MOV")||m.contains("movss")||m.contains("MOVSS"))) return false;
        if(in.getNumOperands()<2) return false;
        return in.getDefaultOperandRepresentation(0).contains(disp);
    }

    public void run() throws Exception {
        base=currentProgram.getImageBase(); fm=currentProgram.getFunctionManager();
        dec=new DecompInterface(); dec.openProgram(currentProgram);

        println("// ##### tight scan: store 0x17c & 0x180 & 0x184, and a +0x20 deref #####");
        List<Long> writers=new ArrayList<>();
        FunctionIterator fi=fm.getFunctions(true);
        while(fi.hasNext()){
            Function f=fi.next();
            boolean s17c=false,s180=false,s184=false,d20=false;
            Address at180=null;
            InstructionIterator ii=currentProgram.getListing().getInstructions(f.getBody(),true);
            while(ii.hasNext()){
                Instruction in=ii.next();
                if(storeTo(in,"0x17c]")) s17c=true;
                if(storeTo(in,"0x180]")){ s180=true; if(at180==null)at180=in.getAddress(); }
                if(storeTo(in,"0x184]")) s184=true;
                String s=in.toString();
                if(s.contains("0x20]")) d20=true;
            }
            if(s17c&&s180&&s184){
                println("//  WRITER "+f.getName()+" @ rva 0x"+Long.toHexString(rva(f.getEntryPoint()))
                        +"  +0x20deref="+d20+"  store180@0x"+(at180!=null?Long.toHexString(rva(at180)):"?")
                        +"  size="+f.getBody().getNumAddresses());
                writers.add(rva(f.getEntryPoint()));
            }
        }
        println("//  writers found = "+writers.size());
        for(long w: writers) decompRva(w, "AngVel-writer candidate");
        // near-HUD cluster candidate (stores 0x180, adjacent to HUD draw)
        decompRva(0xa5f950L, "near-HUD cluster store180");
    }
}
