"""Tests for the sprite stage's pure functions: the animation-table walk over a
synthetic chunk, each frame codec against a frame lifted off a disc with the
rows it decodes to, the texel alpha states, the deterministic packing and the
sheet set's name, in a build and in the committed tree."""

import contextlib
import hashlib
import io
import json
import struct
import sys
import tempfile
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest import mock

sys.path[:0] = [str(Path(__file__).resolve().parents[1])]

from oddmap import image, sprites  # noqa: E402
from oddmap.paths import SITE  # noqa: E402

FIXTURES = json.loads((Path(__file__).parent / "fixtures" / "sprite_frames.json").read_text())


def anim_chunk(tables, frame_headers=1):
    """an Anim chunk whose frames are `frame_headers` opaque 8-bit 2x1 frames,
    one frame info each, and whose tables are the (fps, frames, loop, loop_start)
    tuples given, the last one the header's named table"""
    clut = struct.pack("<I", 2) + struct.pack("<2H", 0, 0x7FFF)
    body = bytearray(12)  # file header: max_w, max_h, frame_table_offset, word8
    clut_off = len(body)
    body += clut
    frame_offs = []
    for _ in range(frame_headers):
        frame_offs.append(len(body))
        body += struct.pack("<IBBBBHH", clut_off, 2, 1, 8, 0, 0, 0) + bytes([1, 1, 0, 0])
    info_offs = []
    for fo in frame_offs:
        info_offs.append(len(body))
        body += struct.pack("<Ihhhhhhhh", fo, 3, 0, -1, -1, 0, 0, 0, 0)
    table_offs = []
    for fps, frames, loop, loop_start in tables:
        table_offs.append(len(body))
        body += struct.pack("<HhhH", fps, len(frames), loop_start, 2 if loop else 0)
        body += struct.pack(f"<{len(frames)}I", *(info_offs[i] for i in frames))
    struct.pack_into("<hhII", body, 0, 2, 1, table_offs[-1], 0)
    return bytes(body)


class Walk(unittest.TestCase):
    def test_enumerates_every_table_in_order_ending_on_the_named_one(self):
        data = anim_chunk([(2, [0], True, 0), (1, [0, 0, 0], False, 0), (4, [0, 0], True, 1)])
        hdr, anims = sprites.walk(data)
        self.assertEqual([a["fps"] for a in anims], [2, 1, 4])
        self.assertEqual([len(a["frames"]) for a in anims], [1, 3, 2])
        self.assertEqual([a["loop"] for a in anims], [True, False, True])
        self.assertEqual(anims[2]["loop_start"], 1)
        self.assertEqual(anims[-1]["off"], hdr["frame_table_offset"])

    def test_a_zero_frame_table_keeps_its_slot(self):
        data = anim_chunk([(1, [0], True, 0), (1, [], False, 0), (1, [0], True, 0)])
        _hdr, anims = sprites.walk(data)
        self.assertEqual([len(a["frames"]) for a in anims], [1, 0, 1])

    def test_a_single_table_is_found_from_the_header_alone(self):
        data = anim_chunk([(3, [0], True, 0)])
        _hdr, anims = sprites.walk(data)
        self.assertEqual(len(anims), 1)

    def test_a_header_naming_nothing_walkable_fails(self):
        data = bytearray(anim_chunk([(1, [0], True, 0)]))
        struct.pack_into("<I", data, 4, len(data) - 4)  # a table offset at the padding
        with self.assertRaises(ValueError):
            sprites.walk(bytes(data))


class Codecs(unittest.TestCase):
    """each fixture is a frame header and payload lifted off a disc, its CLUT and
    the sha1 of the rows the game decodes it to"""

    def chunk(self, fx):
        frame = bytes.fromhex(fx["frame"])
        clut = struct.pack("<I", len(fx["clut"])) + struct.pack(f"<{len(fx['clut'])}H", *fx["clut"])
        data = bytearray(frame + clut)
        struct.pack_into("<I", data, 0, len(frame))  # the CLUT now sits after the payload
        return bytes(data)

    def test_every_codec_reproduces_its_rows(self):
        for name, fx in FIXTURES.items():
            with self.subTest(name):
                f = sprites.decode_frame(self.chunk(fx), 0, fx["game"])
                self.assertEqual((f["w"], f["h"], f["bpp"]), (fx["w"], fx["h"], fx["bpp"]))
                self.assertEqual(len(f["rows"]), fx["rows_len"])
                self.assertEqual(hashlib.sha1(f["rows"]).hexdigest(), fx["rows_sha1"])

    def test_the_fixtures_cover_each_codec_both_games_use(self):
        kinds = {(fx["game"], fx["comp"]) for fx in FIXTURES.values()}
        self.assertTrue({("AO", 0), ("AO", 2), ("AO", 3), ("AO", 4), ("AE", 0), ("AE", 6), ("AE", 7)} <= kinds)

    def test_a_codec_a_game_never_ships_is_refused(self):
        fx = next(v for v in FIXTURES.values() if v["comp"] == 7)
        with self.assertRaises(ValueError):
            sprites.decode_frame(self.chunk(fx), 0, "AO")

    def test_pitch_rounds_to_whole_words(self):
        self.assertEqual([sprites.pitch_halfwords(8, w) for w in (1, 2, 3, 4, 5)], [2, 2, 2, 2, 4])
        self.assertEqual([sprites.pitch_halfwords(4, w) for w in (1, 4, 5, 8, 9)], [2, 2, 2, 2, 4])
        self.assertEqual(sprites.pitch_halfwords(16, 3), 4)


class Texels(unittest.TestCase):
    def test_alpha_marks_clear_semi_transparent_and_opaque(self):
        frame = {"w": 3, "h": 1, "bpp": 8, "pitch": 4, "rows": bytes([0, 1, 2, 0])}
        clut = (0, 0x7FFF, 0x8000 | 0x1F)
        px = sprites.frame_rgba(frame, clut)
        self.assertEqual(px[3::4], bytes([sprites.ALPHA_CLEAR, sprites.ALPHA_OPAQUE, sprites.ALPHA_STP]))
        self.assertEqual(px[4:7], bytes([248, 248, 248]))
        self.assertEqual(px[8:11], bytes([248, 0, 0]))

    def test_four_bit_rows_put_the_low_nibble_left(self):
        frame = {"w": 2, "h": 1, "bpp": 4, "pitch": 2, "rows": bytes([0x21, 0])}
        px = sprites.frame_rgba(frame, (0, 0x001F, 0x03E0))
        self.assertEqual(px[0:3], bytes([248, 0, 0]))
        self.assertEqual(px[4:7], bytes([0, 248, 0]))


class Pack(unittest.TestCase):
    def test_places_tallest_first_without_overlap_and_deterministically(self):
        frames = [(10, 5), (300, 40), (1000, 7), (24, 24), (10, 5)]
        placed, heights = sprites.pack(frames)
        self.assertEqual(placed, sprites.pack(frames)[0])
        rects = [(s, x, y, x + w, y + h) for (s, x, y), (w, h) in zip(placed, frames)]
        for i, a in enumerate(rects):
            self.assertLessEqual(a[3], sprites.SHEET_W)
            for b in rects[i + 1:]:
                if a[0] != b[0]:
                    continue
                self.assertTrue(a[3] <= b[1] or b[3] <= a[1] or a[4] <= b[2] or b[4] <= a[2], (a, b))
        self.assertEqual(len(heights), 1 + max(s for s, _, _ in placed))
        self.assertEqual(heights[0], max(r[4] for r in rects))



class SheetSet(unittest.TestCase):
    """a game's sheets are one set, named for their pixels, alone in their directory"""

    def write(self, out, px):
        frames, entries = [(1, 1, px)], {"A": {"frames": [(0, 0, 0)]}}
        with mock.patch.object(sprites, "build_sprites", return_value=(frames, entries, [])), \
                mock.patch.object(sprites, "read_dice", return_value=list(range(256))), \
                mock.patch.object(sprites, "write_png",
                                  side_effect=lambda path, w, h, rgba, keep_alpha: Path(path).write_bytes(rgba)), \
                contextlib.redirect_stdout(io.StringIO()):
            dst = sprites.write_sprites("AO", [("R1", SimpleNamespace(disc="d"))], out, "cams/ao/sprites")
        return json.loads(dst.read_text())["sheets"]

    def test_a_set_is_named_for_its_pixels_and_their_shape(self):
        a = (2, 1, bytes(8))
        name = sprites.sheet_set_name([a])
        self.assertEqual(name, sprites.sheet_set_name([(2, 1, bytes(8))]))
        self.assertNotEqual(name, sprites.sheet_set_name([(2, 1, bytes(7) + b"\1")]))
        self.assertNotEqual(name, sprites.sheet_set_name([(1, 2, bytes(8))]))
        self.assertNotEqual(name, sprites.sheet_set_name([a, a]))

    def test_a_build_leaves_its_set_alone_in_the_directory(self):
        with tempfile.TemporaryDirectory() as tmp:
            out = Path(tmp)
            sheets = out / "cams/ao/sprites"
            (sheets / "0123456789ab").mkdir(parents=True)
            (sheets / "0123456789ab/0.png").write_bytes(b"x")
            (sheets / "0.png").write_bytes(b"x")

            def shipped():
                return sorted(p.relative_to(out).as_posix() for p in sheets.rglob("*") if p.is_file())
            first = self.write(out, bytes([1, 2, 3, 255]))
            self.assertEqual(shipped(), first)
            self.assertEqual(len(list(sheets.iterdir())), 1)
            self.assertEqual(self.write(out, bytes([1, 2, 3, 255])), first)
            second = self.write(out, bytes([1, 2, 4, 255]))
            self.assertNotEqual(second, first)
            self.assertEqual(shipped(), second)
            self.assertEqual(len(list(sheets.iterdir())), 1)

    def test_each_game_ships_the_one_set_its_sidecar_names(self):
        for game in ("ao", "ae"):
            with self.subTest(game=game):
                listed = json.loads((SITE / f"sprites_{game}.json").read_text())["sheets"]
                sheets = SITE / "cams" / game / sprites.SHEETS_DIR
                self.assertEqual(sorted(p.relative_to(SITE).as_posix() for p in sheets.rglob("*") if p.is_file()),
                                 sorted(listed))
                names = {Path(f).parent.name for f in listed}
                self.assertEqual(len(names), 1, names)
                pixels = [image.read_png((SITE / f).read_bytes()) for f in listed]
                self.assertEqual(names.pop(), sprites.sheet_set_name(pixels),
                                 "a sheet set's directory is named for its pixels: rebuild the sprites")


def container(*chunks):
    """a chunk container of (tag, rid, data) entries, closed by an End! chunk"""
    out = bytearray()
    for tag, rid, data in chunks:
        out += struct.pack("<IHHII", 16 + len(data), 0, 0, struct.unpack("<I", tag.encode("latin1"))[0], rid) + data
    out += struct.pack("<IHHII", 16, 0, 0, struct.unpack("<I", b"End!")[0], 0)
    return bytes(out)


class Level:
    def __init__(self, **files):
        self.files = list(files)
        self._files = files

    def read(self, name):
        return self._files[name]


class Gather(unittest.TestCase):
    def test_a_chunk_repeated_across_levels_is_kept_once(self):
        a = anim_chunk([(2, [0], True, 0)])
        anims, palts, cams = sprites.gather_chunks([("R1", Level(**{"X.BAN": container(("Anim", 7, a))})),
                                                     ("R2", Level(**{"X.BAN": container(("Anim", 7, a))}))])
        self.assertEqual(anims, {("X.BAN", 7): a})
        self.assertEqual((palts, cams), ({}, {}))

    def test_a_chunk_that_differs_between_levels_names_both(self):
        a = anim_chunk([(2, [0], True, 0)])
        b = anim_chunk([(1, [0], True, 0)])
        with self.assertRaises(SystemExit) as caught:
            sprites.gather_chunks([("R1", Level(**{"X.BAN": container(("Anim", 7, a))})),
                                   ("R2", Level(**{"X.BAN": container(("Anim", 7, b))}))])
        self.assertIn("X.BAN 7 differs between R1 and R2", str(caught.exception))


class AnimTable(unittest.TestCase):
    """the curated animation list: every entry names a chunk the builder can open"""

    def setUp(self):
        self.table = json.loads(sprites.SPRITE_ANIMS.read_text())

    def test_every_entry_is_well_formed(self):
        for name, per_game in self.table.items():
            self.assertTrue(per_game, name)
            for game, e in per_game.items():
                with self.subTest(name=name, game=game):
                    self.assertIn(game, ("ao", "ae"))
                    if "bg" in e:
                        self.assertIsInstance(e["bg"], int)
                        self.assertTrue(set(e) <= {"bg", "anim", "pal"}, e)
                    else:
                        self.assertTrue({"file", "rid", "anim"} <= set(e), e)
                        self.assertTrue(set(e) <= {"file", "rid", "anim", "pal"}, e)
                        self.assertRegex(e["file"], r"^[A-Z0-9]+\.(BAN|BND)$")
                    self.assertGreaterEqual(e.get("anim", 0), 0)
                    if "pal" in e:
                        self.assertEqual(len(e["pal"]), 2)
                        self.assertRegex(e["pal"][0], r"^[A-Z0-9]+\.(BAN|BND)$")

    def test_a_variant_shares_its_base_chunk(self):
        for name, per_game in self.table.items():
            base, _, variant = name.partition("@")
            if not variant:
                continue
            for game, e in per_game.items():
                b = self.table.get(base, {}).get(game)  # a palette variant may stand without its base
                if "pal" in e:
                    if b:
                        self.assertEqual({k: v for k, v in e.items() if k != "pal"}, b, name)
                else:  # a file variant: the same place in another file
                    self.assertIsNotNone(b, name)
                    self.assertNotEqual(e["file"], b["file"], name)
                    self.assertEqual({k: v for k, v in e.items() if k != "file"},
                                     {k: v for k, v in b.items() if k != "file"}, name)

    def test_load_anim_table_filters_by_game(self):
        ao, ae = sprites.load_anim_table("AO"), sprites.load_anim_table("AE")
        self.assertTrue(ao and ae)
        self.assertEqual(set(ao), {n for n, g in self.table.items() if "ao" in g})
        self.assertEqual(set(ae), {n for n, g in self.table.items() if "ae" in g})


class Dice(unittest.TestCase):
    def test_finds_the_one_run_holding_every_byte_once(self):
        table = bytes((i * 97 + 13) & 255 for i in range(256))
        data = bytes(range(0, 256, 2)) * 9 + table + bytes(300)
        self.assertEqual(sprites.permutation_windows(data), [len(data) - 556])

    def test_a_table_twice_or_absent_is_each_counted(self):
        table = bytes(range(256))
        self.assertEqual(len(sprites.permutation_windows(table + bytes([5]) * 7 + table)), 2)
        self.assertEqual(sprites.permutation_windows(bytes(range(255)) * 3), [])

if __name__ == "__main__":
    unittest.main()
