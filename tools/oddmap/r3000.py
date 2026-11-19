"""A PlayStation's memory and enough of its R3000 to run a game's routines off
a disc: code loaded where the console loads it, a function called with its
arguments, and the calls it makes out answered by the caller where they reach
for the hardware or the rest of the engine.

It runs compiled code, so a load's value is there for the next instruction,
where the console's arrives one later, an add never traps, and a branch is
taken to stand in no other's delay slot. Nothing stands for the coprocessors
or the hardware's registers: an access outside the two megabytes of RAM is
refused, as is an instruction it does not know."""
import struct

RAM = 0x80000000
SIZE = 0x200000
STACK = RAM + SIZE - 0x1000
HALT = RAM + SIZE - 8          # where a called function returns to
M32 = 0xFFFFFFFF
SIGN = 0x80000000
V0, A0, SP, RA, SINK = 2, 4, 29, 31, 32
RUN = object()                 # what a stub answers to let the function run after all


class Fault(Exception):
    """what the machine will not run or reach"""


def signed(v, bits=32):
    return v - (1 << bits) if v >> (bits - 1) & 1 else v


class Machine:
    """the console's RAM and registers. `stubs` names, by its address, what
    answers where the code calls or jumps there: it is given the machine once
    the delay slot has run, and what it returns is the function's answer, or
    `RUN` to let the function run after all. A set in `stores` gathers the
    addresses the code stores to."""
    def __init__(self):
        self.mem = bytearray(SIZE)
        self.r = [0] * 33
        self.hi = self.lo = 0
        self.stubs = {}
        self.stores = None
        self.steps = 0
        self.code = {}
        self.running = False

    def at(self, addr, size=1):
        at = (addr & M32) - RAM
        if not 0 <= at <= SIZE - size:
            raise Fault(f"{addr & M32:#x} is outside RAM")
        if at % size:
            raise Fault(f"{addr & M32:#x} is no address of {size} bytes")
        return at

    def load(self, addr, data):
        if not RAM <= addr <= RAM + SIZE - len(data):
            raise Fault(f"{len(data)} bytes at {addr:#x} lie outside RAM")
        self.mem[addr - RAM:addr - RAM + len(data)] = data
        self.code.clear()

    def r8(self, addr):
        return self.mem[self.at(addr)]

    def r16(self, addr):
        return struct.unpack_from("<H", self.mem, self.at(addr, 2))[0]

    def r32(self, addr):
        return struct.unpack_from("<I", self.mem, self.at(addr, 4))[0]

    def s16(self, addr):
        return signed(self.r16(addr), 16)

    def s32(self, addr):
        return signed(self.r32(addr))

    def w8(self, addr, v):
        at = self.at(addr)
        self.mem[at] = v & 0xFF
        self.code.pop(RAM + (at & ~3), None)

    def w16(self, addr, v):
        at = self.at(addr, 2)
        struct.pack_into("<H", self.mem, at, v & 0xFFFF)
        self.code.pop(RAM + (at & ~3), None)

    def w32(self, addr, v):
        at = self.at(addr, 4)
        struct.pack_into("<I", self.mem, at, v & M32)
        self.code.pop(RAM + at, None)

    def call(self, addr, *args, limit=20_000_000):
        """run the function at addr with up to four arguments, to its return;
        what it leaves in v0. The function itself runs whatever `stubs` holds,
        the stubs are the ones set as the call begins, and none of them may
        call in its turn, the stack and the return being this call's."""
        if len(args) > 4:
            raise Fault("a fifth argument goes on the stack, which the caller lays out")
        if self.running:
            raise Fault("a call made while another runs")
        r, code, stubs = self.r, self.code, self.stubs
        r[A0:A0 + len(args)] = [v & M32 for v in args]
        r[SP], r[RA] = STACK, HALT
        pc, npc, left = addr, addr + 4, limit
        self.running = True
        try:
            while pc != HALT:
                if not left:
                    raise Fault(f"{limit} instructions run and no return")
                left -= 1
                run = code.get(pc)
                if run is None:
                    run = code[pc] = self.decode(pc)
                target = run()
                pc, npc = npc, npc + 4 if target is None else target
                if pc in stubs:
                    answer = stubs[pc](self)
                    if answer is not RUN:
                        r[V0] = (answer or 0) & M32
                        pc, npc = r[RA], r[RA] + 4
        except Fault as e:
            raise Fault(f"{e}, at {pc:#x}") from None
        finally:
            self.running = False
            self.steps += limit - left
        return r[V0]

    def half(self, op, addr, rt):
        """load or store the half of a word lying across a boundary of four
        that addr reaches: `lwl`, `lwr`, `swl` or `swr`"""
        r = self.r
        low = 8 * (addr & 3)
        high = 24 - low
        word = self.r32(addr & ~3)
        if op == 34:
            r[rt or SINK] = (word << high | r[rt] & (1 << high) - 1) & M32
        elif op == 38:
            r[rt or SINK] = word >> low | r[rt] & ~(M32 >> low) & M32
        else:
            if op == 42:
                word = r[rt] >> high | word & ~(M32 >> high) & M32
            else:
                word = (r[rt] << low | word & (1 << low) - 1) & M32
            self.w32(addr & ~3, word)
            if self.stores is not None:
                self.stores.add(addr)

    def decode(self, pc):
        """the instruction at pc as a function that runs it and gives where a
        branch it takes or a jump goes. A write to the zero register lands in
        a sink past the registers, so the register reads zero unguarded."""
        if pc & 3 or not RAM <= pc < RAM + SIZE:
            raise Fault("no instruction there")
        m, r = self, self.r
        w = struct.unpack_from("<I", self.mem, pc - RAM)[0]
        op, rs, rt, imm = w >> 26, w >> 21 & 31, w >> 16 & 31, w & 0xFFFF
        simm = imm - 0x10000 if imm & 0x8000 else imm
        t, link, branch = rt or SINK, pc + 8, (pc + 4 + simm * 4) & M32
        if op == 0:
            d, sh, fn = (w >> 11 & 31) or SINK, w >> 6 & 31, w & 63
            if fn == 0:
                def run(): r[d] = r[rt] << sh & M32
            elif fn == 2:
                def run(): r[d] = r[rt] >> sh
            elif fn == 3:
                def run(): r[d] = (r[rt] ^ SIGN) - SIGN >> sh & M32
            elif fn == 4:
                def run(): r[d] = r[rt] << (r[rs] & 31) & M32
            elif fn == 6:
                def run(): r[d] = r[rt] >> (r[rs] & 31)
            elif fn == 7:
                def run(): r[d] = (r[rt] ^ SIGN) - SIGN >> (r[rs] & 31) & M32
            elif fn == 8:
                def run(): return r[rs]
            elif fn == 9:
                def run():
                    target = r[rs]
                    r[d] = link
                    return target
            elif fn == 16:
                def run(): r[d] = m.hi
            elif fn == 17:
                def run(): m.hi = r[rs]
            elif fn == 18:
                def run(): r[d] = m.lo
            elif fn == 19:
                def run(): m.lo = r[rs]
            elif fn == 24:
                def run():
                    p = signed(r[rs]) * signed(r[rt])
                    m.lo, m.hi = p & M32, p >> 32 & M32
            elif fn == 25:
                def run():
                    p = r[rs] * r[rt]
                    m.lo, m.hi = p & M32, p >> 32
            elif fn == 26:
                def run():
                    n, by = signed(r[rs]), signed(r[rt])
                    if by:
                        q = abs(n) // abs(by) * (-1 if (n < 0) != (by < 0) else 1)
                        m.lo, m.hi = q & M32, (n - q * by) & M32
                    else:
                        m.lo, m.hi = (1 if n < 0 else M32), n & M32
            elif fn == 27:
                def run():
                    if r[rt]:
                        m.lo, m.hi = r[rs] // r[rt], r[rs] % r[rt]
                    else:
                        m.lo, m.hi = M32, r[rs]
            elif fn in (32, 33):
                def run(): r[d] = (r[rs] + r[rt]) & M32
            elif fn in (34, 35):
                def run(): r[d] = (r[rs] - r[rt]) & M32
            elif fn == 36:
                def run(): r[d] = r[rs] & r[rt]
            elif fn == 37:
                def run(): r[d] = r[rs] | r[rt]
            elif fn == 38:
                def run(): r[d] = r[rs] ^ r[rt]
            elif fn == 39:
                def run(): r[d] = ~(r[rs] | r[rt]) & M32
            elif fn == 42:
                def run(): r[d] = int(r[rs] ^ SIGN < r[rt] ^ SIGN)
            elif fn == 43:
                def run(): r[d] = int(r[rs] < r[rt])
            else:
                raise Fault(f"instruction {w:#010x} is past this machine")
        elif op == 1 and rt in (0, 1, 16, 17):
            negative = not rt & 1
            if rt & 16:
                def run():
                    r[RA] = link
                    return branch if (r[rs] >= SIGN) == negative else None
            else:
                def run(): return branch if (r[rs] >= SIGN) == negative else None
        elif op == 2:
            jump = (pc + 4) & 0xF0000000 | (w & 0x3FFFFFF) << 2
            def run(): return jump
        elif op == 3:
            jump = (pc + 4) & 0xF0000000 | (w & 0x3FFFFFF) << 2
            def run():
                r[RA] = link
                return jump
        elif op == 4:
            def run(): return branch if r[rs] == r[rt] else None
        elif op == 5:
            def run(): return branch if r[rs] != r[rt] else None
        elif op == 6:
            def run(): return branch if r[rs] >= SIGN or not r[rs] else None
        elif op == 7:
            def run(): return branch if 0 < r[rs] < SIGN else None
        elif op in (8, 9):
            def run(): r[t] = (r[rs] + simm) & M32
        elif op == 10:
            def run(): r[t] = int((r[rs] ^ SIGN) - SIGN < simm)
        elif op == 11:
            unsigned = simm & M32
            def run(): r[t] = int(r[rs] < unsigned)
        elif op == 12:
            def run(): r[t] = r[rs] & imm
        elif op == 13:
            def run(): r[t] = r[rs] | imm
        elif op == 14:
            def run(): r[t] = r[rs] ^ imm
        elif op == 15:
            upper = imm << 16
            def run(): r[t] = upper
        elif op == 32:
            def run(): r[t] = signed(m.r8(r[rs] + simm), 8) & M32
        elif op == 33:
            def run(): r[t] = signed(m.r16(r[rs] + simm), 16) & M32
        elif op == 35:
            def run(): r[t] = m.r32(r[rs] + simm)
        elif op == 36:
            def run(): r[t] = m.r8(r[rs] + simm)
        elif op == 37:
            def run(): r[t] = m.r16(r[rs] + simm)
        elif op in (40, 41, 43):
            write = {40: m.w8, 41: m.w16, 43: m.w32}[op]
            def run():
                addr = (r[rs] + simm) & M32
                write(addr, r[rt])
                if m.stores is not None:
                    m.stores.add(addr)
        elif op in (34, 38, 42, 46):
            def run(): m.half(op, (r[rs] + simm) & M32, rt)
        else:
            raise Fault(f"instruction {w:#010x} is past this machine")
        return run
