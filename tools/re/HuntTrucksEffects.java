// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.
// Hunt the shift-sound trigger inside combine::ASYNC_TRUCKS_EFFECTS_UPDATE.
// The RTTI type descriptor for that class is at rva 0x2a16e28 (name @0x2a16e38).
// Strategy: (1) list any symbols mentioning the class, (2) walk RTTI COL->vftable,
// (3) decompile every vtable method + ctor, scanning each for reads of TruckAction+0x70
// (current gear) and calls into known audio funcs (UpdateSound 0xdff1e0, SetVoiceVolPitch 0xdfb2f0).
//   analyzeHeadless reference/ghidra-proj snowrunner -process snowrunner-fixed.bin -noanalysis \
//     -scriptPath tools/re -postScript HuntTrucksEffects.java
import ghidra.app.script.GhidraScript;
import ghidra.app.decompiler.*;
import ghidra.program.model.address.Address;
import ghidra.program.model.listing.*;
import ghidra.program.model.symbol.*;
import ghidra.program.model.mem.MemoryAccessException;
import java.util.*;

public class HuntTrucksEffects extends GhidraScript {
    Address base;
    DecompInterface dec;

    long rvaOf(Address a){ return a.subtract(base); }

    void decompScan(Function f, String why){
        if (f==null){ println("// null func ("+why+")"); return; }
        long rva = rvaOf(f.getEntryPoint());
        println("\n// ================= "+f.getName()+" @ rva 0x"+Long.toHexString(rva)+"  ["+why+"] =================");
        DecompileResults res = dec.decompileFunction(f, 240, monitor);
        if (res==null || !res.decompileCompleted()){ println("// decompile failed"); return; }
        String c = res.getDecompiledFunction().getC();
        // quick relevance flags
        boolean hasGear = c.contains("0x70") || c.contains("+ 0x74") || c.contains("gear");
        boolean hasAudio = c.contains("dff1e0") || c.contains("dfb2f0") || c.toLowerCase().contains("sound") || c.toLowerCase().contains("voice");
        println("//   FLAGS: gearRef="+hasGear+" audioRef="+hasAudio);
        println(c);
    }

    public void run() throws Exception {
        base = currentProgram.getImageBase();
        dec = new DecompInterface();
        dec.openProgram(currentProgram);
        println("// image base = 0x"+Long.toHexString(base.getOffset()));

        // -- 1: symbols mentioning the class --
        println("\n// ---- symbols containing ASYNC_TRUCKS ----");
        SymbolIterator it = currentProgram.getSymbolTable().getSymbolIterator();
        List<Symbol> classSyms = new ArrayList<>();
        while (it.hasNext()){
            Symbol s = it.next();
            String n = s.getName();
            if (n.contains("ASYNC_TRUCKS") || n.contains("TRUCKS_EFFECTS")){
                classSyms.add(s);
                println("//   "+s.getName()+"  @ rva 0x"+Long.toHexString(rvaOf(s.getAddress()))+"  type="+s.getSymbolType());
            }
        }

        // -- 2: walk RTTI: typedesc @0x2a16e28. Its 32-bit RVA refs are at 0x258fa3c and 0x258fa90.
        // The COL has pTypeDescriptor at +0x0c (x64). vtable[-1] points at COL. Find COL, then vtable.
        long[] tdRefs = { 0x258fa3cL, 0x258fa90L };
        Set<Long> vtables = new LinkedHashSet<>();
        for (long ref : tdRefs){
            // COL layout x64: +0 signature, +4 offset, +8 cdOffset, +0xC pTypeDescriptor(RVA), +0x10 pClassHierarchy(RVA), +0x14 pSelf(RVA)
            long colStart = ref - 0xC;
            Address col = base.add(colStart);
            println("\n// candidate COL @ rva 0x"+Long.toHexString(colStart));
            // find 8-byte pointers to this COL (vtable[-1])
            Address colVA = col; // full VA
            // search whole image for the little-endian 64-bit VA of col
            byte[] pat = new byte[8];
            long v = colVA.getOffset();
            for (int i=0;i<8;i++) pat[i]=(byte)((v>>(8*i))&0xff);
            StringBuilder hex=new StringBuilder();
            for (byte b: pat) hex.append(String.format("%02x ", b&0xff));
            Address a = base;
            Address found;
            int n=0;
            while ((found=findBytes(a.add(1), hex.toString()))!=null && n++<8){
                long slot = rvaOf(found);
                long vt = slot+8;
                println("//   COL ptr (vtable[-1]) @ rva 0x"+Long.toHexString(slot)+"  => vtable @ rva 0x"+Long.toHexString(vt));
                vtables.add(vt);
                a = found;
            }
        }

        // -- 3: for each vtable, dump the function pointer slots and decompile targets --
        for (long vt : vtables){
            println("\n// ==== VTABLE @ rva 0x"+Long.toHexString(vt)+" ====");
            Address va = base.add(vt);
            for (int i=0;i<24;i++){
                Address slot = va.add(i*8L);
                long p;
                try { p = getLong(slot); } catch(Exception e){ break; }
                if (p==0) break;
                Address fa;
                try { fa = base.getAddressSpace().getAddress(p); } catch(Exception e){ break; }
                long frva = p - base.getOffset();
                if (frva < 0 || frva > 0x3000000L) break; // out of image => end of vtable
                Function f = getFunctionContaining(fa);
                String fn = (f!=null? f.getName()+" @0x"+Long.toHexString(rvaOf(f.getEntryPoint())) : "(no func)");
                println("//   ["+i+"] rva 0x"+Long.toHexString(frva)+"  "+fn);
            }
            // decompile the vtable methods
            Set<Function> done = new LinkedHashSet<>();
            for (int i=0;i<24;i++){
                Address slot = va.add(i*8L);
                long p; try { p=getLong(slot);}catch(Exception e){break;}
                if (p==0) break;
                long frva = p-base.getOffset();
                if (frva<0||frva>0x3000000L) break;
                Function f = getFunctionContaining(base.getAddressSpace().getAddress(p));
                if (f!=null && done.add(f)) decompScan(f, "vtable["+i+"] of ASYNC_TRUCKS_EFFECTS_UPDATE");
            }
        }
        println("\n// ---- done ----");
    }
}
