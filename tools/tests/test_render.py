"""The render's model over frames worked by hand, and its routines found in a
synthetic executable: stdlib only, no disc."""

import struct
import sys
import unittest
from pathlib import Path
from unittest import mock

sys.path[:0] = [str(Path(__file__).resolve().parents[1]), str(Path(__file__).resolve().parent)]

from synthetic import JR_RA, NOP, Assembly, addiu, chunk, jal, lui, named, word_at  # noqa: E402
from oddmap import render  # noqa: E402
from oddmap.exe import Image  # noqa: E402
from oddmap.fixed import FP  # noqa: E402
from oddmap.render import ABOVE, BELOW, LEFT, NOWHERE, ON, RIGHT, Frame, Sprite, Stage  # noqa: E402

# a rock of 37 by 28 whose art ends five above its point, and a frame whose rect sits to one side of it
ROCK = Frame(37, 28, -18, -31, (-18, -31, 18, -5))
LEANS = Frame(40, 47, -24, -46, (-12, -31, 10, -5))
HALF, THIRD = FP // 2, 0x4CCC
A0, A1 = 4, 5


def at(x, y, **look):
    return Sprite(int(x * FP), int(y * FP), **look)


class Rect(unittest.TestCase):
    def test_a_frames_rect_stands_at_the_objects_point(self):
        self.assertEqual(render.bounding(ROCK, at(100, 50)), (82, 19, 118, 45))

    def test_a_scaled_rect_is_cut_toward_zero_side_by_side(self):
        self.assertEqual(render.bounding(ROCK, at(100, 50, scale=HALF)), (91, 35, 109, 48))
        self.assertEqual(render.bounding(LEANS, at(100, 50, scale=THIRD)), (97, 41, 102, 49))

    def test_a_flipped_rect_is_mirrored_about_the_point_and_an_upended_one_over_it(self):
        self.assertEqual(render.bounding(LEANS, at(100, 50, flip=True)), (90, 19, 112, 45))
        self.assertEqual(render.bounding(LEANS, at(100, 50, upend=True)), (88, 55, 110, 81))

    def test_the_point_is_cut_toward_zero(self):
        self.assertEqual(render.bounding(LEANS, at(-10.5, -0.5)), (-22, -31, 0, -5))
        self.assertEqual(render.bounding(LEANS, at(10.5, 0.5)), (-2, -31, 20, -5))


class Side(unittest.TestCase):
    STAGE = Stage(1000, 500)

    def test_an_edge_on_an_edge_of_the_window_is_on_it(self):
        for rect, where in [
            ((1368, 600, 1400, 620), ON), ((1369, 600, 1400, 620), RIGHT),
            ((1100, 740, 1110, 760), ON), ((1100, 741, 1110, 760), BELOW),
            ((900, 600, 1000, 620), ON), ((900, 600, 999, 620), LEFT),
            ((1100, 400, 1110, 500), ON), ((1100, 400, 1110, 499), ABOVE),
        ]:
            self.assertEqual(render.side(rect, self.STAGE), where, rect)

    def test_right_is_asked_before_below_before_left_before_above(self):
        self.assertEqual(render.side((1369, 741, 1400, 760), self.STAGE), RIGHT)
        self.assertEqual(render.side((900, 741, 999, 760), self.STAGE), BELOW)
        self.assertEqual(render.side((900, 400, 999, 499), self.STAGE), LEFT)

    def test_a_rect_is_nowhere_while_the_event_that_ends_a_life_is_out(self):
        self.assertEqual(render.side((1100, 600, 1110, 620), Stage(1000, 500, dying=True)), NOWHERE)


class Quad(unittest.TestCase):
    STAGE = Stage(1000, 500)

    def test_a_frame_is_drawn_from_its_offset_a_unit_short_each_way(self):
        self.assertEqual(render.quad(ROCK, at(1100, 516), self.STAGE), ((83, -14), (119, 13)))

    def test_a_scaled_frame_is_its_size_scaled_and_stands_a_unit_higher(self):
        self.assertEqual(render.quad(ROCK, at(1100, 516, scale=HALF), self.STAGE), ((92, 0), (109, 13)))
        self.assertEqual(render.quad(LEANS, at(1100, 516, scale=THIRD), self.STAGE), ((94, 2), (105, 15)))
        self.assertEqual(render.quad(ROCK, at(1100, 516, scale=0x18000), self.STAGE), ((74, -31), (128, 10)))

    def test_a_flipped_frame_is_measured_back_by_its_offset_and_size_together(self):
        self.assertEqual(render.quad(ROCK, at(1100, 516, flip=True), self.STAGE), ((81, -14), (117, 13)))
        self.assertEqual(render.quad(ROCK, at(1100, 516, upend=True), self.STAGE), ((83, 18), (119, 45)))
        self.assertEqual(render.quad(ROCK, at(1100, 516, flip=True, upend=True), self.STAGE), ((81, 18), (117, 45)))

    def test_a_game_whose_drawing_upends_nothing_draws_an_upended_frame_upright(self):
        self.assertEqual(render.quad(ROCK, at(1100, 516, upend=True), Stage(1000, 500, upends=False)),
                         ((83, -14), (119, 13)))

    def test_the_renders_offsets_move_the_point_and_the_point_is_cut_toward_zero_on_the_screen(self):
        self.assertEqual(render.quad(ROCK, at(1100, 516, across=3, down=5), self.STAGE), ((86, -9), (122, 18)))
        self.assertEqual(render.quad(ROCK, at(989.5, 499.5), self.STAGE), ((-27, -30), (9, -3)))
        self.assertEqual(render.quad(ROCK, at(1010.5, 500.5), self.STAGE), ((-7, -30), (29, -3)))


class Render(unittest.TestCase):
    STAGE = Stage(1000, 500, level=3, path=5)

    def drawn(self, y=516, stage=None, **look):
        look = dict(dict(level=3, path=5), **look)
        return render.render(ROCK, at(1100, y, **look), stage or self.STAGE)

    def test_an_object_whose_rect_reaches_the_window_is_drawn(self):
        self.assertEqual(self.drawn(), ((83, -14), (119, 13)))
        self.assertEqual(self.drawn(505), ((83, -25), (119, 2)))

    def test_one_whose_rect_ends_a_unit_above_is_not_though_its_frame_reaches_lower(self):
        self.assertIsNone(self.drawn(504))
        crate = render.render(LEANS, at(1100, 504, level=3, path=5), self.STAGE)
        self.assertEqual((crate, render.quad(LEANS, at(1100, 504), self.STAGE)), (None, ((77, -41), (116, 5))))

    def test_one_not_shown_or_made_in_another_path_or_level_is_not(self):
        self.assertIsNone(self.drawn(shown=False))
        self.assertIsNone(self.drawn(path=6))
        self.assertIsNone(self.drawn(level=4))
        self.assertIsNone(self.drawn(stage=Stage(1000, 500, 3, 5, dying=True)))


class Frames(unittest.TestCase):
    def test_a_tables_frames_are_read_with_their_size_offset_and_rect(self):
        data, whole, last = chunk(ROCK, LEANS)
        self.assertEqual(render.frames(data, whole), [ROCK, LEANS])
        self.assertEqual(render.frames(data, last), [LEANS])

    def test_a_sheets_frames_are_measured_by_the_cut_each_names_where_another_names_its_header(self):
        data, infos = bytearray(24), []
        for at, frame in enumerate((ROCK, LEANS)):
            infos.append(len(data))
            data += struct.pack("<4B2h6h", 40 * at, 0, frame.w, frame.h, 3, 0, frame.x, frame.y, *frame.rect)
        table = len(data)
        data += struct.pack("<HhhH2I", 4, 2, 0, 3, *infos)
        struct.pack_into("<hhII", data, 0, 40, 47, table, 64)
        self.assertEqual(render.frames(bytes(data), table), [ROCK, LEANS])


def archive(rid, data):
    """a file of a level's archive holding one chunk of animations"""
    return struct.pack("<IHHII", 16 + len(data), 0, 0, int.from_bytes(b"Anim", "little"), rid) + data


class Level:
    def __init__(self, **files):
        self.files = files

    def read(self, name):
        return self.files[name]


class Art(unittest.TestCase):
    def test_an_objects_art_is_the_chunk_of_its_id_that_holds_its_table(self):
        data, whole, last = chunk(ROCK, LEANS)
        self.assertEqual((render.tables(data), render.tables(data[:last])), ([whole, last], []))
        levels = {"MI": Level(**{"ROCK.BAN": archive(2007, data), "ABE.BND": archive(10, data)}),
                  "NE": Level(**{"NEROCK.BAN": archive(2007, data), "CUT.BAN": archive(2007, data[:last])})}
        self.assertEqual(render.art(levels, 2007, last), data)
        for rid, table, refusal in ((2007, last + 4, "0 candidates for the animation 2007 with a table at 0x58"),
                                    (2008, last, "0 candidates for the animation 2008")):
            with self.assertRaisesRegex(RuntimeError, refusal):
                render.art(levels, rid, table)
        levels["PV"] = Level(**{"PVROCK.BAN": archive(2007, chunk(LEANS, ROCK)[0])})
        with self.assertRaisesRegex(RuntimeError, "2 candidates for the animation 2007"):
            render.art(levels, 2007, last)

    def test_with_no_table_given_an_objects_art_is_the_one_chunk_of_its_id(self):
        data = chunk(ROCK, LEANS)[0]
        levels = {"MI": Level(**{"ROCK.BAN": archive(2007, data), "ABE.BND": archive(10, chunk(LEANS)[0])}),
                  "NE": Level(**{"NEROCK.BAN": archive(2007, data)})}
        self.assertEqual(render.art(levels, 2007), data)
        levels["PV"] = Level(**{"PVROCK.BAN": archive(2007, chunk(LEANS, ROCK)[0])})
        with self.assertRaisesRegex(RuntimeError, "2 candidates for the animation 2007, expected one"):
            render.art(levels, 2007)


class ByHand(unittest.TestCase):
    OWN = Sprite(0, 0, HALF, 3, 5, 0, 5)

    def test_an_object_is_stood_either_side_of_each_edge_and_off_each_corner_at_each_scale_mirrored_each_way(self):
        stood = list(render.by_hand(ROCK, self.OWN, True))
        looks = {}
        for sprite, stage in stood[:288]:
            self.assertEqual((sprite.level, sprite.path, sprite.across, sprite.down, sprite.shown, vars(stage)),
                             (3, 5, 0, 5, True, vars(Stage(0, 0, 3, 5))))
            looks.setdefault((sprite.scale, sprite.flip, sprite.upend), []).append(
                render.side(render.bounding(ROCK, sprite), stage))
        self.assertEqual((len(stood), sorted({scale for scale, _, _ in looks}), len(looks)),
                         (365, [THIRD, HALF, 0x18000], 12))
        for look, sides in looks.items():
            self.assertEqual(sides[::2], [ON, ABOVE, ON, BELOW, ON, LEFT, ON, RIGHT, RIGHT, LEFT, BELOW, RIGHT], look)
            # half a unit on, a point left of the path's origin is cut toward it, its rect back onto the window
            self.assertEqual(sides[9:13:2], [ON, ON], look)

    def test_an_object_is_stood_half_a_unit_over_the_left_and_the_top_of_a_window_away_from_the_origin(self):
        stood = list(render.by_hand(ROCK, self.OWN, True))[288:312]
        self.assertEqual({(stage.left, stage.top, render.side(render.bounding(ROCK, sprite), stage))
                          for sprite, stage in stood}, {(375, 260, ON)})
        self.assertEqual([render.render(ROCK, *stood[at]) for at in (0, 1)],
                         [((-16, 89), (1, 102)), ((92, -9), (109, 4))])

    def test_the_scales_on_a_carry_put_a_measure_a_65536th_either_side_of_it_and_tell_the_rounding_by_it(self):
        scales = list(render.edged(ROCK))
        self.assertEqual([measure * scale % FP for measure, scale in zip((37,) * 3 + (-31,) * 3 + (19,) * 3 + (-3,) * 3,
                                                                         scales)], [0x8041, 0x8042, 0x8043] * 4)
        self.assertTrue(all(FP <= scale < 2 * FP for scale in scales))
        stood = list(render.by_hand(ROCK, self.OWN, True))[312:360]
        self.assertEqual([sprite.scale for sprite, _ in stood[::4]], scales)
        drawn = [render.quad(ROCK, *pair) for pair in stood]
        for off in (-1, 1):
            with mock.patch.object(render, "ROUND", render.ROUND + off):
                self.assertNotEqual([render.quad(ROCK, *pair) for pair in stood], drawn, off)

    def test_an_object_is_stood_in_the_window_with_its_renders_offsets_moved(self):
        sprite, stage = list(render.by_hand(ROCK, self.OWN, True))[360]
        self.assertEqual((sprite.across, sprite.down, render.render(ROCK, sprite, stage)), (3, -2, ((95, 82), (112, 95))))

    def test_the_last_four_stand_on_the_window_and_are_drawn_no_way(self):
        stood = list(render.by_hand(ROCK, self.OWN, True))[-4:]
        self.assertEqual([(render.side(render.bounding(ROCK, sprite), stage), render.render(ROCK, sprite, stage))
                          for sprite, stage in stood], [(ON, None)] * 3 + [(NOWHERE, None)])
        self.assertEqual([(sprite.shown, sprite.level, sprite.path, stage.dying) for sprite, stage in stood],
                         [(False, 3, 5, False), (True, 4, 5, False), (True, 3, 6, False), (True, 3, 5, True)])


LOAD, MAP, SCREEN = 0x80010000, 0x80085DF4, 0x8007BFF4


def renderer(tests=1, again=True, twice=False, built=True, pointers=1):
    """(a synthetic executable's image, what render.code is to find in it,
    the render's address): the routines an object's render calls, in the
    shapes the executables compile them to"""
    head = bytearray(0x800)
    struct.pack_into("<I", head, 0x18, LOAD)
    code = Assembly(LOAD)
    emit = code.emit
    event, product, added = (emit(JR_RA, NOP) for _ in range(3))
    where = emit(*(jal(event), NOP) * tests, JR_RA, NOP)
    colour = emit(jal(product), NOP, jal(product), NOP, JR_RA, NOP)
    rect, mark = (emit(JR_RA, NOP) for _ in range(2))
    draw = emit(jal(product), NOP, jal(added), NOP, JR_RA, NOP)
    spot = emit(jal(product), NOP, jal(product), NOP, JR_RA, NOP)
    shadow = emit(*((jal(draw), NOP) if again else ()), *((jal(colour), NOP) if twice else ()),
                  jal(rect), NOP, jal(mark), NOP, JR_RA, NOP)
    start = emit(*(named(A0, MAP) if built else (lui(A0, 0x8008), NOP)), addiu(A1, 29, 24), jal(where), NOP,
                 jal(colour), NOP, jal(draw), NOP, jal(rect), NOP, jal(mark), NOP,
                 *(w for k in range(pointers) for w in word_at(A0, SCREEN + 16 * k)), jal(spot), NOP,
                 jal(shadow), NOP, JR_RA, NOP)
    return Image(bytes(head + code.data)), render.Code(render=start, where=where, event=event, draw=draw, add=added,
                                                       after={colour, rect, mark, spot, shadow}, map=MAP,
                                                       screen=SCREEN), start


class Routines(unittest.TestCase):
    def test_the_renders_routines_are_found_by_what_they_call_and_are_handed(self):
        image, want, start = renderer()
        self.assertEqual(render.code(image, start), want)

    def test_an_executable_of_another_shape_is_refused_by_the_part_that_is_off(self):
        for shape, refusal in [
            (dict(tests=2), "0 candidates for the test of where a rect lies"),
            (dict(tests=0), "0 candidates for the test of where a rect lies"),
            (dict(again=False), "0 candidates for the drawing of a frame"),
            (dict(twice=True), "2 candidates for the drawing of a frame"),
            (dict(built=False), "the render hands the test of a rect no address it builds"),
            (dict(pointers=0), "0 candidates for the pointer to the camera"),
            (dict(pointers=2), "2 candidates for the pointer to the camera"),
        ]:
            with self.subTest(shape=shape):
                image, _, start = renderer(**shape)
                with self.assertRaisesRegex(RuntimeError, refusal):
                    render.code(image, start)


if __name__ == "__main__":
    unittest.main()
