#!/usr/bin/env python3
"""Print where every falling item a game places waits and what the PlayStation
draws of it while it does, off the models in tools/oddmap/fallingitem.py and
tools/oddmap/render.py: what the falling item tests of tests/unit/sprites.test.js
hold the viewer's items to.

    python3 tools/fallingitem_trace.py AE
    python3 tools/fallingitem_trace.py AO --ticks 64 --items

A game, then: --ticks, how long a fresh game is watched (default 64, two rounds
of the longest standing art); --items, to print each item beside the totals.
The tables are the ones the viewer ships: the records of map_data_*.json, each
built by the camera the builder's own rule files it under, and the frames of
sprites_*.json, with the art a level's items stand and rumble in.

The wait is the map's reading of a fresh game and lives here, not in the
models: an item on the always-on switch rumbles in its second art from the
first tick until its interval is out, and any other stands in its first; a
frame is held for the animation's count of ticks, the first from tick one.
So do the rows, the GPU's rule and no code of the disc's: it fills short of a
quad's right and bottom edges, inside a draw area the size of the window.

Prints JSON: `placed`, how many items the game places; `screens`, each screen a
waiting item is drawn on, with how many; `gone`, each item drawn on some ticks
of its wait and not on others, with those; and with --items `items`, each with
its screen, the point it waits at, its scale, and for each of its two arts the
rows of its screen each frame fills, `-` where the render hands over nothing.
"""
import argparse
import collections
import json
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))

from oddmap import fallingitem, render  # noqa: E402
from oddmap.fixed import FP  # noqa: E402
from oddmap.games import GAMES  # noqa: E402
from oddmap.paths import SITE  # noqa: E402
from oddmap.tlv import filed_cell  # noqa: E402

ALWAYS = 1                          # the switch that reads on from the start
TICKS = 64
# the art a level's items stand in and rumble in, and the levels that take the second pair
ARTS = {"AE": (("AE_FallingRock_Falling", "AE_FallingRock_Waiting"), ("FallingCrate_Falling", "FallingCrate_Waiting"),
               {"BW"}),
        "AO": (("AO_FallingRock_Falling", "AO_FallingRock_Waiting"), ("FallingMeat_Falling", "FallingMeat_Waiting"),
               {"R1", "R2"})}

Tables = collections.namedtuple("Tables", "items arts")
Item = collections.namedtuple("Item", "short level path record screen left top")
Art = collections.namedtuple("Art", "hold loop frames")


def committed(game_key):
    """the tables the viewer ships for a game: its placed items, each with
    the screen and the window's corner of the camera that builds it, and the
    animations they stand in"""
    lower, geo = game_key.lower(), GAMES[game_key]["geometry"]
    data = json.loads((SITE / f"map_data_{lower}.json").read_text())
    items = []
    for lvl in data["levels"]:
        for path in lvl["paths"]:
            names = {cam["cell"]: cam["name"] for cam in path["cams"]}
            for t in path["tlvs"]:
                if t["name"] != fallingitem.NAME:
                    continue
                f, cell = t["fields"], filed_cell(t, path["w"], GAMES[game_key])
                record = fallingitem.Record(t["x1"], t["y1"], t["x2"], t["y2"], f["switch_id"], f["scale"],
                                            f["fall_interval"], f["max_falling_items"],
                                            f["reset_switch_id_after_use"])
                items.append(Item(lvl["short"], lvl["id"], path["id"], record, names.get(cell),
                                  cell % path["w"] * geo["worldW"] + geo["winX"],
                                  cell // path["w"] * geo["worldH"] + geo["winY"]))
    anims = json.loads((SITE / f"sprites_{lower}.json").read_text())["anims"]
    return Tables(items, {name: Art(anim["fps"], anim["loop_start"] if anim["loop"] else None,
                                    [render.Frame(*frame[3:7], tuple(frame[7:11])) for frame in anim["frames"]])
                          for name, anim in anims.items() if name in sum(ARTS[game_key][:2], ())})


def frame_at(art, tick):
    """the frame an animation stands on at a tick of its run"""
    at, count = (tick - 1) // art.hold, len(art.frames)
    if at < count:
        return at
    return count - 1 if art.loop is None else art.loop + (at - art.loop) % (count - art.loop)


def rows(corners):
    """how many rows of a quad the GPU fills on the screen"""
    (x1, y1), (x2, y2) = corners
    return max(0, min(y2, render.HIGH) - max(y1, 0)) if x2 > 0 and x1 < render.WIDE else 0


def trace(tables, game_key, ticks=TICKS, detail=False):
    """the game's items under the models, as the JSON's object"""
    rocks, other, levels = ARTS[game_key]
    screens, gone, items = {}, {}, []
    for item in tables.items:
        record = item.record
        model = fallingitem.FallingItem(fallingitem.World(game_key, item.level, item.path), record)
        stage = render.Stage(item.left, item.top, item.level, item.path)
        arts = [tables.arts[name] for name in (other if item.short in levels else rocks)]
        handed = [[render.render(frame, model.sprite(), stage) for frame in art.frames] for art in arts]
        waits = ([(tick, 1) for tick in range(1, min(ticks, record.interval + 1) + 1)] if record.switch == ALWAYS
                 else [(tick, 0) for tick in range(1, ticks + 1)])
        unseen = [tick for tick, art in waits if handed[art][frame_at(arts[art], tick)] is None]
        where = f"{game_key} {item.short} P{item.path} ({record.x1},{record.y1})"
        if len(unseen) < len(waits):
            screens[item.screen] = screens.get(item.screen, 0) + 1
            if unseen:
                gone[where] = unseen
        items.append({"at": where, "screen": item.screen, "waits": f"{model.x // FP},{model.y // FP}",
                      "scale": model.scale / FP,
                      "rows": [" ".join("-" if quad is None else str(rows(quad)) for quad in art) for art in handed]})
    out = {"game": game_key, "placed": len(tables.items), "screens": screens, "gone": gone}
    return dict(out, items=items) if detail else out


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("game", choices=sorted(GAMES))
    ap.add_argument("--ticks", type=int, default=TICKS)
    ap.add_argument("--items", action="store_true")
    args = ap.parse_args(argv)
    if args.ticks < 1:
        ap.error("--ticks is at least one")
    print(json.dumps(trace(committed(args.game), args.game, args.ticks, args.items), indent=1))


if __name__ == "__main__":
    main()
