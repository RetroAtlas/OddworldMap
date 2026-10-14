"""Sprite animations off the discs: the Anim chunks of a level's BAN, BND and
CAM files, decoded into a sheet per family and the sidecar the viewer's
Objects-as-themselves toggle draws from.

An Anim chunk is a file header, the frames (each a FrameHeader and its pixel
payload, the CLUT somewhere beside them) and the animation tables, which pack
contiguously after the last frame-info record; the file header names one table
(the last one), so the region is found by stepping back from that table's own
frame infos and walking forward. Every offset is from byte 0 of the chunk data.
Exoddus ships 260 chunks in a second shape, one pre-rendered sheet whose frame
infos carry sub-rectangles in the slot a frame-header offset usually fills.

The LCD screens' font is a family of its own: LCDFONT.FNT is one Font chunk per
level archive, a header, a CLUT the screens never read and the 4bpp texels, and
its glyph rectangles are a table in the executable, found by its shape."""
import hashlib
import json
import shutil
import struct

from oddmap.disc import parse_chunks
from oddmap.image import decompress_4or5, write_png
from oddmap.messages import MESSAGE_BUTTONS
from oddmap.paths import HERE

SPRITE_ANIMS = HERE / "data" / "sprite_anims.json"

SHEET_W = 1024          # a sheet's width at most; its height follows the frames, capped
SHEET_MAX_H = 2048
SHEETS_DIR = "sprites"  # under a game's cams directory, its family sheets in it
FONT_FAMILY = "Font"

# alpha states a texel can take in an atlas: the viewer blends the marked ones
# only where the object's polygon is semi-transparent, which is the object's
# rule rather than the texel's
ALPHA_CLEAR, ALPHA_STP, ALPHA_OPAQUE = 0, 254, 255

FONT_FILE, FONT_RID = "LCDFONT.FNT", 2

def glyph_index(code):
    """the engine's glyph for a code point: a printable counts from 31 below it, a
    button code from 137 above, and anything else is drawn as a space"""
    if 0x21 <= code <= 0xAF:
        return code - 31
    if 0x07 <= code <= 0x1F:
        return code + 137
    return None

GLYPH_COUNT = glyph_index(max(MESSAGE_BUTTONS)) + 1

def file_header(data):
    max_w, max_h, fto, word8 = struct.unpack_from("<hhII", data, 0)
    return {"max_w": max_w, "max_h": max_h, "frame_table_offset": fto, "word8": word8,
            # a non-zero word followed by ten zero bytes marks the sheet shape; in
            # Oddysee the word is the CLUT size and the bytes after it are colours
            "sheet": word8 != 0 and data[12:22] == b"\0" * 10}

def frame_info(data, off):
    fh_off, _magic, count, xoff, yoff, x0, y0, x1, y1 = struct.unpack_from("<Ihhhhhhhh", data, off)
    return {"frame_header_offset": fh_off, "count": count, "xoff": xoff, "yoff": yoff,
            "bound": [x0, y0, x1, y1]}

def frame_header(data, off):
    clut, w, h, bpp, comp = struct.unpack_from("<IBBBB", data, off)
    return {"clut_offset": clut, "w": w, "h": h, "bpp": bpp, "comp": comp}

def _info_size(data, off):
    return 20 + 8 * struct.unpack_from("<h", data, off + 6)[0]

def _headers_from(data, start):
    """the AnimationHeaders from `start` to the chunk end, or None where one fails
    to validate before the end (zero-frame headers are kept: they occupy a slot
    and the PC tables count them)"""
    pos, n, anims = start, len(data), []
    while pos + 8 <= n:
        fps, nf, loop, flags = struct.unpack_from("<HhhH", data, pos)
        if nf == 0 and fps and flags <= 15:
            anims.append({"off": pos, "fps": fps, "loop": False, "loop_start": 0, "frames": []})
            pos += 8
            continue
        if nf <= 0 or nf > 512 or fps == 0 or fps > 64 or flags > 15 or loop < 0 or loop >= nf:
            return anims if data[pos:].strip(b"\0") == b"" else None
        if pos + 8 + 4 * nf > n:
            return None
        offs = struct.unpack_from(f"<{nf}I", data, pos + 8)
        if not all(20 <= o + 20 <= n for o in offs):
            return None
        anims.append({"off": pos, "fps": fps, "loop": bool(flags & 2), "loop_start": loop,
                      "frames": list(offs)})
        pos += 8 + 4 * nf
    return anims

def walk(data):
    """(file header, animations) for an Anim chunk, every table in order."""
    hdr = file_header(data)
    fto = hdr["frame_table_offset"]
    n = len(data)
    if fto + 8 > n:
        raise ValueError("frame table offset outside the chunk")
    nf = struct.unpack_from("<h", data, fto + 2)[0]
    start = fto
    if 0 < nf and fto + 8 + 4 * nf <= n:
        offs = struct.unpack_from(f"<{nf}I", data, fto + 8)
        if all(o + 20 <= n for o in offs):
            start = min(fto, max(o + _info_size(data, o) for o in offs))
    elif nf == 0:
        # a named table with no frames says nothing about where the region
        # begins (AO's ROPES.BAN keeps its one real table just before it)
        start = max(0, fto - 64)
    for s in range(start, fto + 1, 4):
        anims = _headers_from(data, s)
        if anims is not None and any(a["off"] == fto for a in anims):
            return hdr, anims
    raise ValueError("no walk of the animation tables passes through the named table")

def pitch_halfwords(bpp, w):
    if bpp == 4:
        return ((w + 7) // 4) & ~1
    if bpp == 8:
        return ((w + 3) // 2) & ~1
    if bpp == 16:
        return (w + 1) & ~1
    raise ValueError(f"bit depth {bpp}")

def decode_type2(src, out_len):
    """three input bytes carry four six-bit values"""
    out = bytearray(out_len + 4)
    dwords, rem, pos, dst = out_len // 4, out_len % 4, 0, 0
    while dwords:
        for _ in range(4):
            if not dwords:
                break
            v = src[pos] | (src[pos + 1] << 8) | (src[pos + 2] << 16)
            pos += 3
            dwords -= 1
            value = (v & 0x3F) | ((v << 2) & 0x3F00) | ((v << 4) & 0x3F0000) | (((v << 4) & 0x0FC00000) << 2)
            out[dst:dst + 4] = struct.pack("<I", value & 0xFFFFFFFF)
            dst += 4
    while rem > 0:
        rem -= 1
        out[dst] = src[pos]
        dst += 1
        pos += 1
    return bytes(out[:out_len])

def decode_ao_type3(src, total_len, out_len):
    """Oddysee's run-length scheme over six-bit codes: a code with bit 5 set
    introduces (code & 31) + 1 literal values, any other skips code + 1 zero
    bytes; the codes past the last whole group are read as plain bytes"""
    in_len, direct_len = total_len & ~3, total_len & 3
    out = bytearray(4 * ((out_len + 3) // 4))
    pos, direct = 0, (6 * in_len) // 8
    ctl, bits, o = 0, 0, 0

    def next_src():
        nonlocal ctl, bits, pos
        if ctl:
            if ctl == 14:
                ctl = 30
                bits |= struct.unpack_from("<H", src, pos)[0] << 14
                pos += 2
        else:
            bits = struct.unpack_from("<I", src, pos)[0]
            pos += 4
            ctl = 32
        ctl -= 6

    def read_direct():
        nonlocal direct
        b = src[direct]
        direct += 1
        return b

    while in_len:
        next_src()
        in_len -= 1
        code = bits & 0x3F
        bits >>= 6
        if code & 0x20:
            for _ in range((code & 0x1F) + 1):
                if in_len:
                    next_src()
                    in_len -= 1
                    out[o] = bits & 0x3F
                    bits >>= 6
                else:
                    out[o] = read_direct() & 0x3F
                    direct_len -= 1
                o += 1
        else:
            o += code + 1
    while direct_len:
        code = read_direct() & 0x3F
        direct_len -= 1
        if code & 0x20:
            for _ in range((code & 0x1F) + 1):
                out[o] = read_direct() & 0x3F
                direct_len -= 1
                o += 1
        else:
            o += code + 1
    return bytes(out[:out_len])

def decode_psx67(src, bits_size, symbols, out_len):
    """the PlayStation Exoddus scheme, ids 6 (eight-bit codes) and 7 (six-bit),
    a port of paulsapps/alive's CompressionType6or7AePsx (MIT, see LICENSE):
    each block rebuilds a pair-substitution table from the stream, then expands
    coded symbols through it. The input is `symbols` codes long; the output runs
    to wherever the input ends, the rest of the frame staying zero."""
    out = bytearray(out_len)
    o = 0
    fixed = 1 << bits_size
    inv, mask = (fixed >> 1) - 1, fixed - 1
    tmp1, tmp2, tmp3 = [0] * 256, [0] * 256, [0] * 256
    nbits, work, pos = 0, 0, 0
    end = (bits_size * symbols) >> 3

    def nb():
        nonlocal nbits, work, pos
        if nbits < 16:
            work |= (src[pos] | (src[pos + 1] << 8)) << nbits
            pos += 2
            nbits += 16
        nbits -= bits_size
        r = work & mask
        work >>= bits_size
        return r

    while pos < end:
        count = 0
        while True:
            m = nb()
            if m > inv:
                for _ in range(m - inv):
                    tmp2[count] = count & 0xFF
                    count += 1
                m = 0
            if count == fixed:
                break
            for _ in range(m + 1):
                b = nb()
                tmp2[count] = b
                if count != b:
                    tmp1[count] = nb()
                count += 1
            if count == fixed:
                break
        hi = nb() << bits_size
        counter = nb() + hi
        t2i = 0
        while True:
            if t2i:
                t2i -= 1
                t1i = tmp3[t2i]
            else:
                if counter == 0:
                    break
                counter -= 1
                t1i = nb()
            i = tmp2[t1i]
            while t1i != i:
                tmp3[t2i] = tmp1[t1i]
                t2i += 1
                t1i = i
                i = tmp2[i]
            if o < out_len:
                out[o] = t1i
            o += 1
    return bytes(out)

def decode_frame(data, fh_off, game_key):
    """the frame at `fh_off`: its header, decoded rows at the texture pitch, and
    the CLUT it names"""
    fh = frame_header(data, fh_off)
    w, h, bpp, comp = fh["w"], fh["h"], fh["bpp"], fh["comp"]
    pitch = pitch_halfwords(bpp, w) * 2
    out_len = pitch * h
    body = fh_off + 8          # the two words after the header are the payload's own in these
    if comp == 0:
        rows = bytes(data[body:body + out_len])
    elif comp == 2:
        rows = decode_type2(data[fh_off + 12:], out_len)
    elif comp == 3 and game_key == "AO":
        rows = decode_ao_type3(data[fh_off + 12:], struct.unpack_from("<I", data, body)[0], out_len)
    elif comp in (4, 5):
        rows = decompress_4or5(data[body:])
    elif comp in (6, 7) and game_key == "AE":
        rows = decode_psx67(data[fh_off + 12:], 8 if comp == 6 else 6,
                            struct.unpack_from("<I", data, body)[0], out_len)
    else:
        raise ValueError(f"compression {comp} in {game_key}")
    n = struct.unpack_from("<I", data, fh["clut_offset"])[0]
    clut = struct.unpack_from(f"<{n}H", data, fh["clut_offset"] + 4)
    return {"w": w, "h": h, "bpp": bpp, "pitch": pitch, "rows": rows, "clut": clut}

def read_palt(data):
    """the colours of a Palt chunk"""
    n = struct.unpack_from("<I", data, 0)[0]
    return struct.unpack_from(f"<{n}H", data, 4)

def frame_rgba(frame, clut, x=0, y=0, w=None, h=None):
    """RGBA8 of a decoded frame (or a sub-rectangle of a sheet frame) through
    the given colours: 0x0000 clear, the semi-transparency bit marked, the rest opaque"""
    w = frame["w"] if w is None else w
    h = frame["h"] if h is None else h
    rows, pitch, bpp = frame["rows"], frame["pitch"], frame["bpp"]
    px = bytearray(w * h * 4)
    for yy in range(h):
        row = (y + yy) * pitch
        for xx in range(w):
            sx = x + xx
            if bpp == 8:
                at = row + sx
                idx = rows[at] if at < len(rows) else 0
            else:
                at = row + sx // 2
                b = rows[at] if at < len(rows) else 0
                idx = b & 0xF if sx % 2 == 0 else b >> 4
            c = clut[idx] if idx < len(clut) else 0
            if c == 0:
                continue
            o = (yy * w + xx) * 4
            px[o] = (c & 0x1F) << 3
            px[o + 1] = ((c >> 5) & 0x1F) << 3
            px[o + 2] = ((c >> 10) & 0x1F) << 3
            px[o + 3] = ALPHA_STP if c & 0x8000 else ALPHA_OPAQUE
    return bytes(px)

def anim_frames(data, anim, game_key, clut=None):
    """[(w, h, rgba, xoff, yoff, key, bound)] for an animation's frames; `key` names
    the pixels so identical frames pack once"""
    hdr = file_header(data)
    sheet = decode_frame(data, hdr["word8"], game_key) if hdr["sheet"] else None
    out, cache = [], {}
    for fo in anim["frames"]:
        fi = frame_info(data, fo)
        ref = fi["frame_header_offset"]
        if sheet:
            x, y, w, h = ref & 0xFF, (ref >> 8) & 0xFF, (ref >> 16) & 0xFF, ref >> 24
            if ref not in cache:
                cache[ref] = (w, h, frame_rgba(sheet, clut or sheet["clut"], x, y, w, h))
        elif ref not in cache:
            f = decode_frame(data, ref, game_key)
            cache[ref] = (f["w"], f["h"], frame_rgba(f, clut or f["clut"]))
        w, h, px = cache[ref]
        out.append((w, h, px, fi["xoff"], fi["yoff"], ref, fi["bound"]))
    return out

def pack(anims):
    """shelf-pack one family's frames, given per animation as (w, h) lists in the
    order they sit on the sheet: an animation starts a new shelf where the current
    one cannot hold it whole, and runs onto more than one only when it is wider
    than the sheet. Returns [(x, y)] for every frame in order and the sheet's
    size, cut to its widest shelf"""
    placed, x, y, shelf, width = [], 0, 0, 0, 0
    for frames in anims:
        if x and x + sum(w for w, _ in frames) > SHEET_W:
            x, y, shelf = 0, y + shelf, 0
        for w, h in frames:
            if x + w > SHEET_W:
                x, y, shelf = 0, y + shelf, 0
            placed.append((x, y))
            x += w
            shelf = max(shelf, h)
            width = max(width, x)
    return placed, width, y + shelf

def load_anim_table(game_key):
    """the curated animation list for a game: name -> {family, file, rid, anim} or
    {family, bg: rid, anim?}, with an optional palette override [file, rid]; an
    animation that names no family fails the build, having no sheet to go on"""
    table = json.loads(SPRITE_ANIMS.read_text())
    out = {}
    for name, entry in table.items():
        spec = entry.get(game_key.lower())
        if spec:
            if not entry.get("family"):
                raise SystemExit(f"sprites: {name} names no family in {SPRITE_ANIMS.name}")
            out[name] = {**spec, "family": entry["family"]}
    return out

def gather_chunks(levels):
    """(file, rid) -> chunk data over the levels' BAN/BND/CAM files; a chunk repeats
    across levels, and every copy is held to the first"""
    anims, palts, cams = {}, {}, {}
    def keep(table, key, data, where, short):
        first, kept = table.setdefault(key, (short, data))
        if kept != data:
            raise SystemExit(f"sprites: {where} differs between {first} and {short}")
    for short, lvl in levels:
        for fn in sorted(lvl.files):
            ext = fn.rsplit(".", 1)[-1]
            if ext not in ("BAN", "BND", "CAM"):
                continue
            for (tag, rid), data in parse_chunks(lvl.read(fn)).items():
                if tag == "Anim":
                    if ext == "CAM":
                        keep(cams, rid, data, f"camera animation {rid}", short)
                    else:
                        keep(anims, (fn, rid), data, f"{fn} {rid}", short)
                elif tag == "Palt":
                    keep(palts, (fn, rid), data, f"palette {fn} {rid}", short)
    unwrap = lambda table: {k: v[1] for k, v in table.items()}
    return unwrap(anims), unwrap(palts), unwrap(cams)

def build_sprites(game_key, levels):
    """decode every listed animation: (frames to pack, each with its family, the
    sidecar's animations, each with the family it packs in, misses)"""
    table = load_anim_table(game_key)
    anims, palts, cams = gather_chunks(levels)
    frames, index, entries, misses = [], {}, {}, []
    for name in sorted(table):
        spec = table[name]
        if "bg" in spec:
            data, ordinal = cams.get(spec["bg"]), spec.get("anim", 0)
        else:
            data, ordinal = anims.get((spec["file"], spec["rid"])), spec["anim"]
        if data is None:
            misses.append(name)
            continue
        _hdr, walked = walk(data)
        if ordinal >= len(walked):
            misses.append(name)
            continue
        anim = walked[ordinal]
        clut = None
        if "pal" in spec:
            pal = palts.get(tuple(spec["pal"]))
            if pal is None:
                misses.append(name)
                continue
            clut = read_palt(pal)
        family = spec["family"]
        refs = []
        for w, h, px, xoff, yoff, ref, b in anim_frames(data, anim, game_key, clut):
            key = (family, spec.get("file"), spec.get("rid", spec.get("bg")), ref, tuple(spec.get("pal", ())))
            if key not in index:
                index[key] = len(frames)
                frames.append((family, w, h, px))
            refs.append([index[key], xoff, yoff, b])
        entries[name] = {"family": family, "fps": anim["fps"], "loop": anim["loop"],
                         "loop_start": anim["loop_start"], "frames": refs}
    return frames, entries, misses

def permutation_windows(data):
    """offsets of every 256-byte run holding each byte value exactly once"""
    counts, distinct, hits = [0] * 256, 0, []
    for i, b in enumerate(data):
        counts[b] += 1
        if counts[b] == 1:
            distinct += 1
        if i >= 256:
            old = data[i - 256]
            counts[old] -= 1
            if counts[old] == 0:
                distinct -= 1
        if distinct == 256:
            hits.append(i - 255)
    return hits

def executable(disc):
    """(name, bytes) of the disc's executable"""
    name = next(n for n in sorted(disc.files) if n.startswith("SLUS_"))
    return name, disc.read(*disc.files[name])

def read_dice(disc):
    """the engine's random table, read off the disc's executable: Math_NextRandom
    walks a 256-byte permutation of 0..255, and the executable holds exactly one"""
    name, exe = executable(disc)
    hits = permutation_windows(exe)
    if len(hits) != 1:
        raise SystemExit(f"sprites: {name} holds {len(hits)} candidate random tables, expected one")
    return list(exe[hits[0]:hits[0] + 256])

def glyph_table_windows(exe, w, h):
    """offsets of every window of GLYPH_COUNT {u8 x, y, w, h} entries shaped like the
    LCD font's table: the glyph gap and then the space width, each a width alone and
    the gap the narrower; a glyph for every letter, the lowercase entries repeating
    the uppercase ones; the twelve button glyphs; every entry inside the w x h
    texture; and nothing in the slot past the end"""
    upper = [glyph_index(c) for c in range(ord("A"), ord("Z") + 1)]
    lower = [glyph_index(c) for c in range(ord("a"), ord("z") + 1)]
    buttons = [glyph_index(c) for c in MESSAGE_BUTTONS]
    def entry(off, i):
        return exe[off + 4 * i:off + 4 * i + 4]
    hits = []
    for off in range(len(exe) - 4 * (GLYPH_COUNT + 1)):
        gap, space = entry(off, 0), entry(off, 1)
        if gap[0] or gap[1] or gap[3] or space[0] or space[1] or space[3] or not 0 < gap[2] < space[2]:
            continue
        if any(entry(off, u) != entry(off, l) for u, l in zip(upper, lower)):
            continue
        if any(not (entry(off, i)[2] and entry(off, i)[3]) for i in upper + buttons):
            continue
        if any(e[0] + e[2] > w or e[1] + e[3] > h for e in (entry(off, i) for i in range(GLYPH_COUNT))):
            continue
        if entry(off, GLYPH_COUNT) == b"\0\0\0\0":
            hits.append(off)
    return hits

def read_font_texture(levels):
    """(w, h, texels) of the LCD font, every level's copy held to the first: its 4bpp
    texels, low nibble first, unpacked to one palette index a texel"""
    first = None
    for short, lvl in levels:
        if FONT_FILE not in lvl.files:
            continue
        data = parse_chunks(lvl.read(FONT_FILE)).get(("Font", FONT_RID))
        if data is None:
            raise SystemExit(f"sprites: {short}'s {FONT_FILE} holds no Font chunk {FONT_RID}")
        if first is None:
            first = (short, data)
        elif first[1] != data:
            raise SystemExit(f"sprites: {FONT_FILE} differs between {first[0]} and {short}")
    if first is None:
        raise SystemExit(f"sprites: no level carries {FONT_FILE}")
    data = first[1]
    w, h, depth, colours = struct.unpack_from("<hhhh", data, 0)
    if depth != 4 or w % 2:
        raise SystemExit(f"sprites: {FONT_FILE} is {w} wide at {depth} bits a texel, expected an even width at 4")
    packed = data[8 + 2 * colours:8 + 2 * colours + w * h // 2]
    texels = bytearray(w * h)
    for i, b in enumerate(packed):
        texels[2 * i] = b & 0xF
        texels[2 * i + 1] = b >> 4
    return w, h, bytes(texels)

def read_glyph_table(discs, w, h):
    """the LCD font's glyph table, read off every disc's executable, which must agree"""
    tables = set()
    for disc in discs:
        name, exe = executable(disc)
        hits = glyph_table_windows(exe, w, h)
        if len(hits) != 1:
            raise SystemExit(f"sprites: {name} holds {len(hits)} candidate LCD glyph tables, expected one")
        tables.add(tuple(bytes(exe[hits[0] + 4 * i:hits[0] + 4 * i + 4]) for i in range(GLYPH_COUNT)))
    if len(tables) != 1:
        raise SystemExit("sprites: the discs disagree on the LCD glyph table")
    return [list(e) for e in tables.pop()]

def read_font(levels):
    """the LCD font: its texture and the glyph table the file does not hold"""
    w, h, texels = read_font_texture(levels)
    return {"w": w, "h": h, "texels": texels,
            "glyphs": read_glyph_table({lvl.disc for _, lvl in levels}, w, h)}

def index_map_rgba(texels):
    """a texture of palette indices as RGBA8: the index in every channel, opaque"""
    return bytes(b for i in texels for b in (i, i, i, 255))

def sheet_name(w, h, rgba):
    """a sheet is named for its pixels and its shape, so a changed one is a new URL
    while an unchanged rebuild or a re-encode keeps the old one"""
    s = hashlib.sha1(struct.pack("<II", w, h))
    s.update(hashlib.sha1(rgba).digest())
    return s.hexdigest()[:12]

def family_sheet(family, names, entries, frames):
    """(w, h, rgba) of a family's sheet and where each of its frames went: its
    animations in the order given, each frame once, where it first appears"""
    order, anims, seen = [], [], set()
    for name in names:
        group = []
        for i, *_ in entries[name]["frames"]:
            if i not in seen:
                seen.add(i)
                group.append(i)
        order += group
        anims.append([frames[i][1:3] for i in group])
    spots, w, h = pack(anims)
    if h > SHEET_MAX_H:
        raise SystemExit(f"sprites: the {family} sheet needs {h} rows, past {SHEET_MAX_H}: "
                         f"split the family in {SPRITE_ANIMS.name}")
    img = bytearray(w * h * 4)
    for i, (x, y) in zip(order, spots):
        _, fw, fh, px = frames[i]
        for yy in range(fh):
            at = ((y + yy) * w + x) * 4
            img[at:at + fw * 4] = px[yy * fw * 4:(yy + 1) * fw * 4]
    return (w, h, bytes(img)), dict(zip(order, spots))

def write_sprites(game_key, levels, out, sheets_rel, abe=None, links=None):
    """a sheet per family and the LCD font's index map, each under `sheets_rel`
    named for its family and its pixels, nothing else left there, and the game's
    sprites sidecar beside the data file, carrying the font's glyph table, the
    per-path Abe start where the game places a device by it and each collision
    line's previous and next links, which the engine's line following walks;
    misses fail the build, since a name the viewer may ask for must not be left
    out silently"""
    frames, entries, misses = build_sprites(game_key, levels)
    if misses:
        raise SystemExit(f"sprites: {len(misses)} listed animations not found on the discs: "
                         + ", ".join(misses))
    families = {}
    for name, entry in entries.items():
        families.setdefault(entry.pop("family"), []).append(name)
    if FONT_FAMILY in families:
        raise SystemExit(f"sprites: {FONT_FAMILY} is the LCD font's own sheet, which no animation may name")
    sheets, placed = {}, {}
    for family, names in sorted(families.items()):
        sheets[family], spots = family_sheet(family, names, entries, frames)
        placed.update({i: (family, x, y) for i, (x, y) in spots.items()})
    font = read_font(levels)
    sheets[FONT_FAMILY] = (font["w"], font["h"], index_map_rgba(font["texels"]))
    sheet_files = {family: f"{sheets_rel}/{family}.{sheet_name(*sheet)}.png" for family, sheet in sorted(sheets.items())}
    for entry in entries.values():
        entry["frames"] = [[*placed[i], *frames[i][1:3], xoff, yoff, *bound]
                           for i, xoff, yoff, bound in entry["frames"]]
    dice = {tuple(read_dice(disc)) for disc in {lvl.disc for _, lvl in levels}}
    if len(dice) != 1:
        raise SystemExit("sprites: the discs disagree on the random table")
    sidecar = {"sheets": sheet_files, "anims": entries, "dice": list(dice.pop()),
               "font": {"sheet": FONT_FAMILY, "w": font["w"], "h": font["h"], "glyphs": font["glyphs"]}}
    if abe:
        sidecar["abe"] = abe
    if links:
        sidecar["links"] = {short: {pid: [row[:2] for row in rows] for pid, rows in paths.items()}
                            for short, paths in sorted(links.items())}

    # what is no sheet of this build goes before the sheets are written, so a
    # family renamed only in case is written afresh on a filesystem blind to case
    def remove(p):
        if p.is_dir():
            shutil.rmtree(p)
        else:
            p.unlink()
    sheets_dir = out / sheets_rel
    kept = {rel.rsplit("/", 1)[1] for rel in sheet_files.values()}
    for old in sheets_dir.iterdir() if sheets_dir.is_dir() else ():
        if old.name not in kept or not old.is_file():
            remove(old)
    sheets_dir.mkdir(parents=True, exist_ok=True)
    for family, (w, h, rgba) in sheets.items():
        write_png(out / sheet_files[family], w, h, rgba, keep_alpha=True)
    dst = out / f"sprites_{game_key.lower()}.json"
    dst.write_text(json.dumps(sidecar, indent=1))
    print(f"sprites -> {dst} ({len(entries)} animations, {len(frames)} frames on {len(sheet_files)} sheets, "
          f"one per family and the font)")
    return dst
