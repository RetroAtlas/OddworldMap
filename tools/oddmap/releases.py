"""The releases of each game beside the base the map is built from: the
hand-curated table that describes them, and the images that are theirs.

A release is known by its discs' SHA-1s, Redump's own, so an image is
identified by its bytes and never by its file name."""
import hashlib
import json
import os
import re
from pathlib import Path

from oddmap.paths import HERE

RELEASES = HERE / "data" / "releases.json"

CODE = re.compile(r"^[a-z]{2}(-r\d+)?$")
CODE_PAGES = ("cp437", "own")
VERDICTS = ("edit", "re-encode")
SHA1 = re.compile(r"^[0-9a-f]{40}$")


def _check_identity(where, entry):
    for key in ("name", "language", "title", "executable"):
        if not isinstance(entry.get(key), str) or not entry[key]:
            raise ValueError(f"{where}: needs a {key}")
    discs = entry.get("discs")
    if not isinstance(discs, list) or not discs:
        raise ValueError(f"{where}: needs its discs")
    for i, d in enumerate(discs):
        if (not isinstance(d, dict) or set(d) != {"redump", "bytes", "sha1"}
                or not isinstance(d["redump"], int) or not isinstance(d["bytes"], int)
                or d["bytes"] % 2352 or not SHA1.match(str(d["sha1"]))):
            raise ValueError(f"{where}: disc {i + 1} is not {{redump, bytes, sha1}} of a raw 2352-byte-sector image")


def check_table(table):
    """the table's shape, every part of it, raising on the first thing off it"""
    if not isinstance(table, dict) or not table:
        raise ValueError("the release table is no table of games")
    seen = {}
    for game, entry in table.items():
        if not isinstance(entry, dict) or set(entry) != {"base", "releases"}:
            raise ValueError(f"{game}: needs its base and its releases")
        _check_identity(f"{game} base", entry["base"])
        for d in entry["base"]["discs"]:
            seen.setdefault(d["sha1"], f"{game} base")
        for code, rel in entry["releases"].items():
            where = f"{game} {code}"
            if not CODE.match(code):
                raise ValueError(f"{where}: a code is a country's two letters, a pressing adding -r and its revision")
            _check_identity(where, rel)
            for d in rel["discs"]:
                if d["sha1"] in seen:
                    raise ValueError(f"{where}: disc {d['sha1']} is {seen[d['sha1']]}'s too")
                seen[d["sha1"]] = where
            if rel.get("code_page") not in CODE_PAGES:
                raise ValueError(f"{where}: code page {rel.get('code_page')!r} is none the builder reads")
            if not isinstance(rel.get("ships"), bool):
                raise ValueError(f"{where}: ships is true or false")
            if rel["ships"] and not (isinstance(rel.get("note"), str) and rel["note"]):
                raise ValueError(f"{where}: a release the site carries needs its note")
            verdicts = rel.get("verdicts", {})
            if not isinstance(verdicts, dict) or any(v not in VERDICTS for v in verdicts.values()):
                raise ValueError(f"{where}: a verdict is one of {', '.join(VERDICTS)}")
            extra = set(rel) - {"name", "language", "title", "executable", "discs", "code_page", "ships", "note", "verdicts"}
            if extra:
                raise ValueError(f"{where}: no field {', '.join(sorted(extra))}")
    return table


def load_releases(path=RELEASES):
    return check_table(json.loads(Path(path).read_text()))


def disc_env(game_key, code):
    """the variable naming a release's images, as the base's does"""
    return f"ODDWORLD_DISC_{game_key}_{code.upper().replace('-', '_')}"


def sha1_file(path):
    h = hashlib.sha1()
    with open(path, "rb") as f:
        for block in iter(lambda: f.read(1 << 20), b""):
            h.update(block)
    return h.hexdigest()


def order_discs(paths, entry, where):
    """the images in the order the release's discs are listed, each checked to be
    one of them by its SHA-1, every disc given once"""
    wanted = {d["sha1"]: i for i, d in enumerate(entry["discs"])}
    placed = [None] * len(wanted)
    for p in paths:
        digest = sha1_file(p)
        if digest not in wanted:
            raise SystemExit(f"{where}: {p} is no disc of this release (SHA-1 {digest})")
        if placed[wanted[digest]] is not None:
            raise SystemExit(f"{where}: disc {wanted[digest] + 1} given twice")
        placed[wanted[digest]] = Path(p)
    missing = [i + 1 for i, p in enumerate(placed) if p is None]
    if missing:
        raise SystemExit(f"{where}: disc {', '.join(map(str, missing))} not given")
    return placed


def find_discs(directory, entry, where):
    """a release's images inside a directory, found by size and then by SHA-1,
    whatever they are named"""
    candidates = [p for p in sorted(Path(directory).iterdir())
                  if p.is_file() and p.stat().st_size in {d["bytes"] for d in entry["discs"]}]
    found = {}
    for p in candidates:
        digest = sha1_file(p)
        for i, d in enumerate(entry["discs"]):
            if d["sha1"] == digest:
                found.setdefault(i, p)
    missing = [i + 1 for i in range(len(entry["discs"])) if i not in found]
    if missing:
        raise SystemExit(f"{where}: disc {', '.join(map(str, missing))} not in {directory}")
    return [found[i] for i in range(len(entry["discs"]))]


def release_images(game_key, code, given, table, directory=None):
    """a release's images: those given, else those its variable names, else the
    ones a directory holds, in disc order and each checked against the table"""
    entry = table[game_key]["releases"][code]
    where = f"{game_key} {code}"
    paths = given or [p for p in os.environ.get(disc_env(game_key, code), "").split(os.pathsep) if p]
    if paths:
        return order_discs(paths, entry, where)
    if directory:
        return find_discs(directory, entry, where)
    raise SystemExit(f"{where}: no images: pass --disc, set ${disc_env(game_key, code)} or name a directory")
