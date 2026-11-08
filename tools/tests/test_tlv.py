"""Tests for the TLV reader and the chunk walk: the chunks keyed by tag and id,
object_fields' payload clamp, the path-meta audit against the tabulated rows,
the grid a path carries when the decomp tabulates none for it, and the audit's
census over the shipped tree."""

import contextlib
import io
import json
import struct
import sys
import unittest
from pathlib import Path

sys.path[:0] = [str(Path(__file__).resolve().parents[1])]

from oddmap import disc, games, tlv  # noqa: E402
from oddmap.paths import SITE  # noqa: E402


def chunk(tag, rid, payload, size=None):
    """one .BND chunk: 16-byte header (size covers it) + payload"""
    typ = int.from_bytes(tag.encode("latin1"), "little")
    size = len(payload) + 16 if size is None else size
    return struct.pack("<IHHII", size, 0, 0, typ, rid) + payload


class ParseChunks(unittest.TestCase):
    def test_keys_by_tag_and_id(self):
        data = chunk("Path", 1, b"abcd") + chunk("Path", 2, b"efgh") + chunk("End!", 0, b"")
        self.assertEqual(disc.parse_chunks(data), {("Path", 1): b"abcd", ("Path", 2): b"efgh"})

    def test_first_of_a_repeated_key_wins(self):
        data = chunk("Path", 1, b"first") + chunk("Path", 1, b"second")
        self.assertEqual(disc.parse_chunks(data), {("Path", 1): b"first"})

    def test_stops_at_the_end_marker(self):
        data = chunk("Path", 1, b"abcd") + chunk("End!", 0, b"") + chunk("Path", 2, b"never")
        self.assertNotIn(("Path", 2), disc.parse_chunks(data))

    def test_a_garbage_header_terminates(self):
        # a size that doesn't advance, or one that runs past the buffer, must end
        # the walk: both spun forever or read out of bounds before the guards
        self.assertEqual(disc.parse_chunks(chunk("Path", 1, b"abcd", size=8)), {})
        self.assertEqual(disc.parse_chunks(chunk("Path", 1, b"abcd", size=4096)), {})


class ObjectFields(unittest.TestCase):
    schema = {1: [[0, "first"], [1, "second", "Path_X::Y"]], 2: []}

    def fields(self, payload, length=None, t=1):
        blob = bytes(16) + payload
        length = 16 + len(payload) if length is None else length
        return tlv.object_fields(self.schema, t, blob, 0, length, 16)

    def test_reads_each_word_as_s16(self):
        self.assertEqual(self.fields(struct.pack("<hh", 5, -1)), {"first": 5, "second": -1})

    def test_a_declared_type_does_not_disturb_the_layout(self):
        self.assertIn("second", self.fields(struct.pack("<hh", 0, 0)))

    def test_a_short_payload_drops_the_words_it_lacks(self):
        self.assertEqual(self.fields(struct.pack("<hh", 5, 9), length=18), {"first": 5})

    def test_a_field_less_type_yields_an_empty_dict(self):
        self.assertEqual(self.fields(b"", t=2), {})

    def test_an_unschemad_type_yields_none(self):
        self.assertIsNone(self.fields(struct.pack("<hh", 0, 0), t=3))


class PathMetaAudit(unittest.TestCase):
    """a tabulated row the chunk itself contradicts"""

    FMT = {k: v for k, v in games.GAMES["AO"]["tlv"].items() if k != "extra_fn"}
    CELLS = 4

    def chunk(self, lines, objects, entries):
        """a path chunk: camera-name slots, `lines` collision records, `objects`
        24-byte records, then one index entry per cell"""
        blob = b"".join(f"AOP01C{i:02d}".encode() for i in range(self.CELLS))
        blob += b"".join(struct.pack("<hhhhI", 8, 8, 9, 9, 0) + b"\xff" * 8
                         for _ in range(lines))
        blob += b"".join(struct.pack("<BBhI", 0, 0, 24, 6) + b"\0" * 16
                         for _ in range(objects))
        return blob + struct.pack(f"<{self.CELLS}i", *entries)

    def meta(self, lines, objects=2):
        off = self.CELLS * 8
        return {"w_units": 2048, "h_units": 960, "coll_off": off, "coll_count": lines,
                "obj_off": off + lines * 20, "idx_off": off + lines * 20 + objects * 24}

    def audit(self, blob, tabulated):
        return tlv.audit_path_meta(blob, self.meta(tabulated), self.FMT, self.CELLS)

    def resolve(self, blob, tabulated):
        out = io.StringIO()
        with contextlib.redirect_stdout(out):
            meta = tlv.resolve_path_meta(blob, 1, tabulated, self.FMT, 1024, 480)
        return meta, out.getvalue()

    def test_a_count_the_index_table_confirms_is_left_alone(self):
        meta, note = self.resolve(self.chunk(3, 2, [0, 24, -1, -1]), self.meta(3))
        self.assertEqual((meta["coll_count"], note), (3, ""))

    def test_the_chunks_own_table_position_replaces_the_tabulated_one(self):
        blob = self.chunk(3, 2, [0, 24, -1, -1])
        meta, note = self.resolve(blob, {**self.meta(3), "idx_off": 0})
        self.assertEqual((meta["idx_off"], note), (len(blob) - self.CELLS * 4, ""))

    def test_a_count_one_short_is_corrected_from_the_chunk(self):
        blob = self.chunk(3, 2, [0, 24, -1, -1])
        audited = self.audit(blob, 2)
        self.assertEqual(audited["coll_count"], 3)
        self.assertEqual(audited["obj_off"], self.CELLS * 8 + 60)
        self.assertEqual(audited["idx_off"], len(blob) - self.CELLS * 4)

    def test_a_count_one_over_is_corrected_the_same_way(self):
        blob = self.chunk(3, 2, [0, 24, -1, -1])
        self.assertEqual(self.audit(blob, 4)["coll_count"], 3)

    def test_a_table_of_nothing_but_gaps_leaves_the_count_standing(self):
        blob = self.chunk(3, 2, [-1] * self.CELLS)
        self.assertEqual(self.audit(blob, 2)["coll_count"], 2)

    def test_a_tabulated_zero_count_is_audited_like_any_other(self):
        meta, note = self.resolve(self.chunk(0, 2, [0, 24, -1, -1]), self.meta(0))
        self.assertEqual((meta["coll_count"], note), (0, ""))
        meta, note = self.resolve(self.chunk(1, 2, [0, 24, -1, -1]), self.meta(0))
        self.assertEqual(meta["coll_count"], 1)
        self.assertIn("path 1: 0 collision lines tabulated, 1 in the chunk", note)

    def test_a_count_no_offset_answers_raises(self):
        blob = self.chunk(3, 2, [7, -1, -1, -1])  # no region start puts a record at +7
        with self.assertRaisesRegex(RuntimeError, "collision count undetermined"):
            self.audit(blob, 3)


class PathDiscovery(unittest.TestCase):
    """the grid a path carries when the decomp tabulates none for it"""

    FMT = {k: v for k, v in games.GAMES["AO"]["tlv"].items() if k != "extra_fn"}
    CELL_W, CELL_H = 1024, 480

    def chunk(self, slots, objects, tail=b""):
        """a path chunk: camera-name slots, then 24-byte objects at cell origins"""
        blob = b"".join(f"AOP01C{i:02d}".encode() if named else b"\0" * 8
                        for i, named in enumerate(slots))
        for cx, cy in objects:
            blob += (struct.pack("<BBhI", 0, 0, 24, 6) + b"\0" * 8
                     + struct.pack("<hhhh", cx * self.CELL_W, cy * self.CELL_H, 0, 0))
        return blob + tail

    def discover(self, blob):
        out = io.StringIO()
        with contextlib.redirect_stdout(out):
            meta = tlv.discover_path_meta(blob, self.FMT, self.CELL_W, self.CELL_H)
        return meta, out.getvalue()

    def test_the_slot_run_ends_at_the_first_thing_that_is_not_a_name(self):
        # 8 cells, an object in the far corner of a 4x2 -> only 4x2 holds it
        meta, note = self.discover(self.chunk([1, 0, 1, 0, 0, 1, 0, 1], [(3, 1)]))
        self.assertEqual((meta["w_units"], meta["h_units"]), (4 * 1024, 2 * 480))
        self.assertEqual(meta["obj_off"], 64)  # the objects begin where the slots end
        self.assertEqual(meta["coll_count"], 0)
        self.assertIn("index table would take 32", note)  # no tail at all: reported

    def test_the_region_end_is_where_the_records_stop(self):
        blob = self.chunk([1] * 4, [(0, 0), (3, 0)], tail=b"\xff" * 16)
        end, origins = tlv.contiguous_objects(blob, 32, self.FMT)
        self.assertEqual(end, 32 + 48)  # the -1 tail is an index table, not a record
        self.assertEqual(origins, [(0, 0), (3 * 1024, 0)])
        meta, note = self.discover(blob)
        self.assertEqual(meta["idx_off"], 80)
        self.assertEqual(note, "")  # a tail of exactly 4 bytes a cell: silent

    def test_an_undetermined_grid_raises_rather_than_picking(self):
        # 4 cells and one object at the origin fits 1x4, 2x2 and 4x1 alike
        with self.assertRaises(RuntimeError):
            self.discover(self.chunk([1] * 4, [(0, 0)]))

    def test_a_discovered_row_is_not_audited(self):
        # 4 bytes of slack past the table: the audit's end-of-chunk rule would move it
        blob = self.chunk([1] * 4, [(0, 0), (3, 0)], tail=b"\xff" * 16 + b"\0" * 4)
        out = io.StringIO()
        with contextlib.redirect_stdout(out):
            meta = tlv.resolve_path_meta(blob, 1, None, self.FMT, self.CELL_W, self.CELL_H)
        self.assertEqual(meta["idx_off"], 80)
        self.assertIn("leaving 20 bytes", out.getvalue())

    def test_one_path_is_tabulated_nothing_at_all(self):
        untabulated = set()
        for game_key in ("AO", "AE"):
            tables = games.game_setup(game_key)["tables"]
            data = json.loads((SITE / games.GAMES[game_key]["data_file"]).read_text())
            untabulated |= {(game_key, L["short"], P["id"]) for L in data["levels"]
                            for P in L["paths"] if P["id"] not in tables[L["short"]]}
        self.assertEqual(untabulated, {("AO", "S1", 1)}, "a table for S1 P1 would retire the discovery")


class PathMetaCensus(unittest.TestCase):
    """the audit's result over the shipped tree, the committed caches being the
    oracle no disc is needed for"""

    # (game, level, path): (tabulated, shipped), the PS1 chunks that contradict the PC tables
    CORRECTED = {("AO", "R1", 20): (30, 31), ("AO", "R6", 6): (41, 40)}

    def test_the_map_carries_the_tabulated_count_except_where_pinned(self):
        found = {}
        for game_key in ("AO", "AE"):
            tables = games.game_setup(game_key)["tables"]
            data = json.loads((SITE / games.GAMES[game_key]["data_file"]).read_text())
            for level in data["levels"]:
                for path in level["paths"]:
                    row = tables[level["short"]].get(path["id"])
                    if row and row["coll_count"] != len(path["lines"]):
                        found[(game_key, level["short"], path["id"])] = (row["coll_count"], len(path["lines"]))
        self.assertEqual(found, self.CORRECTED)

    def test_a_tabulated_row_starts_its_objects_where_its_lines_end(self):
        for game_key in ("AO", "AE"):
            for short, paths in games.game_setup(game_key)["tables"].items():
                for pid, row in paths.items():
                    self.assertEqual(row["coll_off"] + 20 * row["coll_count"], row["obj_off"],
                                     f"{game_key} {short} P{pid}")


if __name__ == "__main__":
    unittest.main()
