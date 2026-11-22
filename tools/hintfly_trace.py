#!/usr/bin/env python3
"""Print a run of the PlayStation's hint fly under the map's chant, off the
model in tools/oddmap/hintfly.py: what tests/unit/hintfly.test.js holds the
viewer's hint flies to.

    python3 tools/hintfly_trace.py 10 150 --chant 10 --shots 54,120
    python3 tools/hintfly_trace.py 5 200 --chant 10,70,95
    python3 tools/hintfly_trace.py 1 200 --chant 2 --seed 136
    python3 tools/hintfly_trace.py 5 300 --at 6,4 --shots 1,64,300

A message id and a count of ticks, then: --chant, the ticks the chant flips
on, rising from 2, the first the map can hear one on; --shots, the ticks to
print every sprite's corner at, about the hint's point and in fly order;
--seed, the byte both dice cursors start from (default 37, where the overlays
start the flies'); --at, the hint's point on its screen (default 180,120,
and --at=-6,4 for one left of its screen's corner). The tables are the ones
the viewer ships for the base game, or a disc's own with --disc, read off the
first overlay holding them or the one --overlay names, the numbers it spells
by off its code.

The chant is the map's, not the console's: a hint with no message hears none,
and one that has spelled every word of its message lets go by itself as the
last word's hold ends and is heard again once the swarm is at rest, where the
console's goes on for as long as Abe chants.

Prints JSON: the message; `line`, the object's state and its count of flies by
the ticks each lasts; `words`, each word with the tick it forms on; `sum`,
folded over every corner of every tick; `rolls`, folded over both dice cursors
after every tick; `own` and `dice`, where the two cursors end; and `shots`.
"""
import argparse
import json
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))

from oddmap import hintfly  # noqa: E402
from oddmap.disc import Disc  # noqa: E402
from oddmap.exe import Image, executable  # noqa: E402
from oddmap.paths import SITE  # noqa: E402
from oddmap.sprites import read_dice  # noqa: E402


def committed():
    """the tables the viewer ships for the base game"""
    dice = json.loads((SITE / "sprites_ao.json").read_text())["dice"]
    messages = json.loads((SITE / "messages_ao.json").read_text())
    return hintfly.Tables(dice, [bytes.fromhex(dots) for dots in messages["alphabet"]], messages["hintfly"])


def trace(tables, message, ticks, flips=(), shots=(), seed=37, at=(180, 120)):
    """a run of the model under the map's chant, as the JSON's object"""
    world = hintfly.World(tables, seed, seed)
    model = hintfly.HintFly(world, at[0], at[1], message)
    words = model.message.split(" ") if model.message else []
    spelled, begun, line, total, rolls, shot = False, 0, [], 0, 0, {}
    for frame in range(1, ticks + 1):
        world.frame = frame
        held = bool(words) and sum(flip <= frame for flip in flips) % 2 == 1
        if (held and model.state == hintfly.HOLD and model.timer < frame
                and len(model.words) - begun >= len(words)):
            spelled = True
        world.chant = held and not spelled
        model.update()
        if model.state == hintfly.IDLE:
            spelled, begun = False, len(model.words)
        key = f"{model.state}:{model.count}"
        if line and line[-1][0] == key:
            line[-1][1] += 1
        else:
            line.append([key, 1])
        corners = [(x - at[0], y - at[1]) for x, y in model.sprites()]
        for i, (x, y) in enumerate(corners):
            total = (total * 31 + (x & 0xFFFF) * 7 + (y & 0xFFFF) + i) & 0xFFFFFFFF
        rolls = (rolls * 31 + world.own * 256 + world.dice) & 0xFFFFFFFF
        if frame in shots:
            shot[frame] = " ".join(f"{x},{y}" for x, y in corners)
    return {"message": model.message, "line": " ".join(f"{key}x{n}" for key, n in line),
            "words": [[frame, word] for frame, word in model.words], "sum": total, "rolls": rolls,
            "own": world.own, "dice": world.dice, "shots": shot}


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("message", type=int)
    ap.add_argument("ticks", type=int)
    ap.add_argument("--chant", default="")
    ap.add_argument("--shots", default="")
    ap.add_argument("--seed", type=int, default=37)
    ap.add_argument("--at", default="180,120")
    ap.add_argument("--disc", help="an Oddysee disc image to read the tables off, in place of the viewer's")
    ap.add_argument("--overlay", help="with --disc, the overlay to read them off")
    args = ap.parse_args(argv)

    def numbers(option):
        try:
            return [int(v) for v in getattr(args, option).split(",") if v]
        except ValueError:
            ap.error(f"--{option} takes whole numbers between commas")

    flips, shots, at = numbers("chant"), numbers("shots"), numbers("at")
    if args.ticks < 1:
        ap.error("ticks is at least one")
    if flips != sorted(set(flips)) or flips and flips[0] < 2:
        ap.error("--chant takes ticks that rise from 2, the first tick the map can hear a chant on")
    if any(not 1 <= tick <= args.ticks for tick in shots):
        ap.error("--shots takes ticks of the run")
    if not 0 <= args.seed <= 255:
        ap.error("--seed is a byte")
    if len(at) != 2 or any(abs(v) > 0x4000 for v in at):
        ap.error("--at takes a point as x,y, of a screen or near one")
    if args.overlay and not args.disc:
        ap.error("--overlay names an overlay of the disc --disc gives")
    try:
        if args.disc:
            disc = Disc(args.disc)
            blobs, base = hintfly.overlays(disc)
            ovl = args.overlay or next(iter(blobs), None)
            if ovl not in blobs:
                sys.exit(f"no hint fly in {ovl or 'any overlay the paths load'}")
            code = hintfly.code(blobs[ovl], base, Image(executable(disc)[1]))
            numbers = hintfly.spelling(blobs[ovl], base, code)
            tables = hintfly.tables(read_dice(disc), blobs[ovl], base, numbers)
        else:
            tables = committed()
        if not 0 <= args.message < len(tables.messages):
            sys.exit(f"there is no message {args.message}")
        out = trace(tables, args.message, args.ticks, flips, shots, args.seed, at)
    except (RuntimeError, ValueError) as e:
        sys.exit(str(e))
    print(json.dumps(out, indent=1))


if __name__ == "__main__":
    main()
