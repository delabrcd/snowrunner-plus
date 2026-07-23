// Headless: discover the asset/texture/GFx surface.
// 1) list SYMBOLS whose (demangled) name matches keyword groups, with RVA.
// 2) for a set of marker STRINGS, find the defined-data address and its xrefs -> containing function.
import ghidra.app.script.GhidraScript;
import ghidra.program.model.address.*;
import ghidra.program.model.listing.*;
import ghidra.program.model.symbol.*;
import ghidra.program.model.mem.*;
import ghidra.program.util.*;
import java.util.*;

public class MapAssetSyms extends GhidraScript {
    Address base;
    long rva(Address a){ return a.subtract(base); }

    String[] KW = {
        "gfxTEXTURE","TEXTURE_PROVIDER","TEXTURE_REQUEST","resLOADER_GFX_BUNDLE",
        "UiMovieDef","LoadMovieDef","MovieDef","gfxMOVIE","gfxMUDRUNNER","GFX_CAPTURE",
        "PRERECORD_GFX","EXTERNAL_TEXTURE","TextureManager","CreateTexture","CreateShaderResource",
        "gfxTRANSLATOR","gfxUPDATE","resLOADER","UiLoadMovie","GetExported","CreateMovie"
    };

    void syms() {
        println("################ SYMBOL SCAN ################");
        SymbolTable st = currentProgram.getSymbolTable();
        SymbolIterator it = st.getAllSymbols(true);
        TreeMap<String,String> hits = new TreeMap<>();
        while (it.hasNext()) {
            Symbol s = it.next();
            String n = s.getName(); // may be mangled
            String dn = n;
            for (String k : KW) {
                if (n.toLowerCase().contains(k.toLowerCase())) {
                    Address a = s.getAddress();
                    String type = "";
                    Function f = getFunctionContaining(a);
                    if (f!=null && f.getEntryPoint().equals(a)) type="[FUNC]";
                    else if (f!=null) type="[in "+f.getName()+"]";
                    else type="[data]";
                    hits.put(String.format("%08x_%s", rva(a), n),
                        String.format("  0x%08x %-7s %s", rva(a), type, n));
                    break;
                }
            }
        }
        for (String v : hits.values()) println(v);
        println("total sym hits: "+hits.size());
    }

    void strXrefs(String[] markers) {
        println("\n################ STRING XREFS ################");
        // build defined-string -> address map by scanning listing
        DataIterator di = currentProgram.getListing().getDefinedData(true);
        List<Data> strs = new ArrayList<>();
        while (di.hasNext()) {
            Data d = di.next();
            if (d.hasStringValue()) strs.add(d);
        }
        for (String m : markers) {
            println("\n--- marker: \""+m+"\"");
            int shown=0;
            for (Data d : strs) {
                Object v = d.getValue();
                if (v==null) continue;
                String sv = v.toString();
                if (!sv.contains(m)) continue;
                println(String.format("  string @0x%08x = %s", rva(d.getAddress()), sv.length()>60?sv.substring(0,60):sv));
                ReferenceIterator ri = currentProgram.getReferenceManager().getReferencesTo(d.getAddress());
                int n=0;
                while (ri.hasNext() && n<8) {
                    Reference r = ri.next();
                    Function f = getFunctionContaining(r.getFromAddress());
                    println(String.format("      xref from 0x%08x %s", rva(r.getFromAddress()), f!=null?("in "+f.getName()+" @0x"+Long.toHexString(rva(f.getEntryPoint()))):""));
                    n++;
                }
                if (++shown>=6) break;
            }
        }
    }

    public void run() throws Exception {
        base = currentProgram.getImageBase();
        println("imagebase 0x"+Long.toHexString(base.getOffset()));
        syms();
        strXrefs(new String[]{
            "UiMovieDef '%s' not found",
            "UiLoadMovieDefFromMemPtr",
            "gfxbundle",
            "getImageReference",
            "TextureManager",
            "MovieDef  \""
        });
    }
}
