"""What the checks of the PlayStation's code read off a game's discs: stdlib
only, no disc."""

import struct
import sys
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest import mock

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from oddmap import records  # noqa: E402
from oddmap.games import GAMES  # noqa: E402


def record(kind, x, y, flags=records.END):
    """an Exoddus object's record, 24 units a side"""
    return struct.pack("<BBhI4h", flags, 0, 28, kind, x, y, x + 24, y + 24).ljust(28, b"\0")


def bundle(*chunks):
    """a level's bundle of path chunks, each by its path's id"""
    return b"".join(struct.pack("<IHH4sI", 16 + len(blob), 0, 0, b"Path", path) + blob for path, blob in chunks)


class Discs(unittest.TestCase):
    def test_the_overlays_are_the_ones_the_paths_load_at_the_address_the_messages_load_at(self):
        blobs = {"B.OVL": b"lcd", "A.OVL": b"a", "D.OVL": b"older", "SLUS_000.00": b"exe"}
        disc = SimpleNamespace(files={name: (name, 0) for name in blobs}, read=lambda name, size: blobs[name])
        leads = {(b"lcd", 101): ([], 0x800A0000), (b"older", 101): ([], 0x8009FF00)}

        def overlays(*loaded):
            def named(data, layout):
                self.assertEqual((data, layout), (b"exe", GAMES["AE"]["path_record"]))
                return set(loaded)

            with mock.patch.object(records, "lead_table", lambda blob, count: leads.get((blob, count))), \
                    mock.patch.object(records, "loaded_overlays", named):
                return records.overlays(disc, "AE")

        found, base = overlays("C.OVL", "B.OVL", "A.OVL")
        self.assertEqual((list(found.items()), base), ([("A.OVL", b"a"), ("B.OVL", b"lcd")], 0x800A0000))
        with self.assertRaisesRegex(RuntimeError, "0 candidates for the address the overlays load at"):
            overlays("A.OVL")
        with self.assertRaisesRegex(RuntimeError, "2 candidates for the address the overlays load at"):
            overlays("B.OVL", "D.OVL")

    def test_a_levels_archive_is_the_fullest_copy_the_discs_hold(self):
        game = {"levels": [(1, "MI", ""), (2, "NE", ""), (3, "PV", ""), (4, "XX", "")],
                "tables": {"MI": {}, "NE": {}, "PV": {}}}
        one = SimpleNamespace(files={"MI.LVL": (0, 10), "NE.LVL": (5, 20), "XX.LVL": (9, 5)})
        two = SimpleNamespace(files={"MI.LVL": (0, 30), "PV.LVL": (7, 1)})

        def lvl(disc, name):
            if name == "PV.LVL":
                raise ValueError("not a LVL archive")
            return disc, name

        with mock.patch.object(records, "Lvl", lvl):
            self.assertEqual(records.archives([one, two], game), {"MI": (two, "MI.LVL"), "NE": (one, "NE.LVL")})

    def test_a_cameras_list_is_read_to_the_record_that_ends_it(self):
        fmt = GAMES["AE"]["tlv"]
        listed = b"".join(struct.pack("<BBhI", flags, 0, length, kind).ljust(length, b"\0")
                          for flags, length, kind in ((0, 16, 5), (4, 20, 7), (4, 16, 9), (0, 16, 5)))
        blob = bytes(8) + listed + struct.pack("<3i", 0, -1, 36)
        self.assertEqual(records.listed(blob, 8, 3, fmt), {0: 0, 16: 0, 36: 2})
        with self.assertRaisesRegex(RuntimeError, "the list of cell 2 runs off its records"):
            records.listed(blob[:-4] + struct.pack("<i", 4), 8, 3, fmt)

    HOIST, ITEM = 2, 11
    ROW = {"w_units": 750, "h_units": 260, "coll_off": 16, "coll_count": 3, "obj_off": 76, "idx_off": 132}

    def placed(self, chunk):
        """what is placed of the items in a level whose one path the executable
        has a record of is the chunk, beside a second it has none of"""
        bnd = bundle((4, chunk), (5, chunk))
        held = {"MI": SimpleNamespace(files={"MIPATH.BND": (0, len(bnd))}, read={"MIPATH.BND": bnd}.get),
                "NE": SimpleNamespace(files={"NE.BND": (0, 4)})}

        def rows(data, layout):
            self.assertEqual((data, layout), ("the first's", GAMES["AE"]["path_record"]))
            return {("MI", 4): self.ROW, ("NE", 4): self.ROW}

        with mock.patch.object(records, "archives", lambda discs, game: held), \
                mock.patch.object(records, "executable", lambda disc: ("", disc)), \
                mock.patch.object(records, "path_records", rows):
            return records.placed(["the first's", "the second's"], "AE", ("FallingItem",))

    def test_an_object_is_read_where_the_executables_own_record_of_its_path_has_it(self):
        hoist, item = record(self.HOIST, 10, 10), record(self.ITEM, 400, 10)
        chunk = bytes(76) + hoist + item + struct.pack("<2i", 0, 28)
        (found,) = self.placed(chunk)
        self.assertEqual((found.short, found.path, found.place, found.object["name"], found.words, found.cell,
                          found.across, found.blob, found.meta),
                         ("MI", 4, 1, "FallingItem", item, 1, 2, chunk, self.ROW))

    def test_an_object_another_camera_lists_than_the_one_its_game_files_it_under_is_refused(self):
        hoist, item = record(self.HOIST, 10, 10, 0), record(self.ITEM, 400, 10)
        with self.assertRaisesRegex(RuntimeError, "MI P4: the camera of cell 0 lists the FallingItem at 400,10, not"):
            self.placed(bytes(76) + hoist + item + struct.pack("<2i", 0, -1))


if __name__ == "__main__":
    unittest.main()
