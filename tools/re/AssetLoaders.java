// Headless: for each marker string, find its data addr, list code xrefs -> containing function,
// and decompile those functions. Also decompile a fixed list of anchor RVAs.
import ghidra.app.script.GhidraScript;
import ghidra.app.decompiler.*;
import ghidra.program.model.address.*;
import ghidra.program.model.listing.*;
import ghidra.program.model.symbol.*;
import java.util.*;

public class AssetLoaders extends GhidraScript {
    Address base; DecompInterface dec; Set<Long> done = new HashSet<>();
    long rva(Address a){ return a.subtract(base); }

    void decompFn(Function f, String why) {
        if (f==null){ println("// null func ("+why+")"); return; }
        long er = rva(f.getEntryPoint());
        if(!done.add(er)){ println("// (dup @0x"+Long.toHexString(er)+" "+why+")"); return; }
        println("\n// ===== FUN @0x"+Long.toHexString(er)+" size="+f.getBody().getNumAddresses()+"  ("+why+") =====");
        DecompileResults r = dec.decompileFunction(f,90,monitor);
        if(r!=null && r.decompileCompleted()) println(r.getDecompiledFunction().getC());
        else println("// decompile failed");
    }
    void decompRva(long rva, String why){ decompFn(getFunctionContaining(base.add(rva)), why); }

    // find defined string data whose value contains m, list xrefs (containing funcs)
    List<Function> xrefFuncs(String m, boolean decomp) {
        List<Function> out = new ArrayList<>();
        DataIterator di = currentProgram.getListing().getDefinedData(true);
        while (di.hasNext()) {
            Data d = di.next();
            if (!d.hasStringValue()) continue;
            Object v = d.getValue(); if (v==null) continue;
            String sv = v.toString();
            if (!sv.equals(m)) continue;
            println("\n// marker \""+m+"\" @0x"+Long.toHexString(rva(d.getAddress())));
            ReferenceIterator ri = currentProgram.getReferenceManager().getReferencesTo(d.getAddress());
            Set<Long> seen = new HashSet<>();
            while (ri.hasNext()) {
                Reference r = ri.next();
                Function f = getFunctionContaining(r.getFromAddress());
                if (f!=null && seen.add(rva(f.getEntryPoint()))) {
                    println("//   xref 0x"+Long.toHexString(rva(r.getFromAddress()))+" in FUN@0x"+Long.toHexString(rva(f.getEntryPoint())));
                    out.add(f);
                }
            }
        }
        if (decomp) for (Function f : out) decompFn(f, "xref of \""+m+"\"");
        return out;
    }

    public void run() throws Exception {
        base = currentProgram.getImageBase();
        dec = new DecompInterface(); dec.openProgram(currentProgram);

        // --- Level 2/1: the resource loaders ---
        xrefFuncs("resLOADER_PCT::Load", true);
        xrefFuncs("resLOADER_PCT_HEADER::Load", true);
        xrefFuncs("resLOADER_BUNDLE_BASE::Load", true);

        // --- Level 3: movie registry + memptr loader ---
        decompRva(0x104b740L, "UiMovieDef '%s' not found  (registry getter)");
        decompRva(0x104acb0L, "UiLoadMovieDefFromMemPtr");
        decompRva(0x19d76c0L, "MovieDef \" dump");
    }
}
