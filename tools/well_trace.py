#!/usr/bin/env python3
"""Print what the wells a game places let go, off the model in
tools/oddmap/well.py: what the tests of tests/unit/well.test.js that read the
shipped data hold the viewer's leaves to.

    python3 tools/well_trace.py AE
    python3 tools/well_trace.py AO L1 1 3 --ticks 17,18,19,20
    python3 tools/well_trace.py AE SV 1 43,44,49,50 --ticks 300,600,1024

A game, then either nothing, for every camera whose wells let leaves go, or a
level, a path and the places of wells among that path's objects, for those
wells' own leaves at the ticks --ticks names. The tables are the ones the
viewer ships: the records, lines and cells of map_data_*.json and the dice
and Abe's starts of sprites_*.json.

Three readings in it are the map's and live here, not in the model. A camera
is read as freshly loaded, both cursors started from the place among its
path's objects of the first of its wells that lets leaves go, where an overlay
starts them at 4 and 8. A well lets leaves go where a fresh game has it do so,
told to and on no switch or the one that always reads on. And a leaf is its
well's own, which the game's list of objects does not say.

Prints JSON. For a game: `ticks`, how long each camera is watched (default
1024, four turns of the dice); `wells` and `cameras`, how many let leaves go
and how many screens they stand on; `screens`, how many of those hold one such
well, two, three and four; `made`, the leaves let go; `flown`, how many leaves
the ticks end with between them, and the sums of those leaves' x and y in
16.16; `never`, the wells none of whose leaves outlives the tick that makes
it; `down`, the wells whose leaves leave downward or level; and `grounded`,
the others one of whose leaves never rises above where it is let go. For
wells: `leaves`, by tick and then by well, each of the well's own leaves as x
and y in 16.16, in the order of the game's list; and `sums`, by tick, how many
those are and the sums of their x and y.
"""
import argparse
import collections
import json
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))

from oddmap import render, well  # noqa: E402
from oddmap.games import GAMES  # noqa: E402
from oddmap.paths import SITE  # noqa: E402
from oddmap.release import filed_cell  # noqa: E402

TICKS = 1024

Tables = collections.namedtuple("Tables", "screens dice abe")


class Owning(well.Well):
    """a well that knows the leaves it lets go"""
    def __init__(self, *args):
        super().__init__(*args)
        self.let = []

    def update(self):
        before = len(self.world.objects)
        super().update()
        self.let += self.world.objects[before:]


def committed(game_key):
    """the tables the viewer ships for a game: the cameras whose wells let
    leaves go, each well the object the map holds, the dice, and Abe's start
    by level and path"""
    lower = game_key.lower()
    data = json.loads((SITE / f"map_data_{lower}.json").read_text())
    sprites = json.loads((SITE / f"sprites_{lower}.json").read_text())
    paths = []
    for lvl in data["levels"]:
        for path in lvl["paths"]:
            wells = [(place, filed_cell(t, path["w"], GAMES[game_key]), well.record(t), t)
                     for place, t in enumerate(path["tlvs"]) if t["name"] in well.NAMES[game_key]]
            if wells:
                paths.append((lvl["short"], path["id"], path["w"], path["lines"], wells))
    return Tables(well.screens(game_key, paths), sprites["dice"], sprites.get("abe") or {})


def camera(tables, game_key, screen):
    """(a camera's world, its wells) as the model builds them"""
    abe = tables.abe.get(screen.short, {}).get(str(screen.path), (0, 0))
    world = well.World(game_key, tables.dice, screen.floors, render.Stage(screen.left, screen.top, path=screen.path),
                       tuple(abe), screen.seed, screen.seed)
    return world, [Owning(world, held, *well.handed(game_key, held)) for _, _, held, _ in screen.wells]


def named(game_key, screen, t):
    return f"{game_key} {screen.short} P{screen.path} ({t['x1']},{t['y1']})"


def sweep(tables, game_key, ticks=TICKS):
    """every camera of a game under the model, as the JSON's object"""
    screens, made, every, never, down, grounded = [0, 0, 0, 0], 0, [0, 0, 0], [], [], []
    held_for = int(game_key == "AE")
    for screen in tables.screens:
        world, wells = camera(tables, game_key, screen)
        letting = [(model, t) for model, (_, _, held, t) in zip(wells, screen.wells) if well.lets(held)]
        screens[len(letting) - 1] += 1
        seen, top = {}, {}
        for _ in range(ticks):
            world.tick()
            for leaf in world.objects[len(wells):]:
                seen[leaf] = seen.get(leaf, 0) + 1
                top[leaf] = min(top.get(leaf, leaf.y), leaf.y)
                every = [every[0] + 1, every[1] + leaf.x, every[2] + leaf.y]
        for model, t in letting:
            made += len(model.let)
            flown = [leaf for leaf in model.let if seen.get(leaf, 0) > held_for]
            if not any(leaf in seen for leaf in model.let):
                never.append(named(game_key, screen, t))
            if (model.exit_y if game_key == "AO" else well.THROWN[1]) >= 0:
                down.append(named(game_key, screen, t))
            elif flown and min(model.leaf_y - top[leaf] for leaf in flown) <= 0:
                grounded.append(named(game_key, screen, t))
    return {"game": game_key, "ticks": ticks, "wells": sum(n * (k + 1) for k, n in enumerate(screens)),
            "cameras": len(tables.screens), "screens": screens, "made": made, "flown": every, "never": never,
            "down": down, "grounded": grounded}


def trace(tables, game_key, short, path, places, ticks):
    """the leaves of some wells of one camera at the ticks asked for, as the
    JSON's object"""
    screen = next((screen for screen in tables.screens if (screen.short, screen.path) == (short, path)
                   and places[0] in [place for place, *_ in screen.wells]), None)
    if screen is None or not set(places) <= {place for place, _, held, _ in screen.wells if well.lets(held)}:
        raise ValueError(f"{short} P{path} holds no camera whose wells at {places} all let leaves go")
    world, wells = camera(tables, game_key, screen)
    own = {place: model for model, (place, *_) in zip(wells, screen.wells)}
    leaves, sums = {}, {}
    for tick in range(1, max(ticks) + 1):
        world.tick()
        if tick in ticks:
            flying = {place: [[leaf.x, leaf.y] for leaf in world.objects[len(wells):] if leaf in own[place].let]
                      for place in places}
            leaves[tick] = flying
            every = [point for place in places for point in flying[place]]
            sums[tick] = [len(every), sum(x for x, _ in every), sum(y for _, y in every)]
    return {"game": game_key, "camera": f"{short} P{path} cell {screen.cell}", "seed": screen.seed,
            "leaves": leaves, "sums": sums}


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("game", choices=sorted(GAMES))
    ap.add_argument("well", nargs="*", help="a level, a path and the places of wells among its objects, by commas")
    ap.add_argument("--ticks", default="")
    args = ap.parse_args(argv)

    def numbers(text, what):
        try:
            return [int(v) for v in text.split(",") if v]
        except ValueError:
            ap.error(f"{what} takes whole numbers between commas")

    ticks = numbers(args.ticks, "--ticks")
    if any(tick < 1 for tick in ticks):
        ap.error("--ticks takes ticks from the first")
    tables = committed(args.game)
    if not args.well:
        if len(ticks) > 1:
            ap.error("a game's cameras are watched for one count of ticks")
        out = sweep(tables, args.game, *ticks)
    elif len(args.well) != 3 or not args.well[1].isdigit() or not ticks:
        ap.error("wells are named by a level, a path and their places, with --ticks to read them at")
    else:
        try:
            out = trace(tables, args.game, args.well[0], int(args.well[1]), numbers(args.well[2], "a place"), ticks)
        except ValueError as e:
            sys.exit(str(e))
    print(json.dumps(out, indent=1))


if __name__ == "__main__":
    main()
