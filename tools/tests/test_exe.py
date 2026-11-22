"""The executable readers over synthetic PS-X EXEs: stdlib only, no disc."""

import struct
import sys
import unittest
from pathlib import Path

sys.path[:0] = [str(Path(__file__).resolve().parents[1])]

from oddmap import exe  # noqa: E402

LOAD = 0x80010000
V0, A0, AT, RA = 2, 4, 1, 31


def lui(rt, imm): return (15 << 26) | (rt << 16) | (imm & 0xFFFF)
def addiu(rt, rs, imm): return (9 << 26) | (rs << 21) | (rt << 16) | (imm & 0xFFFF)
def ori(rt, rs, imm): return (13 << 26) | (rs << 21) | (rt << 16) | (imm & 0xFFFF)
def lw(rt, imm, rs): return (35 << 26) | (rs << 21) | (rt << 16) | (imm & 0xFFFF)
def lb(rt, imm, rs): return (32 << 26) | (rs << 21) | (rt << 16) | (imm & 0xFFFF)
def sw(rt, imm, rs): return (43 << 26) | (rs << 21) | (rt << 16) | (imm & 0xFFFF)
def jal(target): return (3 << 26) | ((target >> 2) & 0x3FFFFFF)
def addu(rd, rs, rt): return (rs << 21) | (rt << 16) | (rd << 11) | 33


JR_RA, NOP = 0x03E00008, 0


class Program:
    """an executable assembled word by word, its text loaded at LOAD"""
    def __init__(self):
        self.text = bytearray()

    def here(self):
        return LOAD + len(self.text)

    def words(self, *ws):
        at = self.here()
        for w in ws:
            self.text += struct.pack("<I", w)
        return at

    def blob(self, data):
        at = self.here()
        self.text += data + b"\0" * (-len(data) % 4)
        return at

    def image(self):
        head = bytearray(0x800)
        struct.pack_into("<I", head, 0x18, LOAD)
        return bytes(head + self.text)


def split(addr):
    """the lui half and the addiu half building addr"""
    return (addr + 0x8000) >> 16, addr & 0xFFFF


def set_video_mode(p, mode, calls=1):
    p.words(JR_RA, NOP)
    setter = p.words(lui(V0, 0x8009), lw(V0, -0x234C, V0), lui(AT, 0x8009), JR_RA, sw(A0, -0x234C, AT))
    p.words(lui(V0, 0x8009), lw(V0, -0x234C, V0), JR_RA, NOP)
    for _ in range(calls):
        p.words(jal(setter), ori(A0, 0, mode) if mode else addu(A0, 0, 0))
    return setter


def vsync(p, *args):
    message = p.blob(b"VSync: timeout\n\0")
    p.words(JR_RA, NOP)
    hi, lo = split(message)
    helper = p.words(lui(A0, hi), addiu(A0, A0, lo), JR_RA, NOP)
    vs = p.words(jal(helper), NOP, JR_RA, NOP)
    for a in args:
        p.words(jal(vs), addiu(A0, 0, a))


class VideoMode(unittest.TestCase):
    def test_the_one_call_names_the_mode(self):
        for mode in (0, 1):
            p = Program()
            set_video_mode(p, mode)
            self.assertEqual(exe.video_mode(p.image()), mode)

    def test_a_setter_called_twice_is_no_mode(self):
        p = Program()
        set_video_mode(p, 1, calls=2)
        with self.assertRaises(SystemExit):
            exe.video_mode(p.image())


class LoadedCode(unittest.TestCase):
    """code with no header, read by the address it loads at"""
    BASE = 0x800A0000

    def test_an_overlay_is_read_from_its_first_word_as_an_executable_past_its_header(self):
        target = self.BASE + 0x1234
        hi, lo = split(target)
        words = [jal(self.BASE + 8), NOP, lui(V0, hi), addiu(V0, V0, lo), JR_RA, NOP, target]
        img = exe.Image(struct.pack(f"<{len(words)}I", *words), self.BASE)
        self.assertEqual((img.load, img.end, img.word(self.BASE + 16)), (self.BASE, self.BASE + 28, JR_RA))
        self.assertEqual((img.holds(self.BASE), img.holds(self.BASE + 28)), (True, False))
        self.assertEqual(exe.references(img, target), [self.BASE + 12])
        self.assertEqual(exe.callers(img, self.BASE + 8), [self.BASE])
        self.assertEqual(img.words_equal(target), [self.BASE + 24])

    def test_a_half_is_lost_where_its_register_is_written_over_before_the_other(self):
        target = 0x800A0178
        hi, lo = split(target)

        def built(between):
            words = [lui(V0, hi), between, addiu(V0, V0, lo), JR_RA, NOP]
            img = exe.Image(struct.pack(f"<{len(words)}I", *words), self.BASE)
            return exe.references(img, target) == [self.BASE + 8]

        computes_or_loads = {*range(8, 16), *range(32, 39)}
        for op in range(1, 64):
            self.assertEqual(built(op << 26 | A0 << 21 | V0 << 16 | 4), op not in computes_or_loads, op)
        self.assertEqual([built(w) for w in (addu(V0, A0, A0), addu(A0, V0, V0), lui(A0, 0x8001), NOP)],
                         [False, True, True, True])


class NamedLoads(unittest.TestCase):
    def test_a_word_and_a_byte_loaded_by_name_are_told_apart_and_from_one_loaded_otherwise(self):
        p = Program()
        p.words(JR_RA, NOP)
        start = p.words(lui(V0, 0x8009), lw(V0, -0x1000, V0), lui(A0, 0x8002), lbu(V0, 0x44, A0),
                        lui(AT, 0x8003), addu(AT, AT, A0), lbu(V0, 8, AT), lui(A0, 0x8004), lb(V0, 4, A0),
                        JR_RA, NOP)
        image = exe.Image(p.image())
        self.assertEqual((exe.words_loaded(image, start), exe.bytes_loaded(image, start)),
                         ({0x8008F000}, {0x80020044}))


class Constants(unittest.TestCase):
    """what a function's code hands, steps and adds, off its instructions"""
    A1, T0, SP, FRAME = 5, 8, 29, 0x8008F000

    def image(self, *words):
        """(an image holding a function of the words, the address of the first)"""
        p = Program()
        p.words(JR_RA, NOP)
        start = p.words(*words, JR_RA, NOP)
        return exe.Image(p.image()), start

    def test_an_argument_is_read_from_the_delay_slot_or_before_the_call_in_the_register_asked_for(self):
        image, start = self.image(lui(self.A1, 1), ori(A0, 0, 9), jal(LOAD), ori(A0, 0, 7))
        self.assertEqual([exe.argument(image, start + 8, r) for r in (A0, self.A1, self.T0)], [7, 0x10000, None])
        self.assertEqual(exe.first_argument(image, start + 8), 7)

    def test_an_argument_is_read_as_far_back_as_asked_and_not_past_a_jump(self):
        image, start = self.image(ori(self.A1, 0, 0xCCCC), *[NOP] * 8, jal(LOAD), NOP)
        self.assertEqual([exe.argument(image, start + 36, self.A1, n) for n in (8, 9, 12)], [None, 0xCCCC, 0xCCCC])
        self.assertIsNone(exe.argument(image, start + 36, self.A1))
        for jump in (jal(LOAD), beq(A0, 0, 1), JR_RA):
            image, start = self.image(ori(self.A1, 0, 0xCCCC), jump, NOP, jal(LOAD), NOP)
            self.assertIsNone(exe.argument(image, start + 12, self.A1))

    def test_an_argument_set_otherwise_is_no_constant(self):
        for word in (addu(self.A1, A0, A0), lw(self.A1, 4, A0), ori(self.A1, self.A1, 0xCCCC), addiu(self.A1, A0, 3)):
            image, start = self.image(lui(self.A1, 1), word, jal(LOAD), NOP)
            self.assertIsNone(exe.argument(image, start + 8, self.A1))
        image, start = self.image(addu(self.A1, 0, 0), jal(LOAD), NOP)
        self.assertEqual(exe.argument(image, start + 4, self.A1), 0)

    def test_the_steps_of_a_function_are_the_ones_it_takes_in_place_but_for_its_stack_and_the_addresses_it_builds(self):
        hi, lo = split(0x800C0268)
        image, start = self.image(addiu(self.SP, self.SP, -160), lui(V0, hi), addiu(V0, V0, lo),
                                  addiu(self.T0, self.T0, 19), addiu(A0, self.T0, 5), addiu(A0, 0, 3), lui(V0, hi),
                                  addiu(A0, A0, -8), addiu(self.SP, self.SP, 160))
        self.assertEqual(exe.steps(image, start), [19, -8])

    def test_what_is_added_to_a_word_loaded_by_name_is_read_up_to_the_next_jump(self):
        hi, lo = split(self.FRAME)
        word = (lui(V0, hi), lw(V0, lo, V0))
        image, start = self.image(*word, addiu(A0, A0, 4), ori(A0, 0, 4), addiu(V0, V0, 75), jal(LOAD), NOP,
                                  *word, addiu(V0, V0, 15))
        self.assertEqual([exe.added(image, at, self.FRAME) for at in (start, start + 28)], [[75], [15]])
        self.assertEqual(exe.added(image, start, self.FRAME + 4), [])
        for other in (ori(V0, 0, hi), lui(A0, hi)):
            image, start = self.image(other, lw(V0, lo, V0), addiu(V0, V0, 75))
            self.assertEqual(exe.added(image, start, self.FRAME), [])
        for jump in (JR_RA, beq(A0, 0, 1), jal(LOAD)):
            image, start = self.image(*word, jump, NOP, addiu(V0, V0, 75))
            self.assertEqual(exe.added(image, start, self.FRAME), [])


class FrameRate(unittest.TestCase):
    def test_every_vsync_call_reads_its_argument(self):
        p = Program()
        vsync(p, 0, 2, -1)
        self.assertEqual(exe.vsync_arguments(p.image()), [0, 2, -1])

    def test_vsync_two_under_each_video_mode(self):
        for mode, hz in ((0, 30), (1, 25)):
            p = Program()
            vsync(p, 2)
            set_video_mode(p, mode)
            self.assertEqual(exe.frame_rate(p.image()), hz)

    def test_no_flip_on_vsync_two_is_refused(self):
        p = Program()
        vsync(p, 0, 1)
        set_video_mode(p, 0)
        with self.assertRaises(SystemExit):
            exe.frame_rate(p.image())


class PathRecords(unittest.TestCase):
    LAYOUT = {"rect": 4, "objects": 20, "collision": 12, "overlay": 12, "files_from": "\\S1.OVL;1"}

    def program(self):
        p = Program()
        names = [p.blob(n.encode() + b"\0") for n in ("\\S1.OVL;1", "\\S1.LVL;1", "\\P2\\R1.OVL;1")]
        p.words(*[w for n in names for w in (n, 0)])
        pd = p.blob(struct.pack("<I8hii", 0, 0, 0, 3072, 1440, 1024, 480, 1024, 480, 672, 3592))
        ci = p.blob(struct.pack("<I4hIIII", 0, 0, 0, 3072, 1440, 72, 31, 1024, 480))
        bly = p.blob(b"R1P20.BLY\0")
        p.blob(struct.pack("<IIIHH", bly, pd, ci, 2, 0))
        return p.image()

    def test_a_record_reaches_its_path_data_and_collision(self):
        row = exe.path_records(self.program(), self.LAYOUT)[("R1", 20)]
        self.assertEqual(row, {"w_units": 3072, "h_units": 1440, "obj_off": 672, "idx_off": 3592,
                               "coll_off": 72, "coll_count": 31, "overlay": 2})

    def test_the_overlay_is_named_through_the_file_table(self):
        self.assertEqual(exe.path_overlays(self.program(), self.LAYOUT), {("R1", 20): "R1.OVL"})

    def test_abe_start_is_read_where_the_layout_places_one(self):
        row = exe.path_records(self.program(), {**self.LAYOUT, "abe": 8})[("R1", 20)]
        self.assertEqual((row["abe_x"], row["abe_y"]), (3072, 1440))

    def test_records_naming_no_overlay_name_none(self):
        layout = {k: v for k, v in self.LAYOUT.items() if k not in ("overlay", "files_from")}
        self.assertIsNone(exe.path_overlays(self.program(), layout))


def bne(rs, rt, off): return (5 << 26) | (rs << 21) | (rt << 16) | (off & 0xFFFF)
def beq(rs, rt, off): return (4 << 26) | (rs << 21) | (rt << 16) | (off & 0xFFFF)
def lbu(rt, imm, rs): return (36 << 26) | (rs << 21) | (rt << 16) | (imm & 0xFFFF)
def sll(rd, rt, sh): return (rt << 16) | (rd << 11) | (sh << 6)


class Text(unittest.TestCase):
    """the LCD font's glyph table and how the measuring routine reads codes"""
    V1, T0, T1, S1, S3, A1 = 3, 8, 9, 17, 19, 5

    def program(self, offset):
        """a font set up with a table when its kind is 2, and a routine measuring
        a string that draws code c with entry c - offset"""
        p = Program()
        p.blob(bytes(32))
        table = p.blob(bytes(i & 255 for i in range(4 * 256)))
        p.words(JR_RA, NOP)
        hi, lo = split(table)
        p.words(ori(V0, 0, 2), bne(self.S3, V0, 4), NOP, lui(V0, hi), addiu(V0, V0, lo), sw(V0, 8, self.S1))
        p.words(JR_RA, NOP)
        p.words(lbu(self.V1, 0, self.A1), beq(self.V1, 0, 13), NOP,
                lw(V0, 0x2C, A0), NOP, lw(V0, 8, V0),
                addiu(self.V1, self.V1, -offset), sll(self.V1, self.V1, 2), addu(self.V1, self.V1, V0),
                lbu(self.T0, 2, self.V1), lbu(self.T1, 2, V0), addiu(self.A1, self.A1, 1),
                lbu(self.V1, 0, self.A1), bne(self.V1, 0, -11), NOP,
                JR_RA, NOP)
        return p.image(), table

    def test_the_table_the_lcd_font_is_set_up_with_is_found(self):
        data, table = self.program(5)
        self.assertEqual(exe.lcd_glyph_table(data), table)

    def test_each_code_reads_the_glyph_the_routine_reaches(self):
        data, table = self.program(5)
        codes, escapes = exe.text_codes(data, table)
        self.assertEqual((codes[0x30], codes[0x41], escapes), (0x30 - 5, 0x41 - 5, {}))
