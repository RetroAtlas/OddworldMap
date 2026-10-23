"""A release against the base: every layer the map draws, read off the
release's own discs and compared with the committed base tree. What differs
is the release's overlay, in final values; the census reports it.

Nothing here names a release. What a release is comes from its discs (the
path records, message tables, fonts, frame rate and art) and from the curated
tables: the release table's code page and its verdicts on cameras the gate
cannot decide, and a table of the release's own naming what it draws that no
standard code page names."""
import difflib
import json
import re
import struct
import tempfile
from concurrent.futures import ProcessPoolExecutor

from oddmap.disc import Disc, Lvl, parse_chunks
from oddmap.exe import (Image, code_differences, executable, frame_rate, lcd_glyph_table, path_overlays,
                        path_records, text, text_codes)
from oddmap.image import cam_masks, cam_pixels, read_png, write_png
from oddmap.messages import MESSAGE_BUTTONS, MESSAGE_TABLES, clean_table, message_json, overlay_tables
from oddmap.paths import HERE, SITE
from oddmap.sprites import (FONT_FAMILY, SHEETS_DIR, build_sprites, family_sheet, font_chunks, font_texture,
                            glyph_index, index_map_rgba, read_dice, sheet_name)
from oddmap.tlv import walk_obj_region

CAMERA_NAME = re.compile(r"[A-Z0-9]{4,8}")


class Base:
    """the committed base a release is compared with"""
    def __init__(self, game_key, game, site=SITE, data_dir=HERE / "data"):
        self.site = site
        self.data = json.loads((site / game["data_file"]).read_text())
        self.links = json.loads((data_dir / game["links_file"]).read_text())["paths"]
        self.messages = json.loads((site / game["messages_file"]).read_text())
        self.sprites = json.loads((site / f"sprites_{game_key.lower()}.json").read_text())
        self.paths = {(L["short"], P["id"]): P for L in self.data["levels"] for P in L["paths"]}
        self._sheets = {}

    def sheet(self, family):
        if family not in self._sheets:
            self._sheets[family] = read_png((self.site / self.sprites["sheets"][family]).read_bytes())
        return self._sheets[family]


class Release:
    """a release's discs, opened: the archives of the levels the base draws, its
    executable, path records and clock"""
    def __init__(self, game_key, game, code, entry, images, shorts=None):
        self.game_key, self.game, self.code, self.entry = game_key, game, code, entry
        self.discs = [Disc(p) for p in images]
        name, self.exe = executable(self.discs[0])
        if name != entry["executable"]:
            raise SystemExit(f"{game_key} {code}: the executable is {name}, the table says {entry['executable']}")
        self.records = path_records(self.exe, game["path_record"])
        self.loads = path_overlays(self.exe, game["path_record"])
        self.overlays = set(self.loads.values()) if self.loads else None
        self.hz = frame_rate(self.exe)
        self.archives = {}
        for _lid, short, _display in game["levels"]:
            if shorts is not None and short not in shorts:
                continue
            name = f"{short}.LVL"
            having = [d for d in self.discs if name in d.files]
            if having:
                try:
                    self.archives[short] = Lvl(max(having, key=lambda d: d.files[name][1]), name)
                except (ValueError, EOFError):
                    pass


def object_keys(tlvs):
    """each object's identity in its path, as the edit sandbox keys it: its name
    and origin, numbered in list order where the pair repeats"""
    plain = [f"{t['name']}@{t['x1']},{t['y1']}" for t in tlvs]
    count, seen, keys = {}, {}, []
    for k in plain:
        count[k] = count.get(k, 0) + 1
    for k in plain:
        if count[k] == 1:
            keys.append(k)
        else:
            seen[k] = seen.get(k, 0) + 1
            keys.append(f"{k}#{seen[k]}")
    return keys


def filed_cell(t, w, game):
    """the grid cell whose camera lists an object"""
    geo = game["geometry"]
    if game["filed_by_midpoint"]:
        x, y = (t["x1"] + t["x2"]) // 2, (t["y1"] + t["y2"]) // 2
    else:
        x, y = t["x1"], t["y1"]
    return (y // geo["worldH"]) * w + x // geo["worldW"]


def index_cells(blob, record, cells, positions):
    """the cell each record is listed under, read off the path's index table"""
    table = struct.unpack_from(f"<{cells}i", blob, record["idx_off"])
    starts = sorted((v, c) for c, v in enumerate(table) if v >= 0)
    out = []
    for pos in positions:
        cell = None
        for v, c in starts:
            if v > pos:
                break
            cell = c
        out.append(cell)
    return out


def rect(t):
    return [t["x1"], t["y1"], t["x2"], t["y2"]]


def compare_objects(game, base_tlvs, tlvs, w, where):
    """the release's objects as edit-sandbox deltas over the base's, aligned per
    camera by type: a changed field's final value, a moved object's rect, a
    removed one marked, an added one whole with the identity of the object it
    follows in the release's list"""
    keys = object_keys(base_tlvs)
    by_cell_base, by_cell = {}, {}
    for i, t in enumerate(base_tlvs):
        by_cell_base.setdefault(filed_cell(t, w, game), []).append(i)
    for i, t in enumerate(tlvs):
        by_cell.setdefault(filed_cell(t, w, game), []).append(i)
    match, objects = {}, {}
    for cell in sorted(set(by_cell_base) | set(by_cell)):
        a, b = by_cell_base.get(cell, []), by_cell.get(cell, [])
        sm = difflib.SequenceMatcher(a=[base_tlvs[i]["name"] for i in a], b=[tlvs[j]["name"] for j in b],
                                     autojunk=False)
        for op, i1, i2, j1, j2 in sm.get_opcodes():
            if op == "equal":
                for i, j in zip(a[i1:i2], b[j1:j2]):
                    match[j] = i
            else:
                for i in a[i1:i2]:
                    objects[keys[i]] = {"removed": True}
    kept = [match[j] for j in sorted(match)]
    if kept != sorted(kept):
        raise SystemExit(f"{where}: the release lists the base's objects in another order")
    for j, i in match.items():
        old, new = base_tlvs[i], tlvs[j]
        delta = {}
        if "fields" in old or "fields" in new:
            if set(old.get("fields", {})) != set(new.get("fields", {})):
                raise SystemExit(f"{where}: {keys[i]} archives other fields")
            fields = {k: v for k, v in new.get("fields", {}).items() if old["fields"][k] != v}
            if fields:
                delta["fields"] = fields
        elif old["extra"] != new["extra"]:
            raise SystemExit(f"{where}: {keys[i]} differs in words no field archive holds")
        if rect(old) != rect(new):
            delta["rect"] = rect(new)
        if delta:
            objects[keys[i]] = delta
    n, ids = 0, []
    for j, t in enumerate(tlvs):
        if j in match:
            ids.append(keys[match[j]])
            continue
        n += 1
        ids.append(f"+{n}")
        added = {"name": t["name"], "rect": rect(t), "after": ids[j - 1] if j else None}
        if "fields" in t:
            added["fields"] = t["fields"]
        objects[f"+{n}"] = added
    return objects, n


def compare_path(game, release, short, pid, blob, base_path, base_links, level_short):
    """(the path's overlay entry, its counts, the cameras to compare by pixels)"""
    where = f"{release.game_key} {release.code} {short} P{pid}"
    record = release.records.get((short, pid))
    if record is None:
        raise SystemExit(f"{where}: no path record names this path")
    geo = game["geometry"]
    w, h = record["w_units"] // geo["worldW"], record["h_units"] // geo["worldH"]
    if (w, h) != (base_path["w"], base_path["h"]):
        raise SystemExit(f"{where}: a {w}x{h} grid where the base's is {base_path['w']}x{base_path['h']}")
    if "abe_x" in record:
        row = game["tables"].get(short, {}).get(pid) or {}
        if (record["abe_x"], record["abe_y"]) != (row.get("abe_x"), row.get("abe_y")):
            raise SystemExit(f"{where}: Abe starts at {record['abe_x']},{record['abe_y']}, which the overlay "
                             "has no field for")
    cells = w * h
    names = []
    for i in range(cells):
        nm = blob[i * 8:(i + 1) * 8].decode("latin1").strip("\0 ")
        names.append(nm if CAMERA_NAME.fullmatch(nm or "") else None)
    lines, links = [], []
    for i in range(record["coll_count"]):
        p = record["coll_off"] + i * 20
        x1, y1, x2, y2 = struct.unpack_from("<hhhh", blob, p)
        lines.append([x1, y1, x2, y2, blob[p + 8]])
        links.append([struct.unpack_from("<" + c, blob, p + off)[0] for _n, off, c in game["line_links"]])
    end = record["idx_off"] if record["idx_off"] > record["obj_off"] else len(blob)
    positions = []
    tlvs = walk_obj_region(blob, record["obj_off"], end, game, level_short, positions)
    for t, cell in zip(tlvs, index_cells(blob, record, cells, positions)):
        if cell is not None and cell != filed_cell(t, w, game):
            raise SystemExit(f"{where}: {t['name']}@{t['x1']},{t['y1']} is listed under cell {cell}, "
                             f"not where its game files it")
    entry, counts = {}, {}
    objects, added = compare_objects(game, base_path["tlvs"], tlvs, w, where)
    if objects:
        entry["objects"] = objects
        if added:
            entry["next"] = added + 1
        counts["objects changed"] = sum(1 for d in objects.values() if "removed" not in d and "name" not in d)
        counts["objects removed"] = sum(1 for d in objects.values() if "removed" in d)
        counts["objects added"] = added
    if lines != base_path["lines"] or links != base_links:
        entry["lines"], entry["links"] = lines, links
        sm = difflib.SequenceMatcher(a=[tuple(x) for x in base_path["lines"]], b=[tuple(x) for x in lines],
                                     autojunk=False)
        for op, i1, i2, j1, j2 in sm.get_opcodes():
            if op == "replace" and i2 - i1 == j2 - j1:
                counts["lines moved"] = counts.get("lines moved", 0) + i2 - i1
            elif op != "equal":
                counts["lines gone"] = counts.get("lines gone", 0) + i2 - i1
                counts["lines new"] = counts.get("lines new", 0) + j2 - j1
    base_cams = {c["cell"]: c for c in base_path["cams"]}
    cams, compare = {}, []
    for cell in range(cells):
        old, new = base_cams.get(cell), names[cell]
        if old and old["name"] == new:
            if old.get("png"):
                compare.append((new, old))
            continue
        if old:
            cams[old["name"]] = None
        if new:
            cams[new] = {"cell": cell}
            compare.append((new, None))
    if cams:
        entry["cams"] = cams
    return entry, counts, compare


def window_sums(a, b, w, h, k=4):
    """the change of every k x k window's summed luma, in thousandths, row by row"""
    d = [299 * (a[o] - b[o]) + 587 * (a[o + 1] - b[o + 1]) + 114 * (a[o + 2] - b[o + 2])
         for o in range(0, w * h * 4, 4)]
    integral = [0] * ((w + 1) * (h + 1))
    for y in range(h):
        run = 0
        for x in range(w):
            run += d[y * w + x]
            integral[(y + 1) * (w + 1) + x + 1] = integral[y * (w + 1) + x + 1] + run
    sums = []
    for y in range(h - k + 1):
        r0, r1 = y * (w + 1), (y + k) * (w + 1)
        sums.extend(abs(integral[r1 + x + k] - integral[r0 + x + k] - integral[r1 + x] + integral[r0 + x])
                    for x in range(w - k + 1))
    return sums


def window_measure(a, b, w, h, k=4):
    """the largest change, over every k x k window, of the window's mean luma"""
    return max(window_sums(a, b, w, h, k), default=0) / (k * k) / 1000


BLOCK = 16  # MDEC's macroblock


def changed_blocks(a, b, w, h, floor, k=4):
    """the (column, row) of every macroblock the release changes: any whose
    pixels differ, or with a floor, any a window measuring at least it lies over"""
    out = set()
    if floor is None:
        for by in range(-(-h // BLOCK)):
            for bx in range(-(-w // BLOCK)):
                x0, x1 = bx * BLOCK * 4, min((bx + 1) * BLOCK, w) * 4
                if any(a[y * w * 4 + x0:y * w * 4 + x1] != b[y * w * 4 + x0:y * w * 4 + x1]
                       for y in range(by * BLOCK, min((by + 1) * BLOCK, h))):
                    out.add((bx, by))
        return out
    cols = w - k + 1
    for i, s in enumerate(window_sums(a, b, w, h, k)):
        if s / (k * k) / 1000 >= floor:
            x, y = i % cols, i // cols
            out.update((bx, by) for by in range(y // BLOCK, (y + k - 1) // BLOCK + 1)
                       for bx in range(x // BLOCK, (x + k - 1) // BLOCK + 1))
    return out


def patch_rects(blocks, w, h):
    """(x, y, w, h) of the pixels over each 8-connected group of blocks, in
    reading order, but for a group's lying inside another's, whose pixels that
    one already carries"""
    seen, rects = set(), []
    for start in sorted(blocks, key=lambda c: (c[1], c[0])):
        if start in seen:
            continue
        seen.add(start)
        group, stack = [], [start]
        while stack:
            bx, by = stack.pop()
            group.append((bx, by))
            for n in ((bx + dx, by + dy) for dy in (-1, 0, 1) for dx in (-1, 0, 1)):
                if n in blocks and n not in seen:
                    seen.add(n)
                    stack.append(n)
        x0, y0 = min(c[0] for c in group) * BLOCK, min(c[1] for c in group) * BLOCK
        x1 = min((max(c[0] for c in group) + 1) * BLOCK, w)
        y1 = min((max(c[1] for c in group) + 1) * BLOCK, h)
        rects.append((x0, y0, x1 - x0, y1 - y0))

    def inside(r, o):
        return r != o and o[0] <= r[0] and o[1] <= r[1] and r[0] + r[2] <= o[0] + o[2] and r[1] + r[3] <= o[1] + o[3]
    return sorted((r for r in set(rects) if not any(inside(r, o) for o in rects)), key=lambda r: (r[1], r[0]))


def compose(a, b, w, rects):
    """a with b's pixels over each rectangle"""
    out = bytearray(a)
    for x, y, pw, ph in rects:
        for r in range(y, y + ph):
            out[(r * w + x) * 4:(r * w + x + pw) * 4] = b[(r * w + x) * 4:(r * w + x + pw) * 4]
    return bytes(out)


def patch_cover(a, b, w, h, floor):
    """the rectangles of b's pixels to draw over a: over the blocks b changes,
    then over any where the screen they compose still differs from b, until
    there are none, since a window across a patch's edge loses the half drawn
    over and with it whatever that half's change cancelled"""
    blocks = changed_blocks(a, b, w, h, floor)
    while True:
        rects = patch_rects(blocks, w, h)
        more = changed_blocks(compose(a, b, w, rects), b, w, h, floor) if rects else set()
        if more <= blocks:
            return rects
        blocks |= more


def compare_camera(job):
    """one camera of the release against the base's: its decoded pixels, the
    window measure where they differ and the rectangles that leave no block its
    game's floor counts as changed, and its masks' coverage and pixels"""
    site, layers, short, name, cam, old, floor = job
    with tempfile.TemporaryDirectory() as tmp:
        decoded = cam_pixels(cam, tmp)
    if decoded is None:
        return {"name": name, "failed": True}
    w, h, rgba, fg = decoded
    masks, clean, stray = cam_masks(fg, rgba, w, h, layers)
    out = {"name": name, "short": short, "w": w, "h": h, "rgba": rgba, "masks": masks, "clean": clean, "stray": stray}
    if old is None:
        return out
    bw, bh, base = read_png((site / old["png"]).read_bytes())
    out["pixels_differ"] = (bw, bh) != (w, h) or base != rgba
    out["measure"] = window_measure(base, rgba, w, h) if out["pixels_differ"] and (bw, bh) == (w, h) else None
    if (bw, bh) == (w, h):
        out["rects"] = patch_cover(base, rgba, w, h, floor) if out["pixels_differ"] else []
    base_masks = {layer: read_png((site / path).read_bytes())[2] for layer, path in old.get("masks", [])}
    coverage = set(base_masks) != set(masks) or any(
        any((x > 0) != (y > 0) for x, y in zip(base_masks[k][3::4], masks[k][3::4])) for k in masks)
    out["coverage_differs"] = coverage
    out["masks_differ"] = coverage or any(base_masks[k] != masks[k] for k in masks)
    return out


def camera_verdict(game, entry, cam):
    """whether a release's camera is its own, by the game's gate, the camera's
    verdict in the release table, or both; 'margin' where the gate cannot tell"""
    if cam.get("failed") or "pixels_differ" not in cam:
        return True
    gate = game["camera_gate"]
    if gate is None:
        return cam["pixels_differ"] or cam["masks_differ"]
    if cam["coverage_differs"]:
        return True
    verdict = entry.get("verdicts", {}).get(cam["name"])
    if verdict:
        return verdict == "edit"
    if not cam["pixels_differ"]:
        return False
    if abs(cam["measure"] - gate) < game["camera_margin"]:
        return "margin"
    return cam["measure"] >= gate


def release_messages(release, base, controls):
    """the release's message tables, per path the entries where the table its
    own overlay carries says otherwise, and the code the scroll-in lead runs in. Each path reads the table compiled
    into the overlay it loads, and a release may carry different copies (the
    French Oddysee's menu and Stockyards overlays spell a button out in one
    message); where the executable names no overlay per path, every copy must
    agree. The release's table is the one most paths read."""
    tables, per_path, lead = {}, {}, None
    for name, copies in sorted(overlay_tables(release.game_key, release.discs, release.overlays).items()):
        if MESSAGE_TABLES[release.game_key][name][1] and copies:
            lead = ord(next(iter(copies.values()))[1][0])
        cleaned = {ovl: clean_table(release.game_key, name, t, controls) for ovl, t in copies.items()}
        if not cleaned:
            raise SystemExit(f"{release.game_key} {release.code}: no overlay carries the {name} message table")
        if release.loads is None:
            if len({tuple(t) for t in cleaned.values()}) != 1:
                raise SystemExit(f"{release.game_key} {release.code}: overlays disagree on the {name} table")
            tables[name] = next(iter(cleaned.values()))
            continue
        reads = {f"{short}/{pid}": cleaned[ovl] for (short, pid), ovl in release.loads.items()
                 if ovl in cleaned and (short, pid) in base.paths}
        tally = {}
        for t in reads.values():
            tally[tuple(t)] = tally.get(tuple(t), 0) + 1
        ranked = sorted(tally.items(), key=lambda kv: -kv[1])
        if len(ranked) > 1 and ranked[0][1] == ranked[1][1]:
            raise SystemExit(f"{release.game_key} {release.code}: no {name} table is read by most paths")
        main = list(ranked[0][0])
        tables[name] = main
        for key, t in reads.items():
            if t != main:
                per_path.setdefault(key, {})[name] = {str(i): m for i, (m, n) in enumerate(zip(t, main)) if m != n}
    return tables, per_path, lead


def compare_sprites(release, base):
    """the families whose frames differ from the base's: their sheets and every
    animation drawn from them, as the base's sidecar shapes them"""
    frames, entries, misses = build_sprites(release.game_key, sorted(release.archives.items()))
    if misses:
        raise SystemExit(f"{release.game_key} {release.code}: animations not on the discs: {', '.join(misses)}")
    differ = []
    for name, entry in entries.items():
        old = base.sprites["anims"].get(name)
        if old is None:
            differ.append(name)
            continue
        same = (entry["fps"], entry["loop"], entry["loop_start"]) == (old["fps"], old["loop"], old["loop_start"]) \
            and len(entry["frames"]) == len(old["frames"])
        for (i, xoff, yoff, bound), of in zip(entry["frames"], old["frames"]) if same else ():
            fam, fw, fh, px = frames[i]
            family, x, y, ow, oh, oxoff, oyoff, *obound = of
            if (fw, fh, xoff, yoff, list(bound)) != (ow, oh, oxoff, oyoff, obound):
                same = False
                break
            sw, _sh, sheet = base.sheet(family)
            crop = b"".join(sheet[((y + r) * sw + x) * 4:((y + r) * sw + x + ow) * 4] for r in range(oh))
            if crop != px:
                same = False
                break
        if not same:
            differ.append(name)
    families = sorted({entries[n]["family"] for n in differ})
    sheets, anims = {}, {}
    for family in families:
        names = sorted(n for n, e in entries.items() if e["family"] == family)
        sheet, spots = family_sheet(family, names, entries, frames)
        sheets[family] = sheet
        for n in names:
            e = entries[n]
            anims[n] = {"family": family, "fps": e["fps"], "loop": e["loop"], "loop_start": e["loop_start"],
                        "frames": [[family, *spots[i], *frames[i][1:3], xoff, yoff, *bound]
                                   for i, xoff, yoff, bound in e["frames"]]}
    return sorted(differ), sheets, anims


def message_codes(tables, escapes):
    """(the single-byte codes, the two-byte codes) the messages use, the tally
    boards' digits and colon among the first"""
    singles, pairs = set(range(0x30, 0x3B)), set()
    for table in tables.values():
        for msg in table:
            raw = msg.encode("latin1")
            i = 0
            while i < len(raw):
                if raw[i] in escapes and i + 1 < len(raw):
                    pairs.add((raw[i], raw[i + 1]))
                    i += 2
                else:
                    singles.add(raw[i])
                    i += 1
    return singles, pairs


def release_font(release, messages):
    """the release's LCD font: the largest of its levels' textures, every other
    one held to be its corner, the glyph table its executable sets the font up
    with, cut after the last entry a message reaches, and how its own measuring
    routine reads each code"""
    textures = [(short, font_texture(data)) for short, data in font_chunks(sorted(release.archives.items()))]
    w, h, texels = max((t for _, t in textures), key=lambda t: t[0] * t[1])
    for short, (tw, th, tt) in textures:
        if tw > w or th > h or any(tt[y * tw:(y + 1) * tw] != texels[y * w:y * w + tw] for y in range(th)):
            raise SystemExit(f"{release.game_key} {release.code}: {short}'s LCD font is no corner of the largest")
    table = lcd_glyph_table(release.exe)
    codes, escapes = text_codes(release.exe, table)
    singles, pairs = message_codes(messages, escapes)
    reached = {codes[c] for c in singles if codes[c] is not None} | {escapes[e][b] for e, b in pairs}
    at = Image(release.exe).offset(table)
    glyphs = [list(release.exe[at + 4 * i:at + 4 * i + 4]) for i in range(max(reached | {1}) + 1)]
    return {"w": w, "h": h, "texels": texels, "glyphs": glyphs, "codes": codes, "escapes": escapes,
            "singles": singles}


def compare_font(release, base, messages):
    """the LCD font where it differs from the base's: its texture, and where a
    code a message uses reaches another glyph than the base's port draws for
    it, the glyph table and how the release reads its codes"""
    font = release_font(release, messages)
    old = base.sprites["font"]
    out = {}
    _w, _h, sheet = base.sheet(FONT_FAMILY)
    rgba = index_map_rgba(font["texels"])
    if (font["w"], font["h"]) != (old["w"], old["h"]) or rgba != sheet:
        out.update({"w": font["w"], "h": font["h"], "rgba": rgba})
    def drawn(i, glyphs):
        return None if i is None else (i, glyphs[i] if i < len(glyphs) else None)
    if font["escapes"] or any(drawn(font["codes"][c], font["glyphs"]) != drawn(glyph_index(c), old["glyphs"])
                              for c in font["singles"]):
        out.update({"w": font["w"], "h": font["h"], "rgba": rgba, "glyphs": font["glyphs"],
                    "codes": font["codes"], "escapes": {str(k): v for k, v in sorted(font["escapes"].items())}})
    return out or None


HINT_FIRST = 0x41  # the engine spells a hint fly's message with the letter its code less this names
HINT_LAST = 0x5A  # Z, the base's last letter: past it a standard code page names no letter a fly draws


def own_chars(game_key, code, code_page, font, tables, per_path, data_dir=HERE / "data"):
    """{table: the character of each glyph or letter, by its index} from the
    hand-curated table of what a release draws that no standard code page
    names: the glyphs its LCD messages reach where its code page is its own,
    and the letters its hint flies spell, which a release reading through a
    standard one names only where they reach past Z. The build fails wherever
    the table does not answer to the release's font and messages"""
    where = f"{game_key} {code}"
    own = code_page == "own"
    if own and (not font or "codes" not in font):
        raise SystemExit(f"{where}: a code page of its own reads through a font of its own")
    path = data_dir / f"codepage_{game_key.lower()}_{code}.json"
    escapes = {int(k): v for k, v in font["escapes"].items()} if own else {}

    def glyphs(msg):
        raw, i = msg.encode("latin1"), 0
        while i < len(raw):
            if raw[i] in escapes and i + 1 < len(raw):
                yield escapes[raw[i]][raw[i + 1]]
                i += 2
            else:
                yield font["codes"][raw[i]]
                i += 1

    def letters(msg):
        for b in msg.encode("latin1"):
            if b != 0x20:
                yield b - HINT_FIRST

    walks = {"lcd": glyphs, "hintfly": letters} if own else {"hintfly": letters}
    reached = {name: set() for name in walks}
    for source in [tables, *per_path.values()]:
        for name, walk in walks.items():
            msgs = source.get(name) or []
            for msg in msgs.values() if isinstance(msgs, dict) else msgs:
                reached[name].update(g for g in walk(msg) if g is not None)
    if not path.is_file():
        if own:
            raise SystemExit(f"{where}: no {path.name} names its glyphs")
        past = sorted(i + HINT_FIRST for i in reached["hintfly"] if i + HINT_FIRST > HINT_LAST)
        if past:
            raise SystemExit(f"{where}: its hint flies spell {', '.join(f'{c:#04x}' for c in past)}, past Z, "
                             f"letters {code_page} cannot name; no {path.name} names them")
        return {}
    if reached["hintfly"] and min(reached["hintfly"]) < 0:
        raise SystemExit(f"{where}: a hint fly spells {min(reached['hintfly']) + HINT_FIRST:#04x}, below its letters")
    page = json.loads(path.read_text())
    if own:
        sheet = f"{FONT_FAMILY}.{sheet_name(font['w'], font['h'], font['rgba'])}"
        if page["sheet"] != sheet:
            raise SystemExit(f"{where}: {path.name} names the glyphs of {page['sheet']}, not of {sheet}")
    elif set(page) != {"hintfly"}:
        raise SystemExit(f"{where}: {path.name} names its hint flies' letters alone, its signs reading "
                         f"through {code_page}")
    out = {}
    for name in walks:
        named = {int(k): v for k, v in page.get(name, {}).items()}
        if reached[name] - set(named):
            raise SystemExit(f"{where}: {path.name} names no character for {name} "
                             f"{sorted(reached[name] - set(named))}")
        if set(named) - reached[name]:
            raise SystemExit(f"{where}: {path.name} names {name} {sorted(set(named) - reached[name])}, "
                             "which no message reaches")
        if named:
            out[name] = [named.get(i) for i in range(max(named) + 1)]
    return out


def compare(game_key, game, code, entry, images, base=None, workers=None):
    """the release against the base, layer by layer: (its overlay, without the
    art's file names, the art to write, the census counts)"""
    base = base or Base(game_key, game)
    release = Release(game_key, game, code, entry, images, {L["short"] for L in base.data["levels"]})
    overlay = {"game": game_key, "code": code, "name": entry["name"], "title": entry["title"],
               "language": entry["language"], "executable": entry["executable"], "hz": release.hz,
               "code_page": entry["code_page"]}
    if entry.get("note"):
        overlay["note"] = entry["note"]
    counts = {}
    paths, jobs = {}, []
    # the gate's margin bounds what a camera that only re-encodes may measure,
    # and a block that reaches that bound is the release's
    floor = None if game["camera_gate"] is None else game["camera_gate"] - game["camera_margin"]
    for (short, pid), base_path in sorted(base.paths.items()):
        lvl = release.archives.get(short)
        if lvl is None or f"{short}PATH.BND" not in lvl.files:
            raise SystemExit(f"{game_key} {code}: no {short}PATH.BND")
        blob = parse_chunks(lvl.read(f"{short}PATH.BND")).get(("Path", pid))
        if blob is None:
            raise SystemExit(f"{game_key} {code}: {short} has no path {pid}")
        p, c, cams = compare_path(game, release, short, pid, blob, base_path,
                                  base.links.get(short, {}).get(str(pid)), game["level_short"])
        if p:
            paths[f"{short}/{pid}"] = p
            if c.get("lines moved") or c.get("lines gone") or c.get("lines new"):
                counts["paths with line changes"] = counts.get("paths with line changes", 0) + 1
            if any(k.startswith("objects") and v for k, v in c.items()):
                counts["paths with object changes"] = counts.get("paths with object changes", 0) + 1
        for k, v in c.items():
            counts[k] = counts.get(k, 0) + v
        for name, old in cams:
            try:
                cam = lvl.read(name + ".CAM")
            except KeyError:
                continue
            jobs.append((f"{short}/{pid}", name, (base.site, game["fg1_layers"], short, name, cam, old, floor)))
    with ProcessPoolExecutor(workers) as pool:
        cameras = list(pool.map(compare_camera, [j[2] for j in jobs], chunksize=4))
    art, margin, kept, own_measures = {}, [], [], []
    for (key, name, job), cam in zip(jobs, cameras):
        old = job[5]
        own = camera_verdict(game, entry, cam)
        if own == "margin":
            margin.append(f"{name} ({cam['measure']:.1f})")
            continue
        if cam.get("pixels_differ"):
            counts["cameras whose pixels differ"] = counts.get("cameras whose pixels differ", 0) + 1
            if not cam["coverage_differs"]:
                (own_measures if own else kept).append(cam["measure"])
        if cam.get("coverage_differs"):
            counts["cameras whose foreground differs"] = counts.get("cameras whose foreground differs", 0) + 1
        if own and not cam.get("failed"):
            if cam.get("rects") == [(0, 0, cam["w"], cam["h"])]:
                del cam["rects"]
            art[name] = cam
            if old is not None:
                paths.setdefault(key, {}).setdefault("cams", {})[name] = {"cell": old["cell"]}
            counts["cameras regional"] = counts.get("cameras regional", 0) + 1
    kept_all = sum(1 for (_k, _n, job), cam in zip(jobs, cameras)
                   if cam.get("pixels_differ") and camera_verdict(game, entry, cam) is False)
    if kept_all:
        counts["cameras re-encoded only"] = kept_all
    measured = [m for m in kept if m is not None], [m for m in own_measures if m is not None]
    if game["camera_gate"] is not None and measured[0]:
        counts["window measure, largest re-encode"] = round(max(measured[0]), 1)
    if game["camera_gate"] is not None and measured[1]:
        counts["window measure, smallest edit"] = round(min(measured[1]), 1)
    if margin:
        raise SystemExit(f"{game_key} {code}: cameras within the gate's margin need a verdict in the "
                         f"release table: {', '.join(margin)}")
    overlay["paths"] = {k: paths[k] for k in sorted(paths)}
    controls = MESSAGE_BUTTONS if entry["code_page"] == "cp437" else range(1, 0x20)
    messages, per_path, lead = release_messages(release, base, controls)
    changed = {name: table for name, table in messages.items() if base.messages.get(name) != table}
    if changed:
        overlay["messages"] = changed
        counts["message tables"] = len(changed)
    for key, tables in per_path.items():
        overlay["paths"].setdefault(key, {})["messages"] = tables
        counts["paths reading other messages"] = counts.get("paths reading other messages", 0) + 1
    overlay["paths"] = {k: overlay["paths"][k] for k in sorted(overlay["paths"])}
    differ, sheets, anims = compare_sprites(release, base)
    if differ:
        overlay["sprites"] = {"anims": anims}
        counts["sprite animations"] = len(differ)
    font = compare_font(release, base, {**base.messages, **messages})
    if font:
        overlay["font"] = {k: v for k, v in font.items() if k != "rgba"}
        if "codes" in font:
            overlay["font"]["lead"] = lead
        sheets[FONT_FAMILY] = (font["w"], font["h"], font["rgba"])
        counts["font"] = 1 if "codes" not in font else "its own glyphs and codes"
    chars = own_chars(game_key, code, entry["code_page"], font, {**base.messages, **messages}, per_path)
    if chars:
        overlay["chars"] = chars
        counts["characters named"] = sum(1 for named in chars.values() for c in named if c is not None)
    dice = {tuple(read_dice(d)) for d in release.discs}
    if len(dice) != 1:
        raise SystemExit(f"{game_key} {code}: the discs disagree on the random table")
    if dice != {tuple(base.sprites["dice"])}:
        overlay["dice"] = list(dice.pop())
        counts["dice"] = 1
    return overlay, {"cameras": art, "sheets": sheets}, counts


def camera_files(root, name, cam):
    """a regional camera's overlay fields and the images they name, (path, w,
    h, RGBA, keep alpha) each: its patches, or the camera whole where it has no
    rectangles, and its masks"""
    short, w, h, rgba = cam["short"], cam["w"], cam["h"], cam["rgba"]
    fields, images = {}, []
    if "rects" not in cam:
        fields["png"] = f"{root}/{short}/{name}.{sheet_name(w, h, rgba)}.png"
        images.append((fields["png"], w, h, rgba, False))
    elif cam["rects"]:
        if len({(x, y) for x, y, _pw, _ph in cam["rects"]}) < len(cam["rects"]):
            raise SystemExit(f"{name}: two patches at one corner would share a name")
        fields["patches"] = []
        for x, y, pw, ph in cam["rects"]:
            px = b"".join(rgba[((y + r) * w + x) * 4:((y + r) * w + x + pw) * 4] for r in range(ph))
            rel = f"{root}/{short}/{name}_{x}_{y}.{sheet_name(pw, ph, px)}.png"
            images.append((rel, pw, ph, px, False))
            fields["patches"].append([x, y, rel])
    masks = []
    for layer, mask in sorted(cam["masks"].items()):
        rel = f"{root}/{short}/{name}_fg{layer}.{sheet_name(w, h, mask)}.png"
        images.append((rel, w, h, mask, True))
        masks.append([layer, rel])
    if masks:
        fields["masks"] = masks
    return fields, images


def _art_job(job):
    path, w, h, rgba, keep = job
    if not path.exists():
        path.parent.mkdir(parents=True, exist_ok=True)
        write_png(path, w, h, rgba, keep_alpha=keep)
    return path


def write_release(game_key, game, overlay, art, out):
    """the release's overlay beside the base data and its art under its own
    directory of the game's cams, each image named for its pixels, so a rebuilt
    one is a new file and an unchanged one keeps its name; whatever else lies
    under that directory goes"""
    code = overlay["code"]
    root = f"{game['cams_dir']}/{code}"
    jobs = []
    for name, cam in sorted(art["cameras"].items()):
        key = next(k for k, p in overlay["paths"].items() if name in p.get("cams", {}))
        fields, images = camera_files(root, name, cam)
        overlay["paths"][key]["cams"][name].update(fields)
        jobs += [(out / rel, *image) for rel, *image in images]
    for p in overlay["paths"].values():
        if "cams" in p:
            p["cams"] = {k: p["cams"][k] for k in sorted(p["cams"])}
    sheets = {}
    for family, (w, h, rgba) in sorted(art["sheets"].items()):
        sheets[family] = f"{root}/{SHEETS_DIR}/{family}.{sheet_name(w, h, rgba)}.png"
        jobs.append((out / sheets[family], w, h, rgba, True))
    if sheets:
        overlay["sheets"] = sheets
    written = {p for p, *_ in jobs}
    top = out / root
    for old in sorted(top.rglob("*"), reverse=True) if top.is_dir() else ():
        if old.is_file() and old not in written:
            old.unlink()
        elif old.is_dir() and not any(old.iterdir()):
            old.rmdir()
    out.mkdir(parents=True, exist_ok=True)
    with ProcessPoolExecutor() as pool:
        list(pool.map(_art_job, jobs, chunksize=4))
    dst = out / f"release_{game_key.lower()}_{code}.json"
    dst.write_text(message_json(overlay))
    return dst, len(jobs)


def compare_code(base_images, release):
    """how far the release's code is from the base's, with addresses masked: the
    executable's differing blocks, and the differing functions of each overlay
    both load (every overlay, where the executable does not name them)"""
    base_discs = [Disc(p) for p in base_images]
    base_exe = executable(base_discs[0])[1]
    blocks, _ = code_differences(text(base_exe), text(release.exe))
    loads = path_overlays(base_exe, release.game["path_record"])
    def overlays(discs, loaded):
        out = {}
        for d in discs:
            for f, (lba, size) in sorted(d.files.items()):
                if f.endswith(".OVL") and f not in out and (loaded is None or f in loaded):
                    out[f] = d.read(lba, size)
        return out
    base_ovls = overlays(base_discs, set(loads.values()) if loads else None)
    rel_ovls = overlays(release.discs, release.overlays)
    per = {n: code_differences(base_ovls[n], rel_ovls[n])[1] for n in sorted(set(base_ovls) & set(rel_ovls))}
    return {"executable blocks": blocks, "overlay functions": [min(per.values()), max(per.values())],
            "overlays identical": f"{sum(1 for v in per.values() if v == 0)} of {len(per)}"}


def census_lines(overlay, counts, code=None):
    """the census report of one release"""
    out = [f"{overlay['game']} {overlay['code']} ({overlay['name']}, {overlay['executable']}): "
           f"{overlay['hz']} Hz, text through "
           f"{'its own code page' if overlay['code_page'] == 'own' else overlay['code_page']}"]
    for k in sorted(counts):
        out.append(f"  {k}: {counts[k]}")
    dropped = sorted(n for p in overlay["paths"].values() for n, c in p.get("cams", {}).items() if c is None)
    if dropped:
        out.append(f"  cameras dropped: {', '.join(dropped)}")
    for name, table in sorted(overlay.get("messages", {}).items()):
        out.append(f"  {name} messages: {sum(1 for m in table if m)} of {len(table)} filled")
    if code:
        out.append(f"  code: {code['executable blocks']} executable blocks, "
                   f"{code['overlay functions'][0]} to {code['overlay functions'][1]} functions an overlay, "
                   f"{code['overlays identical']} overlays identical")
    if len(out) == 1:
        out.append("  every layer the base's")
    return out
