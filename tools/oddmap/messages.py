"""The games' own LCD and hint-fly message tables, lifted from the level
overlays."""
import json
import re
import struct

# The scroll-in run of spaces every LCD message opens with; the engine's own
# source calls it out as something that should have been added at runtime.
MESSAGE_LEAD = " " * 31

# Button commands a message can name, as the font's own code points. Only the
# viewer names them; the build fails on a code outside this range so a name can
# never be missing at the point one is needed.
MESSAGE_BUTTONS = range(0x08, 0x14)

# The string tables to lift, per game: how many entries each holds, and whether
# its messages open on the scroll-in lead. Each is a pointer array plus a
# 4-byte-aligned string blob compiled into the level overlays rather than into
# the executable, so the sweep reads *.OVL, and each is found by its shape, so
# a release's own wording needs no anchor.
MESSAGE_TABLES = {
    "AO": {"lcd": (90, True), "hintfly": (36, False)},
    "AE": {"lcd": (101, True)},
}
LEAD = len(MESSAGE_LEAD)

def _locate(blob, anchor, lead, count):
    """(the table's first word, the overlay's load address) of a pointer table
    whose entry `lead` is `anchor`, or None.

    Anchoring on a string rather than an address derives the overlay's load base
    from the data itself. The table is found by the run of gaps between the first
    strings, which is a signature no other array shares, and is believed only if
    the slot past its declared end points nowhere: that is what makes the length
    self-proving rather than asserted."""
    at = blob.find(anchor.encode("latin1"))
    if at < 0:
        return None
    starts, pos = [], at
    for _ in range(8):
        end = blob.find(b"\x00", pos)
        if end < 0:
            return None             # the anchor sits too near the end to read a run
        starts.append(pos)
        pos = end + 1
        while pos < len(blob) and blob[pos] == 0:   # alignment padding between strings
            pos += 1
        if pos >= len(blob):
            return None
    gaps = [starts[i + 1] - starts[i] for i in range(len(starts) - 1)]
    words = struct.unpack_from(f"<{len(blob) // 4}I", blob, 0)
    for q in range(lead, len(words) - max(count - lead, len(gaps))):
        if all(words[q + i + 1] - words[q + i] == gaps[i] for i in range(len(gaps))):
            table = q - lead
            base = words[q] - starts[0]
            if _read(blob, words, table, base, count) is not None:
                return table, base
            return None
    return None

def _read(blob, words, table, base, count):
    """the `count` strings a table names, or None where one points out of the
    overlay or the slot past the end points into it"""
    out = []
    for i in range(count):
        off = words[table + i] - base
        end = blob.find(b"\x00", off) if 0 <= off < len(blob) else -1
        if end < 0:
            return None
        out.append(blob[off:end].decode("latin1"))
    if 0 <= words[table + count] - base < len(blob):
        return None
    return out

def string_table(blob, anchor, lead, count):
    """the `count` C strings of a pointer table whose entry `lead` is `anchor`"""
    found = _locate(blob, anchor, lead, count)
    if found is None:
        return None
    words = struct.unpack_from(f"<{len(blob) // 4}I", blob, 0)
    return _read(blob, words, found[0], found[1], count)

LEAD_RUN = re.compile(rb"(.)\1{%d}(?!\1)[^\x00]" % (LEAD - 1), re.S)

def lead_table(blob, count):
    """(strings, the overlay's load address) of the table whose entry 1 is the
    first string opening on a run of the scroll-in lead, in whatever character
    the release's font spaces with, or None"""
    for m in LEAD_RUN.finditer(blob):
        at = m.start()
        if m.group(1) == b"\x00" or not (at == 0 or blob[at - 1] == 0 or at % 4 == 0) \
                or (at and blob[at - 1] == blob[at]):
            continue
        anchor = blob[at:blob.find(b"\x00", at)].decode("latin1")
        found = _locate(blob, anchor, 1, count)
        if found is not None:
            words = struct.unpack_from(f"<{len(blob) // 4}I", blob, 0)
            return _read(blob, words, found[0], found[1], count), found[1]
    return None

TEXT = re.compile(rb"[\x08-\x13\x20-\xfe]{1,160}\x00")

def pointer_tables(blob, count, base):
    """every table of exactly `count` pointers to text in an overlay loaded at
    `base`, bounded on both sides by a word that is none, whose entries name more
    than half as many strings as it has slots: the arrays of one pointer
    repeated that the overlays also hold are no message table"""
    words = struct.unpack_from(f"<{len(blob) // 4}I", blob, 0)
    def text(w):
        off = w - base
        return 0 <= off < len(blob) and off % 4 == 0 and TEXT.match(blob, off) is not None
    found, run = [], 0
    for q, w in enumerate(list(words) + [0]):
        if text(w):
            run += 1
            continue
        if run == count and len(set(words[q - run:q])) * 2 > count:
            found.append(_read(blob, words, q - run, base, count))
        run = 0
    return found

def overlay_tables(game_key, discs, overlays=None):
    """{table: {overlay: its strings}} over every overlay carrying a table.

    `overlays` limits the sweep to the overlays the game's paths load, where the
    executable names them: a disc can carry an overlay no path loads, built
    from older sources. Every overlay of a build loads at one address, which
    the tables opening on the lead give and the others are found at."""
    specs = sorted(MESSAGE_TABLES[game_key].items())
    blobs = []
    for disc in discs:
        for ovl in sorted(f for f in disc.files if f.endswith(".OVL")):
            if overlays is None or ovl in overlays:
                blobs.append((ovl, disc.read(*disc.files[ovl])))   # read once, offered to every table
    found = {name: {} for name, _ in specs}
    bases = set()
    for name, (count, lead) in specs:
        if not lead:
            continue
        for ovl, blob in blobs:
            table = lead_table(blob, count)
            if table:
                found[name].setdefault(ovl, table[0])
                bases.add(table[1])
    if len(bases) > 1:
        raise RuntimeError(f"{game_key}: the overlays load at {len(bases)} addresses: "
                           + ", ".join(hex(b) for b in sorted(bases)))
    for name, (count, lead) in specs:
        if lead:
            continue
        for ovl, blob in blobs:
            for base in bases:
                tables = pointer_tables(blob, count, base)
                if len(tables) > 1:
                    raise RuntimeError(f"{game_key}: {ovl} holds {len(tables)} candidate {name} tables")
                if tables:
                    found[name][ovl] = tables[0]
    return found

def clean_table(game_key, name, table, controls=MESSAGE_BUTTONS):
    """a table's messages without the scroll-in lead, every code below a space
    one of `controls`"""
    # the lead is the font's space; stripping whitespace would also eat a
    # trailing button code, 0x09-0x0d being both
    lead = table[1][:1] if MESSAGE_TABLES[game_key][name][1] and len(table) > 1 and table[1] else " "
    out = [s.strip(lead) for s in table]
    for msg in out:
        unknown = {c for c in msg if ord(c) < 0x20 and ord(c) not in controls}
        if unknown:
            raise RuntimeError(f"{game_key} {name}: unnamed button code(s) "
                               f"{sorted(hex(ord(c)) for c in unknown)} in {msg!r}")
    return out

def extract_messages(game_key, discs, overlays=None, controls=MESSAGE_BUTTONS):
    """the game's message tables, read from every overlay carrying them.

    Each table is compiled into every overlay whose level needs it, so the
    copies are a free cross-check: they must all agree, and one disagreeing
    means the tables are per-level and nothing here holds."""
    out = {}
    for name, copies in sorted(overlay_tables(game_key, discs, overlays).items()):
        count = MESSAGE_TABLES[game_key][name][0]
        variants = {}
        for ovl, table in copies.items():
            variants.setdefault(tuple(table), []).append(ovl)
        if not variants:
            raise RuntimeError(f"{game_key}: no overlay carries the {name} message table")
        if len(variants) > 1:
            raise RuntimeError(f"{game_key}: overlays disagree on the {name} message table: "
                               + "; ".join(",".join(v) for v in variants.values()))
        table = clean_table(game_key, name, list(next(iter(variants))), controls)
        out[name] = table
        print(f"  {name}: {sum(1 for s in table if s)} of {count} messages, "
              f"{len(copies)} identical copies")
    return out

SHORTHAND = re.compile(r"(?<!\\)((?:\\\\)*)\\([btnfr])")

def message_json(tables):
    """the tables as JSON, every code below a space written \\u00XX.

    json's shorthand for 0x08-0x0d would put \\n and \\t in the middle of a
    sentence, where they read as whitespace rather than as the button they are.
    A shorthand is rewritten only where its backslash is no escaped one, so a
    release whose font draws a glyph at the backslash's code reads exactly."""
    codes = {"b": 0x08, "t": 0x09, "n": 0x0A, "f": 0x0C, "r": 0x0D}
    return SHORTHAND.sub(lambda m: m.group(1) + "\\u%04x" % codes[m.group(2)], json.dumps(tables, indent=1))

def write_messages(game_key, discs, dst, overlays=None):
    """the viewer's message sidecar for one game: {table: [message by id]}.

    Needs the discs: the decomp carries both LCD tables in source, but those are
    the PC build's and differ from PS1's in wording, not only in button names."""
    tables = extract_messages(game_key, discs, overlays)
    if any("\\" in msg for t in tables.values() for msg in t):
        raise RuntimeError(f"{game_key}: a message contains a backslash")
    dst.parent.mkdir(parents=True, exist_ok=True)
    dst.write_text(message_json(tables))
    print(f"messages -> {dst}")
    return dst
