#!/usr/bin/env python3
"""Run a disc's own falling item beside the model of it: the constructor of
every overlay holding one, found by its shape and run in tools/oddmap/r3000.py's
interpreter over every record the game places, against tools/oddmap/fallingitem.py,
and the executable's render of the item so built against tools/oddmap/render.py,
over every frame of the animations the constructor asks for.

    python3 tools/fallingitem_verify.py --game AO                    # every overlay of the disc
    python3 tools/fallingitem_verify.py --game AE --disc <disc 1> <disc 2>
    python3 tools/fallingitem_verify.py --game AE --overlay PV.OVL

--disc defaults to $ODDWORLD_DISC_AO or $ODDWORLD_DISC_AE, the latter holding
both of Exoddus's images, of which each is run with its own executable and the
overlays it carries. An overlay's constructor builds every placed record under
the map at its own camera and at another, in four levels, with and without an
item already humming, and what it leaves is compared field by field, with what
it stores outside its object. The object so left is then rendered standing in
each frame at its own camera, and what the render hands the ordering table, a
quad or nothing, compared corner by corner.

What the placed records reach too seldom is put there: a record of the other
scale, one of a scale that is neither and one whose rect lies left of the
path's origin, and an item stood by hand as oddmap/render.py stands any object:
either side of each edge of the camera's window and off its corners, at its own
scale and at others, mirrored each way, on the carries of its rounding, hidden,
made in another level and in another path, and under the event that ends a
life. Beside each render the disc's own test of where the item's rect lies is
asked, and its answer compared.

The disc's code is what answers here: the model is right as far as the two
agree, and the first thing they differ on is named with its record.
"""
import argparse
import collections
import os
import struct
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))

from oddmap import fallingitem, records, render  # noqa: E402
from oddmap.disc import Disc  # noqa: E402
from oddmap.exe import Image, calls, executable  # noqa: E402
from oddmap.fixed import FP  # noqa: E402
from oddmap.games import GAMES, game_setup  # noqa: E402
from oddmap.r3000 import RAM, STACK, Fault, Machine  # noqa: E402
from oddmap.render import ABOVE, BELOW, LEFT, ON, RIGHT, Stage  # noqa: E402

THIS, SIZE, RECORD, CELLS, SPARE, HEAP = 0x80180000, 0x200, 0x80181000, 0x80181800, 0x80182000, 0x801C0000
ANIM = int.from_bytes(b"Anim", "little")
EXPLODES = 0x400000
# where an item keeps what the model names, how each is read, and where its table of functions is named
OBJECT = {
    "AE": dict(kind=(0x00, "s16"), level=(0xC2, "s16"), path=(0xC0, "s16"), across=(0xDA, "s16"), down=(0xD8, "s16"),
               red=(0xD0, "s16"), green=(0xD2, "s16"), blue=(0xD4, "s16"), x=(0xB8, "s32"), y=(0xBC, "s32"),
               start=(0x130, "s32"), foot_x=(0x138, "s32"), foot_y=(0x13C, "s32"), scale=(0xCC, "s32"),
               plane=(0xD6, "s16"), layer=(0x28, "s16"), switch=(0x11E, "s16"), interval=(0x124, "s16"),
               most=(0x120, "s16"), left=(0x122, "s16"), reset=(0x12C, "s16"), sounding=(0x12E, "s16"),
               state=(0x11C, "s16"), hit=(0x134, "s16"), channels=(0x140, "s32"), created=(0x144, "s32"),
               info=(0x118, "s32")),
    "AO": dict(kind=(0x00, "s16"), level=(0xAA, "s16"), path=(0xA8, "s16"), across=(0xC2, "s16"), down=(0xC0, "s16"),
               red=(0xB8, "s16"), green=(0xBA, "s16"), blue=(0xBC, "s16"), x=(0xA0, "s32"), y=(0xA4, "s32"),
               start=(0x11C, "s32"), foot_x=(0x120, "s32"), foot_y=(0x124, "s32"), scale=(0xB4, "s32"),
               plane=(0xBE, "s16"), layer=(0x18, "s16"), switch=(0x10A, "s16"), interval=(0x110, "s16"),
               most=(0x10C, "s16"), left=(0x10E, "s16"), reset=(0x118, "s16"), sounding=(0x11A, "s16"),
               state=(0x108, "s16"), channels=(0x128, "s32"), created=(0x12C, "s32"), info=(0x104, "s32")),
}
TABLE = {"AE": 0x1C, "AO": 0x0C}
# the levels a constructor is run under, and whether an item already hums in each
WORLDS = ((1, False), (13, False), (2, False), (5, False), (1, True), (2, True))
AWAY = (3750, 2600)                 # how far off the second camera a record is built under stands
SIDES = {ON: "on the window", ABOVE: "above it", BELOW: "below it", LEFT: "left of it", RIGHT: "right of it"}
Tally = collections.namedtuple("Tally", "placed made_up built art frames drawn sides scales steps code")


class Differs(Exception):
    """the disc's code and the model part ways"""


class Console:
    """a disc's falling item: its overlay over the executable in a machine of
    its own, the constructor run over a record with its base's own
    constructors, and every other routine the three call answered: the
    object's entry among the game's, the animation the item asks for and its
    setup, and its shadow. The render is the executable's, run by
    oddmap/render.py's console."""
    def __init__(self, game, exe, blob, base, found):
        self.m, self.game, self.code = Machine(), game, found
        self.m.load(exe.load, exe.data[exe.head:])
        self.m.load(base, blob)
        self.render = render.Console(self.m, render.code(exe, found.render), game, SPARE)
        made = [target for _, target in calls(Image(blob, base), found.construct)]
        inner = [target for _, target in calls(exe, made[0])] if made and exe.holds(made[0]) else []
        if not inner or not exe.holds(inner[0]):
            raise RuntimeError("the constructor opens on no constructor of the executable's that opens on another")
        self.answered = set(made[1:]) | set(inner[1:]) | {target for _, target in calls(exe, inner[0])}

    def build(self, words, world, info):
        """the object as the disc's constructors leave it over a record's
        bytes: (the animation it asks for and the table it sets it up from,
        what it stores to outside the object)"""
        m, found = self.m, self.code
        m.mem[THIS - RAM:THIS - RAM + SIZE] = bytes(SIZE)
        m.mem[RECORD - RAM:RECORD - RAM + len(words)] = words
        m.w32(found.frame, world.frame)
        m.w32(found.first, HEAP if world.led else 0)
        asked, cells = [], {}

        def answer(m):
            a0, a1, a2 = m.r[4:7]
            if ANIM in (a0, a1):
                cells[CELLS + 8 * len(cells)] = a1 if a0 == ANIM else a2
                return CELLS + 8 * len(cells) - 8
            if a0 == THIS and m.r32(m.r[29] + 16) in cells:
                asked.append((cells[m.r32(m.r[29] + 16)], a1))
            return a0 if a0 >= RAM else HEAP

        m.stubs, m.stores = {routine: answer for routine in self.answered}, set()
        m.call(found.construct, THIS, RECORD, info)
        stored, m.stores = {a for a in m.stores if not THIS <= a < THIS + SIZE and a < STACK - 0x1000}, None
        if len(asked) != 1:
            raise RuntimeError(f"the constructor sets up {len(asked)} animations it asked for, expected one")
        if m.r32(THIS + TABLE[self.game]) != found.table:
            raise Differs("the constructor leaves the object another table of functions than the update's")
        return asked[0], stored

    def fields(self):
        m = self.m
        got = {name: getattr(m, read)(THIS + at) for name, (at, read) in OBJECT[self.game].items()}
        return dict(got, explodes=bool(m.r32(THIS) & EXPLODES), leads=m.r32(self.code.first) == THIS)


def made_up(game_key, placed):
    """a placed record thrice more: at its other scale, at one that is
    neither, and with its rect left of the path's origin, its sides an odd
    sum; Oddysee keeps a copy of the corner before the rect"""
    fmt = GAMES[game_key]["tlv"]
    record = placed.record
    for scale in (int(not record.scale), 2):
        words = bytearray(placed.words)
        struct.pack_into("<h", words, fmt["header_len"] + 2, scale)
        yield placed._replace(record=record._replace(scale=scale), words=bytes(words))
    left, words = record._replace(x1=-30, x2=-5), bytearray(placed.words)
    struct.pack_into("<2h", words, fmt["rect_off"] - 4 * (game_key == "AO"), left.x1, left.y1)
    struct.pack_into("<4h", words, fmt["rect_off"], left.x1, left.y1, left.x2, left.y2)
    yield placed._replace(record=left, words=bytes(words))


def run(game_key, exe, blob, base, found, items, chunk):
    """an overlay's run on the disc's code and on the model: what it covered"""
    console = Console(game_key, exe, blob, base, found)
    upends = render.LAYOUT[game_key]["upends"]
    arts, built, frames, drawn, sides, scales = set(), 0, 0, 0, set(), set()

    def differ(where, what, disc, ours):
        if disc != ours:
            raise Differs(f"{where}: {what}: the disc's {disc}, the model's {ours}")

    def shown(where, table, index, frame, sprite, stage, hand=False):
        nonlocal frames, drawn
        console.render.stage(stage)
        if hand:
            console.render.place(THIS, sprite)
        console.render.stand(THIS, table, index, sprite)
        where = f"{where}, frame {index} of the table at {table:#x}"
        handed, rect = console.render.render(THIS), render.bounding(frame, sprite)
        differ(where, "what the render hands over", handed, render.render(frame, sprite, stage))
        differ(where, f"where the window finds {rect}", console.render.where(rect), render.side(rect, stage))
        frames, drawn = frames + 1, drawn + (handed is not None)
        if sprite.shown and (sprite.level, sprite.path) == (stage.level, stage.path):
            sides.add(render.side(rect, stage))
        scales.add(sprite.scale)

    extra = list(made_up(game_key, items[0]))
    for n, placed in enumerate(items + extra):
        where = f"{placed.short} P{placed.path} ({placed.record.x1},{placed.record.y1})"
        for level, led in WORLDS:
            for k, away in enumerate(((0, 0), AWAY)):
                console.render.stage(Stage(placed.left + away[0], placed.top + away[1], level, placed.path))
                world = fallingitem.World(game_key, level, placed.path, 1000 + n, led)
                art, stored = console.build(placed.words, world, 0x5000 + n)
                model = fallingitem.FallingItem(world, placed.record, 0x5000 + n)
                for name, value in console.fields().items():
                    differ(where, f"the item's {name} under level {level}, camera {k}", value, getattr(model, name))
                differ(where, "whether an item hums once it is made", bool(console.m.r32(found.first)), world.led)
                differ(where, "what the constructor stores to outside its object", stored,
                       {found.first} if model.leads else set())
                arts.add(art)
                built += 1
        if len(arts) != 1:
            raise Differs(f"{where}: the constructor asks for {len(arts)} animations across its records")
        if not n:
            data = chunk(*next(iter(arts)))
            console.render.show(data)
            stood = [(at, index, frame) for at in render.tables(data)
                     for index, frame in enumerate(render.frames(data, at))]
        sprite, stage = model.sprite(), Stage(placed.left, placed.top, model.level, model.path, upends=upends)
        for at, index, frame in stood:
            shown(where, at, index, frame, sprite, stage)
        for at, index, frame in stood if placed in (items[0], extra[0]) else ():
            for hand, staged in render.by_hand(frame, sprite, upends):
                shown(f"{where} by hand at {hand.x / FP},{hand.y / FP} x{hand.scale / FP}"
                      f"{' flipped' * hand.flip}{' upended' * hand.upend}", at, index, frame, hand, staged, True)
    return Tally(len(items), len(extra), built, next(iter(arts)), frames, drawn, sides, scales, console.m.steps, found)


def report(disc, ovl, got):
    """an overlay's line of the report, and whether its run agrees"""
    if isinstance(got, str):
        return f"{disc} {ovl}: {got}", False
    unseen = ", ".join(name for where, name in SIDES.items() if where not in got.sides)
    return (f"{disc} {ovl}: the disc's code and the model agree over {got.placed} placed records and {got.made_up} "
            f"made up, built {got.built:,} times, and {got.frames:,} frames of the animation {got.art[0]} set up "
            f"from {got.art[1]:#x} rendered, {got.drawn:,} of them drawn, their rects "
            f"{'never ' + unseen if unseen else 'on the window and on every side of it'}, at {len(got.scales)} "
            f"scales, in {got.steps:,} instructions; constructor {got.code.construct:#x}, "
            f"render {got.code.render:#x}"), True


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--game", choices=sorted(GAMES), required=True)
    ap.add_argument("--disc", nargs="+", help="the game's disc images, both of Exoddus's "
                    "(default $ODDWORLD_DISC_AO or $ODDWORLD_DISC_AE)")
    ap.add_argument("--overlay", action="append",
                    help="an overlay to run, as often as wanted (default every one holding the item)")
    args = ap.parse_args(argv)
    env = GAMES[args.game]["env"]
    images = args.disc or [p for p in os.environ.get(env, "").split(os.pathsep) if p]
    if not images:
        ap.error(f"no disc image: pass --disc or set ${env}")
    discs = [Disc(image) for image in images]
    items = fallingitem.placed(discs, args.game)
    if not items:
        sys.exit(f"the discs place no {fallingitem.NAME}")
    levels, found = records.archives(discs, game_setup(args.game)), {}

    def chunk(rid, table):
        if (rid, table) not in found:
            found[rid, table] = render.art(levels, rid, table)
        return found[rid, table]

    lines, held = [], set()
    for disc in discs:
        name, data = executable(disc)
        exe = Image(data)
        try:
            blobs, base = fallingitem.overlays(disc, args.game)
        except RuntimeError as e:
            sys.exit(f"{name}: {e}")
        held |= set(blobs)
        for ovl in [ovl for ovl in dict.fromkeys(args.overlay or blobs) if ovl in blobs]:
            try:
                got = run(args.game, exe, blobs[ovl], base, fallingitem.code(blobs[ovl], base, exe), items, chunk)
            except (Differs, Fault, RuntimeError) as e:
                got = str(e)
            lines.append(report(name, ovl, got))
            print(lines[-1][0], flush=True)
    missing = sorted(set(args.overlay or ()) - held)
    if missing or not held:
        sys.exit(f"no falling item in {', '.join(missing) or 'any overlay of the discs'}")
    failed = sum(not ok for _, ok in lines)
    if failed:
        sys.exit(f"{failed} of {len(lines)} overlays differ from the model or would not run")


if __name__ == "__main__":
    main()
