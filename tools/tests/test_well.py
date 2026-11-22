"""The wells' and the leaves' model over records and dice worked by hand, its
routines found in a synthetic overlay, what the two tools add to the model,
and the numbers the viewer's test holds its leaves to: stdlib only, no disc."""

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

import well_trace  # noqa: E402
import well_verify  # noqa: E402
from synthetic import (JR_RA, NOP, Assembly, addiu, addu, jal, lb, lbu, lui, named, ori,  # noqa: E402
                       word_at)
from oddmap import collide, fixed, render, well  # noqa: E402
from oddmap.exe import Image  # noqa: E402
from oddmap.fallingitem import DOWN  # noqa: E402
from oddmap.fixed import FP  # noqa: E402
from oddmap.games import game_setup  # noqa: E402
from oddmap.paths import ROOT  # noqa: E402
from oddmap.render import Stage  # noqa: E402

LEFT, TOP = 1000, 500
RECORD = well.Record(x1=1100, y1=600, x2=1125, y2=624, express=True, scale=0, switch=0, exit_x=-268, exit_y=-1500,
                     emit=1, leaf_x=0, leaf_y=0)
QUIET = [127] * 256                 # dice that neither let a leaf go nor jitter one


def dice(**at):
    """the quiet dice with some bytes set, by their place"""
    return [at.get(f"b{k}", 127) for k in range(256)]


def world(game="AE", rolls=QUIET, lines=(), **shared):
    return well.World(game, rolls, list(lines), Stage(LEFT, TOP, 3, 7), **{"wells": 0, "leaves": 0, **shared})


def built(game="AE", shared=None, **fields):
    """(a well made over the record with some of it replaced, its world)"""
    held, around = RECORD._replace(**fields), world(game, **(shared or {}))
    return well.Well(around, held, *well.handed(game, held)), around


def leaf(game="AE", x=1100, y=600, vx=0, vy=0, scale=FP, **shared):
    """(a leaf let go at a point with a speed, its world)"""
    around = world(game, **shared)
    return well.Leaf(around, x * FP, y * FP, vx, vy, scale), around


class Constructor(unittest.TestCase):
    def test_a_well_keeps_its_scale_its_switch_and_what_it_is_told_and_starts_its_leaves_over_its_middle(self):
        made, around = built()
        self.assertEqual({name: value for name, value in vars(made).items() if name != "world"}, dict(
            dead=False, delay=0, scale=FP, switch=0, emit=1, exit_x=-175636, exit_y=-15 * FP, leaf_x=1112 * FP,
            leaf_y=605 * FP))
        self.assertEqual(around.objects, [made])

    def test_exoddus_hands_a_well_its_corner_five_lower_and_oddysee_the_corner(self):
        self.assertEqual((well.handed("AE", RECORD), well.handed("AO", RECORD)),
                         ((1100 * FP, 605 * FP), (1100 * FP, 600 * FP)))
        self.assertEqual(built("AO")[0].leaf_y, 600 * FP)

    def test_a_scale_that_is_not_none_is_half(self):
        self.assertEqual([built(scale=scale)[0].scale for scale in (0, 1, 2, -1)], [FP, FP // 2, FP // 2, FP // 2])

    def test_the_middle_is_the_mean_of_the_rects_two_sides_cut_toward_zero(self):
        for x1, x2, middle in ((1100, 1125, 1112), (1100, 1124, 1112), (-30, -5, -17), (-31, -5, -18), (-3, 8, 2)):
            self.assertEqual(built(x1=x1, x2=x2)[0].leaf_x, middle * FP, (x1, x2))

    def test_a_leaf_field_that_is_not_none_places_the_leaf_in_exoddus_from_abes_start(self):
        shared = dict(abe=(2100, 40))
        made = built(shared=shared, leaf_x=-960, leaf_y=540)[0]
        self.assertEqual((made.leaf_x, made.leaf_y), (1140 * FP, 580 * FP))
        made = built(shared=shared, leaf_x=-960)[0]
        self.assertEqual((made.leaf_x, made.leaf_y), (1140 * FP, 605 * FP))
        made = built(shared=shared, leaf_y=-3)[0]
        self.assertEqual((made.leaf_x, made.leaf_y), (1112 * FP, 37 * FP))
        made = built("AO", shared, leaf_x=1140, leaf_y=580)[0]
        self.assertEqual((made.leaf_x, made.leaf_y), (1140 * FP, 580 * FP))

    def test_a_leafs_point_past_sixteen_bits_from_abes_start_comes_round(self):
        made = built(shared=dict(abe=(30000, 30000)), leaf_x=30000, leaf_y=30000)[0]
        self.assertEqual((made.leaf_x, made.leaf_y), (60000 * FP - (1 << 32),) * 2)

    def test_wells_join_the_list_in_the_order_they_are_made(self):
        around = world()
        first, second = (well.Well(around, RECORD, *well.handed("AE", RECORD)) for _ in range(2))
        self.assertEqual(around.objects, [first, second])

    def test_a_well_told_nothing_places_no_leaf_and_one_told_anything_keeps_sixteen_bits_of_it(self):
        made = built(emit=0, leaf_x=30, leaf_y=40)[0]
        self.assertEqual((made.emit, made.leaf_x, made.leaf_y), (0, 0, 0))
        self.assertEqual([built(emit=emit)[0].emit for emit in (2, -1)], [2, 0xFFFF])

    def test_an_exit_is_its_hundredths_by_the_engines_quotient_and_none_where_the_record_holds_none(self):
        made = built("AO", express=False, exit_x=777, exit_y=-2501)[0]
        self.assertEqual((made.exit_x, made.exit_y), (509214, -1639055))
        made = built(express=False, exit_x=0, exit_y=0)[0]
        self.assertEqual((made.exit_x, made.exit_y), (0, 0))

    def test_the_builders_record_is_read_by_either_games_names(self):
        held = dict(x1=1100, y1=600, x2=1125, y2=624)
        fields = dict(scale=1, switch_id=5, emit_leaves=1)
        self.assertEqual(well.record(dict(held, name="LocalWell", fields=dict(fields, leaf_xpos=3, leaf_ypos=4))),
                         well.Record(1100, 600, 1125, 624, False, 1, 5, 0, 0, 1, 3, 4))
        self.assertEqual(well.record(dict(held, name="WellExpress",
                                          fields=dict(fields, exit_x=-268, exit_y=-1500, leaf_x=0, leaf_y=9))),
                         well.Record(1100, 600, 1125, 624, True, 1, 5, -268, -1500, 1, 0, 9))


class Roll(unittest.TestCase):
    def test_a_well_takes_a_byte_a_tick_and_one_under_ten_lets_a_leaf_go(self):
        made, around = built(shared=dict(rolls=dice(b0=10, b1=9, b2=0)))
        for wells, leaves in ((1, 0), (2, 1), (3, 2)):
            made.update()
            self.assertEqual((around.wells, len(around.objects) - 1), (wells, leaves))

    def test_a_well_told_nothing_or_on_a_switch_read_off_takes_no_byte(self):
        for fields, on, taken in ((dict(emit=0), (), 0), (dict(switch=2), (), 0), (dict(switch=2), (2,), 1),
                                  (dict(switch=1), (), 1), (dict(switch=0), (), 1), (dict(emit=-1), (), 1)):
            made, around = built(shared=dict(on=on), **fields)
            made.update()
            self.assertEqual(around.wells, taken, fields)

    def test_the_first_switch_reads_on_always_another_as_it_was_written_and_one_off_the_table_is_refused(self):
        around = world(on=(2, 255))
        self.assertEqual([around.switched(switch) for switch in (0, 1, 2, 3, 255)], [False, True, True, False, True])
        for switch in (256, -1):
            with self.assertRaisesRegex(ValueError, f"switch {switch} is off the table's 256"):
                around.switched(switch)

    def test_each_cursor_comes_round_after_256_bytes(self):
        around = world(rolls=list(range(256)), wells=127, leaves=127)
        self.assertEqual((around.roll(), around.wells, around.byte(), around.leaves), (127, 128, 127, 128))
        well.Leaf(around, 0, 0, 0, 0, FP)
        self.assertEqual(around.leaves, 129)
        around.wells = around.leaves = 255
        self.assertEqual((around.roll(), around.wells, around.byte(), around.leaves), (255, 0, 255, 0))
        around.leaves = 255
        well.Leaf(around, 0, 0, 0, 0, FP)
        self.assertEqual(around.leaves, 0)

    def test_exoddus_lets_a_leaf_go_at_two_across_and_twenty_up_and_oddysee_at_the_wells_exit(self):
        made, around = built(shared=dict(rolls=dice(b0=0)))
        made.update()
        let = around.objects[1]
        self.assertEqual((let.x, let.y, let.vx, let.vy, let.layer), (1112 * FP, 605 * FP, 2 * FP, -20 * FP, 27))
        made, around = built(shared=dict(rolls=dice(b0=0)), scale=1)
        made.update()
        let = around.objects[1]
        self.assertEqual((let.vx, let.vy, let.layer), (FP, -10 * FP, 8))
        made, around = built("AO", dict(rolls=dice(b0=0)))
        made.update()
        let = around.objects[1]
        self.assertEqual((let.x, let.y, let.vx, let.vy, let.layer), (1112 * FP, 600 * FP, -175636, -15 * FP, 27))

    def test_an_oddysee_leaf_is_let_go_behind_a_well_whose_exit_leads_down(self):
        for fields, layer in ((dict(exit_y=1500), 22), (dict(exit_y=1500, scale=1), 3), (dict(exit_y=0), 27),
                              (dict(exit_y=1), 22), (dict(scale=1), 8)):
            made, around = built("AO", dict(rolls=dice(b0=0)), **fields)
            made.update()
            self.assertEqual(around.objects[1].layer, layer, fields)
        made, around = built(shared=dict(rolls=dice(b0=0)), exit_y=1500)
        made.update()
        self.assertEqual(around.objects[1].layer, 27)


class Let(unittest.TestCase):
    def test_a_leaf_is_left_tinted_on_its_scales_layer_with_its_speed_shortened_and_a_byte_of_its_cursor_spent(self):
        let, around = leaf(vx=2 * FP, vy=-20 * FP)
        self.assertEqual({name: value for name, value in vars(let).items() if name != "world"}, dict(
            dead=False, delay=1, red=100, green=100, blue=100, scale=FP, landed=False, layer=27, plane=1,
            x=1100 * FP, y=600 * FP, vx=2 * FP, vy=-20 * FP, level=3, path=7, across=0, down=0))
        self.assertEqual((around.leaves, around.objects), (1, [let]))
        let = leaf(vx=-175636, vy=-15 * FP, scale=FP // 2)[0]
        self.assertEqual((let.layer, let.plane, let.vx, let.vy), (8, 0, -87818, -491520))

    def test_an_oddysee_leaf_waits_no_tick_and_is_drawn_five_under_its_point(self):
        let = leaf("AO")[0]
        self.assertEqual((let.delay, let.down), (0, 5))
        self.assertEqual(vars(let.sprite()), vars(render.Sprite(1100 * FP, 600 * FP, FP, 3, 7, 0, 5)))


class Flight(unittest.TestCase):
    def test_a_tick_adds_half_a_unit_of_fall_and_keeps_four_fifths_of_each_speed_cut_down(self):
        let = leaf(vx=2 * FP, vy=-20 * FP)[0]
        let.update()
        self.assertEqual((let.vx, let.vy, let.x, let.y), (104856, -1022346, 1100 * FP + 104856, 600 * FP - 1022346))
        let.update()
        self.assertEqual((let.vx, let.vy), (83883, -791651))
        let = leaf(vx=-87818, vy=-491520)[0]
        let.update()
        self.assertEqual((let.vx, let.vy), (-70254, -366996))

    def test_a_tick_jitters_each_speed_by_a_byte_less_127_over_64_at_the_leafs_scale_across_then_down(self):
        let, around = leaf(rolls=dice(b1=127 + 64, b2=127 - 32, b3=126))
        let.update()
        self.assertEqual((let.vx, let.vy, around.leaves), (FP, 26214 - FP // 2, 3))
        let, around = leaf(scale=FP // 2, rolls=dice(b1=127 + 64, b2=127 - 32))
        let.update()
        self.assertEqual((let.vx, let.vy), (FP // 2, 26214 - FP // 4))
        let, around = leaf(rolls=dice(b1=126, b2=128))
        let.update()
        self.assertEqual((let.vx, let.vy), (-1024, 26214 + 1024))

    def test_a_leaf_comes_to_rest_once_on_the_first_floor_of_its_plane_and_falls_through_it_from_there(self):
        lines = [(1000, 610, 1368, 610, 4), (1000, 620, 1368, 620, 0), (1000, 605, 1368, 605, 1)]
        let = leaf(lines=lines)[0]
        fallen = [26214, 73398, 137358, 214739]
        for moved in fallen:
            let.update()
            self.assertEqual((let.y, let.landed), (600 * FP + moved, False))
        for _ in range(9):
            let.update()
        self.assertEqual((let.y, let.landed, let.dead), (600 * FP + 1208385, False, False))
        let.update()
        self.assertEqual((let.x, let.y, let.vx, let.vy, let.landed), (1100 * FP, 620 * FP - 256, 0, 0, True))
        for moved in fallen:
            let.update()
            self.assertEqual((let.y, let.landed, let.dead), (620 * FP - 256 + moved, True, False))

    def test_a_leaf_flying_across_comes_to_rest_where_its_ray_from_its_own_point_crosses_with_no_speed_left(self):
        let = leaf(x=1100, y=619, vx=3 * FP, vy=4 * FP, lines=[(1000, 620, 1368, 620, 0)])[0]
        let.x += FP // 2
        let.update()
        self.assertEqual((let.x, let.y, let.vx, let.vy, let.landed), (1100 * FP + 76288, 620 * FP - 256, 0, 0, True))

    def test_a_leaf_within_a_unit_past_the_paths_origin_is_still_on_a_window_stood_there(self):
        for at, speed, lives in (((0, 100), (-40960, 0), True), ((-1, 100), (0, 0), False),
                                 ((100, 0), (0, -73728), True), ((100, -1), (0, -32768), False)):
            around = well.World("AE", QUIET, [], Stage(0, 0, 3, 7))
            let = well.Leaf(around, at[0] * FP, at[1] * FP, *speed, FP)
            let.update()
            self.assertEqual((let.dead, let.x < 0 or let.y < 0), (not lives, True), at)

    def test_a_leaf_of_the_plane_behind_rests_on_its_own_floor_and_dies_on_one_of_the_plane_in_front(self):
        lines = [(1000, 610, 1368, 610, 4), (1000, 620, 1368, 620, 0)]
        let = leaf(scale=FP // 2, lines=lines)[0]
        for _ in range(9):
            let.update()
        self.assertEqual((let.y, let.landed, let.dead), (610 * FP - 512, True, False))
        for _ in range(8):
            let.update()
        self.assertEqual((let.y, let.dead), (610 * FP - 512 + 612213, False))
        let.update()
        self.assertEqual((let.y, let.dead), (610 * FP - 512 + 612213, True))
        let = leaf(scale=FP // 2, lines=lines[1:])[0]
        for _ in range(13):
            let.update()
        self.assertEqual(let.dead, False)
        let.update()
        self.assertEqual((let.y, let.landed, let.dead), (600 * FP + 1208385, False, True))

    def test_a_leaf_dies_off_the_cameras_window_an_edge_still_on_it(self):
        def lives(x, y, vx=0):
            let = leaf(x=x, y=y, vx=vx)[0]
            let.update()
            return not let.dead

        self.assertEqual([lives(LEFT, 600), lives(LEFT - 1, 600)], [True, False])
        self.assertEqual([lives(LEFT + 368, 600), lives(LEFT + 369, 600)], [True, False])
        self.assertEqual([lives(1100, TOP), lives(1100, TOP - 1)], [True, False])
        self.assertEqual([lives(1100, TOP + 240), lives(1100, TOP + 241)], [True, False])
        self.assertEqual(lives(LEFT - 1, 600, vx=2 * FP), True)
        let, around = leaf()
        around.stage.dying = True
        let.update()
        self.assertEqual(let.dead, True)


class Loop(unittest.TestCase):
    def test_a_pass_updates_each_object_in_the_lists_order_a_leaf_made_in_it_among_them(self):
        made, around = built("AO", dict(rolls=dice(b0=0)))
        around.tick()
        let = around.objects[1]
        self.assertEqual((len(around.objects), let.x, let.vx), (2, 1112 * FP - 140507, -140507))
        made, around = built(shared=dict(rolls=dice(b0=0)))
        around.tick()
        let = around.objects[1]
        self.assertEqual((let.delay, let.x, let.vx), (0, 1112 * FP, 2 * FP))
        around.tick()
        self.assertEqual(let.x, 1112 * FP + 104856)

    def test_the_dead_are_taken_out_after_the_pass_the_lists_last_into_the_place_of_each(self):
        around = world("AO")
        a, b, c, d = (well.Leaf(around, (1100 + 10 * k) * FP, 600 * FP, 0, 0, FP) for k in range(4))
        b.x = (LEFT - 20) * FP
        around.tick()
        self.assertEqual(around.objects, [a, d, c])
        a.x = d.x = (LEFT - 20) * FP
        around.tick()
        self.assertEqual(around.objects, [c])
        c.x = (LEFT - 20) * FP
        around.tick()
        self.assertEqual(around.objects, [])
        a, b, c = (well.Leaf(around, (1100 + 10 * k) * FP, 600 * FP, 0, 0, FP) for k in range(3))
        a.x = c.x = (LEFT - 20) * FP
        around.tick()
        self.assertEqual(around.objects, [b])

    def test_a_dead_object_is_passed_over_and_one_with_a_delay_spends_a_tick_of_it(self):
        around = world("AO")
        waits, gone = (well.Leaf(around, 1100 * FP, 600 * FP, 0, 0, FP) for _ in range(2))
        waits.delay, gone.dead = 2, True
        around.tick()
        self.assertEqual((waits.delay, waits.y, gone.y, around.objects), (1, 600 * FP, 600 * FP, [waits]))


class Cameras(unittest.TestCase):
    def test_a_fresh_game_has_a_well_let_leaves_go_where_it_is_told_to_on_no_switch_or_the_first(self):
        self.assertEqual([well.lets(RECORD._replace(**fields)) for fields in (
            {}, dict(switch=1), dict(emit=2), dict(emit=-1), dict(emit=0), dict(switch=2), dict(switch=255))],
            [True, True, True, True, False, False, False])

    def test_a_camera_is_every_well_its_list_holds_seeded_by_the_place_of_the_first_that_lets_leaves_go(self):
        quiet, shut = RECORD._replace(emit=0), RECORD._replace(switch=9)
        wells = [(3, 0, quiet, "a"), (5, 0, RECORD, "b"), (300, 1, shut, "c"), (301, 1, quiet, "d"),
                 (302, 3, quiet, "e"), (303, 1, RECORD, "f"), (304, 0, RECORD, "g")]
        self.assertEqual(well.screens("AE", [("MI", 4, 2, ["lines"], wells)]), [
            well.Screen("MI", 4, 0, 0, 0, 5, [wells[0], wells[1], wells[6]], ["lines"]),
            well.Screen("MI", 4, 1, 375, 0, 303 & 255, [wells[2], wells[3], wells[5]], ["lines"])])
        self.assertEqual([(screen.left, screen.top) for screen in well.screens("AO", [("F1", 1, 2, [], wells)])],
                         [(256, 120), (1280, 120)])


BASE, LOAD = 0x800A0000, 0x80010000
MAP, SCREEN, LINES, SWITCHES = 0x80085DF4, 0x8007BFF4, 0x8007EDD4, 0x8007EE34
LEAF_TABLE, WELL_TABLE, WELLS, LEAVES, SIZE = BASE + 0x600, BASE + 0x680, BASE + 0x700, BASE + 0x704, 0x740
AT, V0, V1, A0, A1, A2, T0 = 1, 2, 3, 4, 5, 6, 8


def byte_at(rt, addr):
    """the pair of instructions that loads the byte at an address"""
    return lui(rt, (addr + 0x8000) >> 16), lbu(rt, addr, rt)


def indexed(addr):
    """the instructions that load a signed byte of a table by an index"""
    return lui(AT, (addr + 0x8000) >> 16), addu(AT, AT, V1), lb(V0, addr, AT)


def executable():
    """(a synthetic executable's image, the routines in it): a render in the
    shape oddmap/render.py finds, and what the wells' routines reach for"""
    head = bytearray(0x800)
    struct.pack_into("<I", head, 0x18, LOAD)
    code = Assembly(LOAD)
    emit = code.emit
    names = "event paint added allot base resource setup product roll sound quotient raycast within start idle"
    at = {name: emit(JR_RA, NOP) for name in names.split()}
    at["where"] = emit(jal(at["event"]), NOP, JR_RA, NOP)
    at["draw"] = emit(jal(at["paint"]), NOP, jal(at["added"]), NOP, JR_RA, NOP)
    at["shadow"] = emit(jal(at["draw"]), NOP, jal(at["paint"]), NOP, JR_RA, NOP)
    at["shown"] = emit(*named(A0, MAP), jal(at["where"]), NOP, jal(at["draw"]), NOP, *word_at(A0, SCREEN),
                       jal(at["shadow"]), NOP, JR_RA, NOP)
    at["reset"] = emit(jal(at["allot"]), NOP, JR_RA, NOP)
    at["switched"] = emit(lui(V0, 0x8009), addu(AT, AT, V1), lb(V0, 0x100, AT), lui(AT, 0x8009), NOP, lb(V0, 0x200, AT),
                          *indexed(SWITCHES), JR_RA, NOP)
    return Image(bytes(head + code.data)), at


def overlay(exe, exoddus=True, flies=1, slots=1, shown=0, lets=1, freed=False, updates=1, tabled=1, makes=1,
            made="base resource setup product product roll roll sound",
            flown="product product quotient product quotient product raycast within", fifth="product", opens=True,
            ends=True, allots=True, asks=1, tables=1, inits=2, beyond=1, lines=1, wells=1, leaves=1):
    """(a synthetic overlay, what well.code is to find in it and the
    executable): the wells' routines and the leaves' in the shapes the
    overlays compile them to, Exoddus's or Oddysee's, beside routines that
    share a part of each shape, and the two tables naming the virtual ones"""
    code = Assembly(BASE)
    emit = code.emit
    stub = emit(JR_RA, NOP)
    emit(ori(A2, 0, 0xCCCC), ori(V1, V1, 0x10000 - 127), jal(exe["product"]), NOP, JR_RA, NOP)
    emit(addiu(A1, A1, -127), ori(V1, 0, 0xCCCC), addiu(A1, 0, -127), JR_RA, NOP)
    order = [exe[fifth if name == "product" else name] for name in flown.split()]
    fly = [emit(ori(A2, 0, 0xCCCC), *(w for target in order[:2] for w in (jal(target), NOP)),
                *(w for k in range(leaves) for w in byte_at(V1, LEAVES + 8 * k)), addiu(A1, 0, -127),
                *(w for target in order[2:] for w in (jal(target), NOP)),
                *(w for k in range(lines) for w in word_at(A0, LINES + 16 * k)), JR_RA, NOP) for _ in range(flies)]
    calls = [stub if name == "stub" else exe[name] for name in made.split()]
    leaf = emit(*named(T0, LEAF_TABLE), *(w for target in calls for w in (jal(target), NOP)), JR_RA, NOP)
    fell = emit(*named(T0, LEAF_TABLE), jal(exe["base"]), NOP, JR_RA, NOP)
    between = [[exe["reset"], exe["reset"]], [exe["reset"], exe["switched"]], [exe["switched"], exe["idle"]]][asks] \
        if exoddus else [exe["event"], exe["reset"]]
    last = [exe["allot"] if allots else stub] + [leaf] * lets
    asked = [exe["event" if opens else "idle"]] + between + last if ends else \
        [exe["event"], leaf, between[1], exe["allot"], exe["idle"]]
    update = [emit(*(w for target in asked[:-len(last)] for w in (jal(target), NOP)),
                   *(w for k in range(wells) for w in byte_at(V0, WELLS + 8 * k)),
                   lui(V0, 0x8009), addu(AT, AT, V1), lb(V0, 0x100, AT), lui(AT, 0x8009), NOP, lb(V0, 0x200, AT),
                   *(w for k in range(0 if exoddus else tables) for w in indexed(SWITCHES + 0x200 * k)),
                   *(w for target in asked[-len(last):] for w in (jal(target), NOP)), JR_RA, NOP)
              for _ in range(updates)]
    if freed:
        emit(jal(fell), NOP, JR_RA, NOP)
    asked = [exe["start"], exe["idle"]][:beyond] if exoddus else []
    first = emit(*(w for target in asked for w in (jal(target), NOP)), JR_RA, NOP)
    second = emit(jal(exe["quotient"]), NOP, *(() if exoddus else (jal(exe["resource"]), NOP, jal(exe["setup"]), NOP)),
                  JR_RA, NOP)
    third = emit(JR_RA, NOP)
    construct = [emit(*named(T0, WELL_TABLE), jal(exe["base"]), NOP,
                      *(w for init in (first, second, third)[:inits] for w in (jal(init), NOP)), JR_RA, NOP)
                 for _ in range(makes)]
    emit(*named(T0, WELL_TABLE), jal(exe["reset"]), NOP, JR_RA, NOP)
    blob = bytearray(code.data.ljust(SIZE, b"\0"))
    for k in range(slots):
        struct.pack_into("<3I", blob, LEAF_TABLE - BASE + 0x40 * k + 20, fly[0] if fly else leaf, 0,
                         BASE + 4 if shown is None else exe["shown"] + shown)
    for k in range(tabled):
        struct.pack_into("<I", blob, WELL_TABLE - BASE + 0x40 * k + 20, update[0])
    drawn = render.Code(render=exe["shown"], where=exe["where"], event=exe["event"], draw=exe["draw"],
                        add=exe["added"], after={exe["shadow"]}, map=MAP, screen=SCREEN)
    return bytes(blob), well.Code(
        construct=construct[0] if construct else None, update=update[0], well_table=WELL_TABLE,
        inits=[first, second], leaf=leaf, fly=fly[0] if fly else None, leaf_table=LEAF_TABLE, render=drawn,
        event=exe["event"], allot=exe["allot"], switches=SWITCHES, resource=exe["resource"], setup=exe["setup"],
        product=exe["product"], roll=exe["roll"], sound=exe["sound"], quotient=exe["quotient"],
        raycast=exe["raycast"], within=exe["within"], lines=LINES, start=exe["start"] if exoddus else None,
        wells=WELLS, leaves=LEAVES)


class Routines(unittest.TestCase):
    def found(self, **shape):
        """(what well.code finds in an overlay of a shape, what the overlay was built to hold)"""
        image, exe = executable()
        blob, want = overlay(exe, **shape)
        return well.code(blob, BASE, image), want

    def test_the_routines_are_found_by_what_they_hand_build_call_and_load(self):
        self.assertEqual(*self.found())

    def test_oddysees_update_reads_its_switch_itself_and_its_inits_ask_for_no_start(self):
        self.assertEqual(*self.found(exoddus=False))

    def test_an_overlay_of_another_shape_is_refused_by_the_part_that_is_off(self):
        for shape, refusal in [
            (dict(flies=0), "0 candidates for the leaf's update, a routine handing a call four fifths"),
            (dict(flies=2), "2 candidates for the leaf's update, a routine handing a call four fifths"),
            (dict(slots=0), "0 candidates for the leaf's update's slot"),
            (dict(slots=2), "2 candidates for the leaf's update's slot"),
            (dict(shown=4), "no function of the executable's in the slot after the leaf's update's"),
            (dict(shown=None), "no function of the executable's in the slot after the leaf's update's"),
            (dict(lets=0), "0 candidates for the leaf's constructor"),
            (dict(freed=True), "2 candidates for the leaf's constructor"),
            (dict(updates=2), "2 candidates for the well's update, the leaf's constructor's caller"),
            (dict(tabled=0), "0 candidates for the well's update's slot"),
            (dict(tabled=2), "2 candidates for the well's update's slot"),
            (dict(inits=0), "0 candidates for the well's constructor"),
            (dict(makes=2), "2 candidates for the well's constructor"),
            (dict(made="base resource setup product product roll roll"), "the leaf's constructor makes 7 calls, not"),
            (dict(made="base resource setup product roll product roll sound"), "the leaf's constructor makes 8 calls"),
            (dict(made="base resource setup product product roll roll stub"), "a sound's, all the executable's"),
            (dict(flown="product product product quotient product raycast within"),
             "the leaf's update makes 7 calls, not the product's twice"),
            (dict(flown="product quotient product product quotient product raycast within"),
             "the leaf's update makes 8 calls, not the product's twice"),
            (dict(fifth="roll"), "the leaf's update makes 8 calls, not the product's twice"),
            (dict(opens=False), "the well's update makes 5 calls, not five that open on the event query"),
            (dict(ends=False), "the well's update makes 5 calls, not five that open on the event query and end"),
            (dict(allots=False), "the well's update makes 5 calls, not five that open on the event query and end"),
            (dict(lets=2), "the well's update makes 6 calls, not five"),
            (dict(asks=2), "2 candidates for the query of a switch"),
            (dict(asks=0), "0 candidates for the switch states"),
            (dict(exoddus=False, tables=0), "0 candidates for the switch states"),
            (dict(exoddus=False, tables=2), "2 candidates for the switch states"),
            (dict(inits=1), "the well's constructor calls 1 routines of its overlay that call 1 besides"),
            (dict(inits=3), "the well's constructor calls 3 routines of its overlay that call 1 besides"),
            (dict(beyond=2), "the well's constructor calls 2 routines of its overlay that call 2 besides"),
            (dict(lines=0), "0 candidates for the pointer to the path's lines"),
            (dict(lines=2), "2 candidates for the pointer to the path's lines"),
            (dict(wells=0), "0 candidates for the wells' cursor"),
            (dict(wells=2), "2 candidates for the wells' cursor"),
            (dict(leaves=0), "0 candidates for the leaves' cursor"),
            (dict(leaves=2), "2 candidates for the leaves' cursor"),
        ]:
            with self.subTest(shape=shape):
                with self.assertRaisesRegex(RuntimeError, refusal):
                    self.found(**shape)

    def test_the_overlays_holding_a_leafs_update_are_the_ones_run(self):
        image, exe = executable()
        flies, none = overlay(exe)[0], overlay(exe, flies=0)[0]
        loaded = {"disc": ({"A.OVL": none, "B.OVL": flies, "C.OVL": flies}, BASE)}
        with mock.patch.object(well.records, "overlays", lambda disc, game: loaded[disc]):
            self.assertEqual(well.overlays("disc", "AE"), ({"B.OVL": flies, "C.OVL": flies}, BASE))


def bytes_of(game, kind, rect, *fields):
    """a record's bytes as a game's path chunk holds one"""
    fmt = game_setup(game)["tlv"]
    out = bytearray(fmt["header_len"] + 2 * len(fields))
    struct.pack_into("<I", out, 4, kind)
    struct.pack_into("<4h", out, fmt["rect_off"], *rect)
    struct.pack_into(f"<{len(fields)}h", out, fmt["header_len"], *fields)
    return bytes(out)


class Verifier(unittest.TestCase):
    RECT = (1100, 600, 1125, 624)

    def test_a_records_bytes_are_set_where_the_builders_schema_places_each_field(self):
        local = bytes_of("AE", 8, self.RECT, 0, 0, 3, 0, 0, 0, 0, 0, 1, 0, 0)
        held, words = well_verify.edited("AE", RECORD._replace(express=False), local, switch=2, leaf_x=-960,
                                         leaf_y=540, emit=-1, scale=1)
        self.assertEqual((held.switch, held.leaf_x, held.leaf_y, held.emit, held.scale), (2, -960, 540, -1, 1))
        self.assertEqual(words, bytes_of("AE", 8, self.RECT, 1, 2, 3, 0, 0, 0, 0, 0, -1, -960, 540))
        express = bytes_of("AO", 45, self.RECT, 0, 0, 0, 0, -268, -1500, 0, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0)
        held, words = well_verify.edited("AO", RECORD, express, exit_x=777, exit_y=-2501, leaf_x=5, emit=2)
        self.assertEqual((held.exit_x, held.exit_y, held.leaf_x, held.emit), (777, -2501, 5, 2))
        self.assertEqual(words,
                         bytes_of("AO", 45, self.RECT, 0, 0, 0, 0, 777, -2501, 0, 0, 0, 0, 0, 0, 0, 0, 2, 5, 0, 0))

    def test_a_rects_sides_are_set_in_the_records_header_with_oddysees_copy_of_the_corner(self):
        local = bytes_of("AE", 8, self.RECT, 0, 0, 3, 0, 0, 0, 0, 0, 1, 0, 0)
        held, words = well_verify.edited("AE", RECORD._replace(express=False), local, x1=-31, x2=-10)
        self.assertEqual((held.x1, held.y1, held.x2, held.y2), (-31, 600, -10, 624))
        self.assertEqual(words, bytes_of("AE", 8, (-31, 600, -10, 624), 0, 0, 3, 0, 0, 0, 0, 0, 1, 0, 0))
        express = bytes_of("AO", 45, self.RECT, 0, 0, 0, 0, -268, -1500, 0, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0)
        held, words = well_verify.edited("AO", RECORD, express, x1=-31, y1=7)
        self.assertEqual(struct.unpack_from("<6h", words, 12), (-31, 7, -31, 7, 1125, 624))
        self.assertEqual(words[:12] + words[24:], express[:12] + express[24:])

    def test_a_well_of_each_type_is_made_up_alone_in_its_camera_to_what_no_placed_one_holds(self):
        local = (4, 2, RECORD._replace(express=False, exit_x=0, exit_y=0),
                 bytes_of("AE", 8, self.RECT, 0, 0, 3, 0, 0, 0, 0, 0, 1, 0, 0))
        express = (9, 2, RECORD, bytes_of("AE", 23, self.RECT, 0, 0, 0, 0, -268, -1500, 0, 0, 0, 0, 0, 0, 0, 0, 1, 0,
                                          0, 0))
        shut = (1, 2, RECORD._replace(switch=7), express[3])
        screens = [well.Screen("MI", 1, 2, 750, 0, 1, [shut, local, express], ["lines"])]
        jobs = well_verify.made_up("AE", screens)
        self.assertEqual([job.name for job in jobs], [
            f"a {kind} {what}" for kind, more in (("LocalWell", ()), ("WellExpress", (
                "with its exit leading down", "with its exit leading down at its other scale", "with its exit still",
                "with its exit at odd speeds", "with its exit barely moving")))
            for what in ("with its leaf's x set", "with its leaf's y set", "with its leaf's point set",
                         "told to let leaves go by 2", "told to by -1", "told not to",
                         "on the switch that always reads on", "on a switch read off", "on a switch written on",
                         "on the last switch, written on", "at its other scale", "at a scale that is neither",
                         "with its rect left of the path's origin, its sides an odd sum",
                         "with its leaves let go on the left edge of a window at the path's origin",
                         "with its leaves let go under the top edge of a window at the path's origin",
                         "with its leaf's point past sixteen bits from Abe's start") + more])
        far, edges = [jobs[15], jobs[31]], jobs[13:15] + jobs[29:31]
        self.assertEqual({(job.screen.seed, len(job.screen.wells), job.abe) for job in jobs if job not in far},
                         {(19, 1, (2100, 1600))})
        self.assertEqual({(job.abe, job.screen.wells[0][2].leaf_x, job.screen.wells[0][2].leaf_y) for job in far},
                         {((30000, 30000), 30000, 30000)})
        self.assertEqual({(job.ticks, job.reach, job.screen.left, job.screen.top, job.screen.floors == ["lines"])
                          for job in jobs if job not in edges}, {(192, "", 750, 0, True)})
        self.assertEqual({(job.ticks, job.reach, job.screen.left, job.screen.top, tuple(job.screen.floors))
                          for job in edges}, {(768, "past", 0, 0, ())})
        placed = jobs[2].screen.wells[0]
        self.assertEqual((placed[:2], placed[2].leaf_x, placed[2].leaf_y), ((4, 2), -960, -1020))
        self.assertEqual([job.on for job in jobs[6:10]], [(), (), (2,), (255,)])
        self.assertEqual([job.screen.wells[0][2].switch for job in jobs[6:10]], [1, 2, 2, 255])
        self.assertEqual((jobs[10].screen.wells[0][2].scale, jobs[11].screen.wells[0][2].scale), (1, 2))
        left, top = (job.screen.wells[0] for job in edges[2:])
        self.assertEqual([struct.unpack_from("<4h", words, 8) for _, _, _, words in (jobs[12].screen.wells[0], left,
                                                                                     top)],
                         [(-31, 600, -10, 624), (-14, 115, 12, 624), (100, 10, 125, 624)])
        self.assertEqual([(held.scale, held.leaf_x, held.leaf_y, held.exit_x, held.exit_y) for _, _, held, _ in
                          (left, top)], [(0, 0, 0, 200, -2000)] * 2)
        self.assertEqual([well.Well(world(), held, *well.handed("AE", held)).leaf_x // FP for _, _, held, _ in
                          (left, top)], [-1, 112])
        down = jobs[33].screen.wells[0][2]
        self.assertEqual((down.exit_x, down.exit_y, down.scale), (-268, 1500, 1))
        self.assertEqual(struct.unpack_from("<2h", jobs[-2].screen.wells[0][3], 0x10 + 8), (777, -2501))
        oddysee = well_verify.made_up("AO", [screens[0]._replace(wells=[
            (4, 2, RECORD._replace(express=False), bytes_of("AO", 11, self.RECT, 0, 0, 0, 0, -268, -1500, 0, 0, 0, 0,
                                                            1, 0, 0)),
            (9, 2, RECORD, bytes_of("AO", 45, self.RECT, 0, 0, 0, 0, -268, -1500, 0, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0,
                                    0))])])
        self.assertEqual((len(oddysee), {job.abe for job in oddysee}), (40, {(2100, 1600)}))
        placed = oddysee[2].screen.wells[0][2]
        self.assertEqual((placed.leaf_x, placed.leaf_y, oddysee[14].screen.wells[0][2].y1), (1140, 580, 15))

    def test_a_well_made_up_for_what_its_run_does_not_hold_is_refused(self):
        calm = type("Machine", (), dict(steps=0, r8=lambda self, at: 0))()
        console = type("Console", (), dict(
            m=calm, code=well.Code(*[None] * 23), objects=[], asked=[], begin=lambda *a: None, tick=lambda self: None,
            build=lambda *a: None))()
        screen = well.Screen("MI", 1, 2, 0, 0, 0, [], [])
        got = well_verify.run("AE", console, (0, 1, []), QUIET, well_verify.Job("a well", screen, (), (0, 0), 3, ""))
        self.assertEqual(got[:11], (0, 1, 0, 3, 0, 0, 0, 0, 0, 0, 0))
        with self.assertRaisesRegex(well_verify.Differs, "a well of MI P1 cell 2: made up for a leaf alive within a "
                                    "unit past the path's origin, and its run holds none"):
            well_verify.run("AE", console, (0, 1, []), QUIET, well_verify.Job("a well", screen, (), (0, 0), 3, "past"))

    def test_a_discs_quotient_and_raycast_are_asked_for_every_pair_and_ray_set_by_hand(self):
        class Console:
            m = type("Machine", (), dict(steps=7))()

            def __init__(self, off=0, lost=()):
                self.off, self.lost, self.asked = off, lost, []

            def fresh(self):
                self.asked.append("fresh")

            def quotient(self, a, b):
                self.asked.append("quotient")
                return fixed.fpdiv(a, b) + self.off * ((a, b) == (-7, 2))

            def ray(self, lines, *ray):
                return None if ray[-1] in self.lost else collide.raycast(lines, *ray)

        console = Console()
        self.assertEqual(well_verify.asked(console), well_verify.Asked(320, 29, 21, 0))
        self.assertEqual(console.asked, ["fresh"] + ["quotient"] * 320)
        with self.assertRaisesRegex(well_verify.Differs, r"the quotient of -7 by 2: the disc's -229375, the model's "
                                    "-229376"):
            well_verify.asked(Console(off=1))
        with self.assertRaisesRegex(well_verify.Differs, r"the ray \(3309568, 4603904, 3457024, 6914048\) asked for "
                                    r"the kinds 0x2 over .*16\)\]: the disc's None, the model's Hit\(line=2"):
            well_verify.asked(Console(lost=(0x02,)))

    def test_an_overlays_line_says_what_its_runs_covered_or_the_first_thing_that_differed(self):
        found = self.code()
        runs = [well_verify.Tally(1, 0, 2, 1024, 80, 6000, 70, 9, 0, 5990, 2_000_000, found),
                well_verify.Tally(0, 1, 1, 192, 5, 300, 4, 0, 14, 300, 100_000, found)]
        self.assertEqual(well_verify.report("SLUS_007.10", "MI.OVL", runs), (
            "SLUS_007.10 MI.OVL: the disc's code and the model agree over 1 cameras and 1 wells made up, 3 wells in "
            "all and 1,216 ticks, 85 leaves let go, 74 come to rest and 9 ended on a floor of the plane in front, 14 "
            "ticks flown within a unit past the path's origin, 6,290 of their 6,300 ticks drawn, in 2,100,000 "
            "instructions; well's update 0x800a2000, leaf's 0x800a3000", True))
        self.assertEqual(well_verify.report("SLUS_007.10", "MI.OVL", runs + ["the camera of MI P1 cell 2, tick 3"]),
                         ("SLUS_007.10 MI.OVL: the camera of MI P1 cell 2, tick 3", False))
        self.assertEqual(well_verify.report("SLUS_007.10", "MI.OVL", []),
                         ("SLUS_007.10 MI.OVL: no camera was dealt it", False))

    def test_a_discs_line_says_what_its_arithmetic_was_asked_or_what_differed(self):
        self.assertEqual(well_verify.answered("SLUS_007.10", well_verify.Asked(320, 18, 14, 56_568)), (
            "SLUS_007.10: the engine's quotient and raycast agree with the models over 320 pairs and 18 rays, 14 of "
            "them crossing a line, in 56,568 instructions", True))
        self.assertEqual(well_verify.answered("SLUS_007.10", "the quotient of 1 by 2"),
                         ("SLUS_007.10: the quotient of 1 by 2", False))

    @staticmethod
    def code():
        return well.Code(*[None] * 23)._replace(update=0x800A2000, fly=0x800A3000)


class Trace(unittest.TestCase):
    ODDYSEE = RECORD._replace(x1=1300, y1=700, x2=1325, y2=724)

    def tables(self, game, *wells, lines=(), abe=None, rolls=None):
        """the shipped tables of a path five cells across whose cell 12, or
        in Oddysee 6, lists some wells, each (its place among the path's
        objects, its record)"""
        cell = 12 if game == "AE" else 6
        held = [(place, cell, record, dict(x1=record.x1, y1=record.y1)) for place, record in wells]
        return well_trace.Tables(well.screens(game, [("MI", 7, 5, list(lines), held)]), rolls or dice(b0=0),
                                 abe or {})

    def test_a_well_knows_the_leaves_it_lets_go(self):
        around = world(rolls=dice(b0=0, b2=0))
        made = well_trace.Owning(around, RECORD, *well.handed("AE", RECORD))
        other = well.Well(around, RECORD, *well.handed("AE", RECORD))
        for _ in range(4):
            made.update()
            other.update()
        self.assertEqual(made.let, [around.objects[2], around.objects[3]])

    def test_a_camera_is_read_as_freshly_loaded_from_the_place_of_its_first_well_that_lets_leaves_go(self):
        tables = self.tables("AE", (3, RECORD._replace(switch=7)), (260, RECORD), (9, RECORD),
                             abe={"MI": {"7": [5, 6]}})
        around, wells = well_trace.camera(tables, "AE", tables.screens[0])
        self.assertEqual((around.wells, around.leaves, around.abe, around.stage.left, around.stage.top,
                          around.stage.path), (4, 4, (5, 6), 750, 520, 7))
        self.assertEqual([type(made) for made in wells], [well_trace.Owning] * 3)
        self.assertEqual(around.objects, wells)
        self.assertEqual(well_trace.camera(self.tables("AE", (3, RECORD)), "AE", tables.screens[0])[0].abe, (0, 0))

    def test_a_sweep_counts_the_wells_that_let_leaves_go_their_cameras_and_every_leaf(self):
        tables = self.tables("AE", (0, RECORD), (1, RECORD._replace(switch=7)), (2, RECORD._replace(x1=900, x2=925)),
                             rolls=dice(b0=0, b3=0))
        got = well_trace.sweep(tables, "AE", 4)
        flown = well_trace.trace(tables, "AE", "MI", 7, [0, 2], [1, 2, 3, 4])["leaves"].values()
        every = [point for tick in flown for leaves in tick.values() for point in leaves]
        self.assertEqual(got, {
            "game": "AE", "ticks": 4, "wells": 2, "cameras": 1, "screens": [0, 1, 0, 0], "made": 2,
            "flown": [len(every), sum(x for x, _ in every), sum(y for _, y in every)], "never": [], "down": [],
            "grounded": []})
        self.assertEqual(got["flown"][0], 7)
        more = self.tables("AE", (0, RECORD)).screens + self.tables("AE", (4, RECORD), (5, RECORD), (6, RECORD)).screens
        got = well_trace.sweep(tables._replace(screens=tables.screens + more), "AE", 4)
        self.assertEqual((got["wells"], got["cameras"], got["screens"]), (6, 3, [1, 1, 1, 0]))

    def test_a_sweep_names_the_wells_whose_leaves_never_fly_lead_down_or_never_rise(self):
        ceiling = self.ODDYSEE._replace(y1=590, y2=614)
        got = well_trace.sweep(self.tables("AO", (0, ceiling)), "AO", 4)
        self.assertEqual((got["made"], got["flown"], got["never"], got["down"], got["grounded"]),
                         (1, [0, 0, 0], ["AO MI P7 (1300,590)"], [], []))
        got = well_trace.sweep(self.tables("AO", (0, self.ODDYSEE._replace(exit_y=1500))), "AO", 4)
        self.assertEqual((got["never"], got["down"], got["grounded"]), ([], ["AO MI P7 (1300,700)"], []))
        self.assertEqual(well_trace.sweep(self.tables("AO", (0, self.ODDYSEE._replace(exit_y=0))), "AO", 4)["down"],
                         ["AO MI P7 (1300,700)"])
        self.assertEqual(well_trace.sweep(self.tables("AO", (0, self.ODDYSEE)), "AO", 4)["down"], [])
        on_floor = [(1000, 605, 1400, 605, 0)]
        got = well_trace.sweep(self.tables("AE", (0, RECORD), lines=on_floor), "AE", 8)
        self.assertEqual((got["never"], got["down"], got["grounded"]), ([], [], ["AE MI P7 (1100,600)"]))
        self.assertEqual(well_trace.sweep(self.tables("AE", (0, RECORD), lines=on_floor), "AE", 1)["grounded"], [])
        self.assertEqual(well_trace.sweep(self.tables("AE", (0, RECORD)), "AE", 8)["grounded"], [])
        barely = self.tables("AO", (0, self.ODDYSEE._replace(exit_y=-1)))
        self.assertEqual(well_trace.sweep(barely, "AO", 1)["grounded"], ["AO MI P7 (1300,700)"])

    def test_a_well_one_of_whose_leaves_is_lost_on_its_first_move_is_not_one_whose_leaves_never_fly(self):
        edge = self.ODDYSEE._replace(x1=1635, x2=1659, exit_x=100)
        got = well_trace.sweep(self.tables("AO", (0, edge), rolls=dice(b0=0, b1=0, b6=255)), "AO", 2)
        self.assertEqual((got["made"], got["flown"][0], got["never"]), (2, 2, []))

    def test_a_trace_is_some_wells_own_leaves_at_the_ticks_asked_for_and_their_sums(self):
        tables = self.tables("AE", (0, RECORD), (1, RECORD._replace(x1=1200, x2=1225)), rolls=dice(b0=0, b3=0))
        got = well_trace.trace(tables, "AE", "MI", 7, [0, 1], [1, 2, 3])
        self.assertEqual((got["game"], got["camera"], got["seed"]), ("AE", "MI P7 cell 12", 0))
        first, second = [1112 * FP, 605 * FP], [1212 * FP, 605 * FP]
        self.assertEqual(got["leaves"][1], {0: [first], 1: []})
        self.assertEqual(got["leaves"][2][1], [second])
        self.assertEqual(got["sums"][1], [1, first[0], first[1]])
        moved = got["leaves"][2][0][0]
        self.assertEqual(got["sums"][2], [2, moved[0] + second[0], moved[1] + second[1]])
        self.assertLess(moved[1], first[1])
        self.assertEqual(well_trace.trace(tables, "AE", "MI", 7, [1], [2])["leaves"], {2: {1: [second]}})

    def test_wells_that_stand_on_no_camera_together_or_let_no_leaves_go_are_refused(self):
        tables = self.tables("AE", (0, RECORD), (1, RECORD._replace(switch=7)))
        for places in ([1], [0, 1], [5]):
            with self.assertRaisesRegex(ValueError, "MI P7 holds no camera whose wells at"):
                well_trace.trace(tables, "AE", "MI", 7, places, [1])
        with self.assertRaisesRegex(ValueError, "BW P7 holds no camera"):
            well_trace.trace(tables, "AE", "BW", 7, [0], [1])

    def test_the_shipped_tables_are_a_games_cameras_whose_wells_let_leaves_go_its_dice_and_abes_starts(self):
        for game, cameras, wells, found, abe in (
                ("AO", 38, 49, ("L1", 1, 3), {}), ("AE", 126, 170, ("MI", 1, 50), ("MI", "1"))):
            shipped = well_trace.committed(game)
            self.assertEqual((len(shipped.screens), len(shipped.dice)), (cameras, 256))
            self.assertEqual(sum(well.lets(held) for screen in shipped.screens for _, _, held, _ in screen.wells),
                             wells)
            short, path, place = found
            screen = next(s for s in shipped.screens if (s.short, s.path) == (short, path) and s.seed == place)
            self.assertEqual(screen.wells[0][3]["name"] in well.NAMES[game], True)
            self.assertEqual(bool(shipped.abe), bool(abe))
            if abe:
                self.assertEqual(len(shipped.abe[abe[0]][abe[1]]), 2)

    def test_the_trace_prints_the_run_its_arguments_name(self):
        out = io.StringIO()
        with contextlib.redirect_stdout(out):
            well_trace.main(["AO", "L1", "1", "3", "--ticks", "17,18"])
        self.assertEqual(json.loads(out.getvalue()), json.loads(json.dumps(
            well_trace.trace(well_trace.committed("AO"), "AO", "L1", 1, [3], [17, 18]))))
        out = io.StringIO()
        with contextlib.redirect_stdout(out):
            well_trace.main(["AO", "--ticks", "8"])
        self.assertEqual(json.loads(out.getvalue()), well_trace.sweep(well_trace.committed("AO"), "AO", 8))
        for args in (["--ticks", "0"], ["--ticks", "8,9"], ["L1", "1", "--ticks", "4"],
                     ["L1", "1", "3", "4", "--ticks", "4"], ["L1", "x", "3", "--ticks", "4"], ["L1", "1", "3"],
                     ["L1", "1", "3", "--ticks", "a"], ["L1", "1", "3", "--ticks", "0"]):
            with self.subTest(args=args):
                with self.assertRaises(SystemExit) as refused, contextlib.redirect_stderr(io.StringIO()):
                    well_trace.main(["AO"] + args)
                self.assertEqual(refused.exception.code, 2)
        with self.assertRaises(SystemExit) as refused:
            well_trace.main(["AO", "L1", "1", "99", "--ticks", "4"])
        self.assertEqual(refused.exception.code, "L1 P1 holds no camera whose wells at [99] all let leaves go")


class PortLiterals(unittest.TestCase):
    """the numbers the viewer's tests hold its wells' leaves to are the
    model's, over the tables the viewer ships"""

    @classmethod
    def setUpClass(cls):
        text = " ".join((ROOT / "tests" / "unit" / "well.test.js").read_text().split())
        for old, new in (("[ ", "["), (", ]", "]"), ("{ ", "{"), (", }", "}"), (" }", "}"), ("( ", "("), (", )", ")")):
            text = text.replace(old, new)
        text = re.sub(r"(\d+) \* FP - (\d+)", lambda m: str(int(m[1]) * FP - int(m[2])), text)
        cls.source = re.sub(r"(\d+) \* FP\b", lambda m: str(int(m[1]) * FP), text)
        cls.tables = {game: well_trace.committed(game) for game in ("AO", "AE")}

    def stands(self, literal):
        self.assertEqual(self.source.count(literal), 1, f"{literal} in the test's source")

    def test_the_counts_the_sweeps_hold_are_the_models_over_every_camera(self):
        got = {game: well_trace.sweep(self.tables[game], game) for game in ("AO", "AE")}
        ao, ae = got["AO"], got["AE"]
        self.stands(f"const TURNS = {well_trace.TICKS};")
        self.stands(f"assert.deepEqual(wells, {{AO: {ao['wells']}, AE: {ae['wells']}}});")
        self.stands(f"assert.deepEqual([cameras.AO.size, cameras.AE.size], [{ao['cameras']}, {ae['cameras']}]);")
        self.assertEqual((ao["made"], ae["made"]), (ao["wells"] * 40, ae["wells"] * 40))
        self.stands(f"assert.deepEqual(made, {{AO: {ao['wells']} * 40, AE: {ae['wells']} * 40}},")
        self.stands(f"{json.dumps([list(pair) for pair in zip(ao['screens'], ae['screens'])])}, "
                    '"the screens of one well, two, three and four"')
        self.stands(f"assert.deepEqual(never, {json.dumps(ao['never'] + ae['never'])},")
        self.stands(f"assert.deepEqual(down, {json.dumps(ao['down'] + ae['down'])});")
        self.stands(f"assert.deepEqual(grounded, {json.dumps(ao['grounded'] + ae['grounded'])},")
        self.stands(f"assert.deepEqual(flew, {{AO: {json.dumps(ao['flown'])}, AE: {json.dumps(ae['flown'])}}});")

    def well(self, name):
        """the game, level, path and place of the well the test calls by a name or makes in place"""
        made = re.search(rf'const {name} = wellAt\("(A[OE])", "(\w+)", (\d+), (\d+)\);', self.source) \
            or re.fullmatch(r'wellAt\("(A[OE])", "(\w+)", (\d+), (\d+)\)', name)
        game, short, path, place = made.groups()
        return game, short, int(path), int(place)

    def test_the_flights_held_move_by_move_are_the_models(self):
        runs = re.findall(r'first\((\w+|wellAt\([^)]*\)), "A[OE]", (\[[\d, ]+\])\), (\[\[.*?\]\]),', self.source)
        self.assertEqual((len(runs), self.source.count("first(")), (5, 5))
        for name, ticks, held in runs:
            game, short, path, place = self.well(name)
            got = well_trace.trace(self.tables[game], game, short, path, [place], json.loads(ticks))
            self.assertEqual([leaves[place][0] for leaves in got["leaves"].values()], json.loads(held),
                             (name, ticks))
        quiet = re.findall(r"flying\((\w+), sheets\.A[OE], (\d+)\), \[\]\);", self.source)
        self.assertEqual(len(quiet), 2)
        for name, tick in quiet:
            game, short, path, place = self.well(name)
            got = well_trace.trace(self.tables[game], game, short, path, [place], [int(tick), int(tick) + 1])
            self.assertEqual([len(leaves[place]) for leaves in got["leaves"].values()], [0, 1], name)
        game, short, path, place = self.well("ao")
        (x, y), = well_trace.trace(self.tables[game], game, short, path, [place], [17])["leaves"][17][place]
        self.stands(f"assert.deepEqual(drawn(ao, sheets.AO, 17), [[{x}, {y} + {DOWN['AO'] * FP}]]);")

    def test_the_sums_held_of_a_camera_of_several_are_the_models(self):
        ticks = [300, 600, 1024]
        self.stands(f"{json.dumps(ticks)}.map((tick) =>")
        runs = re.findall(r'sums\("(A[OE])", "(\w+)", (\d+), (\[[\d, ]+\])\), (\[\[.*?\]\]),', self.source)
        self.assertEqual(len(runs), 2)
        for game, short, path, places, held in runs:
            got = well_trace.trace(self.tables[game], game, short, int(path), json.loads(places), ticks)
            self.assertEqual(list(got["sums"].values()), json.loads(held), (game, short, path))


if __name__ == "__main__":
    unittest.main()
