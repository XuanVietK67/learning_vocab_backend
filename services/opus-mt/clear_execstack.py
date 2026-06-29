#!/usr/bin/env python3
"""Clear the executable-stack flag (PF_X on the PT_GNU_STACK program header) from
ELF shared objects under a directory.

CTranslate2's manylinux wheel ships its native lib (libctranslate2-*.so) marked
as requiring an executable stack. Some kernels (Docker Desktop / WSL2, and other
hardened hosts) refuse to load it:

    ImportError: libctranslate2-*.so: cannot enable executable stack as shared
    object requires: Invalid argument

The library doesn't actually need an executable stack, so clearing the flag is
safe — this is the same edit `execstack -c` makes, done without the (unavailable)
execstack tool. Patches only the 4 flag bytes per matching header; reads the rest
in small seeks so even multi-hundred-MB libs are cheap.

Usage: python clear_execstack.py <dir>
"""
import os
import struct
import sys

PT_GNU_STACK = 0x6474E551
PF_X = 0x1


def clear_file(path: str) -> bool:
    with open(path, "r+b") as f:
        ident = f.read(16)
        if ident[:4] != b"\x7fELF":
            return False
        ei_class, ei_data = ident[4], ident[5]
        endian = "<" if ei_data == 1 else ">"
        if ei_class == 2:  # ELF64
            f.seek(0x20)
            e_phoff = struct.unpack(endian + "Q", f.read(8))[0]
            f.seek(0x36)
            e_phentsize = struct.unpack(endian + "H", f.read(2))[0]
            e_phnum = struct.unpack(endian + "H", f.read(2))[0]
            pflags_off = 4
        elif ei_class == 1:  # ELF32
            f.seek(0x1C)
            e_phoff = struct.unpack(endian + "I", f.read(4))[0]
            f.seek(0x2A)
            e_phentsize = struct.unpack(endian + "H", f.read(2))[0]
            e_phnum = struct.unpack(endian + "H", f.read(2))[0]
            pflags_off = 24
        else:
            return False

        changed = False
        for i in range(e_phnum):
            base = e_phoff + i * e_phentsize
            f.seek(base)
            p_type = struct.unpack(endian + "I", f.read(4))[0]
            if p_type != PT_GNU_STACK:
                continue
            f.seek(base + pflags_off)
            p_flags = struct.unpack(endian + "I", f.read(4))[0]
            if p_flags & PF_X:
                f.seek(base + pflags_off)
                f.write(struct.pack(endian + "I", p_flags & ~PF_X))
                changed = True
        return changed


def main(root: str) -> None:
    count = 0
    for dirpath, _dirs, files in os.walk(root):
        for name in files:
            if ".so" not in name:
                continue
            path = os.path.join(dirpath, name)
            try:
                if clear_file(path):
                    count += 1
                    print(f"cleared execstack: {path}")
            except Exception as exc:  # noqa: BLE001 - best-effort, skip oddities
                print(f"skip {path}: {exc}")
    print(f"clear_execstack: cleared {count} file(s) under {root}")


if __name__ == "__main__":
    main(sys.argv[1] if len(sys.argv) > 1 else ".")
