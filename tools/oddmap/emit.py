"""What a build produces besides the map data: the viewer's field-data sidecars,
the service worker's artwork stamp, and the build summary."""
import gzip
import hashlib
import json
import re
import sys

from oddmap import relive
from oddmap.decomp import load_cache
from oddmap.games import game_setup
from oddmap.paths import HERE
from oddmap.schema import load_enum_labels

# decomp quirks corrected when emitting field_types (the schema cache stays
# faithful to the source): a field whose declared type contradicts its meaning
# gets the type it behaves as, keyed (game, object, field) to (the type the
# schema derives today, None for a bare word, and the type to emit), so an
# upstream move spends the entry the way a layout correction's does
_FIELD_TYPE_OVERRIDES = {
    # a boolean declared as a direction instead of choice
    ("AE", "SligSpawner", "chase_abe_when_spotted"): ("XDirection_short", "Choice_short"),
}

def write_field_types(game_key, out):
    """the viewer's field->game-type sidecar for one game: {object: {field: type}}
    over the enum-typed fields only. Derived from the schema cache alone (no disc),
    keyed by object name the way the viewer sees it, so it maps a shown field to
    the type its value transform is keyed by."""
    game = game_setup(game_key)
    ft = {}
    for tid, rows in game["schema"].items():
        name = game["tlv_names"].get(tid)
        typed = {r[1]: r[2] for r in rows if len(r) > 2}
        if name and typed:
            ft[name] = {k: typed[k] for k in sorted(typed)}
    names = {game["tlv_names"].get(tid): rows for tid, rows in game["schema"].items()}
    for (gk, obj, fld), (derived, ty) in _FIELD_TYPE_OVERRIDES.items():
        if gk != game_key:
            continue
        row = next((r for r in names.get(obj) or [] if r[1] == fld), None)
        if row is None:
            raise RuntimeError(f"stale field-type override: {gk} {obj}.{fld}")
        actual = row[2] if len(row) > 2 else None
        if actual == ty:
            raise RuntimeError(f"spent field-type override: the schema types {gk} {obj}.{fld} as {ty} itself")
        if actual != derived:
            raise RuntimeError(f"spent field-type override: {gk} {obj}.{fld} derives as {actual}, not {derived}")
        ft.setdefault(obj, {})[fld] = ty
    dst = out / game["field_types_file"]
    dst.parent.mkdir(parents=True, exist_ok=True)
    dst.write_text(json.dumps({k: ft[k] for k in sorted(ft)}, indent=1))
    print(f"field types -> {dst} ({len(ft)} object types)")
    return dst

def write_relive_export(game_key, out, links_dir=HERE / "data"):
    """everything an export needs that the served site does not already carry:
    relive's schema, the payload layouts the field names join through and —
    Exoddus alone reading them from data rather than from a constant — its Abe
    starts and mud table — and the level-id map a destination's short is read
    through, all from the committed caches; and the collision links from
    `links_dir`, the cache unless a build hands over the ones it has just written.
    It is served rather than cached because a page cannot read tools/data."""
    game = game_setup(game_key)
    rel = json.loads((HERE / "data" / game["relive_cache"]).read_text())
    doc = {"schema": rel,
           "layouts": {str(tid): rows for tid, rows in sorted(game["schema"].items())},
           "links": json.loads((links_dir / game["links_file"]).read_text()),
           # JS reorders an object's integer-like keys, so the order schema_blob
           # reads out of the enum tables has to be carried rather than inferred
           "enum_values": {name: list(table.values()) for name, table in rel["enums"].items()},
           "basic_types": relive.BASIC_TYPES_JSON,
           "base_properties": relive.BASE_PROPS,
           # the served level list keeps one level per archive, so the ender ids
           # destinations name reach the page only through this map
           "level_short": {str(k): v for k, v in sorted(game["level_short"].items())},
           "fallbacks": {}}
    for (gk, literal, prop), v in sorted(relive.EXPORT_VALUE_FALLBACKS.items()):
        if gk == game_key:
            doc["fallbacks"].setdefault(literal, {})[prop] = v
    if game_key == "AE":
        cache = load_cache(game)
        doc["muds_in_level"] = cache["muds_in_level"]
        doc["abe"] = {short: {pid: [row["abe_x"], row["abe_y"]]
                              for pid, row in sorted(rows.items(), key=lambda kv: int(kv[0]))}
                      for short, rows in sorted(cache["tables"].items())}
    dst = out / game["relive_export_file"]
    dst.parent.mkdir(parents=True, exist_ok=True)
    dst.write_text(json.dumps(doc, indent=1))
    print(f"relive export data -> {dst} ({len(doc['schema']['structures'])} object types)")
    return dst

def write_line_links(game_key, links, dst, merge):
    """the words trailing each collision line's coordinates and type, per level and
    path. Read off the disc like the messages and kept out of the map data, which
    first paint waits for: the exporter needs them to write a lossless document and
    no viewer surface draws them, so they reach the page through the export
    sidecar, fetched on the first export press, and, as each line's previous and
    next alone, through the sprite sidecar. A subset build merges, as the map
    data does."""
    columns = [name for name, _off, _code in game_setup(game_key)["line_links"]]
    if merge and dst.exists():
        merged = json.loads(dst.read_text())["paths"]
        merged.update(links)
        links = merged
    dst.parent.mkdir(parents=True, exist_ok=True)
    dst.write_text(json.dumps({"columns": columns,
                               "paths": {k: links[k] for k in sorted(links)}}, indent=1))
    rows = sum(len(rows) for paths in links.values() for rows in paths.values())
    print(f"collision links -> {dst} ({rows} lines)")
    return links

def write_enum_labels(game_key, out):
    """the viewer's enum-value labels sidecar for one game: {type: {value: label}}.
    Generated from the decomp's enum sweep (cached, no disc) so the viewer renders
    enum ints as words without hand-maintaining them; keyed by the same game type
    as field_types and limited to the types some field is actually declared as, so
    it ships only labels the viewer can use (the decomp defines many enums that
    aren't fields)."""
    game = game_setup(game_key)
    used = {r[2] for tid, rows in game["schema"].items() if game["tlv_names"].get(tid)
            for r in rows if len(r) > 2}
    used |= {ty for (gk, _, _), (_, ty) in _FIELD_TYPE_OVERRIDES.items() if gk == game_key}
    labels, bad = load_enum_labels(game_key, game)
    broken = used & bad
    if broken:  # a used type must never ship silently unlabelled or mislabelled
        raise RuntimeError(f"{game_key}: field types with unlabelable enums: {sorted(broken)}")
    kept = {t: {str(v): labels[t][v] for v in sorted(labels[t])}
            for t in sorted(labels) if t in used}
    dst = out / game["enum_labels_file"]
    dst.parent.mkdir(parents=True, exist_ok=True)
    dst.write_text(json.dumps(kept, indent=1))
    print(f"enum labels -> {dst} ({len(kept)} of {len(labels)} enum types used)")
    return dst

CACHE_NAME_LINE = re.compile(r'(?m)^const CACHE_NAME = "[^"]*";$')

def cams_stamp(cams_dir):
    """name the artwork cache after the artwork, so regenerating a PNG expires it
    and a build that decodes nothing leaves every visitor's copy alone. One worker
    serves both games, so the stamp answers to either tree."""
    h = hashlib.sha1()
    for rel in sorted(p.relative_to(cams_dir).as_posix() for p in cams_dir.rglob("*.png")):
        h.update(rel.encode())
        h.update(hashlib.sha1((cams_dir / rel).read_bytes()).digest())
    return f"cams-{h.hexdigest()[:12]}"

def require_stampable(sw_file):
    """a worker that cannot be stamped fails before the build spends its time,
    not after it has written everything except the line it could not find"""
    if not CACHE_NAME_LINE.search(sw_file.read_text()):
        sys.exit(f"{sw_file.name}: no CACHE_NAME line to stamp")

def stamp_cache_name(sw_file, cams_dir):
    name = cams_stamp(cams_dir)
    src = sw_file.read_text()
    new, hits = CACHE_NAME_LINE.subn(f'const CACHE_NAME = "{name}";', src, count=1)
    if not hits:  # returning a name nothing carries would report a stamp that isn't there
        sys.exit(f"{sw_file.name}: no CACHE_NAME line to stamp")
    if new != src:
        sw_file.write_text(new)
    return name

def print_build_summary(game_key, built, data_file, all_levels, cam_stats, cache_name):
    """report card for the finished build: geometry counts, object-field
    coverage, the raw= health line, the data file's on-disk + gzip size, and the
    name the artwork cache now carries.
    `built` is the levels built this run — a subset build merges into a larger
    file, whose full level count is reported alongside."""
    paths = sum(len(L["paths"]) for L in built)
    lines = sum(len(P["lines"]) for L in built for P in L["paths"])
    tlvs = [t for L in built for P in L["paths"] for t in P["tlvs"]]
    types = {t["name"] for t in tlvs}
    with_fields = sum(1 for t in tlvs if "fields" in t)
    raw = {}
    for t in tlvs:
        if "raw" in t.get("extra", {}):
            raw[t["name"]] = raw.get(t["name"], 0) + 1
    blob = data_file.read_bytes()
    cams = cam_stats["reused"] + cam_stats["decoded"] + cam_stats["failed"]

    def row(k, v):
        print(f"  {k:<10} {v}")
    print(f"\n=== {game_key} build summary ===")
    scope = f" of {len(all_levels)} in the file" if len(built) != len(all_levels) else ""
    row("levels", f"{len(built)} built{scope}")
    row("paths", paths)
    row("cameras", f"{cams}  ({cam_stats['decoded']} decoded, {cam_stats['reused']} reused"
        + (f", {cam_stats['failed']} missing/failed" if cam_stats["failed"] else "") + ")")
    row("collision", f"{lines} lines")
    row("objects", f"{len(tlvs)} TLVs across {len(types)} types")
    if tlvs:
        row("fields", f"{with_fields} carry an archive ({100 * with_fields // len(tlvs)}% of objects)")
    row("raw=", f"{sum(raw.values())} undecoded across {len(raw)} types {raw} — will fail the invariant test"
        if raw else "0 (every object decoded)")
    row("data file", f"{data_file.name}  {len(blob) / 1e6:.1f} MB raw / {len(gzip.compress(blob)) // 1024} KB gzip")
    if cache_name:
        row("cam cache", cache_name)
