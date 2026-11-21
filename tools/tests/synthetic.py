"""What the tests of the PlayStation's routines build their synthetic overlays,
executables and animations from: the few instructions the finders read, and a
chunk of frames."""

import struct

JR_RA, JR_V0, NOP = 0x03E00008, 0x00400008, 0


def lui(rt, value): return 15 << 26 | rt << 16 | value & 0xFFFF
def addiu(rt, rs, value): return 9 << 26 | rs << 21 | rt << 16 | value & 0xFFFF
def ori(rt, rs, value): return 13 << 26 | rs << 21 | rt << 16 | value & 0xFFFF
def lw(rt, value, rs): return 35 << 26 | rs << 21 | rt << 16 | value & 0xFFFF
def lh(rt, value, rs): return 33 << 26 | rs << 21 | rt << 16 | value & 0xFFFF
def jal(target): return 3 << 26 | target >> 2 & 0x3FFFFFF
def j(target): return 2 << 26 | target >> 2 & 0x3FFFFFF


def named(rt, addr):
    """the pair of instructions that builds an address in a register"""
    return lui(rt, (addr + 0x8000) >> 16), addiu(rt, rt, addr)


def word_at(rt, addr):
    """the pair of instructions that loads the word at an address"""
    return lui(rt, (addr + 0x8000) >> 16), lw(rt, addr, rt)


class Assembly:
    """code assembled a function at a time from an address on"""
    def __init__(self, at, data=b""):
        self.at, self.data = at, bytearray(data)

    def emit(self, *words):
        here = self.at + len(self.data)
        self.data += struct.pack(f"<{len(words)}I", *words)
        return here


def chunk(*frames):
    """(a chunk of animations holding the frames, where the table naming them
    all lies and where the table naming the last alone does)"""
    data, infos = bytearray(12), []
    for frame in frames:
        header = len(data)
        data += struct.pack("<I4B", 0, frame.w, frame.h, 8, 0)
        infos.append(len(data))
        data += struct.pack("<I2h6h", header, 3, 0, frame.x, frame.y, *frame.rect)
    whole, last = len(data), len(data) + 8 + 4 * len(infos)
    data += struct.pack(f"<HhhH{len(infos)}I", 4, len(infos), 0, 2, *infos)
    data += struct.pack("<HhhHI", 1, 1, 0, 2, infos[-1])
    struct.pack_into("<hhII", data, 0, max(f.w for f in frames), max(f.h for f in frames), last, 0)
    return bytes(data), whole, last
