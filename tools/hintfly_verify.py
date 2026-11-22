#!/usr/bin/env python3
"""Run a disc's own hint fly beside the model of it: the routines of every
overlay holding them, found by their shape and run in tools/oddmap/r3000.py's
interpreter, against tools/oddmap/hintfly.py over the same chants, comparing
every field of the object and of each of its flies after every tick, both
dice cursors, the sounds asked of the engine's player and the sprites handed
to the engine.

    python3 tools/hintfly_verify.py                       # every overlay, every message
    python3 tools/hintfly_verify.py --overlay E3.OVL --message 10 --ticks 900
    python3 tools/hintfly_verify.py --disc <a release's image> --seed 7

--disc defaults to $ODDWORLD_DISC_AO. Each message the overlay's alphabet
spells is run from cursors and at a point drawn from --seed, the same every
time: first under a chant held until the message is spelled through and the
swarm has twice formed the nothing that follows it, then for --ticks more
under one that comes and goes. What a run meets too seldom to count on is put
there: the chant is broken once on a tick the swarm reaches a word's size,
and the last eight flies of every word are stood by their dots, four a whole
pixel off either way across and down, which fly on past, and four a fraction
nearer, which arrive.

The disc's code is what answers here: the model is right as far as the two
agree, and the first thing they differ on is named with its message and tick.
The numbers a word is laid out and held by are the overlay's own, read off its
code and named in its line; every other number is the model's.
"""
import argparse
import functools
import os
import sys
from concurrent.futures import ProcessPoolExecutor
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))

from oddmap import hintfly  # noqa: E402
from oddmap.disc import Disc  # noqa: E402
from oddmap.exe import Image, executable  # noqa: E402
from oddmap.games import GAMES  # noqa: E402
from oddmap.hintfly import FP, HOLD, IDLE, LOOPING, PAUSE, RESIZE, RESIZE_BY, SWARM, TO_DOT, UNWIND  # noqa: E402
from oddmap.r3000 import RUN, Fault, Machine, signed  # noqa: E402
from oddmap.sprites import read_dice  # noqa: E402

THIS, FLIES, SCREEN, ORDER, BANK = 0x80180000, 0x80181000, 0x80190000, 0x80191000, 0x80192000
# where the object and each of its flies keep what the model names, and how each is read
OBJECT = {"timer": (0xFC, "s32"), "state": (0x102, "s16"), "count": (0x108, "s16"), "allocated": (0x10A, "s16"),
          "pos": (0x10E, "s16"), "renewed": (0x110, "s16"), "target": (0x112, "s16")}
FLY = {"x": (0, "s32"), "y": (4, "s32"), "mode": (8, "r8"), "vx": (12, "s32"), "vy": (16, "s32"),
       "tx": (20, "s32"), "ty": (24, "s32"), "pitch": (28, "s16"), "pitch_step": (30, "s16"),
       "angle": (32, "r8"), "speed": (33, "r8")}
SWARM_AT, POINT, MESSAGE = 0xE0, 0x104, 0x10C
FLY_SIZE, CORNER = 76, 8
CHANT = 8
UNPITCHED = 0x7FFF
STATES = {IDLE: "idle", RESIZE: "resize", PAUSE: "pause", HOLD: "hold", UNWIND: "unwind"}
CHANGES = {(IDLE, PAUSE), (PAUSE, RESIZE), (PAUSE, UNWIND), (RESIZE, HOLD), (RESIZE, UNWIND), (HOLD, PAUSE),
           (HOLD, UNWIND), (UNWIND, IDLE)}
POINTS = ((6, 4), (184, 120), (330, 200))
SHORT = ((FP, 0), (-FP, 0), (0, FP), (0, -FP), (FP - 1, 0), (1 - FP, 0), (0, FP - 1), (0, 1 - FP))
ENDLESS = 20_000


class Differs(Exception):
    """the disc's code and the model part ways"""


class Console:
    """a disc's hint fly: its overlay over the executable in a machine of its
    own, the object laid out in spare memory, and what its routines reach for
    beyond the engine's arithmetic answered here: the event query, the voices
    the engine's player plays on and the engine's drawing. The player itself
    runs, seen as it is called."""
    def __init__(self, exe, blob, base, code):
        self.m, self.code = Machine(), code
        self.m.load(exe.load, exe.data[exe.head:])
        self.m.load(base, blob)
        self.chant, self.sounds, self.drawn = False, [], []
        self.updating = {f: self.silent for f in code.voices}
        self.updating.update({code.event: self.event, code.player: self.sound})
        self.drawing = {f: self.handed for f in code.drawing}

    def event(self, m):
        return THIS if m.r[4] == CHANT and self.chant else 0

    def sound(self, m):
        volume, low, high = (signed(v & 0xFFFF, 16) for v in m.r[5:8])
        self.sounds.append((volume, None if low == high == UNPITCHED else low))
        return RUN

    def silent(self, m):
        return 0

    def handed(self, m):
        self.drawn.append(m.r[5])

    def lay_out(self, x, y, message):
        m = self.m
        m.w32(THIS + SWARM_AT, FLIES)
        m.w16(THIS + POINT, x)
        m.w16(THIS + POINT + 2, y)
        m.w16(THIS + MESSAGE, message)
        m.w16(THIS + OBJECT["count"][0], SWARM)
        m.w16(THIS + OBJECT["pos"][0], 0)
        m.w32(self.code.screen, SCREEN)
        m.w32(self.code.bank, BANK)

    def build(self, x, y, message):
        """leave the object as its constructor does, short of the engine's own
        parts of it"""
        m = self.m
        self.lay_out(x, y, message)
        m.call(self.code.longest, THIS)
        m.w16(THIS + OBJECT["state"][0], IDLE)
        m.w32(THIS + OBJECT["timer"][0], 0)
        for i in range(SWARM):
            m.call(self.code.init, THIS, FLIES + FLY_SIZE * i)

    def tick(self, frame, chant):
        self.chant, self.sounds = chant, []
        self.m.w32(self.code.frame, frame)
        self.m.stubs = self.updating
        self.m.call(self.code.update, THIS)

    def render(self):
        """the corner of each sprite of a fly's the engine is handed, in that order"""
        self.drawn = []
        self.m.stubs = self.drawing
        self.m.call(self.code.render, THIS, ORDER)
        return [(self.m.s16(a + CORNER), self.m.s16(a + CORNER + 2)) for a in self.drawn if FLIES <= a < SCREEN]

    def object(self):
        return {name: getattr(self.m, read)(THIS + at) for name, (at, read) in OBJECT.items()}

    def fly(self, i):
        return {name: getattr(self.m, read)(FLIES + FLY_SIZE * i + at) for name, (at, read) in FLY.items()}

    def place(self, i, x, y):
        self.m.w32(FLIES + FLY_SIZE * i + FLY["x"][0], x)
        self.m.w32(FLIES + FLY_SIZE * i + FLY["y"][0], y)

    def cursors(self):
        """(the flies' own cursor, the dice's): the one byte a fly's setup
        stores to outside its fly, and the one byte a roll does"""
        m = self.m
        self.lay_out(0, 0, 0)
        found = []
        for routine, args in ((self.code.init, (THIS, FLIES)), (self.code.roll, (0, 100))):
            m.stores = set()
            m.call(routine, *args)
            found.append({a for a in m.stores if a < THIS})
        m.stores = None
        if [len(stored) for stored in found] != [1, 1]:
            raise RuntimeError(f"a fly's setup stores to {len(found[0])} bytes outside its fly and a roll of the dice "
                               f"to {len(found[1])}, expected one each")
        return found[0].pop(), found[1].pop()


def chants(seed, ticks):
    """whether Abe chants at each of the ticks: spans off and on, of lengths drawn from seed"""
    out, on = [], False
    while len(out) < ticks:
        seed = (seed * 1103515245 + 12345) & 0x7FFFFFFF
        out += [on] * (1 + (seed >> 16) % (240 if on else 40))
        on = not on
    return out[:ticks]


def compare(where, console, model, own, dice):
    def differ(what, disc, ours):
        if disc != ours:
            raise Differs(f"{where}: {what}: the disc's {disc}, the model's {ours}")
    for name, value in console.object().items():
        differ(f"the object's {name}", value, getattr(model, name))
    differ("the flies' cursor", console.m.r8(own), model.world.own)
    differ("the dice's cursor", console.m.r8(dice), model.world.dice)
    for i, fly in enumerate(model.flies):
        for name, value in console.fly(i).items():
            differ(f"fly {i}'s {name}", value, getattr(fly, name))
    differ("the sounds, each its volume and pitch", console.sounds, model.world.sounds)
    handed, ours = console.render(), model.sprites()
    differ("the sprites handed to the engine", len(handed), len(ours))
    for i, corners in enumerate(zip(handed, ours)):
        differ(f"sprite {i}'s corner", *corners)


def run(exe, blob, base, code, tables, message, ticks, seed):
    """a message's run on the disc's code and on the model: (the changes of
    state it made, the words it formed, how many of them a breaking chant let
    go of, the instructions it took)"""
    own, dice = Console(exe, blob, base, code).cursors()
    console = Console(exe, blob, base, code)
    console.m.w8(own, seed * 29 + message)
    console.m.w8(dice, seed * 31 + message)
    world = hintfly.World(tables, console.m.r8(own), console.m.r8(dice))
    point = POINTS[(message + seed) % len(POINTS)]
    model = hintfly.HintFly(world, *point, message)
    console.build(*point, message)
    compare(f"message {message} as constructed", console, model, own, dice)
    changes, dropped, through, cut, heard = set(), 0, False, False, chants(seed * 36 + message, ticks)
    while heard:
        chant = heard.pop(0) if through else world.frame > 0
        if through and chant and not cut and model.state == RESIZE and 0 < abs(model.target - model.count) <= RESIZE_BY:
            chant, cut = False, True
        where = f"message {message}, tick {world.frame + 1}"
        was, formed = model.state, len(model.words)
        standing = any(fly.mode != LOOPING for fly in model.flies[:model.count])
        world.frame, world.chant, world.sounds = world.frame + 1, chant, []
        try:
            console.tick(world.frame, chant)
            model.update()
            compare(where, console, model, own, dice)
        except Fault as e:
            raise Fault(f"{where}: {e}") from None
        if model.state != was:
            changes.add((was, model.state))
            dropped += model.state == UNWIND and standing
        if len(model.words) > formed:
            through = through or [word for _, word in model.words[-2:]] == ["", ""]
            bound = [i for i, fly in enumerate(model.flies[:model.count]) if i and fly.mode == TO_DOT]
            for i, (across, down) in zip(bound[-len(SHORT):], SHORT):
                fly = model.flies[i]
                fly.x, fly.y = fly.tx - across, fly.ty - down
                console.place(i, fly.x, fly.y)
        if not through and world.frame > ENDLESS:
            raise RuntimeError(f"message {message} has not ended in {ENDLESS} ticks of a held chant")
    return changes, sum(1 for _, word in model.words if word), dropped, console.m.steps


@functools.lru_cache(maxsize=None)
def opened(path, ovl, base):
    """an overlay's hint fly, kept between a worker's messages"""
    disc = Disc(path)
    exe, blob = Image(executable(disc)[1]), disc.read(*disc.files[ovl])
    code = hintfly.code(blob, base, exe)
    return exe, blob, code, hintfly.tables(read_dice(disc), blob, base, hintfly.spelling(blob, base, code))


def check(job):
    """a message's run in an overlay: what it covered and where the routines
    lie, or how it failed"""
    path, ovl, base, message, ticks, seed = job
    try:
        exe, blob, code, tables = opened(path, ovl, base)
    except RuntimeError as e:
        return str(e)
    try:
        return run(exe, blob, base, code, tables, message, ticks, seed) + (code, tables.spelling)
    except Differs as e:
        return str(e)
    except (Fault, RuntimeError, ValueError) as e:
        return str(e) if str(e).startswith("message ") else f"message {message}: {e}"


def spelled(tables):
    """the messages the alphabet spells, by id"""
    world = hintfly.World(tables, 0, 0)
    out = []
    for i, text in enumerate(tables.messages):
        try:
            for char in text.replace(" ", ""):
                world.letter(char)
            out.append(i)
        except ValueError:
            pass
    return out


def report(ovl, got, unspelled):
    """an overlay's line of the report, and whether its runs agree"""
    errors = [r for r in got if isinstance(r, str)]
    if errors or not got:
        return f"{ovl}: {errors[0] if errors else 'its alphabet spells none of its messages'}", False
    unseen = ", ".join(f"{STATES[a]} to {STATES[b]}" for a, b in sorted(CHANGES - set().union(*(r[0] for r in got))))
    code, spelling = got[0][4:]
    return (f"{ovl}: the disc's code and the model agree over {len(got)} message{'s' * (len(got) != 1)}, "
            f"{sum(r[1] for r in got)} words "
            f"formed and {sum(r[2] for r in got)} of them let go of, "
            f"{'every change of state' if not unseen else 'the changes of state but ' + unseen}, in "
            f"{sum(r[3] for r in got):,} instructions; dots {spelling.dot:#x} apart, letters {spelling.letter}, words "
            f"held {spelling.hold}; update {code.update:#x}, render {code.render:#x}"
            + (f"; {unspelled} messages spell outside the alphabet and are left unrun" if unspelled else "")), True


def main(argv=None):
    env = GAMES["AO"]["env"]
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--disc", default=os.environ.get(env), help=f"an Oddysee disc image (default ${env})")
    ap.add_argument("--overlay", action="append",
                    help="an overlay to run, as often as wanted (default every one holding the routines)")
    ap.add_argument("--message", action="append", type=int,
                    help="a message to run by its id, as often as wanted (default every one the alphabet spells)")
    ap.add_argument("--ticks", type=int, default=200,
                    help="the ticks a chant comes and goes for, at least one (default 200)")
    ap.add_argument("--seed", type=int, default=1)
    args = ap.parse_args(argv)
    if not args.disc:
        ap.error(f"no disc image: pass --disc or set ${env}")
    if args.ticks < 1:
        ap.error("--ticks is at least one")
    disc = Disc(args.disc)
    try:
        blobs, base = hintfly.overlays(disc)
    except RuntimeError as e:
        sys.exit(f"{executable(disc)[0]}: {e}")
    overlays = list(dict.fromkeys(args.overlay or blobs))
    missing = sorted(set(overlays) - set(blobs))
    if missing or not blobs:
        sys.exit(f"no hint fly in {', '.join(missing) or 'any overlay the paths load'}")
    dice, jobs, unspelled = read_dice(disc), [], {}
    for ovl in overlays:
        try:
            tables = hintfly.tables(dice, blobs[ovl], base)
        except RuntimeError as e:
            sys.exit(f"{ovl}: {e}")
        ids = spelled(tables)
        unspelled[ovl] = len(tables.messages) - len(ids)
        for message in dict.fromkeys(args.message or ids):
            if not 0 <= message < len(tables.messages):
                sys.exit(f"{ovl} holds no message {message}")
            if message not in ids:
                sys.exit(f"{ovl}'s alphabet does not spell message {message}")
            jobs.append((args.disc, ovl, base, message, args.ticks, args.seed))
    with ProcessPoolExecutor() as pool:
        results = list(pool.map(check, jobs))
    lines = [report(ovl, [r for job, r in zip(jobs, results) if job[1] == ovl], unspelled[ovl]) for ovl in overlays]
    for line, _ in lines:
        print(line)
    failed = sum(not ok for _, ok in lines)
    if failed:
        sys.exit(f"{failed} of {len(lines)} overlays differ from the model or would not run")


if __name__ == "__main__":
    main()
