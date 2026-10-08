#!/usr/bin/env python3
"""
Start Abe's Oddysee (PS1 NTSC-U) at a place an Oddworld Map permalink names.

Writes a memory card holding one save per permalink: loading it starts the
path the way the game starts one from a save, every object back at its own
record and Abe on the floor at the linked place. The place is the permalink's
object, else its view's centre, else --at; Abe stands on the first floor at or
below it.

  python3 tools/visit.py 'http://localhost:8471/#AO/D1/7/4637/1709/1.60/ContinuePoint@4625,1638'
  python3 tools/visit.py --launch '#AO/D1/7/4637/1709/1.60'

The card is written to visit.mcd under --out ($ODDWORLD_VISITS, else
OddworldMap/visits in your home folder). --launch boots the game in a
DuckStation profile of its own under --out, made on first launch from a copy
of your DuckStation settings with that card in slot 1, so nothing in
DuckStation's own folder is written (delete the profile folder to remake it);
load the save from the game's main menu. It runs on macOS and Linux, where
DuckStation takes its folder from a variable, and not with a portable install.
--disc defaults to $ODDWORLD_DISC_AO.
"""
import argparse
import configparser
import contextlib
import io
import json
import os
import platform
import re
import shutil
import struct
import subprocess
import sys
import zlib
from pathlib import Path
from urllib.parse import unquote

from oddmap import memcard, savegame
from oddmap.disc import Disc, Lvl, parse_chunks
from oddmap.games import GAMES, game_setup
from oddmap.paths import SITE
from oddmap.tlv import resolve_path_meta

DEFAULT_OUT = Path.home() / "OddworldMap" / "visits"
FLOOR_TYPES = (0, 4)  # floor, background floor
SPAWN_REACH = 60  # how far above and below its saved position the game looks for Abe's floor


def parse_permalink(text):
    """the place a viewer permalink names, read as model.js's parseHash reads it"""
    h = text.split("#", 1)[1] if "#" in text else text
    if "%" in h:
        h = unquote(h)
    parts = h.split("/")
    if len(parts) < 3 or not parts[2].isdigit():
        raise ValueError(f"{text!r} names no game, level and path")
    view = None
    if len(parts) >= 6:
        try:
            x, y, z = float(parts[3]), float(parts[4]), float(parts[5])
            view = (x, y) if z > 0 else None
        except ValueError:
            pass
    obj = None
    for s in parts[6:]:
        m = re.fullmatch(r"(\w+)@(-?\d+),(-?\d+)", s)
        if m:
            obj = (m.group(1), int(m.group(2)), int(m.group(3)))
            break
    return {"game": parts[0].upper(), "level": parts[1].upper(), "path": int(parts[2]),
            "view": view, "obj": obj}


def floor_under(lines, x, y):
    """the first floor at or below (x, y) as (y, line type), and any floor of
    its type within the game's reach above it, which a spawn there would land
    on instead"""
    hits = []
    for x1, y1, x2, y2, t in lines:
        if t in FLOOR_TYPES and min(x1, x2) <= x <= max(x1, x2):
            fy = y1 if x1 == x2 else round(y1 + (y2 - y1) * (x - x1) / (x2 - x1))
            hits.append((fy, t))
    below = sorted(h for h in hits if h[0] >= y)
    if not below:
        return None, []
    fy, t = below[0]
    return below[0], [h for h in hits if h[1] == t and fy - SPAWN_REACH <= h[0] < fy]


def resolve_place(link, data, at=None, face=None):
    """the save's Place for one permalink, and what the choice should mention"""
    level = next((L for L in data["levels"] if L["short"] == link["level"]), None)
    path = level and next((P for P in level["paths"] if P["id"] == link["path"]), None)
    if not path:
        raise ValueError(f"{link['game']} has no {link['level']} P{link['path']}")
    geo = data["geometry"]
    notes, tlv = [], None
    if at:
        x, y = at
    elif link["obj"]:
        name, ox, oy = link["obj"]
        tlv = next((t for t in path["tlvs"] if t["name"] == name and (t["x1"], t["y1"]) == (ox, oy)), None)
        if not tlv:
            raise ValueError(f"{link['level']} P{link['path']} has no {name} at {ox},{oy}")
        x, y = (tlv["x1"] + tlv["x2"]) // 2, tlv["y1"]
    elif link["view"]:
        x, y = round(link["view"][0]), round(link["view"][1])
    else:
        raise ValueError("the permalink names no object or view; pass --at X,Y")
    floor, above = floor_under(path["lines"], x, y)
    if not floor:
        raise ValueError(f"no floor at or below {x},{y} on {link['level']} P{link['path']}")
    fy, line_type = floor
    if above:
        notes.append(f"another floor at y {above[0][0]} is within reach above, and Abe may land there")
    cx, cy = x // geo["worldW"], fy // geo["worldH"]
    cam = next((c for c in path["cams"] if c["cell"] == cx + cy * path["w"]), None)
    if not cam:
        raise ValueError(f"{x},{fy} is in no camera of {link['level']} P{link['path']}")
    wx, wy = x - cx * geo["worldW"] - geo["winX"], fy - cy * geo["worldH"] - geo["winY"]
    if not (0 <= wx < geo["visW"] and 0 <= wy < geo["visH"]):
        notes.append(f"{x},{fy} is outside {cam['name']}'s visible screen")
    fields = (tlv or {}).get("fields", {})
    if tlv and tlv["name"] == "ContinuePoint":
        zone = savegame.Zone(fields["zone_number"], fields["clear_from_id"], fields["clear_to_id"],
                             (tlv["x1"], tlv["y1"], tlv["x2"], tlv["y2"]))
        flip = fields["abe_spawn_direction"]
    else:
        zone = savegame.Zone(0, 0, 0, (x - 12, fy - 72, x + 12, fy + 6))
        flip = 0
    if face:
        flip = int(face == "left")
    place = savegame.Place(level["id"], path["id"], int(re.search(r"C(\d+)$", cam["name"]).group(1)),
                           x, fy, line_type, flip, zone)
    return place, level["name"], cam["name"], notes


def level_flags(disc, game, short):
    """the object flags of every path the level's table names, as a fresh level holds them"""
    if not game["tables"].get(short):
        raise ValueError(f"{short} has no path table, so no save can start there")
    lvl = Lvl(disc, f"{short}.LVL")
    chunks = parse_chunks(lvl.read(f"{short}PATH.BND"))
    geo = game["geometry"]
    out = []
    for pid, row in sorted(game["tables"][short].items()):
        blob = chunks[("Path", pid)]
        with contextlib.redirect_stdout(io.StringIO()):  # the builder's audit notes
            meta = resolve_path_meta(blob, pid, row, game["tlv"], geo["worldW"], geo["worldH"])
        cells = (meta["w_units"] // geo["worldW"]) * (meta["h_units"] // geo["worldH"])
        out.append(savegame.tlv_flags(blob, meta, cells))
    return out


def save_name(place, taken):
    """a card file name in the game's own pattern, the prefix then five
    characters from the range its own names draw on, unique on the card"""
    n = zlib.crc32(struct.pack("<7i", *place[:7]))
    while True:
        digits, v = "", n
        for _ in range(5):
            v, d = divmod(v, 85)
            digits += chr(33 + d)
        name = savegame.NAME_PREFIX + digits
        if name not in taken:
            return name
        n = (n + 1) % 85 ** 5


def data_root(system, env, home):
    """the folder a DuckStation that is not a portable install keeps its
    settings in, as Core::SetDataRoot picks it on macOS and Linux"""
    if system == "Darwin":
        return home / "Library" / "Application Support" / "DuckStation"
    xdg = env.get("XDG_CONFIG_HOME", "")
    return Path(xdg) / "duckstation" if os.path.isabs(xdg) else home / ".local" / "share" / "duckstation"


def profile_env(system, profile):
    """the variable DuckStation picks its folder by, pointed at `profile`"""
    return {"Darwin": {"HOME": str(profile)}, "Linux": {"XDG_CONFIG_HOME": str(profile)}}.get(system)


def program_path(app):
    """the executable to run: a macOS .app bundle's own, else the path given"""
    return app / "Contents" / "MacOS" / "DuckStation" if app.suffix == ".app" else app


def make_profile(data, card, source):
    """the data folder `data` for DuckStation to run from, made once: the
    settings in `source` with the visit card in slot 1 and no achievements
    login, and a copy of its BIOS images"""
    if (data / "settings.ini").exists():
        return
    (data / "bios").mkdir(parents=True, exist_ok=True)
    ini = configparser.ConfigParser(interpolation=None, strict=False)
    ini.optionxform = str
    ini.read(source / "settings.ini", encoding="utf-8")
    for key in ("Token", "Username", "LoginTimestamp"):
        if ini.has_section("Cheevos"):
            ini.remove_option("Cheevos", key)
    for section, key, value in (("Cheevos", "Enabled", "false"),
                                ("AutoUpdater", "CheckAtStartup", "false"),
                                ("Main", "SetupWizardIncomplete", "false"),
                                ("BIOS", "SearchDirectory", "bios"),
                                ("MemoryCards", "Card1Type", "Shared"),
                                ("MemoryCards", "Card1Path", str(card)),
                                ("MemoryCards", "Card2Type", "None")):
        if not ini.has_section(section):
            ini.add_section(section)
        ini.set(section, key, value)
    with open(data / "settings.ini", "w", encoding="utf-8") as f:
        ini.write(f)
    for bios in sorted((source / "bios").glob("*.bin")):
        shutil.copyfile(bios, data / "bios" / bios.name)


def launch(app, out, card, disc):
    """boot `disc` in DuckStation from a profile under `out`, or say why it
    cannot be pointed at one"""
    system = platform.system()
    profile = out / "profile"
    env = profile_env(system, profile)
    mount = f"mount {card} as a memory card instead"
    if env is None:
        sys.exit(f"DuckStation on {system} keeps one folder whatever it is run with; {mount}")
    exe = program_path(app) if app else None
    if not exe or not exe.exists():
        sys.exit(f"no DuckStation at {app}; pass --app")
    if (exe.parent / "portable.txt").exists() or (exe.parent / "settings.ini").exists():
        sys.exit(f"{app} is a portable install, which keeps its folder beside it; {mount}")
    make_profile(data_root(system, env, profile), card, data_root(system, os.environ, Path.home()))
    cue = disc.with_suffix(".cue")
    boot = cue if cue.exists() else disc
    subprocess.Popen([str(exe), "-fastboot", "--", str(boot)], env={**os.environ, **env},
                     start_new_session=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    return profile


def point(text):
    try:
        x, y = (int(v) for v in text.split(","))
    except ValueError:
        raise argparse.ArgumentTypeError(f"{text!r} is not X,Y") from None
    return x, y


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("permalinks", nargs="+", help="Oddworld Map permalinks, or just their #fragments")
    ap.add_argument("--at", type=point, help="place Abe at X,Y (world units) instead of the permalink's "
                    "object or view")
    ap.add_argument("--face", choices=("left", "right"), help="which way Abe faces (default: the "
                    "continue point's own direction, else right)")
    ap.add_argument("--disc", help="the game's raw disc image (default $ODDWORLD_DISC_AO)")
    ap.add_argument("--out", type=Path, default=Path(os.environ.get("ODDWORLD_VISITS") or DEFAULT_OUT))
    ap.add_argument("--launch", action="store_true", help="boot the game in the visit profile")
    ap.add_argument("--app", type=Path, help="the DuckStation program (default /Applications/DuckStation.app "
                    "on macOS, duckstation-qt on the PATH on Linux)")
    args = ap.parse_args()

    try:
        links = [parse_permalink(p) for p in args.permalinks]
    except ValueError as ex:
        sys.exit(str(ex))
    if any(L["game"] != "AO" for L in links):
        sys.exit("only Abe's Oddysee permalinks (#AO/...) can be visited so far")
    if args.at and len(links) > 1:
        sys.exit("--at places one save; give one permalink with it")
    disc_path = args.disc or os.environ.get(GAMES["AO"]["env"])
    if not disc_path:
        sys.exit(f"no disc image: pass --disc or set ${GAMES['AO']['env']}")
    disc_path = Path(disc_path)

    game = game_setup("AO")
    data = json.loads((SITE / game["data_file"]).read_text())
    disc = Disc(disc_path)
    header = savegame.save_header(disc.read(*disc.files["SLUS_001.90"]))
    flags_by_level, saves = {}, []
    for link in links:
        short = link["level"]
        try:
            place, level_name, cam_name, notes = resolve_place(link, data, args.at, args.face)
            if short not in flags_by_level:
                flags_by_level[short] = savegame.flag_block(level_flags(disc, game, short))
        except ValueError as ex:
            sys.exit(str(ex))
        title = f"Abe: {level_name[:20]} P{place.path:02d}C{place.camera:02d}"
        name = save_name(place, {n for n, _ in saves})
        saves.append((name, savegame.ao_save(header, title, place, flags_by_level[short])))
        facing = "left" if place.flip else "right"
        print(f"{cam_name}: Abe at {place.x},{place.y} facing {facing}"
              f"{' on a background floor' if place.line_type == 4 else ''}"
              f"{f', respawning in zone {place.zone.number}' if place.zone.number else ''} ({title})")
        for note in notes:
            print(f"  ! {note}")

    args.out.mkdir(parents=True, exist_ok=True)
    card = args.out / "visit.mcd"
    card.write_bytes(memcard.write_card(saves))
    print(f"wrote {card}")
    if args.launch:
        default = Path("/Applications/DuckStation.app") if platform.system() == "Darwin" \
            else shutil.which("duckstation-qt")
        home = launch(args.app or (default and Path(default)), args.out, card, disc_path)
        print(f"booting {disc_path.stem} in the profile at {home}: choose Load on the main menu, "
              "then Load again and the save")


if __name__ == "__main__":
    main()
