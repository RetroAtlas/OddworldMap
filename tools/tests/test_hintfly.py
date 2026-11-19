"""The hint fly's model over tables of its own, its routines found in a
synthetic overlay, what the two tools add to the model, and the numbers the
viewer's test holds its port to: stdlib only, no disc."""

import contextlib
import io
import json
import math
import re
import struct
import sys
import unittest
from pathlib import Path
from unittest import mock

sys.path[:0] = [str(Path(__file__).resolve().parents[1])]

import hintfly_trace  # noqa: E402
import hintfly_verify  # noqa: E402
from oddmap import hintfly, messages  # noqa: E402
from oddmap.exe import Image  # noqa: E402
from oddmap.hintfly import FP, HOLD, IDLE, LOOPING, ON_DOT, PAUSE, QUARTER, RESIZE, TO_DOT, UNWIND  # noqa: E402
from oddmap.paths import ROOT  # noqa: E402

# letters of two dots, of one and of twelve
A, B, C = bytes([0x00, 0x44]), bytes([0x12]), bytes(range(12))
MESSAGES = ["AB A", "", "B  AB", "A,B", "CC", "CCB CC CA", "CCB B"]
DOT = 0xCCCC


def tables(dice=0x55):
    return hintfly.Tables([dice] * 256 if isinstance(dice, int) else dice, [A, B, C], MESSAGES)


def hint(message, dice=0x55, own=0, start=0):
    return hintfly.HintFly(hintfly.World(tables(dice), own, start), 100, 100, message)


def line(model, ticks, heard):
    """the model's state and count of flies by the ticks each lasts, under a
    chant heard on the ticks given"""
    out = []
    for frame in range(1, ticks + 1):
        model.world.frame, model.world.chant, model.world.sounds = frame, frame in heard, []
        model.update()
        key = f"{model.state}:{model.count}"
        if out and out[-1][0] == key:
            out[-1][1] += 1
        else:
            out.append([key, 1])
    return " ".join(f"{key}x{n}" for key, n in out)


def looped(ticks):
    """the angle of a fly set up under the dice of 0x55 and looping since"""
    return (0x55 + ticks * 243) & 255


class Swarm(unittest.TestCase):
    def test_twenty_flies_start_looping_about_the_point(self):
        model = hint(0)
        self.assertEqual((model.state, model.count, len(model.flies), model.world.own), (IDLE, 20, 20, 100))
        for fly in model.flies:
            self.assertEqual((fly.x, fly.y, fly.mode, fly.angle, fly.speed), (105 * FP, 105 * FP, LOOPING, 0x55, 243))
        self.assertEqual((hint(1).allocated, len(hint(1).flies)), (12, 20))

    def test_a_fly_takes_five_of_the_flies_own_bytes(self):
        model = hint(0, dice=list(range(256)))
        first, second = model.flies[:2]
        self.assertEqual((first.x, first.y, first.angle, first.speed), (84 * FP, 85 * FP, 2, 15))
        self.assertEqual((second.x, second.y, second.angle, second.speed), (89 * FP, 90 * FP, 7, 244))

    def test_the_longest_word_sizes_the_swarm_and_a_word_of_no_dots_ends_the_count(self):
        self.assertEqual([hint(i).allocated for i in (0, 1, 2, 4, 5)], [15, 12, 13, 36, 37])

    def test_a_code_either_side_of_the_alphabet_is_refused(self):
        with self.assertRaisesRegex(ValueError, "0x2c is outside the alphabet's 3 letters"):
            hint(3)
        past = hintfly.Tables([0x55] * 256, [A, B, C], ["A", "AD", "B"])
        with self.assertRaisesRegex(ValueError, "0x44 is outside the alphabet's 3 letters"):
            hintfly.HintFly(hintfly.World(past, 0, 0), 100, 100, 1)
        self.assertEqual(hintfly_verify.spelled(past), [0, 2])

    def test_a_sprite_is_cut_toward_zero(self):
        model = hint(0)
        for fly, x in zip(model.flies, (-0x8000, -0x10000, -0x10001, 0x1FFFF, -0x18000)):
            fly.x, fly.y = x, -x
        self.assertEqual(model.sprites()[:5], [(0, 0), (-1, 1), (-1, 1), (1, -1), (-1, 1)])
        self.assertEqual(len(model.sprites()), 20)

    def test_the_cursors_are_bytes(self):
        world = hintfly.World(tables(list(range(256))), 256 + 7, -1)
        self.assertEqual((world.own, world.dice, world.byte(), world.roll(0, 255)), (7, 255, 7, 255))
        self.assertEqual((world.own, world.dice), (8, 0))


class Chant(unittest.TestCase):
    def test_a_chant_spells_a_word_at_a_time(self):
        model = hint(0)
        self.assertEqual(line(model, 120, range(3, 121)),
                         "1:20x2 3:20x16 2:20x1 4:15x31 3:15x16 2:15x1 4:14x31 3:14x16 2:14x1 4:12x5")
        self.assertEqual((model.words, model.pos), ([(20, "AB"), (68, "A"), (116, "")], 4))

    def test_a_chant_held_past_its_message_forms_nothing_round_after_round_with_no_sizing_to_do(self):
        model = hint(0)
        self.assertEqual(line(model, 170, range(3, 171)).split(" ")[-5:],
                         ["2:14x1", "4:12x31", "3:12x16", "2:12x1", "4:12x7"])
        self.assertEqual((model.words[2:], model.world.dice), ([(116, ""), (164, "")], 170 + 5))

    def test_a_chant_that_breaks_as_the_swarm_reaches_its_size_forms_no_word(self):
        model = hint(0)
        self.assertEqual(line(model, 21, range(3, 20)), "1:20x2 3:20x16 2:20x1 5:15x2")
        self.assertEqual(model.words, [])

    def test_the_swarm_grows_eight_flies_a_tick_each_set_up_as_it_joins(self):
        model = hint(4)
        self.assertEqual(line(model, 19, range(1, 20)), "3:20x16 2:20x1 2:28x1 4:36x1")
        self.assertEqual((model.world.own, len(model.flies)), (100 + 16 * 5, 36))
        self.assertEqual([fly.angle for fly in model.flies[18:30]], [looped(19)] * 2 + [looped(2)] * 8 + [looped(1)] * 2)
        self.assertEqual([(fly.tx, fly.ty) for fly in (model.flies[9], model.flies[12])],
                         [(84 * FP, 92 * FP + 9 * DOT), (100 * FP, 92 * FP)])

    def test_a_swarm_that_shrinks_sets_its_first_flies_up_again_while_they_are_fewer_than_it(self):
        model = hint(5)
        line(model, 68, range(1, 69))
        self.assertEqual((model.words[-1], model.count, model.renewed), ((68, "CC"), 36, 1))
        self.assertEqual([fly.angle for fly in model.flies[:2]], [looped(1), (looped(20) + 17 * 243) & 255])
        model = hint(5)
        line(model, 117, range(1, 118))
        self.assertEqual((model.words[-1], model.count, model.renewed), ((117, "CA"), 26, 10))
        model = hint(6)
        line(model, 70, range(1, 71))
        self.assertEqual((model.words[-1], model.count, model.renewed), ((70, "B"), 13, 18))

    def test_a_word_stands_on_its_dots_centred_on_the_point(self):
        model = hint(0)
        line(model, 20, range(3, 21))
        self.assertEqual([(fly.tx, fly.ty) for fly in model.flies[:3]],
                         [(84 * FP, 92 * FP), (84 * FP + 4 * DOT, 92 * FP + 4 * DOT), (100 * FP + DOT, 92 * FP + 2 * DOT)])
        self.assertEqual([fly.mode for fly in model.flies[:15]], [TO_DOT] * 3 + [LOOPING] * 12)

    def test_a_fly_is_sent_a_sixteenth_of_the_way_a_tick_cut_downward(self):
        model = hint(0)
        model.count, model.flies[5].mode = 15, ON_DOT
        model.form()
        self.assertEqual([fly.mode for fly in model.flies[:15]], [TO_DOT] * 3 + [LOOPING] * 12)
        first, third = model.flies[0], model.flies[2]
        self.assertEqual((first.vx, first.vy), (-21 * FP // 16, -13 * FP // 16))
        self.assertEqual((third.vx, third.vy), (-17204, -46695))
        self.assertEqual((third.pitch, third.pitch_step, model.world.dice), (-42, -3, 3))
        model = hint(0, dice=255)
        model.count = 15
        model.form()
        self.assertEqual((model.flies[0].pitch, model.flies[0].pitch_step), (-127, -8))

    def test_a_hold_that_ends_sends_the_word_looping_where_it_stands(self):
        model = hint(0)
        line(model, 50, range(3, 52))
        self.assertEqual([fly.mode for fly in model.flies[:4]], [ON_DOT] * 3 + [LOOPING])
        model = hint(0)
        line(model, 51, range(3, 52))
        self.assertEqual((model.state, {fly.mode for fly in model.flies}), (PAUSE, {LOOPING}))

    def test_a_chant_that_breaks_sends_the_flies_looping_and_the_swarm_home(self):
        self.assertEqual(line(hint(4), 12, range(1, 10)), "3:20x9 5:20x1 1:20x2")
        self.assertEqual(line(hint(4), 41, range(1, 18)), "3:20x16 2:20x1 5:28x21 1:20x3")
        self.assertEqual(line(hint(4), 50, range(1, 25)), "3:20x16 2:20x1 2:28x1 4:36x6 5:36x21 5:28x1 1:20x4")
        model = hint(4)
        line(model, 25, range(1, 25))
        self.assertEqual((model.state, {fly.mode for fly in model.flies}), (UNWIND, {LOOPING}))
        model = hint(4)
        line(model, 45, range(1, 25))
        self.assertEqual([fly.angle for fly in model.flies[:20]], [looped(19 - k) for k in range(20)])
        self.assertEqual((model.flies[0].tx, model.flies[0].ty), (84 * FP, 92 * FP))

    def test_a_chant_that_comes_back_is_heard_once_the_swarm_is_twenty_again(self):
        heard = set(range(3, 30)) | set(range(35, 76))
        model = hint(0)
        self.assertEqual(line(model, 75, heard),
                         "1:20x2 3:20x16 2:20x1 4:15x10 5:15x21 5:20x1 1:20x1 3:20x16 2:20x1 4:15x6")
        self.assertEqual(model.words, [(20, "AB"), (70, "AB")])

    def test_scattering_stops_at_the_first_fly_already_looping(self):
        model = hint(0)
        for fly, mode in zip(model.flies, (ON_DOT, TO_DOT, LOOPING, ON_DOT)):
            fly.mode = mode
        model.scatter()
        self.assertEqual([fly.mode for fly in model.flies[:4]], [LOOPING, LOOPING, LOOPING, ON_DOT])


class Flight(unittest.TestCase):
    def fly(self, model, **fields):
        """the model's first fly after a tick of it alone, from the fields given"""
        model.count = 1
        for name, value in fields.items():
            setattr(model.flies[0], name, value)
        model.world.sounds = []
        model.move()
        return model.flies[0]

    def test_a_fly_a_whole_pixel_from_its_dot_either_way_has_yet_to_arrive(self):
        there = dict(mode=TO_DOT, tx=50 * FP, ty=50 * FP, vx=7, vy=-9, pitch=20, pitch_step=3)
        for x, y in [(50 * FP - FP, 50 * FP), (50 * FP, 50 * FP + FP), (50 * FP + FP, 50 * FP), (50 * FP, 50 * FP - FP)]:
            fly = self.fly(hint(0), x=x, y=y, **there)
            self.assertEqual((fly.mode, fly.x, fly.y, fly.pitch), (TO_DOT, x + 7, y - 9, 23))
        fly = self.fly(hint(0), x=50 * FP + FP - 1, y=50 * FP - FP + 1, **there)
        self.assertEqual((fly.mode, fly.x, fly.y, fly.pitch), (ON_DOT, 50 * FP + FP - 1, 50 * FP - FP + 1, 0))

    def test_a_fly_on_its_dot_shifts_a_pixel_across_by_the_dice(self):
        model = hint(0, dice=[4, 1, 2, 8, 2] + [0x55] * 251, start=100)
        model.world.own = 0
        at = dict(mode=ON_DOT, tx=10 * FP)
        self.assertEqual(self.fly(model, x=10 * FP, **at).x, 11 * FP)
        self.assertEqual(self.fly(model, **at).x, 11 * FP)
        self.assertEqual(self.fly(model, **at).x, 10 * FP)
        self.assertEqual(model.world.own, 5)

    def test_the_flies_tick_in_their_order_and_none_past_the_swarm(self):
        model = hint(0, dice=[4, 1, 8, 0] + [0x55] * 252, start=100)
        model.world.own, model.count = 0, 2
        for fly in model.flies[:3]:
            fly.mode, fly.tx, fly.x = ON_DOT, 10 * FP, 10 * FP
        model.move()
        self.assertEqual([fly.x for fly in model.flies[:3]], [11 * FP, 10 * FP, 10 * FP])
        self.assertEqual(model.world.own, 4)

    def test_a_looping_fly_turns_by_its_speed_and_steps_five_across_and_two_up_the_wave(self):
        fly = self.fly(hint(0), mode=LOOPING, x=0, y=0, angle=0, speed=64)
        self.assertEqual((fly.angle, fly.x, fly.y), (64, 0, -2 * 65535))
        fly = self.fly(hint(0), mode=LOOPING, x=0, y=0, angle=250, speed=6)
        self.assertEqual((fly.angle, fly.x, fly.y), (0, 5 * 65535, 0))
        fly = self.fly(hint(0), mode=LOOPING, x=0, y=0, angle=0, speed=10)
        self.assertEqual((fly.angle, fly.x, fly.y), (10, 5 * QUARTER[53], -2 * QUARTER[10]))

    def test_only_the_first_fly_rolls_for_a_sound_and_the_player_rolls_a_pitch_for_one_given_none(self):
        quiet = hint(0, dice=20)
        line(quiet, 1, ())
        self.assertEqual((quiet.world.sounds, quiet.world.dice), ([], 1))
        loud = hint(0, dice=19)
        line(loud, 1, ())
        self.assertEqual((loud.world.sounds, loud.world.dice), ([(23, None)], 3))
        for dice, mode, sounds, rolls in [
            (7, LOOPING, [(18, None)], 3), (7, TO_DOT, [(24, 23)], 2), (7, ON_DOT, [(24, 0)], 2),
            (39, LOOPING, [], 1), (39, TO_DOT, [(28, 23)], 2), (39, ON_DOT, [(28, 0)], 2),
            (40, TO_DOT, [], 1), (40, ON_DOT, [], 1),
        ]:
            model = hint(0, dice=dice)
            self.fly(model, mode=mode, x=0, y=0, tx=50 * FP, ty=50 * FP, pitch=20, pitch_step=3)
            self.assertEqual((model.world.sounds, model.world.dice), (sounds, rolls), (dice, mode))

    def test_the_dice_cursor_wraps(self):
        model = hint(0, start=255)
        line(model, 2, ())
        self.assertEqual(model.world.dice, 1)


class Waves(unittest.TestCase):
    def test_the_sine_runs_the_quarter_wave_out_and_back_then_under(self):
        self.assertEqual([hintfly.sine(a) for a in (0, 1, 63, 64, 126, 127, 128, 129, 191, 192, 254, 255, 257, -1)],
                         [0, 1633, 65535, 65535, 1633, 0, 0, -1633, -65535, -65535, -1633, 0, 1633, 0])

    def test_the_quarter_wave_is_the_sine_over_63_steps_cut_downward(self):
        self.assertEqual(list(QUARTER), [int(65535 * math.sin(i * math.pi / 126)) for i in range(64)])

    def test_a_product_keeps_sixteen_bits_of_fraction_cut_downward_and_wraps(self):
        self.assertEqual(hintfly.fpmul(DOT, 4 * FP), 4 * DOT)
        self.assertEqual(hintfly.fpmul(-3, FP // 2), -2)
        self.assertEqual(hintfly.fpmul(0x7FFFFFFF, 2 * FP), -2)
        self.assertEqual([hintfly.s32(v) for v in (0x7FFFFFFF, 0x80000000, 1 << 32)], [0x7FFFFFFF, -0x80000000, 0])
        self.assertEqual([hintfly.s16(v) for v in (0x7FFF, 0x8000, 1 << 16)], [0x7FFF, -0x8000, 0])


BASE, LOAD = 0x800A0000, 0x80010000
EVENT, WAVE, DRAW, FRAME, SCREEN, BANK = 0x80020000, 0x80020100, 0x80020300, 0x8008F000, 0x80080100, 0x80080200
JR_RA, JR_V0, NOP = 0x03E00008, 0x00400008, 0
A0, T0, V1 = 4, 8, 3
STRINGS = MESSAGES[:1] + MESSAGES[2:3] + MESSAGES[4:] + [f"WORD {'ABC'[i % 3] * (i % 7 + 1)}" for i in range(31)]
TABLES = {"AO": {"lcd": (9, True), "hintfly": (36, False)}}


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


def records(blob):
    """where the three letters' records of a synthetic overlay lie"""
    at = len(text_table(STRINGS))
    return [BASE + at, BASE + at + 4, BASE + at + 8]


def text_table(strings):
    """strings laid out as the linker lays them, then a table naming each
    between two words that name nothing"""
    blob, offsets = bytearray(), []
    for s in strings:
        offsets.append(len(blob))
        blob += s.encode("latin1") + b"\0"
        blob += bytes(-len(blob) % 4)
    return bytes(blob) + struct.pack(f"<{len(offsets) + 2}I", 0, *(BASE + off for off in offsets), 0)


class Assembly:
    """code assembled a function at a time from an address on"""
    def __init__(self, at, data=b""):
        self.at, self.data = at, bytearray(data)

    def emit(self, *words):
        here = self.at + len(self.data)
        self.data += struct.pack(f"<{len(words)}I", *words)
        return here


def executable(players=2, rolls=1, banks=1):
    """(a synthetic executable's image, what hintfly.code is to find in it):
    the roll of the dice, two voices, the engine's player calling the three
    and loading where its sounds are kept, and two sound routines calling the
    player"""
    head = bytearray(0x800)
    struct.pack_into("<I", head, 0x18, LOAD)
    code = Assembly(LOAD)
    roll, first, second = (code.emit(JR_RA, NOP) for _ in range(3))
    player = code.emit(jal(first), NOP, *(jal(roll), NOP) * rolls, jal(second), NOP,
                       *(w for k in range(banks) for w in word_at(V1, BANK + 16 * k)), JR_RA, NOP)
    other = code.emit(jal(first), NOP, JR_RA, NOP)
    sounds = [code.emit(jal(player if k < players else other), NOP, JR_RA, NOP) for k in range(2)]
    return Image(bytes(head + code.data)), dict(roll=roll, sounds=sounds, player=player, voices={first, second})


def overlay(exe, virtual=1, leaf=True, sound=60, events=1, frames=1, pointers=1, slot=0, draws=True, called=False,
            builds=True):
    """(a synthetic overlay, the routines in it as hintfly.code is to find
    them): the messages, the alphabet, then the hint fly's routines in the
    shapes the overlays compile them to, and the table naming its virtual
    ones, the render `slot` bytes into itself or, with None, not at all"""
    code = Assembly(BASE, text_table(STRINGS))
    records = []
    for dots in (A, B, C):
        records.append(code.at + len(code.data))
        code.data += bytes([len(dots)]) + dots
        code.data += bytes(-len(code.data) % 4)
    spell = code.at + len(code.data) - 4 * 0x41
    code.data += struct.pack("<3I", *records)
    emit, (first, second) = code.emit, exe["sounds"]
    init = emit(JR_RA, NOP) if leaf else emit(jal(WAVE), NOP, JR_RA, NOP)
    longest = emit(*named(T0, spell), JR_RA, NOP)
    emit(*named(T0, spell), JR_RA, NOP)
    form = emit(*named(T0, spell), jal(exe["roll"]), NOP, JR_RA, NOP)
    move = emit(jal(WAVE), NOP, jal(exe["roll"]), NOP, jal(first), addiu(A0, 0, sound), ori(A0, 0, sound),
                jal(second), NOP, jal(init), addiu(A0, 0, sound), JR_RA, NOP)
    here = code.at + len(code.data)
    update = emit(JR_V0, NOP, *named(T0, spell), j(here + 24), NOP,
                  *(w for k in range(events) for w in (jal(EVENT + 0x40 * k), NOP)),
                  jal(move), NOP, jal(init), NOP, jal(form), NOP, *word_at(T0, records[0]), lui(T0, 0x8001),
                  lw(V1, 16, A0), *(w for k in range(frames) for w in word_at(V1, FRAME + 16 * k)), JR_RA, NOP)
    render = emit(*((jal(DRAW), NOP, jal(DRAW + 0x40), NOP) if draws else ()), lui(A0, 0x8008), lh(A0, 0x22CA, A0),
                  jal(init), NOP, *word_at(T0, records[1]),
                  *(w for k in range(pointers) for w in word_at(A0, SCREEN + 16 * k)), JR_RA, NOP)
    emit(jal(longest), NOP, *((jal(init), NOP) if builds else ()), *((jal(update), NOP) if called else ()), JR_RA, NOP)
    emit(*[0, update] * virtual, 0, 0 if slot is None else render + slot, 0)
    return bytes(code.data), hintfly.Code(
        longest=longest, init=init, update=update, render=render, event=EVENT, frame=FRAME,
        drawing={DRAW, DRAW + 0x40}, screen=SCREEN, player=exe["player"], roll=exe["roll"], voices=exe["voices"],
        bank=BANK)


class Routines(unittest.TestCase):
    def found(self, **shape):
        """(what hintfly.code finds in an overlay of a shape, what the overlay was built to hold)"""
        image, exe = executable(**{k: shape.pop(k) for k in ("players", "rolls", "banks") if k in shape})
        blob, want = overlay(exe, **shape)
        return hintfly.code(blob, BASE, image), want

    def test_the_routines_are_found_by_what_they_index_call_and_load(self):
        self.assertEqual(*self.found())

    def test_an_update_something_also_calls_is_still_the_update(self):
        self.assertEqual(*self.found(called=True))

    def test_an_overlay_of_another_shape_is_refused_by_the_part_that_is_off(self):
        for shape, refusal in [
            (dict(virtual=0), "0 candidates for the update"),
            (dict(virtual=2), "2 candidates for the update's slot"),
            (dict(slot=None), "no function in the slot after the update's"),
            (dict(slot=4), "no function in the slot after the update's"),
            (dict(leaf=False), "0 candidates for a fly's setup"),
            (dict(builds=False), "0 candidates for the routine measuring the longest word"),
            (dict(sound=61), "passes its sound to nothing"),
            (dict(players=1), "2 candidates for the engine's player"),
            (dict(players=0), "0 candidates for the roll of the dice"),
            (dict(rolls=0), "0 candidates for the roll of the dice"),
            (dict(banks=0), "0 candidates for where the player's sounds are kept"),
            (dict(banks=2), "2 candidates for where the player's sounds are kept"),
            (dict(events=2), "2 candidates for the event query"),
            (dict(frames=0), "0 candidates for the frame counter"),
            (dict(frames=2), "2 candidates for the frame counter"),
            (dict(pointers=2), "2 candidates for the pointer the render draws through"),
            (dict(draws=False), "the render hands the engine nothing to draw"),
        ]:
            with self.subTest(shape=shape):
                with self.assertRaisesRegex(RuntimeError, refusal):
                    self.found(**shape)

    def test_an_overlay_with_no_alphabet_or_none_its_code_indexes_is_refused(self):
        image, exe = executable()
        with self.assertRaisesRegex(RuntimeError, "0 candidates for the alphabet"):
            hintfly.code(text_table(STRINGS), BASE, image)
        with mock.patch.object(hintfly, "LETTER_FIRST", 0x40):
            with self.assertRaisesRegex(RuntimeError, "no routine indexes the alphabet by a letter's code"):
                hintfly.code(overlay(exe)[0], BASE, image)

    def test_the_models_tables_are_the_overlays_own(self):
        blob = overlay(executable()[1])[0]
        with mock.patch.dict(messages.MESSAGE_TABLES, TABLES):
            self.assertEqual(hintfly.tables([7] * 256, blob, BASE), hintfly.Tables([7] * 256, [A, B, C], STRINGS))
            with self.assertRaisesRegex(RuntimeError, "0 candidates for the alphabet"):
                hintfly.tables([7] * 256, text_table(STRINGS), BASE)
            with self.assertRaisesRegex(RuntimeError, "0 candidates for the messages"):
                hintfly.tables([7] * 256, text_table(STRINGS[:35]) + blob[-4:], BASE)
            table = len(text_table(STRINGS))
            run_on = blob[:table - 4] + struct.pack("<I", BASE + table) + blob[table:]
            with self.assertRaisesRegex(RuntimeError, "0 candidates for the messages"):
                hintfly.tables([7] * 256, run_on, BASE)

    class Disc:
        def __init__(self, blobs):
            self.blobs = blobs
            self.files = {name: (i, len(blob)) for i, (name, blob) in enumerate(blobs.items())}

        def read(self, lba, size):
            return list(self.blobs.values())[lba]

    def overlays(self, files, loads):
        with mock.patch.dict(messages.MESSAGE_TABLES, TABLES), \
                mock.patch.object(hintfly, "path_overlays", lambda data, layout: loads):
            return hintfly.overlays(self.Disc({**files, "SLUS_000.00": b""}))

    def test_the_overlays_the_paths_load_that_hold_an_alphabet_are_the_ones_run_in_name_order(self):
        lcd = text_table([""] + [" " * 31 + f"Screen {'x' * i}" for i in range(8)])
        flies = overlay(executable()[1])[0]
        loads = {("E2", 1): "E2.OVL", ("E1", 1): "E1.OVL", ("E1", 2): "E1.OVL", ("R1", 1): "R1.OVL", ("F9", 1): "F9.OVL"}
        blobs, base = self.overlays({"D9.OVL": flies, "E2.OVL": flies, "R1.OVL": lcd, "E1.OVL": flies}, loads)
        self.assertEqual((list(blobs), base), (["E1.OVL", "E2.OVL"], BASE))
        with self.assertRaisesRegex(RuntimeError, "0 candidates for the address the overlays load at"):
            self.overlays({"E1.OVL": flies}, {("E1", 1): "E1.OVL"})
        unnamed = flies.replace(struct.pack("<3I", *records(flies)), struct.pack("<3I", *records(flies)[:2], 0))
        with self.assertRaisesRegex(RuntimeError, "^E2.OVL: the alphabet at .* leaves 1 of its records unnamed"):
            self.overlays({"E2.OVL": unnamed, "R1.OVL": lcd, "E1.OVL": flies}, loads)


class Tools(unittest.TestCase):
    def test_a_trace_is_the_model_under_the_maps_chant(self):
        got = hintfly_trace.trace(tables(), 0, 125, flips=[3])
        self.assertEqual(got["line"], "1:20x2 3:20x16 2:20x1 4:15x31 3:15x16 2:15x1 4:14x31 5:14x21 1:20x1 3:20x5")
        self.assertEqual((got["message"], got["words"], got["dice"]), ("AB A", [[20, "AB"], [68, "A"]], 37 + 125 + 5))

    def test_a_chant_that_goes_as_the_last_hold_ends_is_a_broken_one_heard_again_from_twenty(self):
        got = hintfly_trace.trace(tables(), 4, 78, flips=[2, 51, 61])
        self.assertEqual(got["line"], "1:20x1 3:20x16 2:20x1 2:28x1 4:36x31 5:36x21 5:28x1 5:20x1 1:20x1 3:20x4")
        got = hintfly_trace.trace(tables(), 0, 60, flips=[3, 30])
        self.assertEqual(got["line"], "1:20x2 3:20x16 2:20x1 4:15x10 5:15x21 1:20x10")

    def test_a_message_spelled_comes_round_again_from_its_first_word(self):
        got = hintfly_trace.trace(tables(), 0, 175, flips=[3])
        self.assertEqual(got["line"], "1:20x2 3:20x16 2:20x1 4:15x31 3:15x16 2:15x1 4:14x31 5:14x21 1:20x1 "
                                      "3:20x16 2:20x1 4:15x31 3:15x7")
        self.assertEqual(got["words"], [[20, "AB"], [68, "A"], [138, "AB"]])

    def test_a_hint_with_no_message_hears_no_chant_and_one_ending_on_a_space_forms_the_nothing_after_it(self):
        self.assertEqual(hintfly_trace.trace(tables(), 1, 60, flips=[3])["line"], "1:20x60")
        spaced = hintfly.Tables([0x55] * 256, [A, B, C], ["AB "])
        got = hintfly_trace.trace(spaced, 0, 110, flips=[3])
        self.assertEqual((got["line"], got["words"]),
                         ("1:20x2 3:20x16 2:20x1 4:15x31 3:15x16 2:15x1 4:12x31 5:12x12", [[20, "AB"], [68, ""]]))

    def test_the_cursors_start_at_the_seed_and_end_where_the_setups_and_rolls_leave_them(self):
        got = hintfly_trace.trace(tables(), 0, 30, flips=[3])
        self.assertEqual((got["own"], got["dice"]), (37 + 20 * 5 + 5 * 5, 37 + 30 + 3))
        got = hintfly_trace.trace(hintfly.Tables(list(range(256)), [A, B, C], MESSAGES), 0, 1, seed=7)
        self.assertEqual((got["own"], got["dice"]), (107, 10))
        got = hintfly_trace.trace(tables(), 0, 2)
        self.assertEqual(got["rolls"], (137 * 256 + 38) * 31 + 137 * 256 + 39)

    def test_a_shot_is_each_corner_about_the_hints_point_in_fly_order(self):
        got = hintfly_trace.trace(tables(), 0, 40, flips=[3], shots=[1, 40], at=(60, 40))
        self.assertEqual(got["shots"][1], " ".join(["4,3"] * 20))
        self.assertEqual(got["shots"][40].split(" ")[:3], ["-17,-9", "-13,-5", "1,-6"])
        self.assertEqual(len(got["shots"][40].split(" ")), 15)
        self.assertEqual(got, hintfly_trace.trace(tables(), 0, 40, flips=[3], shots=[1, 40]))
        cut = hintfly_trace.trace(tables(), 0, 1, shots=[1], at=(-6, -6))
        self.assertEqual(cut["shots"][1], " ".join(["5,4"] * 20))

    def test_the_sum_folds_every_corner_of_every_tick(self):
        got = hintfly_trace.trace(tables(), 0, 40, flips=[3], shots=range(1, 41))
        total = 0
        for tick in range(1, 41):
            for i, corner in enumerate(got["shots"][tick].split(" ")):
                x, y = (int(v) for v in corner.split(","))
                total = (total * 31 + (x & 0xFFFF) * 7 + (y & 0xFFFF) + i) % 2 ** 32
        self.assertEqual(got["sum"], total)
        self.assertEqual(hintfly_trace.trace(tables(), 0, 40, flips=[3])["shots"], {})

    def refused(self, *argv):
        """what the trace says of arguments it will not take"""
        said = io.StringIO()
        with contextlib.redirect_stderr(said), self.assertRaises(SystemExit) as stopped:
            hintfly_trace.main(list(argv))
        return f"{said.getvalue()}{stopped.exception.code}"

    def test_the_trace_refuses_what_is_no_run_of_the_maps(self):
        for argv, why in [
            (("10", "0"), "ticks is at least one"),
            (("10", "50", "--chant", "1"), "--chant takes ticks that rise from 2"),
            (("10", "50", "--chant", "9,5"), "--chant takes ticks that rise from 2"),
            (("10", "50", "--chant", "5,5"), "--chant takes ticks that rise from 2"),
            (("10", "50", "--chant", "a"), "--chant takes whole numbers between commas"),
            (("10", "50", "--shots", "51"), "--shots takes ticks of the run"),
            (("10", "50", "--shots", "0"), "--shots takes ticks of the run"),
            (("10", "50", "--seed", "256"), "--seed is a byte"),
            (("10", "50", "--seed=-1"), "--seed is a byte"),
            (("10", "50", "--at", "6"), "--at takes a point as x,y"),
            (("10", "50", "--at", "6,4,2"), "--at takes a point as x,y"),
            (("10", "50", "--at", "40000,4"), "--at takes a point as x,y"),
            (("10", "50", "--overlay", "E3.OVL"), "--overlay names an overlay of the disc"),
            (("36", "50"), "there is no message 36"),
            (("-1", "50"), "there is no message -1"),
        ]:
            with self.subTest(argv=argv):
                self.assertIn(why, self.refused(*argv))

    def printed(self, *argv):
        """what the trace prints for its arguments, read back"""
        said = io.StringIO()
        with contextlib.redirect_stdout(said):
            hintfly_trace.main(list(argv))
        return json.loads(said.getvalue())

    def test_the_trace_prints_the_run_its_arguments_name(self):
        shipped = hintfly_trace.committed()
        want = hintfly_trace.trace(shipped, 1, 40, [2, 30], [5, 40], 136, [-6, 4])
        got = self.printed("1", "40", "--chant", "2,30", "--shots", "5,40", "--seed", "136", "--at=-6,4")
        self.assertEqual(got, json.loads(json.dumps(want)))
        self.assertEqual((got["message"], sorted(got["shots"]), got["words"]), ("ABE WAS HERE", ["40", "5"], [[27, "ABE"]]))
        self.assertEqual(self.printed("1", "40"), json.loads(json.dumps(hintfly_trace.trace(shipped, 1, 40))))
        self.assertEqual(list(got), ["message", "line", "words", "sum", "rolls", "own", "dice", "shots"])

    def test_the_verifiers_chant_is_drawn_from_its_seed_and_opens_unheard(self):
        heard = hintfly_verify.chants(7, 2000)
        self.assertEqual((len(heard), heard[0], heard), (2000, False, hintfly_verify.chants(7, 2000)))
        self.assertNotEqual(heard, hintfly_verify.chants(8, 2000))
        spans = [(m.group(0)[0], len(m.group(0))) for m in re.finditer(r"0+|1+", "".join(str(int(h)) for h in heard))]
        self.assertGreater(len(spans), 10)
        self.assertLessEqual(max(n for on, n in spans if on == "1"), 240)
        self.assertLessEqual(max(n for on, n in spans if on == "0"), 40)

    def test_the_messages_run_are_the_ones_the_alphabet_spells(self):
        self.assertEqual(hintfly_verify.spelled(tables()), [0, 1, 2, 4, 5, 6])

    def test_an_overlays_line_says_what_its_runs_covered_or_the_first_that_failed(self):
        code = overlay(executable()[1])[1]
        some = {(IDLE, PAUSE), (PAUSE, RESIZE), (RESIZE, HOLD), (HOLD, UNWIND), (UNWIND, IDLE)}
        rest = {(PAUSE, UNWIND), (HOLD, PAUSE)}
        runs = [(some, 3, 1, 1000, code), (rest, 4, 2, 234, code)]
        self.assertEqual(hintfly_verify.report("E1.OVL", runs, 0), (
            "E1.OVL: the disc's code and the model agree over 2 messages, 7 words formed and 3 of them let go of, "
            f"the changes of state but resize to unwind, in 1,234 instructions; update {code.update:#x}, "
            f"render {code.render:#x}", True))
        whole = hintfly_verify.report("E1.OVL", [(some | rest | {(RESIZE, UNWIND)}, 3, 1, 1000, code)], 2)
        self.assertIn("agree over 1 message, 3 words formed and 1 of them let go of, every change of state, in 1,000",
                      whole[0])
        self.assertIn("; 2 messages spell outside the alphabet and are left unrun", whole[0])
        self.assertEqual(hintfly_verify.report("E1.OVL", [runs[0], "message 3, tick 9: fly 2's x", "later"], 0),
                         ("E1.OVL: message 3, tick 9: fly 2's x", False))
        self.assertEqual(hintfly_verify.report("E1.OVL", [], 36),
                         ("E1.OVL: its alphabet spells none of its messages", False))


class PortLiterals(unittest.TestCase):
    """the numbers tests/unit/hintfly.test.js holds the viewer's hint flies to
    are the model's, over the tables the viewer ships"""
    # a run the test makes: its message, ticks, flips, shots, seed and point, and what of it the test holds
    RUNS = [
        (5, 300, [], [1, 64, 300], 37, (180, 120), "shots"),
        (5, 300, [], [1, 64, 300], 37, (6, 4), "shots"),
        (10, 150, [10], [54, 120], 37, (180, 120), "line words shots"),
        (10, 400, [10], [], 37, (180, 120), "words ends"),
        (14, 900, [5], [], 37, (180, 120), "words ends"),
        (5, 220, [10, 70], [60, 75, 110], 37, (180, 120), "line shots ends"),
        (5, 200, [10, 70, 95], [], 37, (180, 120), "line words ends"),
        (29, 150, [10], [], 37, (180, 120), "words ends"),
        (1, 200, [2], [], 136, (180, 120), "words ends"),
        (10, 220, [10, 122, 130], [], 37, (180, 120), "words ends"),
        (None, 100, [10], [], 37, (180, 120), "line"),
    ]

    def test_every_run_the_ports_test_makes_is_the_models(self):
        source = " ".join((ROOT / "tests" / "unit" / "hintfly.test.js").read_text().split())
        source = source.replace("[ ", "[").replace(", ]", "]")
        shipped = hintfly_trace.committed()
        silent = hintfly.Tables(shipped.dice, shipped.alphabet, [""])
        self.assertEqual(len(re.findall(r"\brun\(hint\(", source)), sum(1 for run in self.RUNS if run[2]))
        seen = []
        for message, ticks, flips, shots, seed, at, held in self.RUNS:
            got = hintfly_trace.trace(*((silent, 0) if message is None else (shipped, message)), ticks, flips, shots,
                                      seed, at)
            literals = {"line": [f'"{got["line"]}"'], "words": [str([tick for tick, _ in got["words"]])],
                        "shots": [f'"{corners}"' for corners in got["shots"].values()],
                        "ends": [f'{got["sum"]}, {got["rolls"]}, {got["own"]}, {got["dice"]}']}
            self.assertEqual(len(got["shots"]), len(shots))
            for part in held.split():
                for literal in literals[part]:
                    found = len(re.findall(r"(?<!\d)" + re.escape(literal) + r"(?!\d)", source))
                    with self.subTest(message=message, ticks=ticks, flips=flips, seed=seed, at=at, part=part):
                        self.assertEqual((found, literal in seen), (1, False), f"{literal[:70]} in the test's source")
                    seen.append(literal)

    def test_the_shipped_tables_are_a_game_of_letters_and_messages(self):
        shipped = hintfly_trace.committed()
        self.assertEqual((sorted(shipped.dice), len(shipped.alphabet), len(shipped.messages), shipped.messages[10]),
                         (list(range(256)), 26, 36, "DROP IN"))


if __name__ == "__main__":
    unittest.main()
