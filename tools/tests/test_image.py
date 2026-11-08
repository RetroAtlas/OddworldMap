"""Tests for the image stage: the LZ variant, the FG1 walk over synthetic
streams, the PNG reader over every shape oxipng reduces to, the re-encode and
the pinned encoder; the tests that encode through oxipng skip where none is on
PATH, which is every CI run."""

import random
import re
import shutil
import struct
import subprocess
import sys
import tempfile
import unittest
import zlib
from pathlib import Path
from unittest import mock

sys.path[:0] = [str(Path(__file__).resolve().parents[1])]

from oddmap import image  # noqa: E402
from oddmap.paths import SITE  # noqa: E402


def png(w, h, depth, ctype, lines, plte=None, trns=None, interlace=0):
    """one PNG from filtered scanlines, each opening with its filter byte"""
    def chunk(tag, data):
        c = tag + data
        return struct.pack(">I", len(data)) + c + struct.pack(">I", zlib.crc32(c))
    head = chunk(b"IHDR", struct.pack(">IIBBBBB", w, h, depth, ctype, 0, 0, interlace))
    head += chunk(b"PLTE", plte) if plte is not None else b""
    head += chunk(b"tRNS", trns) if trns is not None else b""
    return b"\x89PNG\r\n\x1a\n" + head + chunk(b"IDAT", zlib.compress(b"".join(lines))) + chunk(b"IEND", b"")


class Decompress4or5(unittest.TestCase):
    def test_literal_run_then_overlapping_back_copy(self):
        stream = struct.pack("<I", 5) + bytes([1]) + b"AB" + bytes([0x80, 1])
        self.assertEqual(image.decompress_4or5(stream), b"ABABA")

    def test_stops_at_the_declared_length(self):
        stream = struct.pack("<I", 2) + bytes([1]) + b"AB" + bytes([1]) + b"CD"
        self.assertEqual(image.decompress_4or5(stream), b"AB")

    def test_a_back_copy_cut_at_its_control_byte_stops_short(self):
        stream = struct.pack("<I", 5) + bytes([1]) + b"AB" + bytes([0x80])
        self.assertEqual(image.decompress_4or5(stream), b"AB")

    def test_a_back_copy_reaching_before_the_output_stops_short(self):
        stream = struct.pack("<I", 5) + bytes([0x80, 0]) + bytes([1]) + b"AB"
        self.assertEqual(image.decompress_4or5(stream), b"")


class DecodeFg1(unittest.TestCase):
    """the FG1 walk over synthetic streams: a 4x2 canvas whose cam pixels are all 0x11"""

    W, H = 4, 2
    CAM = bytes([0x11]) * (W * H * 4)
    RED = struct.pack("<H", 0x1F)
    # a 2x1 partial block at (1, 0): one red pixel, one transparent
    BLOCK = struct.pack("<HHhhHH", 0, 0, 1, 0, 2, 1) + RED + bytes(2)

    @staticmethod
    def header(typ, layer=0, x=0, y=0, cw=0, ch=0):
        return struct.pack("<HHhhHH", typ, layer, x, y, cw, ch)

    @classmethod
    def sub(cls, body):
        """body inside a 0xFFFD sub-stream, held as literal LZ runs"""
        runs = [body[i:i + 128] for i in range(0, len(body), 128)]
        lz = struct.pack("<I", len(body)) + b"".join(bytes([len(r) - 1]) + r for r in runs)
        return cls.header(0xFFFD, layer=len(body), x=len(lz)) + lz

    def decode(self, *chunks):
        return image.decode_fg1([bytes(4) + b"".join(chunks)], self.CAM, self.W, self.H)

    def marked(self, overlays):
        """per layer id, the pixels its overlay marks"""
        return {layer: {(i % self.W, i // self.W): bytes(o[i * 4:i * 4 + 4])
                        for i in range(self.W * self.H) if o[i * 4 + 3]}
                for layer, o in overlays.items()}

    def test_a_partial_block_marks_its_pixels_and_leaves_zero_transparent(self):
        overlays, clean = self.decode(self.BLOCK, self.header(0xFFFF))
        self.assertTrue(clean)
        self.assertEqual(self.marked(overlays), {0: {(1, 0): b"\xff\x00\x00\xff"}})

    def test_the_same_block_inside_a_sub_stream_marks_the_same_pixels(self):
        overlays, clean = self.decode(self.sub(self.BLOCK + self.header(0xFFFC)), self.header(0xFFFF))
        self.assertTrue(clean)
        self.assertEqual(self.marked(overlays), {0: {(1, 0): b"\xff\x00\x00\xff"}})

    def test_a_full_block_copies_the_cam_pixels(self):
        overlays, clean = self.decode(self.header(0xFFFE, x=0, y=1, cw=2, ch=1), self.header(0xFFFF))
        self.assertTrue(clean)
        self.assertEqual(self.marked(overlays), {0: {(0, 1): bytes([0x11]) * 4, (1, 1): bytes([0x11]) * 4}})

    def test_each_block_draws_into_the_overlay_of_its_own_layer(self):
        overlays, clean = self.decode(self.BLOCK, self.header(0xFFFE, layer=3, x=0, y=1, cw=1, ch=1),
                                      self.header(0xFFFF))
        self.assertTrue(clean)
        self.assertEqual(self.marked(overlays), {0: {(1, 0): b"\xff\x00\x00\xff"},
                                                 3: {(0, 1): bytes([0x11]) * 4}})

    def test_a_partial_block_draws_over_a_full_block_on_its_layer_whichever_comes_first(self):
        full = self.header(0xFFFE, x=0, y=0, cw=4, ch=1)
        for chunks in ((full, self.BLOCK), (self.BLOCK, full)):
            overlays, clean = self.decode(*chunks, self.header(0xFFFF))
            self.assertTrue(clean)
            self.assertEqual(self.marked(overlays)[0][(1, 0)], b"\xff\x00\x00\xff")
            self.assertEqual(self.marked(overlays)[0][(2, 0)], bytes([0x11]) * 4)

    def test_the_first_partial_block_to_mark_a_pixel_is_on_top(self):
        blue = struct.pack("<HHhhHH", 0, 0, 1, 0, 1, 1) + struct.pack("<H", 0x1F << 10)
        overlays, clean = self.decode(blue, self.BLOCK, self.header(0xFFFF))
        self.assertTrue(clean)
        self.assertEqual(self.marked(overlays), {0: {(1, 0): b"\x00\x00\xff\xff"}})

    def test_a_cameras_chunks_compose_as_one(self):
        first = bytes(4) + self.BLOCK + self.header(0xFFFF)
        second = bytes(4) + self.header(0xFFFE, x=0, y=0, cw=4, ch=1) + self.header(0xFFFF)
        overlays, clean = image.decode_fg1([first, second], self.CAM, self.W, self.H)
        self.assertTrue(clean)
        self.assertEqual(self.marked(overlays)[0][(1, 0)], b"\xff\x00\x00\xff")
        self.assertEqual(len(self.marked(overlays)[0]), 4)

    def test_a_layer_with_nothing_on_screen_has_no_overlay(self):
        overlays, clean = self.decode(self.header(0xFFFE, layer=1, x=-4, y=0, cw=2, ch=1), self.BLOCK,
                                      self.header(0xFFFF))
        self.assertTrue(clean)
        self.assertEqual(list(overlays), [0])

    def test_a_truncated_block_reports_unclean(self):
        overlays, clean = self.decode(self.BLOCK[:-2])
        self.assertFalse(clean)
        self.assertEqual(overlays, {})

    def test_a_junk_type_inside_a_sub_stream_reports_unclean(self):
        body = self.BLOCK + self.header(0x1234) + self.BLOCK + self.header(0xFFFC)
        _, clean = self.decode(self.sub(body), self.header(0xFFFF))
        self.assertFalse(clean)

    def test_a_sub_stream_that_runs_out_reports_unclean(self):
        _, clean = self.decode(self.sub(self.BLOCK), self.header(0xFFFF))
        self.assertFalse(clean)

    def test_a_bare_end_of_sub_stream_reports_unclean(self):
        _, clean = self.decode(self.header(0xFFFC), self.header(0xFFFF))
        self.assertFalse(clean)

    def test_a_sub_stream_too_short_for_its_prefix_reports_unclean(self):
        _, clean = self.decode(self.header(0xFFFD, x=2) + bytes(2), self.header(0xFFFF))
        self.assertFalse(clean)

    def test_a_sub_stream_declared_past_the_buffer_reports_unclean(self):
        _, clean = self.decode(self.header(0xFFFD, x=40) + bytes(2))
        self.assertFalse(clean)


class ReadPng(unittest.TestCase):
    """every shape oxipng reduces write_png's RGBA8 to reads back as that RGBA8"""

    def test_each_colour_type_and_depth_decodes(self):
        """each colour type at each depth it takes, a transparency key clearing
        exactly the samples or pixels equal to it"""
        R, G, B, W, T = b"\xff\0\0\xff", b"\0\xff\0\xff", b"\0\0\xff\xff", b"\xff\xff\xff\xff", bytes(4)

        def grey(v, alpha=255):
            return bytes((v, v, v, alpha))
        cases = [
            (png(2, 1, 8, 3, [b"\0\0\1"], plte=b"\xff\0\0\0\0\0", trns=b"\xff\0"), R + T),
            (png(3, 1, 2, 3, [b"\0" + bytes([0b00011000])], plte=b"\xff\0\0\0\xff\0\0\0\xff"), R + G + B),
            (png(9, 1, 1, 0, [b"\0\xaa\x80"], trns=b"\0\0"), (W + T) * 4 + W),
            (png(5, 1, 2, 0, [b"\0" + bytes([0b00011011, 0b10000000])]), grey(0) + grey(85) + grey(170) + W + grey(170)),
            (png(3, 1, 4, 0, [b"\0\x17\xf0"]), grey(17) + grey(119) + W),
            (png(4, 1, 4, 0, [b"\0\x67\x87"], trns=b"\0\x07"), grey(102) + grey(119, 0) + grey(136) + grey(119, 0)),
            (png(2, 1, 8, 0, [b"\0\0\xff"]), b"\0\0\0\xff" + W),
            (png(2, 1, 8, 2, [b"\0\xff\0\0\0\0\xff"], trns=b"\0\xff\0\0\0\0"), b"\xff\0\0\0" + B),
            (png(3, 1, 8, 2, [bytes([0, 1, 2, 3, 4, 5, 6, 2, 3, 4])], trns=bytes([0, 2, 0, 3, 0, 4])),
             bytes([1, 2, 3, 255, 4, 5, 6, 255, 2, 3, 4, 0])),
            (png(1, 1, 8, 4, [b"\0\x80\x40"]), b"\x80\x80\x80\x40"),
            (png(1, 1, 8, 6, [b"\0" + G]), G),
        ]
        for data, rgba in cases:
            w, h, got = image.read_png(data)
            self.assertEqual((w * h * 4, got), (len(rgba), rgba), data[16:29].hex())

    def test_each_filter_is_undone(self):
        """one filter type a row, applied as the spec defines it, at each pixel size
        a filter steps over, a packed depth among them, on rows wide enough that
        many a byte's sum wraps"""
        def paeth(a, b, c):
            p = a + b - c
            pa, pb, pc = abs(p - a), abs(p - b), abs(p - c)
            return a if pa <= pb and pa <= pc else b if pb <= pc else c

        def predicted(f, raw, prior, i, step):
            a, b, c = (raw[i - step] if i >= step else 0), prior[i], (prior[i - step] if i >= step else 0)
            return (0, a, b, (a + b) // 2, paeth(a, b, c))[f]

        w, rng = 37, random.Random(0)
        filters = (4, 3, 2, 1, 0, 1, 2, 3, 4)  # Paeth first, over the zero row above the image
        colours = [bytes((i * 16, 255 - i * 16, i * 7, i * 30 if i < 8 else 255)) for i in range(16)]
        plte, trns = b"".join(c[:3] for c in colours), bytes(c[3] for c in colours[:8])
        shapes = [  # colour type, depth, the bytes a filter steps by, a row's bytes, the RGBA they read as
            (0, 8, 1, w, lambda raw: b"".join(bytes((g, g, g, 255)) for g in raw)),
            (4, 8, 2, 2 * w, lambda raw: b"".join(bytes((g, g, g, a)) for g, a in zip(raw[::2], raw[1::2]))),
            (2, 8, 3, 3 * w, lambda raw: b"".join(raw[i:i + 3] + b"\xff" for i in range(0, len(raw), 3))),
            (6, 8, 4, 4 * w, lambda raw: raw),
            (3, 4, 1, (w + 1) // 2, lambda raw: b"".join(colours[i] for v in raw for i in (v >> 4, v & 15))[:4 * w]),
        ]
        for ctype, depth, step, stride, rgba in shapes:
            rows = [bytes(rng.randrange(256) for _ in range(stride)) for _ in filters]
            prior, lines = bytes(stride), []
            for f, raw in zip(filters, rows):
                lines.append(bytes([f]) + bytes((raw[i] - predicted(f, raw, prior, i, step)) & 255 for i in range(stride)))
                prior = raw
            palette = (plte, trns) if ctype == 3 else (None, None)
            self.assertEqual(image.read_png(png(w, len(rows), depth, ctype, lines, *palette)),
                             (w, len(rows), b"".join(map(rgba, rows))), f"colour type {ctype}")

    def test_a_shape_write_png_never_emits_is_refused(self):
        with self.assertRaisesRegex(ValueError, "depth 16"):
            image.read_png(png(1, 1, 16, 0, [b"\0\0\0"]))
        with self.assertRaisesRegex(ValueError, "interlace 1"):
            image.read_png(png(1, 1, 8, 0, [b"\0\0"], interlace=1))
        with self.assertRaisesRegex(ValueError, "not a PNG"):
            image.read_png(b"GIF89a")


class Reencode(unittest.TestCase):
    """a PNG re-emitted from its own pixels is the PNG the installed oxipng writes again"""

    RGBA = b"".join(bytes((x * 16, y * 60, 128, 255 if (x + y) % 3 else 0)) for y in range(4) for x in range(16))

    @unittest.skipUnless(shutil.which("oxipng"), "no oxipng on PATH")
    def test_a_written_png_re_emits_to_itself(self):
        with tempfile.TemporaryDirectory() as tmp:
            mask, cam, dst = (Path(tmp) / n for n in ("a_fg37.png", "a.png", "b.png"))
            image.write_png(mask, 16, 4, self.RGBA, keep_alpha=True)
            self.assertEqual(image.read_png(mask.read_bytes()), (16, 4, self.RGBA))
            self.assertFalse(image.reencode_png(mask, dst))
            self.assertEqual(dst.read_bytes(), mask.read_bytes())
            image.write_png(cam, 16, 4, self.RGBA)  # opaque on the way in, whatever the alpha said
            self.assertFalse(image.reencode_png(cam, dst))
            self.assertEqual(dst.read_bytes(), cam.read_bytes())

    @unittest.skipUnless(shutil.which("oxipng"), "no oxipng on PATH")
    def test_bytes_another_encoder_wrote_move_and_are_reported(self):
        with tempfile.TemporaryDirectory() as tmp:
            ours, theirs = Path(tmp) / "a_fg37.png", Path(tmp) / "b_fg37.png"
            image.write_png(ours, 16, 4, self.RGBA, keep_alpha=True)
            with mock.patch.object(image.subprocess, "run"):  # the raw RGBA8 stands for another encoder's bytes
                image.write_png(theirs, 16, 4, self.RGBA, keep_alpha=True)
            self.assertNotEqual(theirs.read_bytes(), ours.read_bytes())
            self.assertEqual(image.reencode_pngs([(ours, ours), (theirs, theirs)]), [theirs])
            self.assertEqual(theirs.read_bytes(), ours.read_bytes())
            self.assertEqual(image.reencode_pngs([]), [])


class PinnedEncoder(unittest.TestCase):
    """the builder encodes with one oxipng release, and the committed images reproduce at it"""

    def setUp(self):
        keep = mock.patch.object(image, "OXIPNG", image.OXIPNG)  # ensure_oxipng rebinds it, refusing or not
        keep.start()
        self.addCleanup(keep.stop)

    def answering(self, version):
        return mock.patch.object(image.subprocess, "run",
                                 return_value=subprocess.CompletedProcess([], 0, f"oxipng {version}\n"))

    def test_a_missing_oxipng_is_refused_naming_the_pin(self):
        with mock.patch.object(image.shutil, "which", return_value=None), \
             self.assertRaisesRegex(SystemExit, image.OXIPNG_VERSION.replace(".", r"\.")):
            image.ensure_oxipng()

    def test_a_release_off_the_pin_is_refused_naming_both(self):
        pin = image.OXIPNG_VERSION.replace(".", r"\.")
        with mock.patch.object(image.shutil, "which", return_value="/x/oxipng"), self.answering("10.1.1"), \
             self.assertRaisesRegex(SystemExit, rf"oxipng 10\.1\.1 is installed but .* oxipng {pin}"):
            image.ensure_oxipng()

    def test_an_answer_naming_no_release_is_refused(self):
        with mock.patch.object(image.shutil, "which", return_value="/x/oxipng"), \
             mock.patch.object(image.subprocess, "run", return_value=subprocess.CompletedProcess([], 0, "")), \
             self.assertRaisesRegex(SystemExit, "not a release"):
            image.ensure_oxipng()

    def test_the_pinned_release_passes(self):
        with mock.patch.object(image.shutil, "which", return_value="/x/oxipng"), \
             self.answering(image.OXIPNG_VERSION) as run:
            image.ensure_oxipng()
            self.assertEqual(image.OXIPNG, "/x/oxipng")
        run.assert_called_once_with(["/x/oxipng", "--version"], stdout=subprocess.PIPE, text=True, check=True)

    @unittest.skipUnless(shutil.which("oxipng"), "no oxipng on PATH")
    def test_the_committed_artwork_reproduces_at_the_pin(self):
        version = image.oxipng_version(shutil.which("oxipng"))
        self.assertEqual(version, image.OXIPNG_VERSION,
                         f"oxipng {version} is on PATH and the committed images encode with {image.OXIPNG_VERSION}: "
                         f"install that release (brew upgrade oxipng, or cargo install oxipng --version "
                         f"{image.OXIPNG_VERSION} --locked), or move OXIPNG_VERSION and re-encode the tree")
        pngs = sorted((SITE / "cams").rglob("*.png"))
        few = [p for p in pngs if re.search(r"_fg\d+\.png$", p.name) or p.parent.parent.name == "sprites"]
        sample = few + [p for p in pngs if p not in few][::40]
        with tempfile.TemporaryDirectory() as tmp:
            moved = image.reencode_pngs([(p, Path(tmp) / f"{i}.png") for i, p in enumerate(sample)])
        self.assertFalse(moved, f"{len(moved)} of {len(sample)} committed images do not reproduce at oxipng "
                                f"{image.OXIPNG_VERSION}, so the tree encodes with another release: --reencode-images "
                                f"it at the pin in a commit of its own, or move OXIPNG_VERSION to the release that "
                                f"wrote it. First: " + ", ".join(p.relative_to(SITE).as_posix() for p in moved[:5]))


if __name__ == "__main__":
    unittest.main()
