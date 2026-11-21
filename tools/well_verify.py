#!/usr/bin/env python3
"""Run a disc's own wells and the leaves they let go beside the model of them:
the routines of every overlay holding them, found by their shape and run in
tools/oddmap/r3000.py's interpreter over the cameras a game places, against
tools/oddmap/well.py over the same dice, comparing every field of every well
and leaf after every tick, both dice cursors, and whether the executable's
render goes on to draw each leaf against tools/oddmap/render.py.

    python3 tools/well_verify.py --game AO                    # every camera, dealt over the disc's overlays
    python3 tools/well_verify.py --game AE --disc <disc 1> <disc 2>
    python3 tools/well_verify.py --game AE --overlay MI.OVL --ticks 256

--disc defaults to $ODDWORLD_DISC_AO or $ODDWORLD_DISC_AE, the latter holding
both of Exoddus's images, of which each is run with its own executable and the
overlays it carries. A camera is every well its list holds, each built by the
overlay's constructor from its record's own bytes, at the point the game's
factory hands it, then ticked --ticks times from the two cursors the map reads
that camera's dice from. Every camera whose wells let leaves go in a fresh game
is run once, dealt in turn over the overlays, so that each overlay runs some
and --overlay runs them all in the ones it names.

What placed records do not reach is put there by hand: a well of each type
alone in its camera, with a leaf field set, each and both, told to let leaves
go by a value past one and by a negative one, told not to, on the switch that
always reads on, on another read off and written on, at the other scale and at
one that is neither, with its rect left of the path's origin, its sides an odd
sum, with its leaves let go on the left edge and under the top edge of a
window stood at the path's origin, in Exoddus with a leaf's point past sixteen
bits from Abe's start, and with an exit that leads down, at either scale,
stands still or holds odd speeds. Abe is started away from the path's origin
under each. And each disc's quotient and raycast are asked directly for the
pairs and rays oddmap/fixed.py and oddmap/collide.py set by hand.

The disc's code is what answers here: the model is right as far as the two
agree, and the first thing they differ on is named with its camera and tick.
"""
import argparse
import collections
import functools
import os
import struct
import sys
from concurrent.futures import ProcessPoolExecutor
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))

from oddmap import collide, fixed, records, render, well  # noqa: E402
from oddmap.disc import Disc  # noqa: E402
from oddmap.exe import Image, calls, executable  # noqa: E402
from oddmap.fixed import FP, whole  # noqa: E402
from oddmap.games import GAMES, game_setup  # noqa: E402
from oddmap.r3000 import RAM, RUN, STACK, Fault, Machine  # noqa: E402
from oddmap.render import Stage  # noqa: E402
from oddmap.sprites import read_dice  # noqa: E402

RECORDS, COLLISIONS, SPARE, LINES, HEAP, TOP = 0x80180000, 0x80181000, 0x80182000, 0x80184000, 0x80190000, 0x801F0000
ANSWER = COLLISIONS + 0x20          # where the engine's arithmetic is told to leave an answer
ROOM = 0x200                        # the room a well is built in
ANIM = int.from_bytes(b"Anim", "little")
UPDATES, DEAD = 0x20000, 0x40000    # the flags the engine's loop reads in an object's first word
LEVEL = 3                           # the level the map is stood in, which no routine run here tells from another
# where an object keeps what the engine's loop reads of it
LOOP = {"AE": dict(table=0x1C, delay=0x18), "AO": dict(table=0x0C, delay=0x04)}
# where a well and a leaf keep what the model names, beside what the render's layout places, and how each is read
WELL = {"AE": dict(scale=(0x28, "s32"), switch=(0x24, "s32"), emit=(0x3C, "r16"), leaf_x=(0x34, "s32"),
                   leaf_y=(0x38, "s32"), exit_x=(0x2C, "s32"), exit_y=(0x30, "s32")),
        "AO": dict(scale=(0xE4, "s32"), switch=(0xE0, "s32"), emit=(0xF8, "r16"), leaf_x=(0xF0, "s32"),
                   leaf_y=(0xF4, "s32"), exit_x=(0xE8, "s32"), exit_y=(0xEC, "s32"))}
LEAF = {"AE": dict(vx=(0xC4, "s32"), vy=(0xC8, "s32"), layer=(0x28, "s16"), plane=(0xD6, "s16"), red=(0xD0, "s16"),
                   green=(0xD2, "s16"), blue=(0xD4, "s16"), landed=(0xF4, "r32")),
        "AO": dict(vx=(0xAC, "s32"), vy=(0xB0, "s32"), layer=(0x18, "s16"), plane=(0xBE, "s16"), red=(0xB8, "s16"),
                   green=(0xBA, "s16"), blue=(0xBC, "s16"), landed=(0xDC, "r32"))}
PLACED = dict(x="s32", y="s32", scale="s32", level="s16", path="s16", across="s16", down="s16")
# a record's fields as the builder names them, by the model's names
FIELDS = dict(scale=("scale",), switch=("switch_id",), exit_x=("exit_x",), exit_y=("exit_y",), emit=("emit_leaves",),
              leaf_x=("leaf_x", "leaf_xpos"), leaf_y=("leaf_y", "leaf_ypos"))
RECT = ("x1", "y1", "x2", "y2")
EARLY = 19                          # a byte of the dice under ten, so that a well alone lets a leaf go at once
BY_HAND = 192                       # the ticks a well made up is run for
AWAY = 1000                         # how far right of a made-up well's corner and below it Abe is started
FAR = 30000                         # a start of Abe's and a leaf field whose sum is past sixteen bits
THROWN = (200, -2000)               # the exit that lets an Oddysee leaf go at the speed Exoddus's are thrown at
EDGE, UNDER = -1, 15                # the x, and the y, a leaf so thrown is let go at to end its first move about 0
MADE_FOR = dict(past="a leaf alive within a unit past the path's origin")
Job = collections.namedtuple("Job", "name screen on abe ticks reach")
Tally = collections.namedtuple("Tally", "cameras made_up wells ticks leaves flown rested ended past drawn steps code")
Asked = collections.namedtuple("Asked", "pairs rays crossed steps")


class Differs(Exception):
    """the disc's code and the model part ways"""


class Console:
    """a disc's wells and their leaves: the overlay over the executable in a
    machine of its own. A well's constructor runs over a record with the
    executable's constructors beneath it, and the updates and the leaf's
    constructor as the loop reaches them, with the engine's product and
    quotient, its roll of the dice, its raycast over the path's lines and its
    test of a point by the camera's window. Answered: the event, with none;
    the allocation, with room of the tool's; the resource a leaf asks for,
    with the chunk of its animation, and any other with none; the setup of an
    animation and the sound; the query of Abe's start, with the one given;
    and whatever else a constructor of the executable's calls. The list of
    objects and the pass over it are the tool's reading of the engine's loop,
    and every camera starts from the memory the disc loads."""
    def __init__(self, game, exe, blob, base, found):
        self.m, self.game, self.code = Machine(), game, found
        self.m.load(exe.load, exe.data[exe.head:])
        self.m.load(base, blob)
        self.loaded, self.chunk = bytes(self.m.mem), b""
        self.render = render.Console(self.m, found.render, game, SPARE)
        self.objects, self.wells, self.making, self.asked, self.abe, self.heap = [], [], None, [], (0, 0), HEAP
        img = Image(blob, base)
        beneath, called = [], set()
        for top in (found.construct, found.leaf):
            made = calls(img, top)
            for _ in range(3):
                if not made or not exe.holds(made[0][1]):
                    break
                beneath.append(made[0][1])
                made = calls(exe, made[0][1])
                called |= {target for _, target in made}
        called -= {found.product, found.roll, found.quotient, found.raycast, found.within}
        self.stubs = {routine: self.other for routine in called}
        self.stubs.update({routine: self.base for routine in beneath})
        self.stubs.update({found.event: self.none, found.allot: self.allot, found.resource: self.resource,
                           found.setup: self.setup, found.sound: self.none})
        if found.start:
            self.stubs[found.start] = self.start

    def none(self, m):
        return 0

    def other(self, m):
        return m.r[4] if m.r[4] >= RAM else SPARE

    def base(self, m):
        """a constructor of the executable's runs where it is handed the
        object being made, as one beneath the overlay's is"""
        return RUN if m.r[4] == self.making else self.other(m)

    def room(self, size):
        at, self.heap = self.heap, self.heap + (size + 15 & ~15)
        if self.heap > TOP:
            raise RuntimeError("the leaves outgrow the room kept for them")
        self.m.mem[at - RAM:self.heap - RAM] = bytes(self.heap - at)
        self.making = at
        self.objects.append(at)
        return at

    def allot(self, m):
        return self.room(m.r[4])

    def resource(self, m):
        a0, a1, a2 = m.r[4:7]
        rid = a1 if a0 == ANIM else a2 if a1 == ANIM else None
        if self.making in self.wells:
            return 0
        self.asked.append(rid)
        return self.render.cell

    def setup(self, m):
        self.asked.append(m.r[5])
        return 0

    def start(self, m):
        self.m.w16(m.r[5], self.abe[0])
        self.m.w16(m.r[5] + 2, self.abe[1])
        return 0

    def fresh(self):
        """the memory as the disc loads it, with the leaf's animation where
        its resource is answered from"""
        self.m.mem[:] = self.loaded
        self.render.show(self.chunk)

    def lay(self, lines):
        """a path's lines where the engine keeps one's"""
        m = self.m
        m.load(LINES, b"".join(struct.pack("<4hB", *line).ljust(20, b"\0") for line in lines))
        for at, value in enumerate((LINES, len(lines), len(lines), len(lines))):
            m.w32(COLLISIONS + 4 * at, value)
        m.w32(self.code.lines, COLLISIONS)

    def quotient(self, a, b):
        """the disc's own quotient of two 16.16 numbers"""
        m = self.m
        m.stubs = {}
        m.call(self.code.quotient, ANSWER, a, b)
        return m.s32(ANSWER)

    def ray(self, lines, x1, y1, x2, y2, kinds):
        """the disc's own answer to a ray over lines, as the model gives one"""
        m = self.m
        self.lay(lines)
        for at, value in enumerate((y2, ANSWER, ANSWER + 4, ANSWER + 8, kinds)):
            m.w32(STACK + 16 + 4 * at, value)
        m.stubs = {}
        if not m.call(self.code.raycast, COLLISIONS, x1, y1, x2) & 0xFFFF:
            return None
        return collide.Hit((m.r32(ANSWER) - LINES) // 20, m.s32(ANSWER + 4), m.s32(ANSWER + 8))

    def art(self):
        """the animation a leaf's constructor asks for, by its id: a leaf
        made for no camera, over a resource that holds nothing"""
        m = self.m
        m.mem[SPARE + 0x100 - RAM:SPARE + 0x110 - RAM] = bytes(16)
        m.w32(self.render.cell, SPARE + 0x100)
        self.objects, self.wells, self.asked, self.heap = [], [], [], HEAP
        m.w32(STACK + 16, 0)
        m.w32(STACK + 20, FP)
        m.stubs = self.stubs
        m.call(self.code.leaf, self.room(ROOM), 0, 0, 0)
        if len(self.asked) != 2 or self.asked[0] is None:
            raise RuntimeError(f"the leaf's constructor asks for {len(self.asked)} things, not a resource of "
                               "animations and its setup")
        return self.asked[0]

    def show(self, data):
        """the chunk of animations a leaf stands in: (the table its
        constructor sets it up from, the ticks a frame is held, its frames)"""
        if len(data) > LINES - self.render.data:
            raise RuntimeError("the leaf's animation outgrows the room kept for it")
        self.chunk = data
        self.table, = struct.unpack_from("<I", data, 4)
        return self.table, struct.unpack_from("<H", data, self.table)[0], render.frames(data, self.table)

    def begin(self, stage, lines, seed, on, abe):
        """a camera with nothing built: the map and the camera's window, the
        path's lines, both cursors on the seed, every switch off but the ones
        given, and Abe's start"""
        m, found = self.m, self.code
        self.objects, self.wells, self.asked, self.abe, self.heap = [], [], [], abe, HEAP
        self.fresh()
        self.render.stage(stage)
        self.lay(lines)
        m.w8(found.wells, seed)
        m.w8(found.leaves, seed)
        m.mem[found.switches - RAM:found.switches - RAM + 256] = bytes(256)
        for switch in on:
            m.w8(found.switches + switch, 1)

    def build(self, words, x, y, info):
        """a well as the disc's constructor leaves it over a record's bytes,
        handed a point"""
        m, at = self.m, RECORDS + 0x80 * len(self.wells)
        m.mem[at - RAM:at - RAM + len(words)] = words
        this = self.room(ROOM)
        self.wells.append(this)
        m.w32(STACK + 16, info)
        m.stubs = self.stubs
        m.call(self.code.construct, this, at, x, y)

    def tick(self):
        """a pass of the engine's loop, as the model's world makes it, each
        update the disc's own"""
        m, at = self.m, LOOP[self.game]
        m.stubs, k = self.stubs, 0
        while k < len(self.objects):
            obj, k = self.objects[k], k + 1
            if not m.r32(obj) & UPDATES or m.r32(obj) & DEAD:
                continue
            delay = m.r32(obj + at["delay"])
            if delay:
                m.w32(obj + at["delay"], delay - 1)
                continue
            table = m.r32(obj + at["table"])
            m.call(m.r32(table + well.SLOT), obj + m.s16(table + well.SLOT - 4))
        k = 0
        while k < len(self.objects):
            if m.r32(self.objects[k]) & DEAD:
                last = self.objects.pop()
                if k < len(self.objects):
                    self.objects[k] = last
            else:
                k += 1

    def fields(self, obj):
        """what an object holds of what the model names, and the table of
        functions it was left"""
        m, at = self.m, LOOP[self.game]
        got = dict(dead=bool(m.r32(obj) & DEAD), delay=m.r32(obj + at["delay"]))
        if obj in self.wells:
            got.update({name: getattr(m, read)(obj + where) for name, (where, read) in WELL[self.game].items()})
            return got, m.r32(obj + at["table"]) == self.code.well_table
        got.update({name: getattr(m, read)(obj + where) for name, (where, read) in LEAF[self.game].items()})
        got.update({name: getattr(m, read)(obj + self.render.at[name]) for name, read in PLACED.items()})
        return dict(got, landed=bool(got["landed"] & 1)), m.r32(obj + at["table"]) == self.code.leaf_table


def edited(game_key, held, words, **fields):
    """a well's record and its bytes with some of its fields, or sides of its
    rect, set; Oddysee keeps a copy of the corner before the rect"""
    game = game_setup(game_key)
    fmt, out, held = game["tlv"], bytearray(words), held._replace(**fields)
    layout = {name: word for word, name, *_ in game["schema"][struct.unpack_from("<I", words, 4)[0] & 0xFFFF]}
    for name, value in fields.items():
        if name not in RECT:
            word = next(layout[known] for known in FIELDS[name] if known in layout)
            struct.pack_into("<h", out, fmt["header_len"] + 2 * word, value)
    if any(name in RECT for name in fields):
        struct.pack_into("<2h", out, fmt["rect_off"] - 4 * (game_key == "AO"), held.x1, held.y1)
        struct.pack_into("<4h", out, fmt["rect_off"], held.x1, held.y1, held.x2, held.y2)
    return held, bytes(out)


def made_up(game_key, screens, ticks=BY_HAND):
    """the jobs of a well of each type alone in its camera, its record set by
    hand to what no placed one holds, Abe started away from the path's origin"""
    names, out = game_setup(game_key)["tlv_names"], []
    for express in (False, True):
        screen, (place, cell, held, words) = next(
            (screen, found) for screen in screens for found in screen.wells
            if found[2].express == express and well.lets(found[2]) and not found[2].switch)
        exits = game_key == "AO" or express
        abe = (held.x1 + AWAY, held.y1 + AWAY)
        x, y = (40 - AWAY, -20 - AWAY) if game_key == "AE" else (held.x1 + 40, held.y1 - 20)
        thrown = dict(scale=0, leaf_x=0, leaf_y=0, **(dict(zip(("exit_x", "exit_y"), THROWN)) if exits else {}))
        lower, origin = well.LOWER[game_key], dict(left=0, top=0, floors=[])
        sets = [("with its leaf's x set", dict(leaf_x=x)), ("with its leaf's y set", dict(leaf_y=y)),
                ("with its leaf's point set", dict(leaf_x=x, leaf_y=y)),
                ("told to let leaves go by 2", dict(emit=2)), ("told to by -1", dict(emit=-1)),
                ("told not to", dict(emit=0)), ("on the switch that always reads on", dict(switch=well.ALWAYS)),
                ("on a switch read off", dict(switch=2)), ("on a switch written on", dict(switch=2), dict(on=(2,))),
                ("on the last switch, written on", dict(switch=255), dict(on=(255,))),
                ("at its other scale", dict(scale=int(not held.scale))), ("at a scale that is neither", dict(scale=2)),
                ("with its rect left of the path's origin, its sides an odd sum", dict(x1=-31, x2=-10)),
                ("with its leaves let go on the left edge of a window at the path's origin",
                 dict(thrown, x1=2 * EDGE - 12, x2=12, y1=120 - lower), dict(origin, reach="past", ticks=4 * ticks)),
                ("with its leaves let go under the top edge of a window at the path's origin",
                 dict(thrown, x1=100, x2=125, y1=UNDER - lower), dict(origin, reach="past", ticks=4 * ticks))]
        if game_key == "AE":
            sets.append(("with its leaf's point past sixteen bits from Abe's start", dict(leaf_x=FAR, leaf_y=FAR),
                         dict(abe=(FAR, FAR))))
        if exits:
            sets += [("with its exit leading down", dict(exit_y=1500)),
                     ("with its exit leading down at its other scale", dict(exit_y=1500, scale=int(not held.scale))),
                     ("with its exit still", dict(exit_x=0, exit_y=0)),
                     ("with its exit at odd speeds", dict(exit_x=777, exit_y=-2501)),
                     ("with its exit barely moving", dict(exit_x=-1, exit_y=-333))]
        for name, fields, *more in sets:
            more = {**dict(on=(), reach="", ticks=ticks, left=screen.left, top=screen.top, floors=screen.floors,
                           abe=abe), **(more[0] if more else {})}
            alone = screen._replace(seed=EARLY, wells=[(place, cell) + edited(game_key, held, words, **fields)],
                                    left=more["left"], top=more["top"], floors=more["floors"])
            out.append(Job(f"a {names[struct.unpack_from('<I', words, 4)[0] & 0xFFFF]} {name}", alone, more["on"],
                           more["abe"], more["ticks"], more["reach"]))
    return out


def run(game_key, console, shown, dice, job):
    """a camera's run on the disc's code and on the model: what it covered"""
    screen, (table, hold, frames) = job.screen, shown
    stage = Stage(screen.left, screen.top, LEVEL, screen.path)
    where = f"{job.name or 'the camera'} of {screen.short} P{screen.path} cell {screen.cell}"

    def differ(when, what, disc, ours):
        if disc != ours:
            raise Differs(f"{where}, {when}: {what}: the disc's {disc}, the model's {ours}")

    def compare(when):
        differ(when, "the wells' cursor", console.m.r8(console.code.wells), world.wells)
        differ(when, "the leaves' cursor", console.m.r8(console.code.leaves), world.leaves)
        differ(when, "how many objects the list holds", len(console.objects), len(world.objects))
        for k, (obj, ours) in enumerate(zip(console.objects, world.objects)):
            got, tabled = console.fields(obj)
            differ(when, f"object {k}'s kind", obj in console.wells, isinstance(ours, well.Well))
            differ(when, f"object {k}'s table of functions being its own", tabled, True)
            for name, value in got.items():
                differ(when, f"object {k}'s {name}", value, getattr(ours, name))

    console.begin(stage, screen.floors, screen.seed, job.on, job.abe)
    world = well.World(game_key, dice, screen.floors, stage, job.abe, screen.seed, screen.seed, job.on)
    for k, (_, _, held, words) in enumerate(screen.wells):
        point = well.handed(game_key, held)
        console.build(words, *point, 0x4000 + k)
        well.Well(world, held, *point)
    compare("as constructed")
    born, before = {}, console.m.steps
    seen = dict(rested=0, ended=0, past=0, flown=0, drawn=0)
    for tick in range(1, job.ticks + 1):
        when, flying = f"tick {tick}", world.objects[len(screen.wells):]
        try:
            console.tick()
        except Fault as e:
            raise Fault(f"{where}, {when}: {e}") from None
        world.tick()
        compare(when)
        if any(asked != table for asked in console.asked[1::2]):
            raise Differs(f"{where}, {when}: a leaf is set up from another table than its chunk names")
        seen["ended"] += sum(leaf.dead and render.side((whole(leaf.x), whole(leaf.y)) * 2, stage) == render.ON
                             for leaf in flying)
        for obj, leaf in list(zip(console.objects, world.objects))[len(screen.wells):]:
            first, was = born.get(obj, (tick, False))
            born[obj] = first, leaf.landed
            at, sprite = (tick - first) // hold % len(frames), leaf.sprite()
            console.render.stand(obj, table, at, sprite)
            ours = render.render(frames[at], sprite, stage) is not None
            differ(when, f"whether the render draws the leaf at {leaf.x / FP},{leaf.y / FP}",
                   console.render.draws(obj), ours)
            for name, counted in (("rested", leaf.landed and not was), ("past", leaf.x < 0 or leaf.y < 0),
                                  ("flown", True), ("drawn", ours)):
                seen[name] += counted
    if job.reach and not seen[job.reach]:
        raise Differs(f"{where}: made up for {MADE_FOR[job.reach]}, and its run holds none")
    return Tally(int(not job.name), int(bool(job.name)), len(screen.wells), job.ticks, len(console.asked) // 2,
                 steps=console.m.steps - before, code=console.code, **seen)


def asked(console):
    """a disc's quotient and raycast asked directly for the pairs and rays
    set by hand, beside the models: what was asked"""
    console.fresh()
    before, pairs, thrown, crossed = console.m.steps, fixed.by_hand(), 0, 0
    for a, b in pairs:
        disc, ours = console.quotient(a, b), fixed.fpdiv(a, b)
        if disc != ours:
            raise Differs(f"the quotient of {a} by {b}: the disc's {disc}, the model's {ours}")
    for lines, rays in collide.by_hand():
        for ray, kinds in rays:
            disc, ours = console.ray(lines, *ray, kinds), collide.raycast(lines, *ray, kinds)
            if disc != ours:
                raise Differs(f"the ray {ray} asked for the kinds {kinds:#x} over {lines}: the disc's {disc}, "
                              f"the model's {ours}")
            thrown, crossed = thrown + 1, crossed + (ours is not None)
    return Asked(len(pairs), thrown, crossed, console.m.steps - before)


@functools.lru_cache(maxsize=None)
def opened(image, game_key, ovl, base):
    """an overlay's wells in a machine, kept between a worker's cameras"""
    disc = Disc(image)
    exe, blob = Image(executable(disc)[1]), disc.read(*disc.files[ovl])
    console = Console(game_key, exe, blob, base, well.code(blob, base, exe))
    data = render.art(records.archives([disc], game_setup(game_key)), console.art())
    return console, console.show(data), read_dice(disc)


def check(work):
    """a camera's run in an overlay, or with no camera the asking of its
    disc's arithmetic: what it covered, or how it failed"""
    image, game_key, ovl, base, job = work
    try:
        console, shown, dice = opened(image, game_key, ovl, base)
        return run(game_key, console, shown, dice, job) if job else asked(console)
    except (Differs, Fault, RuntimeError, ValueError) as e:
        return str(e)


def report(disc, ovl, got):
    """an overlay's line of the report, and whether its runs agree"""
    errors = [r for r in got if isinstance(r, str)]
    if errors or not got:
        return f"{disc} {ovl}: {errors[0] if errors else 'no camera was dealt it'}", False
    total = {name: sum(getattr(r, name) for r in got) for name in Tally._fields[:-1]}
    code = got[0].code
    return (f"{disc} {ovl}: the disc's code and the model agree over {total['cameras']} cameras and {total['made_up']} "
            f"wells made up, {total['wells']} wells in all and {total['ticks']:,} ticks, {total['leaves']:,} leaves "
            f"let go, {total['rested']:,} come to rest and {total['ended']:,} ended on a floor of the plane in "
            f"front, {total['past']:,} ticks flown within a unit past the path's origin, {total['drawn']:,} of their "
            f"{total['flown']:,} ticks drawn, in {total['steps']:,} instructions; well's update {code.update:#x}, "
            f"leaf's {code.fly:#x}"), True


def answered(disc, got):
    """a disc's line on its arithmetic, and whether it agrees"""
    if isinstance(got, str):
        return f"{disc}: {got}", False
    return (f"{disc}: the engine's quotient and raycast agree with the models over {got.pairs} pairs and {got.rays} "
            f"rays, {got.crossed} of them crossing a line, in {got.steps:,} instructions"), True


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--game", choices=sorted(GAMES), required=True)
    ap.add_argument("--disc", nargs="+", help="the game's disc images, both of Exoddus's "
                    "(default $ODDWORLD_DISC_AO or $ODDWORLD_DISC_AE)")
    ap.add_argument("--overlay", action="append",
                    help="an overlay to run, as often as wanted (default every one holding the routines)")
    ap.add_argument("--ticks", type=int, default=1024,
                    help="the ticks a placed camera is run for, at least one (default 1024, four turns of the dice)")
    args = ap.parse_args(argv)
    env = GAMES[args.game]["env"]
    images = args.disc or [p for p in os.environ.get(env, "").split(os.pathsep) if p]
    if not images:
        ap.error(f"no disc image: pass --disc or set ${env}")
    if args.ticks < 1:
        ap.error("--ticks is at least one")
    discs = [Disc(image) for image in images]
    screens = well.placed(discs, args.game)
    if not screens:
        sys.exit("the discs place no well that lets leaves go")
    jobs = [Job("", screen, (), (0, 0), args.ticks, "") for screen in screens] + made_up(args.game, screens)
    holders = []
    for image, disc in zip(images, discs):
        name = executable(disc)[0]
        try:
            blobs, base = well.overlays(disc, args.game)
        except RuntimeError as e:
            sys.exit(f"{name}: {e}")
        holders += [(image, name, ovl, base) for ovl in blobs if not args.overlay or ovl in args.overlay]
    missing = sorted(set(args.overlay or ()) - {ovl for _, _, ovl, _ in holders})
    if missing or not holders:
        sys.exit(f"no well's leaves in {', '.join(missing) or 'any overlay of the discs'}")
    dealt = [holders[k % len(holders)] for k in range(len(jobs))]
    firsts = [next(held for held in holders if held[0] == image) for image in images
              if image in {held[0] for held in holders}]
    with ProcessPoolExecutor() as pool:
        results = list(pool.map(check, [(image, args.game, ovl, base, job) for (image, _, ovl, base), job
                                        in zip(dealt + firsts, jobs + [None] * len(firsts))], chunksize=1))
    lines = [report(name, ovl, [r for held, r in zip(dealt, results) if held == (image, name, ovl, base)])
             for image, name, ovl, base in holders]
    lines += [answered(name, got) for (_, name, _, _), got in zip(firsts, results[len(jobs):])]
    for line, _ in lines:
        print(line)
    failed = sum(not ok for _, ok in lines)
    if failed:
        sys.exit(f"{failed} of {len(lines)} lines differ from the model or would not run")


if __name__ == "__main__":
    main()
