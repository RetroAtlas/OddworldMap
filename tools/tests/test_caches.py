"""Tests for the committed caches and the pins: the schema, pathdata and enum
caches against a fresh parse of the pinned checkout, which skip where no
checkout is found beside the repo or at $ODDWORLD_DECOMP (CI points it at a
clone of the pin) and fail where the variable names a path that holds none, the
collision links at their hand-written offsets, and the docs naming both pins."""

import json
import math
import sys
import unittest
from pathlib import Path
from unittest import mock

sys.path[:0] = [str(Path(__file__).resolve().parents[1]), str(Path(__file__).resolve().parent)]

from oddmap import games, image, schema  # noqa: E402
from oddmap.paths import AO_COMMIT, DECOMP_COMMIT, HERE, SITE  # noqa: E402
from decomp_checkout import needs_decomp, stale  # noqa: E402


class SchemaCaches(unittest.TestCase):
    def cached_layout(self, game_key):
        """a (tid, layout) pair the parser derives on its own, so an override of
        it has nothing left to add. Read from the cache rather than from
        game_setup, whose schema already carries the overrides."""
        cache = HERE / "data" / games.GAMES[game_key]["schema_cache"]
        names = games.game_setup(game_key)["tlv_names"]
        return next((int(k), v) for k, v in json.loads(cache.read_text()).items()
                    if int(k) in names)

    def assertOverrideFails(self, game_key, tid, layout):
        entry = {(game_key, tid): layout}
        with mock.patch.dict(schema._SCHEMA_LAYOUT_OVERRIDES, entry), self.assertRaises(RuntimeError):
            games.game_setup(game_key)

    def test_a_layout_override_for_an_unknown_type_fails_the_build(self):
        self.assertOverrideFails("AO", 9999, [])

    def test_a_layout_override_the_parser_derives_fails_the_build(self):
        tid, layout = self.cached_layout("AO")
        self.assertOverrideFails("AO", tid, layout)

    def test_an_empty_override_cannot_blank_a_derived_layout(self):
        tid, _ = self.cached_layout("AO")
        self.assertOverrideFails("AO", tid, [])

    def test_cached_layouts_are_word_and_name_pairs(self):
        for game_key in ("AO", "AE"):
            cache = HERE / "data" / games.GAMES[game_key]["schema_cache"]
            for tid, rows in json.loads(cache.read_text()).items():
                for row in rows:
                    self.assertIn(len(row), (2, 3), f"{cache.name} type {tid}: {row}")
                    self.assertIsInstance(row[0], int)
                    self.assertRegex(row[1], r"^[a-z0-9_]+$")

    def test_a_linked_member_is_cached_like_its_neighbours(self):
        for game_key in ("AO", "AE"):
            names = games.game_setup(game_key)["tlv_names"]
            tid = next(t for t, n in names.items() if n == "ShadowZone")
            cache = HERE / "data" / games.GAMES[game_key]["schema_cache"]
            rows = json.loads(cache.read_text())[str(tid)]
            self.assertEqual([r for r in rows if r[1] in ("r", "g", "b")],
                             [[2, "r"], [3, "g"], [4, "b"]], f"{game_key} ShadowZone")

    @needs_decomp
    def test_the_committed_cache_matches_a_fresh_parse(self):
        for game_key in ("AO", "AE"):
            cache = HERE / "data" / games.GAMES[game_key]["schema_cache"]
            self.assertEqual(
                cache.read_text(),
                json.dumps(schema.parse_object_schema(game_key), indent=1),
                stale(cache.name),
            )


class PathdataCache(unittest.TestCase):
    @needs_decomp
    def test_the_committed_cache_matches_a_fresh_parse(self):
        for game_key in ("AO", "AE"):
            game = games.GAMES[game_key]
            self.assertEqual(
                (HERE / "data" / game["cache"]).read_text(),
                json.dumps(game["parse_tables"](), indent=1),
                stale(game["cache"]),
            )

    def test_the_ae_cache_carries_abe_start_and_the_mud_table(self):
        raw = json.loads((HERE / "data" / games.GAMES["AE"]["cache"]).read_text())
        self.assertEqual(len(raw["muds_in_level"]), 15)
        for v in raw["muds_in_level"]:
            self.assertIsInstance(v, int)
        for short, paths in raw["tables"].items():
            for pid, row in paths.items():
                self.assertIsInstance(row.get("abe_x"), int, f"{short} P{pid}")
                self.assertIsInstance(row.get("abe_y"), int, f"{short} P{pid}")


class EnumCache(unittest.TestCase):
    def cache_file(self, game_key):
        return HERE / "data" / games.GAMES[game_key]["enum_cache"]

    def test_cached_labels_are_numeric_value_to_label_maps(self):
        for game_key in ("AO", "AE"):
            raw = json.loads(self.cache_file(game_key).read_text())
            self.assertEqual(set(raw), {"labels", "bad"})
            for ty, vals in raw["labels"].items():
                self.assertTrue(vals, ty)
                for v, label in vals.items():
                    self.assertRegex(v, r"^-?\d+$", f"{ty}: {v}")
                    self.assertTrue(label and isinstance(label, str), f"{ty} {v}: {label!r}")
            for ty in raw["bad"]:
                self.assertIsInstance(ty, str)

    @needs_decomp
    def test_the_committed_cache_matches_a_fresh_sweep(self):
        for game_key in ("AO", "AE"):
            labels, bad = schema.parse_enum_labels(game_key)
            self.assertEqual(
                self.cache_file(game_key).read_text(),
                json.dumps({"labels": labels, "bad": sorted(bad)}, indent=1),
                stale(self.cache_file(game_key).name),
            )


class LinksCache(unittest.TestCase):
    """the collision links are read at hand-written offsets, and what they carry
    proves them: a link indexes a line of its own path, and Exoddus's length
    column is the line's own"""

    LINKED = {"AO": 1652, "AE": 1794}

    def rows(self, game_key):
        cache = json.loads((HERE / "data" / games.GAMES[game_key]["links_file"]).read_text())
        data = json.loads((SITE / games.GAMES[game_key]["data_file"]).read_text())
        paths = {(L["short"], P["id"]): P["lines"] for L in data["levels"] for P in L["paths"]}
        self.assertEqual({(s, int(p)) for s, ps in cache["paths"].items() for p in ps}, set(paths))
        for (short, pid), lines in sorted(paths.items()):
            rows = cache["paths"][short][str(pid)]
            self.assertEqual(len(rows), len(lines), f"{game_key} {short} P{pid}")
            yield f"{game_key} {short} P{pid}", cache["columns"], lines, rows

    def test_every_link_indexes_a_line_of_its_own_path(self):
        for game_key in ("AO", "AE"):
            linked = 0
            for where, columns, lines, rows in self.rows(game_key):
                for i, row in enumerate(rows):
                    for column, v in zip(columns, row):
                        if column == "length" or v == -1:
                            continue
                        self.assertTrue(0 <= v < len(lines), f"{where} line {i} {column}: {v}")
                        linked += 1
            self.assertEqual(linked, self.LINKED[game_key], game_key)

    def test_the_exoddus_length_column_is_the_lines_own(self):
        for where, columns, lines, rows in self.rows("AE"):
            col = columns.index("length")
            for i, ((x1, y1, x2, y2, _type), row) in enumerate(zip(lines, rows)):
                self.assertEqual(row[col], int(math.hypot(x2 - x1, y2 - y1)), f"{where} line {i}")


class PinnedRevision(unittest.TestCase):
    def test_the_decomp_doc_names_both_pins(self):
        doc = (HERE.parent / "docs" / "decomp.md").read_text()
        self.assertIn(DECOMP_COMMIT[:9], doc)
        self.assertIn(AO_COMMIT[:9], doc)

    def test_the_builder_doc_names_the_oxipng_pin(self):
        self.assertIn(image.OXIPNG_VERSION, (HERE.parent / "docs" / "builder.md").read_text())


if __name__ == "__main__":
    unittest.main()
