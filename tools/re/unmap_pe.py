#!/usr/bin/env python3
"""Turn a linear memory dump of a mapped PE (file offset == RVA) into a file whose PE section
headers match, so radare2 / r2ghidra / Ghidra load it correctly (imports, xrefs, analysis).

For a dump captured [module_base .. module_base+image_size], each section already sits at its
RVA offset in the file. The on-disk section headers still point at the *original* file offsets,
so a PE loader reads the wrong bytes. We rewrite each section's PointerToRawData = VirtualAddress
and SizeOfRawData = VirtualSize. (Classic "unmap"/"realign" of a process dump.)

  python3 tools/re/unmap_pe.py reference/snowrunner-dump.bin reference/snowrunner-fixed.bin
"""
import struct, sys

def main(src, dst):
    data = bytearray(open(src, 'rb').read())
    if data[:2] != b'MZ':
        sys.exit('not a PE (no MZ)')
    e_lfanew = struct.unpack_from('<I', data, 0x3c)[0]
    if data[e_lfanew:e_lfanew+4] != b'PE\x00\x00':
        sys.exit('no PE signature at e_lfanew=0x%x' % e_lfanew)
    coff = e_lfanew + 4
    num_sections = struct.unpack_from('<H', data, coff + 2)[0]
    size_opt = struct.unpack_from('<H', data, coff + 16)[0]
    opt = coff + 20
    magic = struct.unpack_from('<H', data, opt)[0]   # 0x20b = PE32+
    sect = opt + size_opt
    print('PE32+' if magic == 0x20b else 'PE32', 'sections=%d' % num_sections)
    for i in range(num_sections):
        off = sect + i * 40
        name = data[off:off+8].split(b'\x00')[0].decode('latin1')
        vsize = struct.unpack_from('<I', data, off + 0x08)[0]
        vaddr = struct.unpack_from('<I', data, off + 0x0c)[0]
        # SizeOfRawData := VirtualSize (aligned to 0x200), PointerToRawData := VirtualAddress
        raw_size = (vsize + 0x1ff) & ~0x1ff
        struct.pack_into('<I', data, off + 0x10, raw_size)   # SizeOfRawData
        struct.pack_into('<I', data, off + 0x14, vaddr)      # PointerToRawData
        print('  %-10s RVA=0x%08x vsize=0x%x -> raw@0x%08x size=0x%x' % (name, vaddr, vsize, vaddr, raw_size))
    open(dst, 'wb').write(data)
    print('wrote', dst, '(%d bytes)' % len(data))

if __name__ == '__main__':
    if len(sys.argv) != 3:
        sys.exit('usage: unmap_pe.py <dump.bin> <out.bin>')
    main(sys.argv[1], sys.argv[2])
