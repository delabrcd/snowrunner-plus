// Headless: (a) emit raw first-N bytes for AOB building of key funcs; (b) decompile the RHI free fn and
// the name-lookup fn; (c) follow the GFX prerecord-job data pointer at 0x29d6780 and dump the pointer table.
import ghidra.app.script.GhidraScript;
import ghidra.app.decompiler.*;
import ghidra.program.model.address.*;
import ghidra.program.model.listing.*;
import ghidra.program.model.mem.*;
import ghidra.program.model.symbol.*;

public class AobAndCapture extends GhidraScript {
    Address base; DecompInterface dec;
    long rva(Address a){ return a.subtract(base); }

    void aob(long r, String name, int nbytes) throws Exception {
        Address a=base.add(r);
        byte[] bs=new byte[nbytes];
        currentProgram.getMemory().getBytes(a,bs);
        StringBuilder h=new StringBuilder();
        for(byte b:bs) h.append(String.format("%02X ",b&0xff));
        println("// AOB "+name+" @0x"+Long.toHexString(r)+": "+h.toString().trim());
    }
    void decompRva(long r,String why){
        Function f=getFunctionContaining(base.add(r));
        if(f==null){println("// no func @0x"+Long.toHexString(r)+" ("+why+")");return;}
        println("\n// ===== FUN @0x"+Long.toHexString(rva(f.getEntryPoint()))+" ("+why+") =====");
        DecompileResults res=dec.decompileFunction(f,90,monitor);
        if(res!=null&&res.decompileCompleted()) println(res.getDecompiledFunction().getC());
        else println("// decompile failed");
    }

    public void run() throws Exception {
        base=currentProgram.getImageBase();
        dec=new DecompInterface(); dec.openProgram(currentProgram);
        Memory mem=currentProgram.getMemory();

        println("################ AOBs ################");
        aob(0x14c8710L,"TexMgr_GetTexture",32);
        aob(0x14c8b60L,"TexMgr_LookupOnly",32);
        aob(0x104b740L,"MovieDefRegistry_Get",32);
        aob(0x104acb0L,"UiLoadMovieDefFromMemPtr",32);
        aob(0x1750670L,"resLOADER_BUNDLE_BASE_Load",32);
        aob(0x127df00L,"resLOADER_PCT_Load",32);

        println("\n################ RHI free + lookup ################");
        decompRva(0x14c8b60L,"TexMgr name-lookup only");
        decompRva(0x14b12c0L,"FUN_..bb212c0 (frees engine-tex[0x15]=RHI tex)");

        println("\n################ GFX prerecord-job pointer follow ################");
        // 0x29d6780 = PTR_s_GPU_CRASH_ID_MR2_PRERECORD_GFX ; dump 0x40 bytes around it as pointers
        for(long off=-0x20; off<0x40; off+=8){
            Address a=base.add(0x29d6780L+off);
            long val=mem.getLong(a);
            long vr = val==0?0:(val-base.getOffset());
            String note="";
            Address va=null;
            try{ va=base.add(vr);}catch(Exception e){}
            if(va!=null){
                Function f=getFunctionContaining(va);
                if(f!=null) note=" -> FUN@0x"+Long.toHexString(rva(f.getEntryPoint()));
                Data d=getDataAt(va);
                if(d!=null&&d.hasStringValue()) note=" -> str \""+d.getValue()+"\"";
            }
            println(String.format("// [0x%08x] = 0x%016x (rva 0x%x)%s", 0x29d6780L+off, val, vr, note));
        }
        // who references 0x29d6780 (the vtable/table using it)
        println("// --- xrefs to 0x29d6780 ---");
        ReferenceIterator ri=currentProgram.getReferenceManager().getReferencesTo(base.add(0x29d6780L));
        while(ri.hasNext()){
            Reference r=ri.next();
            Function f=getFunctionContaining(r.getFromAddress());
            println("//   from 0x"+Long.toHexString(rva(r.getFromAddress()))+(f!=null?" in FUN@0x"+Long.toHexString(rva(f.getEntryPoint())):" (data)"));
        }
    }
}
