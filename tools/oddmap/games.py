"""Per-game profile: which levels a build walks, which decoders and tables it
uses, and where its outputs go."""
from oddmap.decomp import load_cache, parse_pathdata_cpp_ae, parse_pathdata_cpp_ao
from oddmap.schema import load_object_schema
from oddmap.tables import AO_LEVELS, AO_TLV_NAMES
from oddmap.tlv import tlv_extra_ae, tlv_extra_ao

GAMES = {
    "AO": {
        "title": "Oddworld: Abe's Oddysee",
        "data_file": "map_data_ao.json",
        "cams_dir": "cams/ao",
        "cache": "pathdata_ao.json",
        "schema_cache": "objects_ao.json",
        "enum_cache": "enums_ao.json",
        "relive_cache": "relive_ao.json",
        "links_file": "lines_ao.json",
        "relive_export_file": "relive_export_ao.json",
        "field_types_file": "field_types_ao.json",
        "enum_labels_file": "enum_labels_ao.json",
        "messages_file": "messages_ao.json",
        "env": "ODDWORLD_DISC_AO",
        "geometry": {"cellW": 368, "cellH": 240, "worldW": 1024, "worldH": 480,
                     "winX": 256, "winY": 120, "visW": 368, "visH": 240},
        "tlv": {"header_len": 0x18, "rect_off": 0x10, "min_len": 24, "max_len": 480,
                "max_type": 115, "check_flags": True, "extra_fn": tlv_extra_ao},
        "line_links": (("previous", 0x0C, "i"), ("next", 0x10, "i")),
        # the render layer each FG1 block layer id draws on
        "fg1_layers": (37, 18),
        "path_record": {"rect": 4, "objects": 20, "collision": 12, "overlay": 12, "files_from": "\\S1.OVL;1"},
        # whether a camera lists an object by its rect's midpoint, else its top-left corner
        "filed_by_midpoint": False,
        # a release's camera is its own where any pixel differs: the smallest
        # edit the census found sits among the re-encodes
        "camera_gate": None,
        "parse_tables": parse_pathdata_cpp_ao,
    },
    "AE": {
        "title": "Oddworld: Abe's Exoddus",
        "data_file": "map_data_ae.json",
        "cams_dir": "cams/ae",
        "cache": "pathdata_ae.json",
        "schema_cache": "objects_ae.json",
        "enum_cache": "enums_ae.json",
        "relive_cache": "relive_ae.json",
        "links_file": "lines_ae.json",
        "relive_export_file": "relive_export_ae.json",
        "field_types_file": "field_types_ae.json",
        "enum_labels_file": "enum_labels_ae.json",
        "messages_file": "messages_ae.json",
        "env": "ODDWORLD_DISC_AE",
        "geometry": {"cellW": 368, "cellH": 240, "worldW": 375, "worldH": 260,
                     "winX": 0, "winY": 0, "visW": 368, "visH": 240},
        "tlv": {"header_len": 0x10, "rect_off": 0x08, "min_len": 16, "max_len": 512,
                "max_type": 150, "check_flags": False, "extra_fn": tlv_extra_ae},
        "line_links": (("previous", 0x0A, "h"), ("next", 0x0C, "h"), ("previous_2", 0x0E, "h"),
                       ("next_2", 0x10, "h"), ("length", 0x12, "h")),
        "fg1_layers": (4, 18, 23, 37),
        "path_record": {"rect": 0, "objects": 12, "collision": 0, "abe": 20},
        "filed_by_midpoint": True,
        # a release's camera is its own where some window's mean luma moves this
        # far, and a camera inside the margin needs a verdict
        "camera_gate": 16, "camera_margin": 4,
        "parse_tables": parse_pathdata_cpp_ae,
    },
}

def game_setup(game_key):
    """resolve per-game level list, tlv names and tables (loading the cache)"""
    game = dict(GAMES[game_key])
    cache = load_cache(game)
    if game_key == "AO":
        game["levels"] = AO_LEVELS
        game["tlv_names"] = AO_TLV_NAMES
        game["tables"] = {short: {int(k): v for k, v in paths.items()} for short, paths in cache.items()}
    else:
        game["levels"] = [tuple(l) for l in cache["levels"]]
        game["tlv_names"] = {int(k): v for k, v in cache["tlv_names"].items()}
        game["tables"] = {short: {int(k): v for k, v in paths.items()} for short, paths in cache["tables"].items()}
        game["tlv"] = dict(game["tlv"])
        game["tlv"]["max_type"] = max(game["tlv_names"])
    # TLV destinations name ender level ids too, so the id map must cover every
    # id, not just the one kept per archive in the level list
    game["level_short"] = {lid: s for lid, s, _ in game["levels"]} if game_key == "AO" \
        else {int(k): v for k, v in cache["id_to_short"].items()}
    # the layout overrides are checked against tlv_names, so the schema resolves after it
    game["schema"] = load_object_schema(game_key, game)
    return game
