// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.
// Headless: locate RTTI type-descriptor strings, their Complete-Object-Locators, vtables, and
// functions that reference those vtables. Targets: GFX_CAPTURE_JOB, EXTERNAL_TEXTURE_PROVIDER@gfxTEXTURE,
// rendPRERECORD_GFX_JOB. Also report the singleton globals we care about.
import ghidra.app.script.GhidraScript;
import ghidra.program.model.address.*;
import ghidra.program.model.listing.*;
import ghidra.program.model.mem.*;
import ghidra.program.model.symbol.*;
import java.util.*;

public class RttiHunt extends GhidraScript {
    Address base; Memory mem;
    long rva(Address a){ return a.subtract(base); }

    // find address of a defined string exactly equal to s (RTTI descriptors are stored as data)
    Address findStr(String s){
        DataIterator di=currentProgram.getListing().getDefinedData(true);
        while(di.hasNext()){
            Data d=di.next();
            if(d.hasStringValue() && s.equals(d.getValue().toString())) return d.getAddress();
        }
        return null;
    }

    void hunt(String rtti) throws Exception {
        println("\n#### RTTI \""+rtti+"\"");
        Address sd=findStr(rtti);
        if(sd==null){ println("//   type-descriptor string not found as data"); return; }
        // the type descriptor object starts 0x10 before the name string (vftptr + spare + name)
        Address typeDesc=sd.subtract(0x10);
        println("//   name@0x"+Long.toHexString(rva(sd))+"  typeDesc@0x"+Long.toHexString(rva(typeDesc)));
        // find 32-bit-image-relative refs to typeDesc from COLs. COL has field +0xc = image-rel typeDesc.
        long tdImgRel = rva(typeDesc);
        // scan defined pointers referencing typeDesc directly
        ReferenceIterator ri=currentProgram.getReferenceManager().getReferencesTo(typeDesc);
        int n=0;
        while(ri.hasNext()&&n<12){ Reference r=ri.next(); println("//   ref->typeDesc from 0x"+Long.toHexString(rva(r.getFromAddress()))); n++; }
        // brute: search memory for the 4-byte image-relative value of typeDesc (COL field 3)
        byte[] pat=new byte[]{(byte)(tdImgRel),(byte)(tdImgRel>>8),(byte)(tdImgRel>>16),(byte)(tdImgRel>>24)};
        Address cur=base;
        int found=0;
        while(found<6){
            Address hit=mem.findBytes(cur, pat, null, true, monitor);
            if(hit==null) break;
            long hr=rva(hit);
            // a COL: check field0==1 (signature). COL start = hit-0xc
            Address colStart=hit.subtract(0xc);
            String note="";
            try{
                int sig=mem.getInt(colStart);
                if(sig==1){
                    // vtable ptr = address just after a pointer to this COL. Find a data ptr whose value==colStart, vtable=that+8
                    ReferenceIterator ri2=currentProgram.getReferenceManager().getReferencesTo(colStart);
                    while(ri2.hasNext()){
                        Reference rr=ri2.next();
                        Address vtbl=rr.getFromAddress().add(8);
                        note+=" COL@0x"+Long.toHexString(rva(colStart))+" vtbl@0x"+Long.toHexString(rva(vtbl));
                        // list first vtable slot func
                        try{ long f0=mem.getLong(vtbl); Address fa=base.add(f0-base.getOffset()); Function fn=getFunctionContaining(fa); if(fn!=null) note+=" slot0=FUN@0x"+Long.toHexString(rva(fn.getEntryPoint())); }catch(Exception e){}
                    }
                }
            }catch(Exception e){}
            println("//   imgrel-ref @0x"+Long.toHexString(hr)+note);
            cur=hit.add(4); found++;
        }
    }

    public void run() throws Exception {
        base=currentProgram.getImageBase(); mem=currentProgram.getMemory();
        println("SINGLETONS: texMgr=DAT@0x"+Long.toHexString(0x2b17220L)+" movieReg=DAT@0x"+Long.toHexString(0x2ab3630L)+" rhiResMgr=DAT@0x"+Long.toHexString(rva(base.add(0x6ffffd187348L-base.getOffset()))));
        hunt(".?AVGFX_CAPTURE_JOB@combine@@");
        hunt(".?AVrendPRERECORD_GFX_JOB@combine@@");
        hunt(".?AVEXTERNAL_TEXTURE_PROVIDER@gfxTEXTURE@@");
        hunt(".?AVEXTERNAL_TEXTURE_PROVIDER@gfxMUDRUNNER_RTTS@combine@@");
    }
}
