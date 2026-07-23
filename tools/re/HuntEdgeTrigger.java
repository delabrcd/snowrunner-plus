// For every caller of StartSoundObject(0xdfe630), scan the decompiled C for an EDGE pattern:
// a StartSoundObject call whose preceding ~8 lines contain an inequality compare of an int field
// (candidate: gear != prevGear). Rank + print full body of matches. Also print signature+size of all.
import ghidra.app.script.GhidraScript;
import ghidra.app.decompiler.*;
import ghidra.program.model.address.Address;
import ghidra.program.model.listing.*;
import ghidra.program.model.symbol.*;
import java.util.*;

public class HuntEdgeTrigger extends GhidraScript {
    Address base; DecompInterface dec;
    long rva(Address a){ return a.subtract(base); }
    String dc(Function f){ if(f==null)return null; DecompileResults r=dec.decompileFunction(f,180,monitor); return (r!=null&&r.decompileCompleted())?r.getDecompiledFunction().getC():null; }

    public void run() throws Exception {
        base=currentProgram.getImageBase();
        dec=new DecompInterface(); dec.openProgram(currentProgram);
        Function so=getFunctionContaining(base.add(0xdfe630L));
        Set<Function> callers=new LinkedHashSet<>();
        for(Reference r: getReferencesTo(so.getEntryPoint())){
            Function c=getFunctionContaining(r.getFromAddress());
            if(c!=null) callers.add(c);
        }
        List<Function> edge=new ArrayList<>();
        println("// all "+callers.size()+" StartSoundObject callers (name/rva/lines/edgeScore):");
        for(Function c:callers){
            String s=dc(c); if(s==null)continue;
            String[] L=s.split("\n");
            int score=0; List<Integer> hits=new ArrayList<>();
            for(int i=0;i<L.length;i++){
                if(L[i].contains("FUN_6ffffb46e630")){
                    for(int j=Math.max(0,i-9);j<i;j++){
                        if(L[j].contains("!=")||L[j].contains("< *(int")||L[j].contains("prev")) { score++; hits.add(i+1); break; }
                    }
                }
            }
            println("//   "+c.getName()+" @0x"+Long.toHexString(rva(c.getEntryPoint()))+"  lines="+L.length+"  edgeScore="+score+(score>0?"  hitLines="+hits:""));
            if(score>0) edge.add(c);
        }
        for(Function c:edge){
            println("\n// ===== [EDGE-TRIGGER CANDIDATE] "+c.getName()+" @0x"+Long.toHexString(rva(c.getEntryPoint()))+" =====");
            println(dc(c));
        }
    }
}
