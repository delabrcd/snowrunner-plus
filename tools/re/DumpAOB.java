// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.
// Print the first N instructions of key functions with raw bytes, so we can build stable AOB sigs.
import ghidra.app.script.GhidraScript;
import ghidra.program.model.address.Address;
import ghidra.program.model.listing.*;
import ghidra.program.model.mem.*;

public class DumpAOB extends GhidraScript {
    Address base;
    long rva(Address a){ return a.subtract(base); }
    void dump(long r,String name,int n) throws Exception {
        Address a=base.add(r);
        Function f=getFunctionContaining(a);
        println("\n// ===== "+name+" @ rva 0x"+Long.toHexString(r)+ (f!=null?" ("+f.getName()+")":"")+" =====");
        Instruction ins=getInstructionAt(a);
        StringBuilder aob=new StringBuilder();
        for(int i=0;i<n && ins!=null;i++){
            byte[] bs=ins.getBytes();
            StringBuilder h=new StringBuilder();
            for(byte b: bs) h.append(String.format("%02X ", b&0xff));
            println(String.format("//   0x%-8x %-24s %s", rva(ins.getAddress()), h.toString().trim(), ins.toString()));
            // naive AOB: wildcard the last 4 bytes of any instr containing a rip/rel operand (call/jmp/lea/mov with disp32)
            String m=ins.toString();
            boolean rel = m.contains("[RIP") || ins.getMnemonicString().equals("CALL") || ins.getMnemonicString().equals("JMP");
            if(rel && bs.length>=5){
                for(int k=0;k<bs.length-4;k++) aob.append(String.format("%02X ", bs[k]&0xff));
                aob.append("?? ?? ?? ?? ");
            } else {
                for(byte b: bs) aob.append(String.format("%02X ", b&0xff));
            }
            ins=ins.getNext();
        }
        println("//   AOB: "+aob.toString().trim());
    }
    public void run() throws Exception {
        base=currentProgram.getImageBase();
        dump(0xdfe630L,"StartSoundObject",10);
        dump(0xc5d460L,"PlaySoundEventByHash",12);
        dump(0xc5c960L,"AnimEventSoundPlayer",10);
    }
}
