// Run 2: identify the HUD param_1 object (callers of the HUD draw), find the writer of the
// AngVel scalar member (offset 0x180, with speed@0x17c and delta@0x184 on the same object),
// and decompile the gearbox caps accessors that define redlineIndex(gear).
import ghidra.app.script.GhidraScript;
import ghidra.app.decompiler.*;
import ghidra.program.model.address.Address;
import ghidra.program.model.listing.*;
import ghidra.program.model.symbol.*;
import java.util.*;

public class DecompAngVel2 extends GhidraScript {
    DecompInterface dec; Address base; FunctionManager fm; Set<Long> done = new HashSet<>();
    long rva(Address a){ return a.subtract(base); }

    void decompFunc(Function f, String why) {
        if (f == null) { println("// null func ("+why+")"); return; }
        long er = rva(f.getEntryPoint());
        if (!done.add(er)) { println("// (dup "+f.getName()+" @0x"+Long.toHexString(er)+" "+why+")"); return; }
        println("\n// ===== "+f.getName()+" @ rva 0x"+Long.toHexString(er)+" size="+f.getBody().getNumAddresses()+"  ("+why+") =====");
        DecompileResults r = dec.decompileFunction(f, 150, monitor);
        if (r!=null && r.decompileCompleted()) println(r.getDecompiledFunction().getC());
        else println("// decompile failed: "+(r!=null?r.getErrorMessage():"null"));
    }
    void decompRva(long r, String why){ decompFunc(fm.getFunctionContaining(base.add(r)), why); }

    void callers(long rva, String name) {
        Function f=fm.getFunctionContaining(base.add(rva));
        if(f==null){println("// no func @0x"+Long.toHexString(rva));return;}
        println("\n// ##### CALLERS of "+name+" (rva 0x"+Long.toHexString(rva)+") #####");
        ReferenceIterator it=currentProgram.getReferenceManager().getReferencesTo(f.getEntryPoint());
        Set<Long> seen=new HashSet<>(); List<Long> callerRvas=new ArrayList<>(); int n=0;
        while(it.hasNext()&&n<24){
            Reference ref=it.next();
            if(!ref.getReferenceType().isCall()) continue;
            Function c=fm.getFunctionContaining(ref.getFromAddress());
            if(c!=null&&seen.add(c.getEntryPoint().getOffset())){
                long cr=rva(c.getEntryPoint());
                println("//   caller "+c.getName()+" @ rva 0x"+Long.toHexString(cr)+"  (call site 0x"+Long.toHexString(rva(ref.getFromAddress()))+")");
                callerRvas.add(cr); n++;
            }
        }
        for(long cr: callerRvas) decompRva(cr, "caller of "+name);
    }

    // Scan every function's instructions for stores/reads at displacement 0x180 alongside
    // 0x17c and 0x184 => the AngVel telemetry object's reader AND writer.
    void scanTriple() {
        println("\n// ##### SCAN: functions referencing displacements 0x17c & 0x180 & 0x184 #####");
        FunctionIterator fi = fm.getFunctions(true);
        int reported=0;
        while (fi.hasNext() && reported < 30) {
            Function f = fi.next();
            boolean has17c=false, has180=false, has184=false, store180=false;
            InstructionIterator ii = currentProgram.getListing().getInstructions(f.getBody(), true);
            Address st180=null;
            while (ii.hasNext()) {
                Instruction in = ii.next();
                String s = in.toString();
                if (s.contains("0x17c]")) has17c=true;
                if (s.contains("0x180]")) { has180=true;
                    String m=in.getMnemonicString();
                    // store: first operand is the memory ref (MOVSS [mem+0x180], xmm)
                    if ((m.startsWith("MOV")||m.startsWith("movss")) && in.getNumOperands()>=2) {
                        String op0 = in.getDefaultOperandRepresentation(0);
                        if (op0.contains("0x180]")) { store180=true; if(st180==null) st180=in.getAddress(); }
                    }
                }
                if (s.contains("0x184]")) has184=true;
            }
            if (has17c && has180 && has184) {
                reported++;
                println("//  HIT "+f.getName()+" @ rva 0x"+Long.toHexString(rva(f.getEntryPoint()))
                        +"  store180="+store180+(st180!=null?(" @0x"+Long.toHexString(rva(st180))):"")
                        +"  size="+f.getBody().getNumAddresses());
            }
        }
        println("//  (scan reported "+reported+" functions)");
    }

    public void run() throws Exception {
        base = currentProgram.getImageBase(); fm = currentProgram.getFunctionManager();
        dec = new DecompInterface(); dec.openProgram(currentProgram);

        // 1. who calls the HUD draw -> identifies param_1 object provenance
        callers(0xa639e0L, "HUD_AngVelDraw");
        // 2. find writer of the AngVel member (offset triple)
        scanTriple();
        // 3. gearbox caps accessors: GetGearData (returns cap for gear) + related
        decompRva(0xd72640L, "GetGearData(gearbox,gear)->caps");   // FUN_6ffffb3e2640
        decompRva(0xd71750L, "gearbox param ptr FUN_6ffffb3e1750");
        decompRva(0xd72300L, "GetMaxGear FUN_6ffffb3e2300");
    }
}
