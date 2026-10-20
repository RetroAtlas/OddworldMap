"""A release against the base, over synthetic data: stdlib only, no disc."""

import sys
import unittest
from pathlib import Path

sys.path[:0] = [str(Path(__file__).resolve().parents[1])]

from oddmap import release  # noqa: E402

GEO = {"worldW": 1024, "worldH": 480}
CORNER = {"geometry": GEO, "filed_by_midpoint": False, "camera_gate": None}
GATED = {"geometry": GEO, "filed_by_midpoint": True, "camera_gate": 16, "camera_margin": 4}


def tlv(name, x1, y1, w=24, h=24, **fields):
    t = {"t": 1, "name": name, "x1": x1, "y1": y1, "x2": x1 + w, "y2": y1 + h, "extra": {}}
    if fields:
        t["fields"] = fields
    return t


class Keys(unittest.TestCase):
    def test_a_pair_seen_once_is_its_name_and_origin(self):
        self.assertEqual(release.object_keys([tlv("Door", 5, 6)]), ["Door@5,6"])

    def test_a_repeated_pair_is_numbered_in_list_order(self):
        keys = release.object_keys([tlv("Mine", 1, 2), tlv("Door", 5, 6), tlv("Mine", 1, 2)])
        self.assertEqual(keys, ["Mine@1,2#1", "Door@5,6", "Mine@1,2#2"])

    def test_each_game_files_an_object_by_its_own_point(self):
        t = tlv("Zone", 1000, 10, w=100)
        self.assertEqual(release.filed_cell(t, 4, CORNER), 0)
        self.assertEqual(release.filed_cell(t, 4, GATED), 1)


class Objects(unittest.TestCase):
    def compare(self, base, new):
        return release.compare_objects(CORNER, base, new, 4, "test")

    def test_a_changed_field_carries_its_final_value_alone(self):
        objects, added = self.compare([tlv("Slig", 10, 10, pause=60, delay=30)],
                                      [tlv("Slig", 10, 10, pause=90, delay=30)])
        self.assertEqual((objects, added), ({"Slig@10,10": {"fields": {"pause": 90}}}, 0))

    def test_a_moved_object_carries_its_whole_rect(self):
        objects, _ = self.compare([tlv("Hoist", 10, 10)], [tlv("Hoist", 12, 10)])
        self.assertEqual(objects, {"Hoist@10,10": {"rect": [12, 10, 36, 34]}})

    def test_an_object_the_release_lacks_is_removed(self):
        objects, _ = self.compare([tlv("Door", 10, 10), tlv("Mine", 50, 10)], [tlv("Door", 10, 10)])
        self.assertEqual(objects, {"Mine@50,10": {"removed": True}})

    def test_an_added_object_is_whole_and_follows_its_neighbour(self):
        objects, added = self.compare([tlv("Door", 10, 10), tlv("Mine", 50, 10)],
                                      [tlv("Door", 10, 10), tlv("Gas", 30, 10, time=7200), tlv("Mine", 50, 10)])
        self.assertEqual(added, 1)
        self.assertEqual(objects, {"+1": {"name": "Gas", "rect": [30, 10, 54, 34], "after": "Door@10,10",
                                          "fields": {"time": 7200}}})

    def test_objects_are_aligned_within_their_camera_only(self):
        """a door refiled under the next camera is that camera's to build"""
        objects, added = self.compare([tlv("Door", 10, 10)], [tlv("Door", 1030, 10)])
        self.assertEqual(added, 1)
        self.assertEqual(objects["Door@10,10"], {"removed": True})
        self.assertEqual(objects["+1"]["after"], None)

    def test_a_release_that_reorders_the_base_objects_cannot_be_carried(self):
        with self.assertRaises(SystemExit):
            self.compare([tlv("Door", 10, 10), tlv("Mine", 1030, 10)], [tlv("Mine", 1030, 10), tlv("Door", 10, 10)])

    def test_words_no_archive_holds_cannot_be_carried(self):
        a, b = tlv("Thing", 10, 10), tlv("Thing", 10, 10)
        b["extra"] = {"raw": "1 2"}
        with self.assertRaises(SystemExit):
            self.compare([a], [b])


class Cameras(unittest.TestCase):
    def cam(self, **k):
        return {"name": "MIP04C35", "pixels_differ": True, "masks_differ": False, "coverage_differs": False,
                "measure": 2.0, **k}

    def test_without_a_gate_any_difference_is_the_releases(self):
        self.assertTrue(release.camera_verdict(CORNER, {}, self.cam(measure=0.5)))
        self.assertTrue(release.camera_verdict(CORNER, {}, self.cam(pixels_differ=False, masks_differ=True)))
        self.assertFalse(release.camera_verdict(CORNER, {}, self.cam(pixels_differ=False)))

    def test_a_gate_keeps_a_re_encode_and_takes_an_edit(self):
        self.assertFalse(release.camera_verdict(GATED, {}, self.cam(measure=11.0)))
        self.assertTrue(release.camera_verdict(GATED, {}, self.cam(measure=22.0)))

    def test_a_camera_inside_the_margin_waits_for_a_verdict(self):
        self.assertEqual(release.camera_verdict(GATED, {}, self.cam(measure=17.0)), "margin")
        self.assertTrue(release.camera_verdict(GATED, {"verdicts": {"MIP04C35": "edit"}}, self.cam(measure=17.0)))
        self.assertFalse(release.camera_verdict(GATED, {"verdicts": {"MIP04C35": "re-encode"}},
                                                self.cam(measure=13.0)))

    def test_a_foreground_that_moves_is_the_releases_whatever_the_art(self):
        self.assertTrue(release.camera_verdict(GATED, {}, self.cam(measure=1.0, coverage_differs=True)))

    def test_the_window_measure_reads_a_patch_and_not_scattered_noise(self):
        w = h = 8
        base = bytes([100, 100, 100, 255]) * (w * h)
        patch = bytearray(base)
        for y in range(2, 6):
            for x in range(2, 6):
                patch[(y * w + x) * 4:(y * w + x) * 4 + 3] = bytes([140, 140, 140])
        noise = bytearray(base)
        for i in range(0, w * h, 5):
            noise[i * 4:i * 4 + 3] = bytes([140, 140, 140])
        self.assertAlmostEqual(release.window_measure(base, bytes(patch), w, h), 40.0)
        self.assertLess(release.window_measure(base, bytes(noise), w, h), 20.0)


class Patches(unittest.TestCase):
    W, H = 48, 32

    def screen(self, grey=100):
        return bytearray(bytes([grey, grey, grey, 255]) * (self.W * self.H))

    def fill(self, px, x0, y0, x1, y1, grey):
        for y in range(y0, y1):
            for x in range(x0, x1):
                px[(y * self.W + x) * 4:(y * self.W + x) * 4 + 3] = bytes([grey] * 3)

    def test_without_a_floor_one_pixel_marks_its_block_alone(self):
        new = self.screen()
        new[(17 * self.W + 33) * 4 + 2] = 101
        self.assertEqual(release.changed_blocks(bytes(self.screen()), bytes(new), self.W, self.H, None), {(2, 1)})

    def test_a_window_reaching_the_floor_marks_every_block_it_lies_over(self):
        new = self.screen()
        self.fill(new, 14, 14, 18, 18, 116)
        blocks = release.changed_blocks(bytes(self.screen()), bytes(new), self.W, self.H, 16)
        self.assertEqual(blocks, {(0, 0), (1, 0), (0, 1), (1, 1)})
        self.assertEqual(release.changed_blocks(bytes(self.screen()), bytes(new), self.W, self.H, 16.5), set())

    def test_a_change_under_the_floor_marks_nothing(self):
        new = self.screen()
        for i in range(0, self.W * self.H, 7):
            new[i * 4:i * 4 + 3] = bytes([140, 140, 140])
        self.assertTrue(release.changed_blocks(bytes(self.screen()), bytes(new), self.W, self.H, None))
        self.assertEqual(release.changed_blocks(bytes(self.screen()), bytes(new), self.W, self.H, 12), set())

    def test_each_8_connected_group_of_blocks_is_one_rectangle(self):
        self.assertEqual(release.patch_rects({(0, 0), (1, 1), (4, 0), (4, 1), (3, 1)}, 96, 32),
                         [(0, 0, 32, 32), (48, 0, 32, 32)])
        self.assertEqual(release.patch_rects({(0, 0), (2, 0)}, 96, 32), [(0, 0, 16, 16), (32, 0, 16, 16)])

    def test_a_group_inside_another_s_rectangle_needs_none_of_its_own(self):
        frame = {(x, 0) for x in range(5)} | {(4, y) for y in range(5)}
        self.assertEqual(release.patch_rects(frame | {(1, 2)}, 96, 96), [(0, 0, 80, 80)])

    def test_a_patch_grows_until_the_screen_it_composes_reaches_the_floor_nowhere(self):
        new = self.screen()
        for x0, grey in ((14, 74), (16, 126), (18, 80)):
            self.fill(new, x0, 0, x0 + 2, 4, grey)
        self.assertEqual(release.changed_blocks(bytes(self.screen()), bytes(new), self.W, self.H, 12), {(0, 0)})
        self.assertEqual(release.patch_cover(bytes(self.screen()), bytes(new), self.W, self.H, 12), [(0, 0, 32, 16)])

    def test_a_rectangle_stops_at_the_screen_edge(self):
        self.assertEqual(release.patch_rects({(2, 1)}, 40, 20), [(32, 16, 8, 4)])

    def cam(self, **k):
        rgba = bytes(range(256)) * (self.W * self.H * 4 // 256)
        return {"short": "MI", "w": self.W, "h": self.H, "rgba": rgba, "masks": {}, **k}

    def test_a_patch_is_the_release_s_pixels_under_its_rectangle_named_for_them(self):
        cam = self.cam(rects=[(16, 16, 32, 16)], masks={4: bytes(self.W * self.H * 4)})
        fields, images = release.camera_files("cams/ae/jp", "MIP01C01", cam)
        crop = b"".join(cam["rgba"][((16 + r) * self.W + 16) * 4:((16 + r) * self.W + 48) * 4] for r in range(16))
        patch = f"cams/ae/jp/MI/MIP01C01_16_16.{release.sheet_name(32, 16, crop)}.png"
        mask = f"cams/ae/jp/MI/MIP01C01_fg4.{release.sheet_name(self.W, self.H, cam['masks'][4])}.png"
        self.assertEqual(fields, {"patches": [[16, 16, patch]], "masks": [[4, mask]]})
        self.assertEqual(images[0], (patch, 32, 16, crop, False))
        self.assertEqual(images[1][0], mask)

    def test_a_camera_without_rectangles_ships_whole_and_one_with_none_ships_none(self):
        fields, images = release.camera_files("cams/ae/jp", "STP01C52", self.cam())
        self.assertEqual(list(fields), ["png"])
        self.assertEqual(images, [(fields["png"], self.W, self.H, self.cam()["rgba"], False)])
        self.assertEqual(release.camera_files("cams/ae/jp", "MIP01C01", self.cam(rects=[])), ({}, []))

    def test_two_patches_at_one_corner_are_refused_as_one_name(self):
        with self.assertRaises(SystemExit):
            release.camera_files("cams/ae/jp", "MIP01C01", self.cam(rects=[(16, 16, 32, 16), (16, 16, 16, 32)]))


class Writing(unittest.TestCase):
    def test_a_release_without_art_of_its_own_writes_into_a_fresh_directory(self):
        import tempfile
        with tempfile.TemporaryDirectory() as tmp:
            out = Path(tmp) / "fresh"
            dst, files = release.write_release("AE", {"cams_dir": "cams/ae"}, {"code": "eu", "paths": {}},
                                               {"cameras": {}, "sheets": {}}, out)
            self.assertEqual((dst, files), (out / "release_ae_eu.json", 0))
            self.assertTrue(dst.is_file())


class Messages(unittest.TestCase):
    class Fake:
        game_key, code = "AO", "fr"

        def __init__(self, loads):
            self.loads, self.discs, self.overlays = loads, [], set(loads.values())

    class Base:
        paths = {("R1", 1): {}, ("R1", 2): {}, ("E1", 3): {}}

    def test_a_path_whose_overlay_says_otherwise_carries_the_entries_that_differ(self):
        lead = " " * 31
        tables = {"lcd": {"R1.OVL": ["", lead + "Work!", lead + "Press \x0b"],
                          "E3.OVL": ["", lead + "Work!", lead + "Press /013"]}}
        loads = {("R1", 1): "R1.OVL", ("R1", 2): "R1.OVL", ("E1", 3): "E3.OVL"}
        original = release.overlay_tables
        release.overlay_tables = lambda *a: tables
        try:
            main, per_path = release.release_messages(self.Fake(loads), self.Base(), range(0x08, 0x14))
        finally:
            release.overlay_tables = original
        self.assertEqual(main["lcd"], ["", "Work!", "Press \x0b"])
        self.assertEqual(per_path, {"E1/3": {"lcd": {"2": "Press /013"}}})
