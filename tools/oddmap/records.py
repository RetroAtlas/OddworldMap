"""What a check of the PlayStation's code reads off a game's discs before it
runs any: a disc's overlays and the address they load at, the fullest copy of
each level's archive, the camera whose list holds each record of a path, and
every object of the types asked for as the path chunks hold it, with that
camera."""
import collections
import contextlib
import io
import struct

from oddmap.disc import Lvl, parse_chunks
from oddmap.exe import one
from oddmap.games import game_setup
from oddmap.messages import MESSAGE_TABLES, lead_table
from oddmap.tlv import filed_cell, resolve_path_meta, tlv_header_ok, walk_obj_region

END = 4                             # the flag that ends a camera's list of records

Placed = collections.namedtuple("Placed", "short path place object words cell across blob meta")


def overlays(disc, game_key):
    """({overlay: its bytes} for each of a disc's, the address they load at)"""
    blobs = {name: disc.read(*disc.files[name]) for name in sorted(disc.files) if name.endswith(".OVL")}
    leads = (lead_table(blob, MESSAGE_TABLES[game_key]["lcd"][0]) for blob in blobs.values())
    return blobs, one({lead[1] for lead in leads if lead}, "the address the overlays load at")


def archives(discs, game):
    """{level: its archive} over the discs given, the fullest copy of each"""
    out = {}
    for _id, short, _name in game["levels"]:
        name = f"{short}.LVL"
        having = [disc for disc in discs if name in disc.files]
        if short in game["tables"] and having:
            try:
                out[short] = Lvl(max(having, key=lambda disc: disc.files[name][1]), name)
            except (ValueError, EOFError):
                pass
    return out


def listed(blob, start, cells, fmt):
    """{a record's offset among the path's objects: the cell whose camera
    lists it}, each camera's list read to the record that ends it"""
    out = {}
    for cell, first in enumerate(struct.unpack_from(f"<{cells}i", blob, len(blob) - 4 * cells)):
        at = start + first
        while first >= 0:
            flags, _, length, kind = struct.unpack_from("<BBhI", blob, at)
            if not tlv_header_ok(fmt, flags, length, kind):
                raise RuntimeError(f"the list of cell {cell} runs off its records")
            out[at - start] = cell
            if flags & END:
                break
            at += length
    return out


def placed(discs, game_key, names):
    """every object of the named types a game places, as its discs hold it:
    its place among its path's objects, the object as the builder reads it,
    its record's own bytes, the cell of the camera whose list holds it, which
    is the one the builder files it under, how many cells the path is across,
    and the path's chunk with where it keeps what"""
    game = game_setup(game_key)
    fmt, geo, out = game["tlv"], game["geometry"], []
    for short, lvl in archives(discs, game).items():
        if f"{short}PATH.BND" not in lvl.files:
            continue
        chunks = parse_chunks(lvl.read(f"{short}PATH.BND"))
        for path in sorted(rid for tag, rid in chunks if tag == "Path"):
            blob = chunks["Path", path]
            with contextlib.redirect_stdout(io.StringIO()):
                meta = resolve_path_meta(blob, path, game["tables"][short].get(path), fmt, geo["worldW"],
                                         geo["worldH"])
            across, down = max(1, meta["w_units"] // geo["worldW"]), max(1, meta["h_units"] // geo["worldH"])
            ends = meta["idx_off"] if meta["idx_off"] > meta["obj_off"] else len(blob)
            offsets = []
            objects = walk_obj_region(blob, meta["obj_off"], ends, game, {}, offsets)
            if not any(obj["name"] in names for obj in objects):
                continue
            cells = listed(blob, meta["obj_off"], across * down, fmt)
            for place, (obj, offset) in enumerate(zip(objects, offsets)):
                if obj["name"] not in names:
                    continue
                at, cell = meta["obj_off"] + offset, cells[offset]
                if cell != filed_cell(obj, across, game):
                    raise RuntimeError(f"{short} P{path}: the camera of cell {cell} lists the {obj['name']} at "
                                       f"{obj['x1']},{obj['y1']}, not the one its game files it under")
                out.append(Placed(short, path, place, obj, blob[at:at + struct.unpack_from("<h", blob, at + 2)[0]],
                                  cell, across, blob, meta))
    return out
