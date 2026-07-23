// Ghidra headless: find the DRIVESHAFT runtime structure & its angular velocity.
// The truck XML defines drivetrain as <Shafts> topology; there is a runtime shaft object whose
// rotation follows the engine/wheels (spins during wheelspin) and animates the visual propshaft.
// Strategy: locate shaft/drivetrain strings, xref -> parser/update funcs, decompile; also decompile
// the drivetrain update (0xc404f0) and its callees, looking for a stored angular-velocity float.
//   analyzeHeadless <proj> snowrunner -process snowrunner-fixed.bin -noanalysis \
//     -scriptPath tools/re -postScript DecompShafts.java
import ghidra.app.script.GhidraScript;
import ghidra.app.decompiler.*;
import ghidra.program.model.address.Address;
import ghidra.program.model.data.StringDataInstance;
import ghidra.program.model.listing.*;
import ghidra.program.model.symbol.*;
import java.util.*;

public class DecompShafts extends GhidraScript {
    Address base; DecompInterface dec; FunctionManager fm; Set<Long> done = new HashSet<>();
    long rva(Address a) { return a.subtract(base); }

    String decomp(Function f) {
        if (f.getBody().getNumAddresses() > 24000) return "// (skipped: " + f.getBody().getNumAddresses() + " bytes, too large)";
        DecompileResults r = dec.decompileFunction(f, 90, monitor);
        return (r != null && r.decompileCompleted()) ? r.getDecompiledFunction().getC() : "// decompile failed";
    }
    void dumpFunc(Function f, String why) {
        if (f == null) { println("// null func: " + why); return; }
        long er = rva(f.getEntryPoint());
        if (!done.add(er)) { println("// (dup " + f.getName() + " @0x" + Long.toHexString(er) + " -- " + why + ")"); return; }
        println("\n// ===== " + f.getName() + " @ rva 0x" + Long.toHexString(er) + "  size=" + f.getBody().getNumAddresses() + "  (" + why + ") =====");
        println(decomp(f));
    }

    // find defined strings containing any needle; return their addresses
    List<Address> findStrings(String[] needles) {
        List<Address> hits = new ArrayList<>();
        DataIterator di = currentProgram.getListing().getDefinedData(true);
        while (di.hasNext()) {
            Data d = di.next();
            if (d == null || !d.hasStringValue()) continue;
            String s = d.getDefaultValueRepresentation();
            if (s == null) continue;
            for (String n : needles) if (s.contains(n)) { hits.add(d.getAddress()); break; }
        }
        return hits;
    }

    void strXref(String[] needles, String why, int maxStrings, int maxFnsPerStr) {
        println("\n// #### string search " + why + " " + Arrays.toString(needles) + " ####");
        List<Address> hits = findStrings(needles);
        println("// " + hits.size() + " matching strings");
        int sc = 0;
        for (Address sa : hits) {
            if (sc++ >= maxStrings) { println("// ...(" + (hits.size() - maxStrings) + " more strings)"); break; }
            Data d = getDataAt(sa);
            String txt = d != null ? d.getDefaultValueRepresentation() : "?";
            ReferenceIterator it = currentProgram.getReferenceManager().getReferencesTo(sa);
            Set<Long> fns = new LinkedHashSet<>(); int n = 0;
            while (it.hasNext() && n < 20) { Reference r = it.next(); Function f = fm.getFunctionContaining(r.getFromAddress()); if (f != null) fns.add(rva(f.getEntryPoint())); n++; }
            println("// str @rva 0x" + Long.toHexString(rva(sa)) + " " + txt + "  -> " + fns.size() + " funcs, " + n + " refs");
            int fc = 0; for (long er : fns) { if (fc++ >= maxFnsPerStr) break; dumpFunc(fm.getFunctionContaining(base.add(er)), why + " " + txt); }
        }
    }

    // decompile the callees of a function that write a float member (candidate angvel integrators)
    void dumpCallees(long rva, String why, int max) {
        Function f = fm.getFunctionContaining(base.add(rva));
        if (f == null) { println("// no func @0x" + Long.toHexString(rva)); return; }
        dumpFunc(f, why);
        Set<Function> callees = f.getCalledFunctions(monitor);
        println("// " + why + " has " + callees.size() + " callees; dumping up to " + max + " small ones");
        int c = 0;
        for (Function ce : callees) { if (c >= max) break; if (ce.getBody().getNumAddresses() <= 6000) { dumpFunc(ce, why + " callee"); c++; } }
    }

    public void run() throws Exception {
        base = currentProgram.getImageBase(); fm = currentProgram.getFunctionManager();
        dec = new DecompInterface(); dec.openProgram(currentProgram);
        println("// imageBase=0x" + Long.toHexString(base.getOffset()));
        strXref(new String[]{ "Shaft", "shaft" }, "SHAFT", 12, 2);
        strXref(new String[]{ "Cardan", "Propeller", "PropShaft", "Driveshaft", "DriveShaft" }, "PROP", 8, 2);
        dumpCallees(0xc404f0L, "DrivetrainUpdate_ApplyGear", 10);
    }
}
