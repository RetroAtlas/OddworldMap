"""The R3000 interpreter over hand-assembled code: stdlib only, no disc."""

import struct
import sys
import unittest
from pathlib import Path

sys.path[:0] = [str(Path(__file__).resolve().parents[1])]

from oddmap.r3000 import HALT, RAM, RUN, SIZE, Fault, Machine  # noqa: E402

CODE, DATA, FAR = 0x80010000, 0x80020000, 0x80030000
ZERO, V0, V1, A0, A1, A2, A3, T0, T1, S0, RA = 0, 2, 3, 4, 5, 6, 7, 8, 9, 16, 31
M32 = 0xFFFFFFFF
NOP = 0


def special(fn, rd=0, rs=0, rt=0, sh=0): return rs << 21 | rt << 16 | rd << 11 | sh << 6 | fn
def immediate(op, rt, rs, value): return op << 26 | rs << 21 | rt << 16 | value & 0xFFFF
def jump(op, target): return op << 26 | target >> 2 & 0x3FFFFFF


def addu(rd, rs, rt): return special(33, rd, rs, rt)
def addiu(rt, rs, value): return immediate(9, rt, rs, value)
def lui(rt, value): return immediate(15, rt, 0, value)
def jr(rs): return special(8, rs=rs)
def branch(op, rs, rt, words): return immediate(op, rt, rs, words)


RETURN = (jr(RA), NOP)


def run(words, *args, data=b"", stubs=None, limit=10_000):
    """(what the code at CODE returns, the machine it ran in)"""
    m = Machine()
    m.load(CODE, struct.pack(f"<{len(words)}I", *words))
    m.load(DATA, data)
    m.stubs = stubs or {}
    return m.call(CODE, *args, limit=limit), m


def op3(fn, a, b):
    """a three-register instruction over two values"""
    return run([special(fn, V0, A0, A1), *RETURN], a, b)[0]


def with_immediate(op, a, value):
    return run([immediate(op, V0, A0, value), *RETURN], a)[0]


class Arithmetic(unittest.TestCase):
    def test_a_call_passes_four_arguments_and_returns_v0(self):
        got, m = run([addu(V0, A0, A1), addu(V0, V0, A2), jr(RA), addu(V0, V0, A3)], 1, 20, 300, 4000)
        self.assertEqual(got, 4321)
        self.assertEqual(m.steps, 4)

    def test_a_fifth_argument_is_refused(self):
        with self.assertRaisesRegex(Fault, "fifth argument"):
            run([*RETURN], 1, 2, 3, 4, 5)

    def test_sums_wrap_at_32_bits(self):
        self.assertEqual(op3(33, M32, 1), 0)
        self.assertEqual(op3(32, M32, 2), 1)
        self.assertEqual(op3(35, 0, 1), M32)
        self.assertEqual(op3(34, 5, 7), M32 - 1)
        self.assertEqual(with_immediate(9, 5, -6), M32)
        self.assertEqual(with_immediate(9, 1, 0x7FFF), 0x8000)
        self.assertEqual(with_immediate(8, 0x7FFFFFFF, 1), 0x80000000)

    def test_logic_takes_its_immediate_unsigned(self):
        self.assertEqual(op3(36, 0b1100, 0b1010), 0b1000)
        self.assertEqual(op3(37, 0b1100, 0b1010), 0b1110)
        self.assertEqual(op3(38, 0b1100, 0b1010), 0b0110)
        self.assertEqual(op3(39, 0b1100, 0b1010), M32 - 0b1110)
        self.assertEqual(with_immediate(12, M32, 0x8001), 0x8001)
        self.assertEqual(with_immediate(13, 0x10000, 0x8001), 0x18001)
        self.assertEqual(with_immediate(14, 0xFFFF, 0x8001), 0x7FFE)
        self.assertEqual(run([lui(V0, 0x8001), *RETURN])[0], 0x80010000)

    def test_a_comparison_is_signed_or_unsigned_by_its_name(self):
        self.assertEqual(op3(42, M32, 1), 1)
        self.assertEqual(op3(42, 1, M32), 0)
        self.assertEqual(op3(43, M32, 1), 0)
        self.assertEqual(op3(43, 1, M32), 1)
        self.assertEqual(with_immediate(10, M32 - 4, -4), 1)
        self.assertEqual(with_immediate(10, 3, -4), 0)
        self.assertEqual(with_immediate(11, 0x10000, -4), 1)
        self.assertEqual(with_immediate(11, M32, -4), 0)
        self.assertEqual([op3(42, 7, 7), op3(43, 7, 7), with_immediate(10, 7, 7), with_immediate(11, 7, 7)], [0] * 4)

    def test_a_shift_takes_its_count_from_five_bits_and_fills_from_the_right_with_zeros_or_the_sign(self):
        def by_count(fn, value, count):
            return run([special(fn, V0, rt=A0, sh=count), *RETURN], value)[0]

        def by_register(fn, value, count):
            return run([special(fn, V0, A1, A0), *RETURN], value, count)[0]

        self.assertEqual(by_count(0, 0x80000001, 4), 0x10)
        self.assertEqual(by_count(2, 0x80000000, 31), 1)
        self.assertEqual(by_count(3, 0x80000000, 31), M32)
        self.assertEqual(by_count(3, 0x40000000, 30), 1)
        self.assertEqual(by_register(4, 3, 33), 6)
        self.assertEqual(by_register(6, 0x80000000, 63), 1)
        self.assertEqual(by_register(7, 0x80000000, 36), 0xF8000000)
        self.assertEqual([by_count(2, 0x80000001, 0), by_count(3, 0x80000001, 0)], [0x80000001] * 2)
        self.assertEqual([by_register(fn, 0x80000001, 32) for fn in (4, 6, 7)], [0x80000001] * 3)

    def halves(self, fn, a, b):
        """(lo, hi) after a multiply or divide of two values"""
        code = [special(fn, rs=A0, rt=A1), special(18, V0), special(16, V1), *RETURN]
        got, m = run(code, a, b)
        return got, m.r[V1]

    def test_a_product_fills_hi_and_lo(self):
        self.assertEqual(self.halves(24, -2, 3), (M32 - 5, M32))
        self.assertEqual(self.halves(24, 3, -2), (M32 - 5, M32))
        self.assertEqual(self.halves(24, -2, -3), (6, 0))
        self.assertEqual(self.halves(24, 0x10000, 0x10000), (0, 1))
        self.assertEqual(self.halves(25, M32, 2), (M32 - 1, 1))
        self.assertEqual(self.halves(25, M32, M32), (1, M32 - 1))

    def test_a_division_cuts_toward_zero_and_its_remainder_takes_the_dividends_sign(self):
        self.assertEqual(self.halves(26, -7, 2), (M32 - 2, M32))
        self.assertEqual(self.halves(26, 7, -2), (M32 - 2, 1))
        self.assertEqual(self.halves(26, -7, -2), (3, M32))
        self.assertEqual(self.halves(27, M32, 16), (0x0FFFFFFF, 15))
        self.assertEqual(self.halves(27, M32, M32 - 1), (1, 1))
        self.assertEqual(self.halves(26, -0x80000000, -1), (0x80000000, 0))

    def test_a_division_by_zero_leaves_what_the_console_does(self):
        self.assertEqual(self.halves(26, 5, 0), (M32, 5))
        self.assertEqual(self.halves(26, -5, 0), (1, M32 - 4))
        self.assertEqual(self.halves(26, 0, 0), (M32, 0))
        self.assertEqual(self.halves(27, 5, 0), (M32, 5))

    def test_hi_and_lo_are_set_from_a_register(self):
        got, m = run([special(17, rs=A0), special(19, rs=A1), special(16, V0), special(18, V1), *RETURN], 7, 9)
        self.assertEqual((got, m.r[V1]), (7, 9))

    def test_the_zero_register_stays_zero(self):
        code = [addiu(ZERO, ZERO, 5), lui(ZERO, 1), special(33, ZERO, A0, A0), addu(V0, ZERO, ZERO), *RETURN]
        self.assertEqual(run(code, 9)[0], 0)
        code = [immediate(34, ZERO, A0, 3), immediate(38, ZERO, A0, 0), addu(V0, ZERO, ZERO), *RETURN]
        self.assertEqual(run(code, DATA, data=bytes([0x11, 0x22, 0x33, 0x44]))[0], 0)


class Control(unittest.TestCase):
    def taken(self, word, value, other=0):
        """whether a branch over one instruction is taken"""
        code = [word, addiu(V0, ZERO, 1), addiu(V0, V0, 10), *RETURN]
        return run(code, value, other)[0] == 1

    def test_a_branch_runs_its_delay_slot_either_way(self):
        code = [branch(4, A0, ZERO, 2), addiu(V0, ZERO, 1), addiu(V0, V0, 10), *RETURN]
        self.assertEqual(run(code, 0)[0], 1)
        self.assertEqual(run(code, 5)[0], 11)

    def test_each_branch_tests_its_own_condition(self):
        for op, rt, value, other, taken in [
            (4, A1, 7, 7, True), (4, A1, 7, 8, False), (5, A1, 7, 8, True), (5, A1, 7, 7, False),
            (6, 0, 0, 0, True), (6, 0, -1, 0, True), (6, 0, 1, 0, False),
            (7, 0, 1, 0, True), (7, 0, 0, 0, False), (7, 0, -1, 0, False),
            (1, 0, -1, 0, True), (1, 0, 0, 0, False), (1, 1, 0, 0, True), (1, 1, -1, 0, False),
            (1, 0, 1, 0, False), (1, 1, 1, 0, True), (1, 0, -0x80000000, 0, True), (1, 1, -0x80000000, 0, False),
            (6, 0, -0x80000000, 0, True), (7, 0, -0x80000000, 0, False),
        ]:
            with self.subTest(op=op, rt=rt, value=value, other=other):
                self.assertEqual(self.taken(branch(op, A0, rt, 2), value, other), taken)

    def test_a_branch_backward_loops(self):
        code = [addu(V0, V0, A0), addiu(A0, A0, -1), branch(5, A0, ZERO, -3), NOP, *RETURN]
        self.assertEqual(run(code, 10)[0], 55)

    def test_a_call_links_past_its_delay_slot(self):
        callee = CODE + 6 * 4
        code = [addu(S0, RA, ZERO), jump(3, callee), NOP, jr(S0), NOP, NOP, addu(V0, RA, ZERO), *RETURN]
        self.assertEqual(run(code)[0], CODE + 3 * 4)

    def test_a_jump_goes_without_linking(self):
        code = [jump(2, CODE + 4 * 4), addiu(V0, ZERO, 1), NOP, NOP, addu(V1, RA, ZERO), *RETURN]
        got, m = run(code)
        self.assertEqual((got, m.r[V1]), (1, HALT))

    def test_a_call_through_a_register_links_in_the_register_named(self):
        callee = CODE + 6 * 4
        code = [lui(T0, callee >> 16), immediate(13, T0, T0, callee), special(9, T1, T0), NOP, *RETURN, NOP,
                addu(V0, T1, ZERO), jr(T1), NOP]
        self.assertEqual(run(code)[0], CODE + 4 * 4)

    def test_a_linking_branch_links_whether_or_not_it_is_taken(self):
        for rt, value, taken in [(16, -1, True), (16, 1, False), (17, 0, True), (17, -1, False),
                                 (16, -0x80000000, True)]:
            code = [addu(S0, RA, ZERO), branch(1, A0, rt, 2), NOP, addiu(V1, ZERO, 1), addu(V0, RA, ZERO),
                    jr(S0), NOP]
            got, m = run(code, value)
            self.assertEqual((got, m.r[V1] == 0), (CODE + 3 * 4, taken), (rt, value))

    def test_a_function_that_never_returns_is_cut_off(self):
        with self.assertRaisesRegex(Fault, "50 instructions run and no return, at 0x80010000$"):
            run([jump(2, CODE), NOP], limit=50)

    def test_the_steps_run_on_from_call_to_call(self):
        _, m = run([addiu(V0, ZERO, 1), *RETURN])
        m.call(CODE)
        self.assertEqual(m.steps, 6)

    def test_an_instruction_it_does_not_know_is_refused_with_its_address(self):
        for word in [0x40806000, 0x0000000D, 0x0000000C, immediate(1, 2, A0, 1), 0xFC000000]:
            with self.subTest(word=hex(word)):
                with self.assertRaisesRegex(Fault, f"{word:#010x} is past this machine, at {CODE + 4:#x}"):
                    run([NOP, word, *RETURN])

    def test_running_outside_ram_or_off_a_words_boundary_is_refused(self):
        with self.assertRaisesRegex(Fault, "no instruction there, at 0x1000"):
            run([lui(T0, 0), immediate(13, T0, T0, 0x1000), jr(T0), NOP])
        m = Machine()
        m.load(CODE, struct.pack("<3I", addiu(V0, ZERO, 9), *RETURN))
        for addr in (CODE + 2, RAM + SIZE):
            with self.assertRaisesRegex(Fault, f"no instruction there, at {addr:#x}"):
                m.call(addr)


class Memory(unittest.TestCase):
    BYTES = bytes([0x80, 0x01, 0xFE, 0x7F, 0x11, 0x22, 0x33, 0x44])

    def loaded(self, op, at):
        return run([immediate(op, V0, A0, at), *RETURN], DATA, data=self.BYTES)[0]

    def test_a_load_extends_by_its_sign_or_with_zeros(self):
        self.assertEqual(self.loaded(32, 0), 0xFFFFFF80)
        self.assertEqual(self.loaded(36, 0), 0x80)
        self.assertEqual(self.loaded(32, 1), 1)
        self.assertEqual(self.loaded(33, 2), 0x7FFE)
        self.assertEqual(self.loaded(33, 0), 0x0180)
        self.assertEqual(self.loaded(37, 2), 0x7FFE)
        self.assertEqual(self.loaded(35, 4), 0x44332211)

    def test_a_load_or_a_store_reaches_back_from_its_register(self):
        def back(op, by=-4):
            return run([immediate(op, V0, A0, by), *RETURN], DATA + 8, data=self.BYTES)[0]

        self.assertEqual(back(35), 0x44332211)
        self.assertEqual(back(33), 0x2211)
        self.assertEqual(back(37), 0x2211)
        self.assertEqual((back(32, -8), back(36, -8)), (0xFFFFFF80, 0x80))
        halves = [immediate(38, V0, A0, -8), immediate(34, V0, A0, -5), *RETURN]
        self.assertEqual(run(halves, DATA + 8, data=self.BYTES)[0], 0x7FFE0180)
        self.assertEqual(run([immediate(33, V0, A0, -2), *RETURN], DATA + 2, data=bytes([0, 0x80]))[0], 0xFFFF8000)
        self.assertEqual(run([immediate(37, V0, A0, -2), *RETURN], DATA + 2, data=bytes([0, 0x80]))[0], 0x8000)
        _, m = run([immediate(43, A1, A0, -4), *RETURN], DATA + 8, 0xA1B2C3D4, data=bytes(8))
        self.assertEqual(bytes(m.mem[DATA - RAM:DATA - RAM + 8]), bytes.fromhex("00000000d4c3b2a1"))

    def test_a_store_writes_its_low_bytes_first(self):
        code = [immediate(43, A1, A0, 0), immediate(41, A1, A0, 4), immediate(40, A1, A0, 7), *RETURN]
        _, m = run(code, DATA, 0xA1B2C3D4, data=bytes(8))
        self.assertEqual(bytes(m.mem[DATA - RAM:DATA - RAM + 8]), bytes.fromhex("d4c3b2a1d4c300d4"))

    def test_a_word_across_a_boundary_loads_in_two_halves(self):
        for k in range(4):
            code = [immediate(38, V0, A0, k), immediate(34, V0, A0, k + 3), *RETURN]
            want = struct.unpack_from("<I", self.BYTES, k)[0]
            self.assertEqual(run(code, DATA, data=self.BYTES)[0], want, k)

    def test_a_word_across_a_boundary_stores_in_two_halves(self):
        for k in range(4):
            code = [immediate(46, A1, A0, k), immediate(42, A1, A0, k + 3), *RETURN]
            _, m = run(code, DATA, 0xA1B2C3D4, data=self.BYTES)
            want = bytearray(self.BYTES)
            want[k:k + 4] = bytes.fromhex("d4c3b2a1")
            self.assertEqual(bytes(m.mem[DATA - RAM:DATA - RAM + 8]), bytes(want), k)

    def test_half_a_load_keeps_the_rest_of_the_register(self):
        got = run([addu(V0, A1, ZERO), immediate(34, V0, A0, 1), *RETURN], DATA, 0xAABBCCDD, data=self.BYTES)[0]
        self.assertEqual(got, 0x0180CCDD)
        got = run([addu(V0, A1, ZERO), immediate(38, V0, A0, 2), *RETURN], DATA, 0xAABBCCDD, data=self.BYTES)[0]
        self.assertEqual(got, 0xAABB7FFE)

    def test_an_access_outside_ram_is_refused_with_its_address(self):
        for op in (32, 35, 40, 43):
            with self.subTest(op=op):
                with self.assertRaisesRegex(Fault, f"0x1f801070 is outside RAM, at {CODE + 8:#x}"):
                    run([lui(T0, 0x1F80), immediate(13, T0, T0, 0x1070), immediate(op, V0, T0, 0), *RETURN])
        with self.assertRaisesRegex(Fault, "outside RAM"):
            run([immediate(35, V0, A0, 0), *RETURN], RAM + SIZE - 2)

    def test_a_word_or_a_half_off_its_boundary_is_refused(self):
        for op, at, size in [(35, 2, 4), (43, 1, 4), (33, 1, 2), (41, 3, 2)]:
            with self.subTest(op=op):
                with self.assertRaisesRegex(Fault, f"is no address of {size} bytes"):
                    run([immediate(op, V0, A0, at), *RETURN], DATA)

    def test_what_is_loaded_must_lie_in_ram(self):
        m = Machine()
        for addr in (RAM - 4, RAM + SIZE - 3, 0x1000):
            with self.assertRaises(Fault):
                m.load(addr, bytes(4))
        m.load(RAM + SIZE - 4, bytes(4))

    def test_the_first_and_last_bytes_of_ram_are_reached(self):
        m = Machine()
        m.w32(RAM + SIZE - 4, 0xA1B2C3D4)
        m.w8(RAM, 0x7F)
        self.assertEqual((m.r32(RAM + SIZE - 4), m.r8(RAM + SIZE - 1), m.r8(RAM)), (0xA1B2C3D4, 0xA1, 0x7F))
        m.load(RAM, struct.pack("<3I", addiu(V0, ZERO, 9), *RETURN))
        self.assertEqual(m.call(RAM), 9)

    def test_the_readers_and_writers_agree_on_a_value(self):
        m = Machine()
        m.w32(DATA, -2)
        m.w16(DATA + 4, 0x18000)
        m.w8(DATA + 6, 0x1FF)
        self.assertEqual((m.r32(DATA), m.s32(DATA), m.r16(DATA + 4), m.s16(DATA + 4), m.r8(DATA + 6)),
                         (M32 - 1, -2, 0x8000, -0x8000, 0xFF))


class Calls(unittest.TestCase):
    def test_a_stub_answers_in_the_functions_place_once_the_delay_slot_has_run(self):
        seen = []

        def stub(m):
            seen.append(tuple(m.r[A0:A0 + 4]))
            return -3

        code = [addu(S0, RA, ZERO), jump(3, FAR), addiu(A0, A0, 1), addiu(V0, V0, 100), jr(S0), NOP]
        got, m = run(code, 1, 2, 3, 4, stubs={FAR: stub})
        self.assertEqual(seen, [(2, 2, 3, 4)])
        self.assertEqual(got, 97)
        self.assertEqual(m.steps, 6)

    def test_a_stub_answers_a_word_and_nothing_is_zero(self):
        code = [addu(S0, RA, ZERO), addiu(V0, ZERO, 9), jump(3, FAR), NOP, jr(S0), NOP]
        self.assertEqual(run(code, stubs={FAR: lambda m: None})[0], 0)
        self.assertEqual(run(code, stubs={FAR: lambda m: -1})[0], M32)

    def test_a_stub_that_answers_run_has_seen_the_call_and_lets_the_function_run(self):
        seen = []

        def stub(m):
            seen.append(m.r[A0])
            return RUN

        m = Machine()
        m.load(CODE, struct.pack("<6I", addu(S0, RA, ZERO), jump(3, FAR), NOP, addiu(V0, V0, 100), jr(S0), NOP))
        m.load(FAR, struct.pack("<3I", addiu(V0, A0, 1), *RETURN))
        m.stubs = {FAR: stub}
        self.assertEqual((m.call(CODE, 7), seen, m.steps), (108, [7], 9))

    def test_the_function_called_runs_whatever_the_stubs_hold_and_a_stub_may_not_call(self):
        m = Machine()
        m.load(CODE, struct.pack("<3I", addiu(V0, ZERO, 1), *RETURN))
        m.stubs = {CODE: lambda m: 7}
        self.assertEqual(m.call(CODE), 1)
        m.load(FAR, struct.pack("<6I", addu(S0, RA, ZERO), jump(3, CODE), NOP, addiu(V0, V0, 100), jr(S0), NOP))
        self.assertEqual(m.call(FAR), 107)
        m.stubs = {CODE: lambda m: m.call(CODE)}
        with self.assertRaisesRegex(Fault, f"a call made while another runs, at {CODE:#x}"):
            m.call(FAR)
        m.stubs = {}
        self.assertEqual(m.call(FAR), 101)

    def test_a_function_has_a_stack_to_keep_a_frame_on(self):
        code = [addiu(29, 29, -8), immediate(43, A0, 29, 4), immediate(35, V0, 29, 4), jr(RA), addiu(29, 29, 8)]
        self.assertEqual(run(code, 1234)[0], 1234)

    def test_the_stores_are_gathered_once_asked_for(self):
        code = [immediate(43, A1, A0, 4), immediate(40, A1, A0, 9), immediate(46, A1, A0, 13), *RETURN]
        m = Machine()
        m.load(CODE, struct.pack(f"<{len(code)}I", *code))
        m.call(CODE, DATA, 1)
        self.assertIsNone(m.stores)
        m.stores = set()
        m.call(CODE, DATA, 1)
        self.assertEqual(m.stores, {DATA + 4, DATA + 9, DATA + 13})

    def test_code_written_over_is_read_again(self):
        m = Machine()
        m.load(CODE, struct.pack("<4I", addiu(V0, ZERO, 1), *RETURN, NOP))
        self.assertEqual(m.call(CODE), 1)
        m.w32(CODE, addiu(V0, ZERO, 2))
        self.assertEqual(m.call(CODE), 2)
        m.w8(CODE, 3)
        self.assertEqual(m.call(CODE), 3)
        m.w16(CODE, 4)
        self.assertEqual(m.call(CODE), 4)
        m.load(CODE, struct.pack("<I", addiu(V0, ZERO, 5)))
        self.assertEqual(m.call(CODE), 5)
        m.load(CODE, struct.pack("<3I", addiu(V0, ZERO, 5), jr(RA), addiu(V0, V0, 1)))
        self.assertEqual(m.call(CODE), 6)

    def test_a_byte_or_a_half_written_inside_an_instruction_is_read_again(self):
        m = Machine()
        m.load(CODE, struct.pack("<3I", addiu(V0, ZERO, 0x8000), *RETURN))
        self.assertEqual(m.call(CODE), 0xFFFF8000)
        m.w8(CODE + 1, 0x81)
        self.assertEqual(m.call(CODE), 0xFFFF8100)
        m.w16(CODE + 2, immediate(13, V0, ZERO, 0) >> 16)
        self.assertEqual(m.call(CODE), 0x8100)

    def test_code_written_over_by_an_address_past_32_bits_is_read_again(self):
        m = Machine()
        m.load(CODE, struct.pack("<3I", addiu(V0, ZERO, 1), *RETURN))
        self.assertEqual(m.call(CODE), 1)
        for value, write in enumerate((m.w32, m.w16, m.w8), 2):
            for addr in (CODE - (1 << 32), CODE + (1 << 32)):
                m.w32(CODE, addiu(V0, ZERO, 1))
                self.assertEqual(m.call(CODE), 1)
                write(addr, addiu(V0, ZERO, value))
                self.assertEqual(m.call(CODE), value, (write.__name__, hex(addr)))

    def test_code_that_stores_over_code_runs_what_it_stored(self):
        m = Machine()
        m.load(CODE, struct.pack("<3I", addiu(V0, ZERO, 1), *RETURN))
        caller = [addu(S0, RA, ZERO), jump(3, CODE), NOP, immediate(43, A1, A0, 0), jump(3, CODE), NOP,
                  jr(S0), NOP]
        m.load(FAR, struct.pack(f"<{len(caller)}I", *caller))
        self.assertEqual(m.call(FAR, CODE, addiu(V0, ZERO, 7)), 7)


if __name__ == "__main__":
    unittest.main()
