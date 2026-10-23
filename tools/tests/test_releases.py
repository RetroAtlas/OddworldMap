"""The release table and how a release's images are told apart: stdlib only,
no disc image needed."""

import copy
import hashlib
import os
import sys
import tempfile
import unittest
from pathlib import Path
from unittest import mock

sys.path[:0] = [str(Path(__file__).resolve().parents[1])]

from oddmap import releases  # noqa: E402


def image(directory, name, fill):
    """a two-sector raw image whose bytes, and so whose SHA-1, follow `fill`"""
    p = Path(directory) / name
    p.write_bytes(bytes([fill]) * 2352 * 2)
    return p, hashlib.sha1(p.read_bytes()).hexdigest()


def entry(*digests):
    return {"name": "Somewhere", "language": "English", "title": "A Game", "executable": "SLES_000.00",
            "discs": [{"redump": i + 1, "bytes": 2352 * 2, "sha1": d} for i, d in enumerate(digests)],
            "code_page": "cp437", "ships": False}


class Table(unittest.TestCase):
    def test_the_committed_table_holds_its_shape(self):
        table = releases.load_releases()
        self.assertEqual(set(table), {"AO", "AE"})

    def test_every_release_the_site_carries_has_a_note(self):
        for game, entry_ in releases.load_releases().items():
            for code, rel in entry_["releases"].items():
                if rel["ships"]:
                    self.assertTrue(rel["note"], f"{game} {code}")

    def test_a_code_page_of_a_release_s_own_names_its_font_and_characters(self):
        import json
        import re
        for game, entry_ in releases.load_releases().items():
            for code, rel in entry_["releases"].items():
                if rel["code_page"] != "own":
                    continue
                path = releases.HERE / "data" / f"codepage_{game.lower()}_{code}.json"
                page = json.loads(path.read_text())
                self.assertRegex(page["sheet"], r"^Font\.[0-9a-f]{12}$", path.name)
                self.assertTrue(set(page) - {"sheet"} and set(page) - {"sheet"} <= {"lcd", "hintfly"}, path.name)
                for name in set(page) - {"sheet"}:
                    for k, v in page[name].items():
                        self.assertTrue(re.fullmatch(r"0|[1-9]\d*", k) and isinstance(v, str), f"{path.name} {k}")

    def broken(self, edit):
        table = copy.deepcopy(releases.load_releases())
        edit(table)
        with self.assertRaises(ValueError):
            releases.check_table(table)

    def test_a_code_that_is_no_country_or_pressing_is_refused(self):
        self.broken(lambda t: t["AO"]["releases"].__setitem__("pal", t["AO"]["releases"].pop("eu")))

    def test_a_disc_listed_twice_is_refused(self):
        def twice(t):
            t["AE"]["releases"]["fr"]["discs"][0]["sha1"] = t["AE"]["releases"]["eu"]["discs"][0]["sha1"]
        self.broken(twice)

    def test_a_disc_the_base_holds_is_refused_as_a_release(self):
        def base(t):
            t["AO"]["releases"]["eu"]["discs"][0]["sha1"] = t["AO"]["base"]["discs"][0]["sha1"]
        self.broken(base)

    def test_an_image_size_off_the_sector_is_refused(self):
        self.broken(lambda t: t["AO"]["releases"]["eu"]["discs"][0].__setitem__("bytes", 1000))

    def test_a_shipped_release_without_a_note_is_refused(self):
        self.broken(lambda t: t["AO"]["releases"]["eu"].pop("note"))

    def test_an_unknown_code_page_is_refused(self):
        self.broken(lambda t: t["AO"]["releases"]["fr"].__setitem__("code_page", "latin1"))

    def test_a_release_without_a_code_page_is_refused(self):
        self.broken(lambda t: t["AO"]["releases"]["fr"].__setitem__("code_page", None))

    def test_a_verdict_off_the_list_is_refused(self):
        self.broken(lambda t: t["AE"]["releases"]["jp"].__setitem__("verdicts", {"MIP04C35": "maybe"}))

    def test_a_field_the_table_does_not_know_is_refused(self):
        self.broken(lambda t: t["AE"]["releases"]["eu"].__setitem__("region", "PAL"))


class Images(unittest.TestCase):
    def setUp(self):
        self.dir = tempfile.TemporaryDirectory()
        self.addCleanup(self.dir.cleanup)

    def test_images_come_back_in_disc_order_whatever_order_they_were_given(self):
        one, d1 = image(self.dir.name, "x.bin", 1)
        two, d2 = image(self.dir.name, "y.bin", 2)
        self.assertEqual(releases.order_discs([two, one], entry(d1, d2), "t"), [one, two])

    def test_an_image_that_is_no_disc_of_the_release_is_refused(self):
        one, d1 = image(self.dir.name, "x.bin", 1)
        other, _ = image(self.dir.name, "z.bin", 9)
        with self.assertRaises(SystemExit):
            releases.order_discs([one, other], entry(d1), "t")

    def test_a_missing_disc_is_refused(self):
        one, d1 = image(self.dir.name, "x.bin", 1)
        with self.assertRaises(SystemExit):
            releases.order_discs([one], entry(d1, "0" * 40), "t")

    def test_a_directory_is_searched_by_bytes_whatever_the_names(self):
        one, d1 = image(self.dir.name, "renamed.bin", 1)
        two, d2 = image(self.dir.name, "also renamed.img", 2)
        image(self.dir.name, "unrelated.bin", 7)
        self.assertEqual(releases.find_discs(self.dir.name, entry(d1, d2), "t"), [one, two])

    def test_the_variable_names_the_images_when_none_are_given(self):
        one, d1 = image(self.dir.name, "x.bin", 1)
        table = {"AO": {"releases": {"us-r1": entry(d1)}}}
        with mock.patch.dict(os.environ, {"ODDWORLD_DISC_AO_US_R1": str(one)}):
            self.assertEqual(releases.release_images("AO", "us-r1", None, table), [one])
