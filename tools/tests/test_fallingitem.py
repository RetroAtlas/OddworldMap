"""The falling item's model over records worked by hand, its routines found in
a synthetic overlay, and what the verifier adds to the model: stdlib only, no
disc."""

import struct
import sys
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest import mock

sys.path[:0] = [str(Path(__file__).resolve().parents[1]), str(Path(__file__).resolve().parent)]

import fallingitem_verify  # noqa: E402
from synthetic import JR_RA, NOP, Assembly, addiu, chunk, jal, lh, lui, named, ori, word_at  # noqa: E402
from oddmap import fallingitem  # noqa: E402
from oddmap.exe import Image  # noqa: E402
from oddmap.fallingitem import GAIN, PERIOD  # noqa: E402
from oddmap.fixed import FP  # noqa: E402
from oddmap.games import GAMES  # noqa: E402
from oddmap.render import ABOVE, BELOW, LEFT, ON, RIGHT, Frame, Sprite  # noqa: E402

RECORD = fallingitem.Record(x1=1237, y1=276, x2=1262, y2=301, switch=5, scale=0, interval=30, most=3, reset=1)
ROCK = Frame(37, 28, -18, -31, (-18, -31, 18, -5))
LEANS = Frame(40, 47, -24, -46, (-12, -31, 10, -5))


def item(game="AE", level=3, led=False, info=0, **record):
    """(an item made over the record with some of it replaced, the world it was made in)"""
    world = fallingitem.World(game, level, 5, 77, led)
    return fallingitem.FallingItem(world, RECORD._replace(**record), info), world


class Constructor(unittest.TestCase):
    def test_an_item_is_left_at_its_records_corner_to_wait_there_and_to_come_back_to(self):
        self.assertEqual(vars(item(info=9)[0]), dict(
            kind=48, explodes=True, info=9, level=3, path=5, across=0, down=0, red=127, green=127, blue=127,
            switch=5, interval=30, reset=1, most=3, left=3, scale=FP, plane=1, layer=31, x=1237 * FP, y=276 * FP,
            foot_x=1249 * FP, foot_y=301 * FP, start=276 * FP, state=0, sounding=1, hit=0, channels=0, leads=True,
            created=77))

    def test_an_item_of_scale_one_is_half_on_the_plane_behind_and_in_exoddus_on_a_layer_of_its_own(self):
        made = item(scale=1)[0]
        self.assertEqual((made.scale, made.plane, made.layer), (FP // 2, 0, 12))
        made = item("AO", scale=1)[0]
        self.assertEqual((made.scale, made.plane, made.layer), (FP // 2, 0, 31))
        made = item(scale=2)[0]
        self.assertEqual((made.scale, made.plane, made.layer), (FP, 1, 31))

    def test_oddysee_draws_five_under_the_point_in_its_own_grey_and_tints_the_items_of_its_lines(self):
        made = item("AO", 1)[0]
        self.assertEqual((made.kind, made.down, made.red, made.green, made.blue), (32, 5, 105, 105, 105))
        made = item("AO", 2)[0]
        self.assertEqual((made.red, made.green, made.blue), (77, 120, 190))
        self.assertEqual(item("AE", 2)[0].red, 127)

    def test_the_foot_is_the_middle_of_the_rect_cut_toward_zero_at_its_bottom(self):
        for x1, x2, middle in ((1237, 1262, 1249), (-30, -5, -17), (-31, -5, -18), (-3, 8, 2), (-8, 3, -2)):
            made = item(x1=x1, x2=x2)[0]
            self.assertEqual((made.foot_x, made.foot_y), (middle * FP, 301 * FP), (x1, x2))

    def test_the_first_item_made_hums_for_the_rest_in_exoddus_and_on_oddysees_farms(self):
        first, world = item()
        second = fallingitem.FallingItem(world, RECORD)
        self.assertEqual((first.leads, first.created, second.leads, second.created, world.led),
                         (True, 77, False, 0, True))
        for level, leads in ((1, True), (13, True), (2, False), (5, False)):
            made, world = item("AO", level)
            self.assertEqual((made.leads, made.created, world.led), (leads, 77 * leads, leads), level)
        made, world = item("AO", 1, led=True)
        self.assertEqual((made.leads, made.created, world.led), (False, 0, True))

    def test_the_render_reads_the_item_at_its_point(self):
        self.assertEqual(vars(item("AO", 2, scale=1)[0].sprite()),
                         vars(Sprite(1237 * FP, 276 * FP, FP // 2, 2, 5, 0, 5)))


BASE, LOAD, FRAME = 0x800A0000, 0x80010000, 0x8007C000
TABLE, FIRST, SIZE = BASE + 0x400, BASE + 0x480, 0x4C0
A1, S1, V0, V1, T0 = 5, 17, 2, 3, 8


def move(rd, rs):
    return rs << 21 | rd << 11 | 33


def overlay(updates=1, slots=1, shown=0, makers=1, record="moved", frames=1, firsts=1):
    """(a synthetic overlay, a synthetic executable's image, what
    fallingitem.code is to find in the two): the item's routines in the
    shapes the overlays compile them to, beside a routine that hums and does
    not fall, and the table naming its virtual ones, the render `shown` bytes
    into the executable's or, with None, in no executable"""
    head = bytearray(0x800)
    struct.pack_into("<I", head, 0x18, LOAD)
    exe = Assembly(LOAD)
    exe.emit(JR_RA, NOP)
    base, shows = exe.emit(JR_RA, NOP), exe.emit(NOP, JR_RA, NOP)
    code = Assembly(BASE)
    emit = code.emit
    emit(JR_RA, NOP)
    saw = emit(lui(V1, PERIOD >> 16), ori(V1, V1, PERIOD), lui(V0, 2), ori(V0, V0, GAIN), JR_RA, NOP)
    falls = [emit(lui(V0, GAIN >> 16), ori(V0, V0, GAIN), lui(V1, PERIOD >> 16), NOP, ori(V1, V1, PERIOD), JR_RA, NOP)
             for _ in range(updates)]
    emit(*named(T0, TABLE), JR_RA, NOP)
    read = {"moved": (move(S1, A1), jal(base), NOP, lh(V0, 0x10, S1)),
            "slot": (jal(base), move(S1, A1), lh(V0, 0x10, S1)),
            "direct": (lh(V0, 0x10, A1), jal(base), NOP),
            "called": (jal(base), NOP, lh(V0, 0x10, A1)),
            "over": (move(S1, A1), addiu(S1, 0, 5), jal(base), NOP, lh(V0, 0x10, S1))}[record]
    made = [emit(*read, *named(T0, TABLE), *(w for k in range(frames) for w in word_at(V1, FRAME + 16 * k)),
                 *(w for k in range(firsts) for w in word_at(V1, FIRST + 16 * k)), JR_RA, NOP) for _ in range(makers)]
    blob = bytearray(code.data.ljust(SIZE, b"\0"))
    for k in range(slots):
        struct.pack_into("<3I", blob, 0x400 + 0x40 * k + 20, falls[0] if falls else saw, 0,
                         BASE + 4 if shown is None else shows + shown)
    return bytes(blob), Image(bytes(head + exe.data)), fallingitem.Code(
        construct=made[0], update=falls[0] if falls else saw, render=shows, table=TABLE, frame=FRAME, first=FIRST)


class Disc:
    def __init__(self, blobs):
        self.blobs = blobs
        self.files = {name: (i, len(blob)) for i, (name, blob) in enumerate(blobs.items())}

    def read(self, lba, size):
        return list(self.blobs.values())[lba]


class Routines(unittest.TestCase):
    def found(self, **shape):
        """(what fallingitem.code finds in an overlay of a shape, what the overlay was built to hold)"""
        blob, exe, want = overlay(**shape)
        return fallingitem.code(blob, BASE, exe), want

    def test_the_routines_are_found_by_what_they_build_and_load_and_the_table_naming_them(self):
        self.assertEqual(*self.found())

    def test_a_record_is_followed_into_the_register_it_is_moved_to_past_a_call(self):
        self.assertEqual(*self.found(record="slot"))
        self.assertEqual(*self.found(record="direct"))

    def test_an_overlay_of_another_shape_is_refused_by_the_part_that_is_off(self):
        for shape, refusal in [
            (dict(updates=0), "0 candidates for the update, a routine building"),
            (dict(updates=2), "2 candidates for the update, a routine building"),
            (dict(slots=0), "0 candidates for the update's slot"),
            (dict(slots=2), "2 candidates for the update's slot"),
            (dict(shown=4), "no function of the executable's in the slot after the update's"),
            (dict(shown=None), "no function of the executable's in the slot after the update's"),
            (dict(record="called"), "0 candidates for the constructor"),
            (dict(record="over"), "0 candidates for the constructor"),
            (dict(makers=2), "2 candidates for the constructor"),
            (dict(frames=0), "0 candidates for the frame counter"),
            (dict(frames=2), "2 candidates for the frame counter"),
            (dict(firsts=0), "0 candidates for the word naming the item that hums"),
            (dict(firsts=2), "2 candidates for the word naming the item that hums"),
        ]:
            with self.subTest(shape=shape):
                with self.assertRaisesRegex(RuntimeError, refusal):
                    self.found(**shape)

    def test_the_overlays_holding_an_update_are_the_ones_run_at_the_address_the_messages_load_at(self):
        falls, hums, lcd, other = overlay()[0], overlay(updates=0)[0], b"LCD.", b"LCD!"
        files = {"B.OVL": falls, "A.OVL": hums, "L.OVL": lcd, "C.OVL": falls, "D.BND": falls}
        leads = {lcd: ([], BASE), other: ([], LOAD)}
        with mock.patch.object(fallingitem, "lead_table", lambda blob, count: leads.get(blob)):
            blobs, base = fallingitem.overlays(Disc(files), "AE")
            self.assertEqual((list(blobs), base), (["B.OVL", "C.OVL"], BASE))
            with self.assertRaisesRegex(RuntimeError, "0 candidates for the address the overlays load at"):
                fallingitem.overlays(Disc({"B.OVL": falls}), "AE")
            with self.assertRaisesRegex(RuntimeError, "2 candidates for the address the overlays load at"):
                fallingitem.overlays(Disc({**files, "M.OVL": other}), "AE")


def archive(rid, data):
    """a file of a level's archive holding one chunk of animations"""
    return struct.pack("<IHHII", 16 + len(data), 0, 0, int.from_bytes(b"Anim", "little"), rid) + data


class Level:
    def __init__(self, **files):
        self.files = files

    def read(self, name):
        return self.files[name]


class Discs(unittest.TestCase):
    def test_a_levels_archive_is_the_fullest_copy_the_discs_hold(self):
        game = {"levels": [(1, "MI", ""), (2, "NE", ""), (3, "PV", ""), (4, "XX", "")],
                "tables": {"MI": {}, "NE": {}, "PV": {}}}
        one = SimpleNamespace(files={"MI.LVL": (0, 10), "NE.LVL": (5, 20), "XX.LVL": (9, 5)})
        two = SimpleNamespace(files={"MI.LVL": (0, 30), "PV.LVL": (7, 1)})

        def lvl(disc, name):
            if name == "PV.LVL":
                raise ValueError("not a LVL archive")
            return disc, name

        with mock.patch.object(fallingitem, "Lvl", lvl):
            self.assertEqual(fallingitem.archives([one, two], game), {"MI": (two, "MI.LVL"), "NE": (one, "NE.LVL")})

    def test_a_cameras_list_is_read_to_the_record_that_ends_it(self):
        fmt = GAMES["AE"]["tlv"]
        records = b"".join(struct.pack("<BBhI", flags, 0, length, kind).ljust(length, b"\0")
                           for flags, length, kind in ((0, 16, 5), (4, 20, 7), (4, 16, 9), (0, 16, 5)))
        blob = bytes(8) + records + struct.pack("<3i", 0, -1, 36)
        self.assertEqual(fallingitem._listed(blob, 8, 3, fmt), {0: 0, 16: 0, 36: 2})
        with self.assertRaisesRegex(RuntimeError, "the list of cell 2 runs off its records"):
            fallingitem._listed(blob[:-4] + struct.pack("<i", 4), 8, 3, fmt)

    def test_an_items_art_is_the_chunk_of_its_id_that_holds_its_table(self):
        data, whole, last = chunk(ROCK, LEANS)
        self.assertEqual((fallingitem.tables(data), fallingitem.tables(data[:last])), ([whole, last], []))
        levels = {"MI": Level(**{"ROCK.BAN": archive(2007, data), "ABE.BND": archive(10, data)}),
                  "NE": Level(**{"NEROCK.BAN": archive(2007, data), "CUT.BAN": archive(2007, data[:last])})}
        self.assertEqual(fallingitem.art(levels, 2007, last), data)
        for rid, table, refusal in ((2007, last + 4, "0 candidates for the animation 2007 with a table at 0x58"),
                                    (2008, last, "0 candidates for the animation 2008")):
            with self.assertRaisesRegex(RuntimeError, refusal):
                fallingitem.art(levels, rid, table)
        levels["PV"] = Level(**{"PVROCK.BAN": archive(2007, chunk(LEANS, ROCK)[0])})
        with self.assertRaisesRegex(RuntimeError, "2 candidates for the animation 2007"):
            fallingitem.art(levels, 2007, last)


class Verifier(unittest.TestCase):
    def test_a_record_is_made_up_at_its_other_scale_and_left_of_the_paths_origin(self):
        for game, header, rect in (("AE", 0x10, 0x08), ("AO", 0x18, 0x10)):
            words = bytearray(header + 10)
            struct.pack_into("<4h", words, rect, 1237, 276, 1262, 301)
            struct.pack_into("<5h", words, header, 5, 0, 30, 3, 1)
            placed = fallingitem.Placed("PV", 5, RECORD, bytes(words), "PVP05C03", 1125, 260)
            half, neither, left = fallingitem_verify.made_up(game, placed)
            for made, scale in ((half, 1), (neither, 2)):
                struct.pack_into("<h", words, header + 2, scale)
                self.assertEqual(made, placed._replace(record=RECORD._replace(scale=scale), words=bytes(words)), game)
            struct.pack_into("<h", words, header + 2, 0)
            struct.pack_into("<4h", words, rect, -30, 276, -5, 301)
            if game == "AO":
                struct.pack_into("<2h", words, 0x0C, -30, 276)
            self.assertEqual(left, placed._replace(record=RECORD._replace(x1=-30, x2=-5), words=bytes(words)), game)

    def test_an_overlays_line_says_what_its_run_covered_or_the_first_thing_that_differed(self):
        found = fallingitem.Code(0x800A1000, 0x800A2000, 0x80025FB0, 0x800A3000, 0x8007C000, 0x800A4000)
        got = fallingitem_verify.Tally(93, 3, 1152, (2007, 0x1D2C), 6208, 2936, {ON, ABOVE, BELOW, LEFT, RIGHT},
                                       {1, 2, 3, 4}, 5571768, found)
        self.assertEqual(fallingitem_verify.report("SLUS_007.10", "PV.OVL", got), (
            "SLUS_007.10 PV.OVL: the disc's code and the model agree over 93 placed records and 3 made up, built "
            "1,152 times, and 6,208 frames of the animation 2007 set up from 0x1d2c rendered, 2,936 of them drawn, "
            "their rects on the window and on every side of it, at 4 scales, in 5,571,768 instructions; constructor "
            "0x800a1000, render 0x80025fb0", True))
        line, agrees = fallingitem_verify.report("SLUS_007.10", "PV.OVL", got._replace(sides={ON, LEFT}))
        self.assertEqual(("their rects never above it, below it, right of it, at 4 scales" in line, agrees),
                         (True, True))
        self.assertEqual(fallingitem_verify.report("SLUS_007.10", "PV.OVL", "PV P5 (1237,276): the item's y"),
                         ("SLUS_007.10 PV.OVL: PV P5 (1237,276): the item's y", False))


if __name__ == "__main__":
    unittest.main()
