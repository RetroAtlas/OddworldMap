"""The falling item's model over records worked by hand, its routines found in
a synthetic overlay, what the two tools add to the model, and the numbers the
viewer's tests hold its port to: stdlib only, no disc."""

import contextlib
import io
import json
import re
import struct
import sys
import unittest
from pathlib import Path
from unittest import mock

sys.path[:0] = [str(Path(__file__).resolve().parents[1]), str(Path(__file__).resolve().parent)]

import fallingitem_trace  # noqa: E402
import fallingitem_verify  # noqa: E402
from synthetic import JR_RA, NOP, Assembly, addiu, jal, lh, lui, named, ori, word_at  # noqa: E402
from oddmap import fallingitem, records, render  # noqa: E402
from oddmap.exe import Image  # noqa: E402
from oddmap.fallingitem import DOWN, GAIN, PERIOD  # noqa: E402
from oddmap.fixed import FP  # noqa: E402
from oddmap.paths import ROOT  # noqa: E402
from oddmap.render import ABOVE, BELOW, LEFT, ON, RIGHT, Frame, Sprite, Stage  # noqa: E402

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
        with mock.patch.object(records, "lead_table", lambda blob, count: leads.get(blob)):
            blobs, base = fallingitem.overlays(Disc(files), "AE")
            self.assertEqual((list(blobs), base), (["B.OVL", "C.OVL"], BASE))
            with self.assertRaisesRegex(RuntimeError, "0 candidates for the address the overlays load at"):
                fallingitem.overlays(Disc({"B.OVL": falls}), "AE")
            with self.assertRaisesRegex(RuntimeError, "2 candidates for the address the overlays load at"):
                fallingitem.overlays(Disc({**files, "M.OVL": other}), "AE")


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


class Trace(unittest.TestCase):
    SHORT = ROCK._replace(rect=(-18, -31, 18, -6))
    ARTS = {"AE_FallingRock_Falling": fallingitem_trace.Art(4, 0, [ROCK, SHORT]),
            "AE_FallingRock_Waiting": fallingitem_trace.Art(1, 0, [ROCK, ROCK]),
            "FallingCrate_Falling": fallingitem_trace.Art(1, 0, [LEANS]),
            "FallingCrate_Waiting": fallingitem_trace.Art(1, 0, [LEANS])}

    def item(self, short, x, y, **record):
        record = RECORD._replace(x1=x, y1=y, x2=x + 25, y2=y + 25, **record)
        return fallingitem_trace.Item(short, 1, 1, record, f"{short}P01C01", 0, 0)

    def test_a_frame_is_held_its_arts_count_of_ticks_and_the_art_comes_round_from_where_it_loops(self):
        art = fallingitem_trace.Art(4, 0, [ROCK] * 3)
        at = fallingitem_trace.frame_at
        self.assertEqual([at(art, tick) for tick in (1, 4, 5, 12, 13, 24, 25)], [0, 0, 1, 2, 0, 2, 0])
        self.assertEqual([at(art._replace(loop=1), tick) for tick in (12, 13, 17, 21)], [2, 1, 2, 1])
        self.assertEqual([at(art._replace(loop=None), tick) for tick in (12, 13, 99)], [2, 2, 2])

    def test_the_rows_filled_stop_short_of_the_quads_foot_and_at_the_screens_edges(self):
        self.assertEqual([fallingitem_trace.rows(corners) for corners in (
            ((83, -14), (119, 13)), ((0, 230), (10, 250)), ((368, 0), (400, 10)), ((-9, 0), (0, 10)),
            ((-9, 0), (1, 10)), ((3, -9), (9, 0)))], [13, 10, 0, 0, 10, 0])

    def test_a_trace_is_each_item_under_the_models_through_the_maps_wait(self):
        tables = fallingitem_trace.Tables([
            self.item("MI", 100, 5), self.item("MI", 200, 100, switch=1, interval=2), self.item("MI", 300, 4),
            self.item("BW", 10, 50, scale=1)], self.ARTS)
        self.assertEqual(fallingitem_trace.trace(tables, "AE", 16), {
            "game": "AE", "placed": 4, "screens": {"MIP01C01": 2, "BWP01C01": 1},
            "gone": {"AE MI P1 (100,5)": [5, 6, 7, 8, 13, 14, 15, 16]}})
        self.assertEqual(fallingitem_trace.trace(tables, "AE", 16, True)["items"], [
            {"at": "AE MI P1 (100,5)", "screen": "MIP01C01", "waits": "100,5", "scale": 1.0, "rows": ["2 -", "2 2"]},
            {"at": "AE MI P1 (200,100)", "screen": "MIP01C01", "waits": "200,100", "scale": 1.0,
             "rows": ["27 27", "27 27"]},
            {"at": "AE MI P1 (300,4)", "screen": "MIP01C01", "waits": "300,4", "scale": 1.0, "rows": ["- -", "- -"]},
            {"at": "AE BW P1 (10,50)", "screen": "BWP01C01", "waits": "10,50", "scale": 0.5, "rows": ["22", "22"]}])

    def test_a_levels_items_stand_in_the_art_the_viewer_draws_them_in(self):
        shown, hidden = fallingitem_trace.Art(1, 0, [ROCK]), fallingitem_trace.Art(1, 0, [self.SHORT])
        for game, levels, rest in (("AE", ("BW",), ("MI", "PV")), ("AO", ("R1", "R2"), ("F2", "L1"))):
            rocks, other, _ = fallingitem_trace.ARTS[game]
            tables = fallingitem_trace.Tables([self.item(short, 100, 5) for short in levels + rest],
                                              {**dict.fromkeys(rocks, hidden), **dict.fromkeys(other, shown)})
            self.assertEqual(fallingitem_trace.trace(tables, game, 4)["screens"],
                             {f"{short}P01C01": 1 for short in levels}, game)

    def test_an_item_on_the_always_on_switch_is_watched_in_its_second_art_until_its_interval_is_out(self):
        arts = dict(self.ARTS, AE_FallingRock_Waiting=fallingitem_trace.Art(1, 0, [ROCK, ROCK, ROCK, self.SHORT]))
        tables = fallingitem_trace.Tables([self.item("MI", 100, 5, switch=1, interval=2)], arts)
        self.assertEqual(fallingitem_trace.trace(tables, "AE", 16)["gone"], {})
        tables = fallingitem_trace.Tables([self.item("MI", 100, 5, switch=1, interval=3)], arts)
        self.assertEqual(fallingitem_trace.trace(tables, "AE", 16)["gone"], {"AE MI P1 (100,5)": [4]})
        self.assertEqual(fallingitem_trace.trace(tables, "AE", 3)["gone"], {})

    def test_the_shipped_tables_are_a_games_items_each_under_the_camera_that_files_it_and_their_art(self):
        record = fallingitem.Record
        for game, count, item, art, shape in (
                ("AO", 21, ("F2", 4, 2, record(2386, 128, 2410, 152, 118, 0, 0, 0, 1), "F2P02C09", 2304, 120),
                 "AO_FallingRock_Falling", (4, 0, 8, Frame(42, 38, -20, -37, (-9, -32, 11, -9)))),
                ("AE", 93, ("PV", 3, 5, record(1237, 276, 1250, 300, 1, 1, 30, 0, 1), "PVP05C03", 1125, 260),
                 "FallingCrate_Waiting", (1, 0, 4, Frame(40, 47, -24, -46, (-13, -35, 8, -9)))),
                ("AE", 93, ("BW", 8, 4, record(611, 1039, 635, 1063, 1, 0, 60, 0, 0), "BWP04C06", 375, 1040),
                 "AE_FallingRock_Falling", (4, 0, 4, Frame(31, 28, -16, -31, (-16, -31, 14, -5))))):
            shipped = fallingitem_trace.committed(game)
            self.assertEqual((len(shipped.items), sorted(shipped.arts)),
                             (count, sorted(sum(fallingitem_trace.ARTS[game][:2], ()))))
            self.assertIn(fallingitem_trace.Item(*item), shipped.items)
            held = shipped.arts[art]
            self.assertEqual((held.hold, held.loop, len(held.frames), held.frames[2]), shape, art)

    def test_the_trace_prints_the_run_its_arguments_name(self):
        out = io.StringIO()
        with contextlib.redirect_stdout(out):
            fallingitem_trace.main(["AO", "--ticks", "12", "--items"])
        self.assertEqual(json.loads(out.getvalue()),
                         fallingitem_trace.trace(fallingitem_trace.committed("AO"), "AO", 12, True))
        with self.assertRaises(SystemExit), contextlib.redirect_stderr(io.StringIO()):
            fallingitem_trace.main(["AO", "--ticks", "0"])


class PortLiterals(unittest.TestCase):
    """the numbers the viewer's tests hold its falling items to are the
    models', over the tables the viewer ships and over the tests' own"""

    @staticmethod
    def source(name):
        text = " ".join((ROOT / "tests" / "unit" / name).read_text().split())
        return text.replace("[ ", "[").replace(", ]", "]").replace("{ ", "{").replace(", }", "}").replace(" }", "}")

    def stands(self, source, literal):
        self.assertEqual(source.count(literal), 1, f"{literal} in the test's source")

    def test_the_screens_and_ticks_the_sweep_holds_are_the_models_over_the_shipped_tables(self):
        source = self.source("sprites.test.js")
        got = {game: fallingitem_trace.trace(fallingitem_trace.committed(game), game, detail=True)
               for game in ("AO", "AE")}
        self.stands(source, f"const WAIT_WINDOW = {fallingitem_trace.TICKS};")
        self.stands(source, f"assert.deepEqual(placed, {{AO: {got['AO']['placed']}, AE: {got['AE']['placed']}}});")
        for game, run in got.items():
            held = re.findall(rf"assert\.deepEqual\(drawnOn\.{game}, \{{(.*?)\}}\);", source)
            self.assertEqual([dict((name, int(n)) for name, n in re.findall(r"(\w+): (\d+)", text)) for text in held],
                             [run["screens"]], game)
        gone = [[where, ticks] for run in got.values() for where, ticks in run["gone"].items()]
        self.stands(source, f"assert.deepEqual(blinks, {json.dumps(gone)});")
        self.stands(source, f'const renderOffset = g === "AO" ? {DOWN["AO"]} : {DOWN["AE"]};')
        pinned = re.findall(r'recordAt\("(A[OE])", "(\w+)", (\d+), "FallingItem", (-?\d+), (-?\d+)\)\.y, (-?\d+)\)',
                            source)
        waits = {item["at"]: item["waits"] for run in got.values() for item in run["items"]}
        self.assertEqual(len(pinned), 2)
        for game, short, path, x, y, held in pinned:
            self.assertEqual(waits[f"{game} {short} P{path} ({x},{y})"], f"{x},{held}")

    def test_the_edges_and_frames_the_gates_test_holds_are_the_models_over_the_tests_own_item(self):
        source = self.source("fallingitem.test.js")
        rect, window, at = (-10, -30, 10, -5), (0, -5, 368, 235), dict(x=100, y=0)
        frame, stage = Frame(1, 1, 0, 0, rect), Stage(*window[:2])
        self.stands(source, f"Item_Falling: bounded(4, 4, true, {list(rect)}),")
        self.stands(source, f"x: {at['x']}, y: {at['y']}, lines:")
        self.stands(source, f"win: {list(window)}, cam:")

        def edge(axis, step, scale):
            """the last place along an axis at which the model draws the item, and the next"""
            place = dict(at)
            while render.render(frame, Sprite(place["x"] * FP, place["y"] * FP, int(scale * FP)), stage):
                place[axis] += step
            return place[axis] - step, place[axis]

        for axis, step, scale in (("y", -1, 1), ("y", 1, 1), ("x", -1, 1), ("x", 1, 1), ("y", -1, 0.5)):
            on, off = edge(axis, step, scale)
            tail = "" if scale == 1 else f", {scale}"
            self.stands(source, f"[drawn({{{axis}: {on}}}{tail}), drawn({{{axis}: {off}}}{tail})], [true, false]")
        short = frame._replace(rect=rect[:3] + (rect[3] - 1,))
        art = fallingitem_trace.Art(4, 0, [frame, frame, short, frame])
        self.stands(source, f"(i === 2 ? [...f.slice(0, 10), {short.rect[3]}] : f)")
        run = [fallingitem_trace.frame_at(art, tick) for tick in range(1, 17)]
        self.stands(source, json.dumps([n if render.render(art.frames[n], Sprite(at["x"] * FP, at["y"] * FP), stage)
                                        else None for n in run]))
        self.stands(source, f'"AO"), y: y + {DOWN["AO"]}}});')
        self.stands(source, f"assert.equal(resolveRecord(lower(0), itemSet(), 1).y, {DOWN['AO']});")


if __name__ == "__main__":
    unittest.main()
