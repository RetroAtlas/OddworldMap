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
