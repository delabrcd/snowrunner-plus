// Ghidra headless: trace the input-handler layer. Decompile the per-action handlers that call
// the confirmed setters, show ALL references to each (detect a function-pointer/action table),
// walk up to the dispatcher, enumerate refs to g_TruckControl (0x2A8EDD8), and find the public
// ShiftGear/DisableAutoAndShift via callers of the gear-write core 0xd72570. Also AOB-locate
// SetPowerCoef (movss [rax+0x38] after mov rax,[rcx+0x68]).
import ghidra.app.script.GhidraScript;
import ghidra.app.decompiler.*;
import ghidra.program.model.address.Address;
import ghidra.program.model.listing.*;
import ghidra.program.model.symbol.*;
import java.util.*;

public class TraceDispatch extends GhidraScript {
    DecompInterface dec; Address base; FunctionManager fm; Set<Long> done=new HashSet<>();

    void decompRva(long rva,String why){
        Function f=fm.getFunctionContaining(base.add(rva));
        if(f==null){println("// no func @0x"+Long.toHexString(rva)+" ("+why+")");return;}
        long er=f.getEntryPoint().subtract(base);
        if(!done.add(er)){println("// (dup "+f.getName()+" "+why+")");return;}
        println("\n// ===== "+f.getName()+" @ rva 0x"+Long.toHexString(er)+" size="+f.getBody().getNumAddresses()+"  ("+why+") =====");
        DecompileResults r=dec.decompileFunction(f,120,monitor);
        if(r!=null&&r.decompileCompleted()) println(r.getDecompiledFunction().getC());
        else println("// decompile failed");
    }

    void allRefs(long rva,String name){
        Function f=fm.getFunctionContaining(base.add(rva));
        if(f==null)return;
        println("\n// --- ALL references to "+name+" (0x"+Long.toHexString(rva)+") ---");
        ReferenceIterator it=currentProgram.getReferenceManager().getReferencesTo(f.getEntryPoint());
        int n=0;
        while(it.hasNext()&&n<40){
            Reference ref=it.next(); n++;
            Address fa=ref.getFromAddress();
            Function c=fm.getFunctionContaining(fa);
            String loc=c!=null?("code in "+c.getName()+"@0x"+Long.toHexString(c.getEntryPoint().subtract(base))):"DATA/no-func";
            println("//   "+ref.getReferenceType()+" from 0x"+Long.toHexString(fa.subtract(base))+"  ["+loc+"]");
        }
    }

    public void run() throws Exception {
        base=currentProgram.getImageBase(); fm=currentProgram.getFunctionManager();
        dec=new DecompInterface(); dec.openProgram(currentProgram);

        long[] handlers={0xb8b240L,0xb90ec0L,0xb89d00L,0xb89db0L,0xb747f0L,0xb74910L,0xb74bd0L};
        for(long h:handlers) decompRva(h,"input-handler");
        for(long h:handlers) allRefs(h,"handler_0x"+Long.toHexString(h));

        // gear-write core callers => public ShiftGear/DisableAutoAndShift
        allRefs(0xd72570L,"GearWriteCore_d72570");
        println("\n// == decompile gear-core callers ==");
        Function core=fm.getFunctionContaining(base.add(0xd72570L));
        Set<Long> cc=new HashSet<>();
        for(Reference ref:getRefIter(core)){
            if(!ref.getReferenceType().isCall())continue;
            Function c=fm.getFunctionContaining(ref.getFromAddress());
            if(c!=null&&cc.add(c.getEntryPoint().subtract(base))) decompRva(c.getEntryPoint().subtract(base),"caller of GearWriteCore");
        }

        // references to g_TruckControl global
        println("\n// --- refs to g_TruckControl (0x2A8EDD8) ---");
        Address g=base.add(0x2A8EDD8L);
        ReferenceIterator it=currentProgram.getReferenceManager().getReferencesTo(g);
        int n=0;
        while(it.hasNext()&&n<40){
            Reference ref=it.next();n++;
            Function c=fm.getFunctionContaining(ref.getFromAddress());
            println("//   "+ref.getReferenceType()+" from 0x"+Long.toHexString(ref.getFromAddress().subtract(base))+
                (c!=null?" in "+c.getName()+"@0x"+Long.toHexString(c.getEntryPoint().subtract(base)):" (no func)"));
        }
    }

    java.util.List<Reference> getRefIter(Function f){
        java.util.List<Reference> l=new ArrayList<>();
        if(f==null)return l;
        ReferenceIterator it=currentProgram.getReferenceManager().getReferencesTo(f.getEntryPoint());
        while(it.hasNext())l.add(it.next());
        return l;
    }
}
