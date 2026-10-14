"""Tests for the sprite stage's pure functions: the animation-table walk over a
synthetic chunk, each frame codec against a frame lifted off a disc with the
rows it decodes to, the texel alpha states, the packing of a family's sheet,
each sheet's name and directory, in a build and in the committed tree, and the
LCD font's texture and glyph table."""

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
    def test_a_family_packs_in_order_each_animation_whole_on_a_shelf(self):
        anims = [[(300, 40), (300, 40)], [(500, 10)], [(10, 5)], [(1000, 7), (30, 9)]]
        placed, w, h = sprites.pack(anims)
        self.assertEqual(sprites.pack(anims), (placed, w, h))
        # the second will not fit beside the first and starts a shelf, the third
        # fits beside it, and the fourth, wider than the sheet, runs onto a second
        self.assertEqual(placed, [(0, 0), (300, 0), (0, 40), (500, 40), (0, 50), (0, 57)])
        self.assertEqual((w, h), (1000, 66))

    def test_the_sheet_is_cut_to_its_widest_shelf(self):
        self.assertEqual(sprites.pack([[(10, 4)], [], [(5, 6)]]), ([(0, 0), (10, 0)], 15, 6))

    def test_a_frame_two_animations_share_is_packed_once_where_it_first_appears(self):
        def px(v, n):
            return bytes([v, v, v, 255]) * n
        frames = [("F", 2, 1, px(1, 2)), ("F", 1, 1, px(2, 1))]
        entries = {"A": {"frames": [[1, 0, 0, None], [0, 0, 0, None]]}, "B": {"frames": [[0, 0, 0, None]]}}
        (w, h, rgba), spots = sprites.family_sheet("F", ["A", "B"], entries, frames)
        self.assertEqual(spots, {1: (0, 0), 0: (1, 0)})
        self.assertEqual((w, h, rgba), (3, 1, px(2, 1) + px(1, 2)))

    def test_a_family_past_the_height_cap_fails_naming_it(self):
        frames = [("Tall", 1, 5, bytes(20))]
        with mock.patch.object(sprites, "SHEET_MAX_H", 4), self.assertRaises(SystemExit) as caught:
            sprites.family_sheet("Tall", ["A"], {"A": {"frames": [[0, 0, 0, None]]}}, frames)
        self.assertIn("Tall", str(caught.exception))


class Build(unittest.TestCase):
    def test_a_chunk_two_families_name_is_decoded_onto_each(self):
        chunk = anim_chunk([(2, [0], True, 0)])
        table = {"A_Idle": {"family": "A", "file": "X.BAN", "rid": 7, "anim": 0},
                 "B_Idle": {"family": "B", "file": "X.BAN", "rid": 7, "anim": 0}}
        with mock.patch.object(sprites, "load_anim_table", return_value=table), \
                mock.patch.object(sprites, "gather_chunks", return_value=({("X.BAN", 7): chunk}, {}, {})):
            frames, entries, misses = sprites.build_sprites("AO", [])
        self.assertEqual(misses, [])
        self.assertEqual([f[0] for f in frames], ["A", "B"])
        self.assertEqual(frames[0][1:], frames[1][1:])
        self.assertEqual([entries[n]["frames"][0][0] for n in ("A_Idle", "B_Idle")], [0, 1])


class Sheets(unittest.TestCase):
    """each family's sheet is named for its family and its pixels, alone among the game's sheets"""

    FONT = {"w": 1, "h": 1, "texels": b"\x07", "glyphs": [[0, 0, 3, 0], [0, 0, 10, 0]]}

    def write(self, out, pixels, links=None):
        """a build of one one-frame animation per family, `pixels` giving each family's texel"""
        frames, entries = [], {}
        for k, (family, px) in enumerate(pixels.items()):
            frames.append((family, 1, 1, px))
            entries[f"{family}_Idle"] = {"family": family, "fps": 1, "loop": False, "loop_start": 0,
                                         "frames": [[k, 0, 0, [0, 0, 1, 1]]]}
        with mock.patch.object(sprites, "build_sprites", return_value=(frames, entries, [])), \
                mock.patch.object(sprites, "read_dice", return_value=list(range(256))), \
                mock.patch.object(sprites, "read_font", return_value=dict(self.FONT)), \
                mock.patch.object(sprites, "write_png",
                                  side_effect=lambda path, w, h, rgba, keep_alpha: Path(path).write_bytes(rgba)), \
                contextlib.redirect_stdout(io.StringIO()):
            dst = sprites.write_sprites("AO", [("R1", SimpleNamespace(disc="d"))], out, "cams/ao/sprites",
                                        links=links)
        return json.loads(dst.read_text())

    def test_a_sheet_is_named_for_its_pixels_and_its_shape(self):
        name = sprites.sheet_name(2, 1, bytes(8))
        self.assertEqual(name, sprites.sheet_name(2, 1, bytes(8)))
        self.assertNotEqual(name, sprites.sheet_name(2, 1, bytes(7) + b"\1"))
        self.assertNotEqual(name, sprites.sheet_name(1, 2, bytes(8)))
        self.assertRegex(name, r"^[0-9a-f]{12}$")

    def test_a_build_leaves_each_family_its_one_sheet_and_nothing_else(self):
        with tempfile.TemporaryDirectory() as tmp:
            out = Path(tmp)
            sheets = out / "cams/ao/sprites"
            # a family renamed only in case: where the filesystem ignores case this
            # is the file A's sheet is written to
            renamed = f"a.{sprites.sheet_name(1, 1, bytes([1, 2, 3, 255]))}.png"
            for stale in ("0123456789ab/0.png", "A.000000000000.png", "Gone.000000000000.png", "0.png", renamed):
                (sheets / stale).parent.mkdir(parents=True, exist_ok=True)
                (sheets / stale).write_bytes(b"x")

            def shipped():
                return sorted(p.relative_to(out).as_posix() for p in sheets.rglob("*") if p.is_file())
            first = self.write(out, {"A": bytes([1, 2, 3, 255]), "B": bytes([4, 5, 6, 255])})["sheets"]
            self.assertEqual(shipped(), sorted(first.values()))
            self.assertEqual(sorted(p.name for p in sheets.iterdir()), sorted(Path(r).name for r in first.values()))
            for family, rel in first.items():
                self.assertEqual(Path(rel).name.split(".")[0], family)
            self.assertEqual(self.write(out, {"A": bytes([1, 2, 3, 255]), "B": bytes([4, 5, 6, 255])})["sheets"],
                             first)
            second = self.write(out, {"A": bytes([1, 2, 3, 255]), "B": bytes([4, 5, 7, 255])})["sheets"]
            self.assertEqual(second["A"], first["A"])
            self.assertNotEqual(second["B"], first["B"])
            self.assertEqual(shipped(), sorted(second.values()))

    def test_every_frame_reads_back_from_its_family_s_sheet_and_one_family_leaves_the_rest_alone(self):
        def build(b_texel):
            def tex(v, n):
                return bytes([v, v + 1, v + 2, 255]) * n
            frames = [("A", 2, 2, tex(10, 4)), ("A", 3, 1, tex(20, 3)), ("B", 1, 3, tex(b_texel, 3))]
            def anim(*refs):
                return {"fps": 1, "loop": False, "loop_start": 0, "frames": [[i, 0, 0, [0, 0, 1, 1]] for i in refs]}
            entries = {"A_One": {"family": "A", **anim(0, 1)}, "A_Two": {"family": "A", **anim(1)},
                       "B_One": {"family": "B", **anim(2)}}
            return frames, entries
        with tempfile.TemporaryDirectory() as tmp:
            out = Path(tmp)
            runs = []
            for b_texel in (30, 40):
                frames, entries = build(b_texel)
                written = {}
                with mock.patch.object(sprites, "build_sprites", return_value=(frames, entries, [])), \
                        mock.patch.object(sprites, "read_dice", return_value=list(range(256))), \
                        mock.patch.object(sprites, "read_font", return_value=dict(self.FONT)), \
                        mock.patch.object(sprites, "write_png",
                                          side_effect=lambda path, w, h, rgba, keep_alpha:
                                          written.__setitem__(Path(path).relative_to(out).as_posix(), (w, h, rgba))), \
                        contextlib.redirect_stdout(io.StringIO()):
                    side = json.loads(sprites.write_sprites("AO", [("R1", SimpleNamespace(disc="d"))], out,
                                                            "cams/ao/sprites").read_text())
                for name, a in side["anims"].items():
                    for (family, x, y, w, h, *_), (i, *_) in zip(a["frames"], build(b_texel)[1][name]["frames"]):
                        sw, _, rgba = written[side["sheets"][family]]
                        cut = b"".join(rgba[((y + yy) * sw + x) * 4:((y + yy) * sw + x + w) * 4] for yy in range(h))
                        self.assertEqual((family, cut), frames[i][::3], name)
                runs.append(side)
            first, second = runs
            self.assertEqual(second["sheets"]["A"], first["sheets"]["A"])
            self.assertNotEqual(second["sheets"]["B"], first["sheets"]["B"])
            self.assertEqual({n: a for n, a in second["anims"].items() if n.startswith("A_")},
                             {n: a for n, a in first["anims"].items() if n.startswith("A_")})

    def test_a_frame_names_its_family_s_sheet_and_its_place_on_it(self):
        with tempfile.TemporaryDirectory() as tmp:
            side = self.write(Path(tmp), {"A": bytes([1, 2, 3, 255]), "B": bytes([4, 5, 6, 255])})
            self.assertEqual(side["anims"]["B_Idle"], {"fps": 1, "loop": False, "loop_start": 0,
                                                     "frames": [["B", 0, 0, 1, 1, 0, 0, 0, 0, 1, 1]]})

    def test_the_font_is_its_own_family_s_sheet_as_an_index_map(self):
        with tempfile.TemporaryDirectory() as tmp:
            out = Path(tmp)
            side = self.write(out, {"A": bytes([1, 2, 3, 255])})
            font = side["font"]
            self.assertEqual(font["sheet"], sprites.FONT_FAMILY)
            self.assertEqual((font["w"], font["h"], font["glyphs"]), (1, 1, self.FONT["glyphs"]))
            self.assertEqual((out / side["sheets"][font["sheet"]]).read_bytes(), bytes([7, 7, 7, 255]))

    def test_no_animation_may_take_the_font_s_family(self):
        with tempfile.TemporaryDirectory() as tmp, self.assertRaises(SystemExit) as caught:
            self.write(Path(tmp), {sprites.FONT_FAMILY: bytes([1, 2, 3, 255])})
        self.assertIn(sprites.FONT_FAMILY, str(caught.exception))

    def test_the_same_links_in_another_order_write_the_same_bytes(self):
        links = {"R1": {"1": [[-1, 1], [0, -1]], "10": [[-1, -1]]}, "E1": {"3": [[-1, -1]]},
                 "C1": {"2": [[1, -1], [-1, 0]]}}
        with tempfile.TemporaryDirectory() as tmp:
            out = Path(tmp)
            written = []
            for handed in (links, dict(reversed(links.items()))):
                self.assertEqual(self.write(out, {"A": bytes([1, 2, 3, 255])}, handed)["links"], links)
                written.append((out / "sprites_ao.json").read_bytes())
        self.assertEqual(written[0], written[1])

    def test_each_game_ships_the_sheets_its_sidecar_names_each_named_for_its_pixels(self):
        for game in ("ao", "ae"):
            with self.subTest(game=game):
                listed = json.loads((SITE / f"sprites_{game}.json").read_text())["sheets"]
                sheets = SITE / "cams" / game / sprites.SHEETS_DIR
                self.assertEqual(sorted(p.relative_to(SITE).as_posix() for p in sheets.rglob("*") if p.is_file()),
                                 sorted(listed.values()))
                sizes = {}
                for family, rel in listed.items():
                    w, h, rgba = image.read_png((SITE / rel).read_bytes())
                    self.assertEqual(Path(rel).name, f"{family}.{sprites.sheet_name(w, h, rgba)}.png",
                                     f"{rel}: a sheet is named for its family and its pixels: rebuild the sprites")
                    sizes[family] = (w, h)
                anims = json.loads((SITE / f"sprites_{game}.json").read_text())["anims"]
                for name, a in anims.items():
                    for family, x, y, w, h, *_ in a["frames"]:
                        sw, sh = sizes[family]
                        self.assertTrue(x + w <= sw and y + h <= sh, f"{game} {name} lies outside its sheet")


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
    """the curated animation list: every entry names a family and a chunk the builder can open"""

    def setUp(self):
        self.table = json.loads(sprites.SPRITE_ANIMS.read_text())

    @staticmethod
    def games(entry):
        return {k: v for k, v in entry.items() if k != "family"}

    def test_every_entry_is_well_formed(self):
        for name, entry in self.table.items():
            with self.subTest(name=name):
                # a family is a directory the worker reads as one and a sidecar key, and
                # the font's is the builder's own
                self.assertRegex(entry.get("family", ""), r"^[A-Z][A-Za-z0-9]*$")
                self.assertNotEqual(entry["family"], sprites.FONT_FAMILY)
                self.assertTrue(self.games(entry))
            for game, e in self.games(entry).items():
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

    def test_families_stay_apart_on_a_filesystem_blind_to_case(self):
        families = {e["family"] for e in self.table.values()}
        self.assertEqual(len({f.casefold() for f in families}), len(families))

    # the objects that draw a camera's own animation, by the id their fields carry
    DRAWS_BG = {"ao": {"BackgroundAnimation", "WellLocal", "WellExpress"}, "ae": {"BackgroundAnimation"}}

    def test_a_camera_s_own_animation_packs_with_the_first_path_that_draws_it(self):
        first = {}
        for game, types in self.DRAWS_BG.items():
            data = json.loads((SITE / f"map_data_{game}.json").read_text())
            for lvl in data["levels"]:
                for path in sorted(lvl["paths"], key=lambda p: p["id"]):
                    for t in path["tlvs"]:
                        rid = (t.get("fields") or {}).get("animation_id")
                        if t["name"] in types and rid:
                            first.setdefault(f"bg:{rid}", f"{lvl['short']}P{path['id']:02d}")
        for name, entry in self.table.items():
            if name.startswith("bg:"):
                self.assertEqual(entry["family"], first.get(name), name)

    def test_a_variant_shares_its_base_chunk_and_its_family(self):
        for name, entry in self.table.items():
            base, _, variant = name.partition("@")
            if not variant:
                continue
            if base in self.table:
                self.assertEqual(entry["family"], self.table[base]["family"], name)
            for game, e in self.games(entry).items():
                b = self.table.get(base, {}).get(game)  # a palette variant may stand without its base
                if "pal" in e:
                    if b:
                        self.assertEqual({k: v for k, v in e.items() if k != "pal"}, b, name)
                else:  # a file variant: the same place in another file
                    self.assertIsNotNone(b, name)
                    self.assertNotEqual(e["file"], b["file"], name)
                    self.assertEqual({k: v for k, v in e.items() if k != "file"},
                                     {k: v for k, v in b.items() if k != "file"}, name)

    def test_load_anim_table_filters_by_game_and_carries_the_family(self):
        ao, ae = sprites.load_anim_table("AO"), sprites.load_anim_table("AE")
        self.assertTrue(ao and ae)
        self.assertEqual(set(ao), {n for n, e in self.table.items() if "ao" in e})
        self.assertEqual(set(ae), {n for n, e in self.table.items() if "ae" in e})
        for name, spec in ao.items():
            self.assertEqual(spec, {**self.table[name]["ao"], "family": self.table[name]["family"]})

    def test_an_entry_without_a_family_fails_the_build(self):
        with tempfile.TemporaryDirectory() as tmp:
            table = Path(tmp) / "sprite_anims.json"
            table.write_text(json.dumps({"Slig_Idle": {"ao": {"file": "SLIG.BND", "rid": 412, "anim": 2}}}))
            with mock.patch.object(sprites, "SPRITE_ANIMS", table), self.assertRaises(SystemExit) as caught:
                sprites.load_anim_table("AO")
        self.assertIn("Slig_Idle", str(caught.exception))


class Font(unittest.TestCase):
    """the LCD font: the texture off a level's LCDFONT.FNT and the glyph table off the executable"""

    @staticmethod
    def table(lower_differs=False, end=b"\0\0\0\0"):
        ents = [b"\0\0\x03\0", b"\0\0\x0a\0"] + [bytes([0, 0, 6, 14])] * (sprites.GLYPH_COUNT - 2)
        for k in range(26):
            glyph = bytes([9 * (k % 12), 9 + 14 * (k // 12), 7, 14])
            ents[sprites.glyph_index(ord("A") + k)] = glyph
            ents[sprites.glyph_index(ord("a") + k)] = bytes([glyph[0], 60, 7, 14]) if lower_differs else glyph
        for i, code in enumerate(sprites.MESSAGE_BUTTONS):
            ents[sprites.glyph_index(code)] = bytes([18 * (i % 6), 72 + 16 * (i // 6), 18, 14])
        return b"".join(ents) + end

    def test_a_code_s_glyph_follows_the_engine_s_rule(self):
        self.assertEqual([sprites.glyph_index(c) for c in (0x21, ord("A"), ord("a"), 0xAF)], [2, 34, 66, 144])
        self.assertEqual([sprites.glyph_index(c) for c in (0x07, 0x08, 0x13, 0x1F)], [144, 145, 156, 168])
        self.assertEqual([sprites.glyph_index(c) for c in (0, 0x06, 0x20, 0xB0, 0xFF)], [None] * 5)
        self.assertEqual(sprites.GLYPH_COUNT, 157)

    def test_finds_the_one_window_shaped_like_the_table(self):
        decoy, real = self.table(lower_differs=True), self.table()
        exe = bytes(range(200)) + decoy + bytes(41) + real + bytes(300)
        at = 200 + len(decoy) + 41
        self.assertEqual(sprites.glyph_table_windows(exe, 112, 109), [at], "a table of bytes promises no alignment")
        self.assertEqual(sprites.glyph_table_windows(exe, 100, 109), [], "a glyph past the texture's edge")
        self.assertEqual(sprites.glyph_table_windows(bytes(100) + self.table(end=b"\0\0\x09\0"), 112, 109), [],
                         "a table that runs on past its end")

    def test_the_glyph_table_is_read_off_every_disc_and_they_must_agree(self):
        def disc(table):
            exe = bytes(64) + table + bytes(64)
            return SimpleNamespace(files={"SLUS_001.90": (24, len(exe))}, read=lambda lba, size: exe)
        glyphs = sprites.read_glyph_table([disc(self.table())], 112, 109)
        self.assertEqual(len(glyphs), sprites.GLYPH_COUNT)
        self.assertEqual(glyphs[:2], [[0, 0, 3, 0], [0, 0, 10, 0]])
        self.assertEqual(glyphs[sprites.glyph_index(ord("B"))], [9, 9, 7, 14])
        with self.assertRaises(SystemExit) as caught:
            sprites.read_glyph_table([disc(self.table()), disc(self.table(end=b"\0\0\x09\0"))], 112, 109)
        self.assertIn("0 candidate LCD glyph tables", str(caught.exception))
        other = self.table()[:4 * 34] + bytes([1, 9, 7, 14]) + self.table()[4 * 35:]
        other = other[:4 * 66] + bytes([1, 9, 7, 14]) + other[4 * 67:]
        with self.assertRaises(SystemExit) as caught:
            sprites.read_glyph_table([disc(self.table()), disc(other)], 112, 109)
        self.assertIn("disagree", str(caught.exception))

    def test_the_texture_reads_its_header_then_the_texels_low_nibble_first(self):
        chunk = struct.pack("<hhhh", 4, 1, 4, 16) + bytes(32) + bytes([0x21, 0x43])
        lvl = Level(**{sprites.FONT_FILE: container(("Font", sprites.FONT_RID, chunk))})
        self.assertEqual(sprites.read_font_texture([("R1", lvl), ("CR", Level()), ("R2", lvl)]),
                         (4, 1, bytes([1, 2, 3, 4])))

    def test_copies_must_agree_and_one_must_exist(self):
        a = struct.pack("<hhhh", 2, 1, 4, 16) + bytes(32) + bytes([0x21])
        b = struct.pack("<hhhh", 2, 1, 4, 16) + bytes(32) + bytes([0x12])
        with self.assertRaises(SystemExit) as caught:
            sprites.read_font_texture([("R1", Level(**{sprites.FONT_FILE: container(("Font", 2, a))})),
                                       ("R2", Level(**{sprites.FONT_FILE: container(("Font", 2, b))}))])
        self.assertIn("LCDFONT.FNT differs between R1 and R2", str(caught.exception))
        with self.assertRaises(SystemExit):
            sprites.read_font_texture([("CR", Level())])

    def test_an_index_map_carries_the_index_in_every_channel(self):
        self.assertEqual(sprites.index_map_rgba(bytes([0, 5])), bytes([0, 0, 0, 255, 5, 5, 5, 255]))


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
