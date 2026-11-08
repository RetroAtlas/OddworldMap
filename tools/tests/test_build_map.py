"""Tests for the build itself: the artwork cache stamp, and the committed
sidecars, which must reproduce from the committed caches without a disc image;
loading the CLI here is the one check that it asks the package for nothing it
lacks."""

import contextlib
import io
import json
import sys
import tempfile
import unittest
from pathlib import Path
from unittest import mock

sys.path[:0] = [str(Path(__file__).resolve().parents[1])]

from oddmap import emit, games  # noqa: E402
from oddmap.paths import HERE, SITE  # noqa: E402

# the CLI has no test of its own and lint cannot resolve a cross-module import,
# so loading it here is what catches a name it asks the package for and misses
import build_map  # noqa: E402,F401


class CacheStamp(unittest.TestCase):
    """the artwork cache name answers to the cameras and masks and to nothing else"""

    def worker(self, tmp, files):
        cams = Path(tmp) / "cams"
        for rel, data in files.items():
            (cams / rel).parent.mkdir(parents=True, exist_ok=True)
            (cams / rel).write_bytes(data)
        sw = Path(tmp) / "sw.js"
        sw.write_text('// lead\nconst CACHE_NAME = "cams-v1";\nconst ENABLED = "cams-on";\n')
        return sw, cams

    def test_bytes_and_path_both_reach_the_stamp(self):
        with tempfile.TemporaryDirectory() as tmp:
            sw, cams = self.worker(tmp, {"ao/L/A.png": b"a", "ae/L/B.png": b"b"})
            base = emit.stamp_cache_name(sw, cams)
            self.assertEqual(base, emit.stamp_cache_name(sw, cams))
            (cams / "ao/L/A.png").write_bytes(b"c")
            self.assertNotEqual(base, emit.stamp_cache_name(sw, cams))
            (cams / "ao/L/A.png").write_bytes(b"a")
            self.assertEqual(base, emit.stamp_cache_name(sw, cams))  # content, not a counter
            (cams / "ao/L/A.png").rename(cams / "ao/L/Z.png")
            self.assertNotEqual(base, emit.stamp_cache_name(sw, cams))

    def test_a_sheet_reaches_no_stamp(self):
        with tempfile.TemporaryDirectory() as tmp:
            sw, cams = self.worker(tmp, {"ao/L/A.png": b"a", "ao/sprites/s1/0.png": b"s"})
            base = emit.stamp_cache_name(sw, cams)
            (cams / "ao/sprites/s1").rename(cams / "ao/sprites/s2")
            (cams / "ao/sprites/s2/0.png").write_bytes(b"t")
            self.assertEqual(base, emit.stamp_cache_name(sw, cams))

    def test_it_rewrites_the_one_line(self):
        with tempfile.TemporaryDirectory() as tmp:
            sw, cams = self.worker(tmp, {"ao/L/A.png": b"a"})
            name = emit.stamp_cache_name(sw, cams)
            self.assertIn(f'const CACHE_NAME = "{name}";', sw.read_text())
            self.assertIn('const ENABLED = "cams-on";', sw.read_text())

    def test_a_worker_it_cannot_stamp_fails_the_build(self):
        # both the early precondition and the write itself, which must not report
        # a stamp it did not manage to write
        with tempfile.TemporaryDirectory() as tmp:
            sw, cams = self.worker(tmp, {"ao/L/A.png": b"a"})
            sw.write_text("const CACHE_NAME = 'cams-v1';\n")  # not the shape it writes
            with self.assertRaises(SystemExit):
                emit.require_stampable(sw)
            with self.assertRaises(SystemExit):
                emit.stamp_cache_name(sw, cams)

    def test_the_committed_worker_names_the_committed_artwork(self):
        self.assertIn(f'const CACHE_NAME = "{emit.cams_stamp(SITE / "cams")}";',
                      (SITE / "sw.js").read_text(),
                      "sw.js and public/cams disagree — commit the stamped line with the artwork")


class Sidecars(unittest.TestCase):
    """the committed sidecars must be reproducible from the sources they claim"""

    def emit(self, writer, game_key):
        with tempfile.TemporaryDirectory() as tmp, contextlib.redirect_stdout(io.StringIO()):
            written = writer(game_key, Path(tmp))
            return written.read_bytes()

    def assertReproduces(self, writer, game_key, filename):
        self.assertEqual(
            self.emit(writer, game_key),
            (SITE / filename).read_bytes(),
            f"{filename} differs from a fresh emit — rebuild it or fix the emitter",
        )

    def test_field_types_ao(self):
        self.assertReproduces(emit.write_field_types, "AO", "field_types_ao.json")

    def test_field_types_ae(self):
        self.assertReproduces(emit.write_field_types, "AE", "field_types_ae.json")

    def test_enum_labels_ao(self):
        self.assertReproduces(emit.write_enum_labels, "AO", "enum_labels_ao.json")

    def test_enum_labels_ae(self):
        self.assertReproduces(emit.write_enum_labels, "AE", "enum_labels_ae.json")

    def test_relive_export_ao(self):
        self.assertReproduces(emit.write_relive_export, "AO", "relive_export_ao.json")

    def test_relive_export_ae(self):
        self.assertReproduces(emit.write_relive_export, "AE", "relive_export_ae.json")

    def test_release_index(self):
        with tempfile.TemporaryDirectory() as tmp, contextlib.redirect_stdout(io.StringIO()):
            fresh = emit.write_release_index(Path(tmp)).read_bytes()
        self.assertEqual(fresh, (SITE / "releases.json").read_bytes(),
                         "releases.json differs from a fresh emit: rebuild it or fix the emitter")

    def test_the_served_export_data_is_the_caches_verbatim(self):
        """the page reads relive's schema and the collision links through this
        file, so a copy that drifted from the cache would export documents the
        builder cannot reproduce"""
        for game_key in ("AO", "AE"):
            game = games.GAMES[game_key]
            side = json.loads((SITE / game["relive_export_file"]).read_text())
            for served, cache in (("schema", "relive_cache"), ("links", "links_file")):
                self.assertEqual(side[served],
                                 json.loads((HERE / "data" / game[cache]).read_text()),
                                 f"{game_key} {served}")

    def test_the_export_data_carries_the_whole_level_map(self):
        """a destination can name a level the served list does not keep — the
        Exoddus enders — so the map is the builder's, every id of it"""
        for game_key in ("AO", "AE"):
            game = games.game_setup(game_key)
            side = json.loads((SITE / game["relive_export_file"]).read_text())
            self.assertEqual(side["level_short"], {str(k): v for k, v in game["level_short"].items()})
        ae = json.loads((SITE / games.GAMES["AE"]["relive_export_file"]).read_text())
        kept = {str(L["id"]) for L in json.loads((SITE / games.GAMES["AE"]["data_file"]).read_text())["levels"]}
        self.assertEqual(set(ae["level_short"]) - kept, {"7", "11", "12", "13", "14", "15"})

    def test_the_export_data_carries_the_links_it_is_handed(self):
        game = games.GAMES["AO"]
        cached = json.loads((HERE / "data" / game["links_file"]).read_text())
        with tempfile.TemporaryDirectory() as tmp, contextlib.redirect_stdout(io.StringIO()):
            dst = Path(tmp) / game["links_file"]
            emit.write_line_links("AO", {"R1": cached["paths"]["R1"]}, dst, merge=False)
            side = json.loads(emit.write_relive_export("AO", Path(tmp), Path(tmp)).read_text())
            self.assertEqual(side["links"], json.loads(dst.read_text()))
        self.assertNotEqual(side["links"], cached)

    def test_a_subset_build_hands_the_sprites_the_merged_links(self):
        """a --levels build merges its links into the table on disk and the sidecar is
        written from that table, so the other levels' links survive the rerun"""
        game = games.GAMES["AO"]
        cached = json.loads((HERE / "data" / game["links_file"]).read_text())["paths"]
        calls = []
        with tempfile.TemporaryDirectory() as tmp, contextlib.redirect_stdout(io.StringIO()), \
                mock.patch.object(build_map, "write_sprites", side_effect=lambda *a, **k: calls.append((a, k))):
            dst = Path(tmp) / game["links_file"]
            emit.write_line_links("AO", {"R1": cached["R1"], "E1": cached["E1"]}, dst, merge=False)
            merged = build_map.write_sprite_data("AO", [], Path(tmp), "cams/ao/sprites", None,
                                                 {"R1": cached["R1"]}, dst, True)
            self.assertEqual(set(merged), {"R1", "E1"})
            self.assertEqual(set(json.loads(dst.read_text())["paths"]), {"R1", "E1"})
            self.assertEqual(len(calls), 1)
            args, kwargs = calls[0]
            self.assertEqual(set(kwargs["links"] if "links" in kwargs else args[5]), {"R1", "E1"})
            alone = build_map.write_sprite_data("AO", [], Path(tmp), "cams/ao/sprites", None,
                                                {"R1": cached["R1"]}, Path(tmp) / "fresh.json", False)
            self.assertEqual(set(alone), {"R1"})

    def test_a_stale_field_type_override_fails_the_emit(self):
        stale = {("AO", "Door", "no_such_field"): (None, "Choice_short")}
        with mock.patch.dict(emit._FIELD_TYPE_OVERRIDES, stale), self.assertRaises(RuntimeError):
            self.emit(emit.write_field_types, "AO")

    def test_a_spent_field_type_override_fails_the_emit(self):
        for entry in (("DoorStates", "DoorStates"), (None, "Choice_short")):
            spent = {("AO", "Door", "start_state"): entry}
            with mock.patch.dict(emit._FIELD_TYPE_OVERRIDES, spent), self.assertRaisesRegex(RuntimeError, "spent"):
                self.emit(emit.write_field_types, "AO")


if __name__ == "__main__":
    unittest.main()
