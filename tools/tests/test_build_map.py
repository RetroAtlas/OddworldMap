"""Unit tests for the builder's pure functions: python3 -m unittest discover -s tools/tests

Stdlib only, and nothing here needs a disc image. The committed sidecars must
reproduce from the committed caches, and the caches from a fresh parse of the
alive_reversing checkout — the checkout-probing tests (the member-type parser
pair and the cache freshness checks) skip where none is found, beside the repo or
at $ODDWORLD_DECOMP, which CI points at a clone of the pin; a variable naming no
checkout fails them instead.
"""

import contextlib
import io
import json
import math
import os
import shutil
import struct
import subprocess
import sys
import tempfile
import unittest
import zlib
from pathlib import Path
from unittest import mock

sys.path[:0] = [str(Path(__file__).resolve().parents[1]), str(Path(__file__).resolve().parent)]

from oddmap import decomp, disc, emit, games, image, messages, relive, schema, tlv  # noqa: E402
from oddmap.paths import AO_COMMIT, DECOMP_COMMIT, HERE, SITE  # noqa: E402
from decomp_checkout import needs_decomp, stale  # noqa: E402

# the CLI has no test of its own and lint cannot resolve a cross-module import,
# so loading it here is what catches a name it asks the package for and misses
import build_map  # noqa: E402,F401


def png(w, h, depth, ctype, lines, plte=None, trns=None, interlace=0):
    """one PNG from filtered scanlines, each opening with its filter byte"""
    def chunk(tag, data):
        c = tag + data
        return struct.pack(">I", len(data)) + c + struct.pack(">I", zlib.crc32(c))
    head = chunk(b"IHDR", struct.pack(">IIBBBBB", w, h, depth, ctype, 0, 0, interlace))
    head += chunk(b"PLTE", plte) if plte is not None else b""
    head += chunk(b"tRNS", trns) if trns is not None else b""
    return b"\x89PNG\r\n\x1a\n" + head + chunk(b"IDAT", zlib.compress(b"".join(lines))) + chunk(b"IEND", b"")


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


class IntRows(unittest.TestCase):
    def test_keeps_integers_in_order_and_drops_the_rest(self):
        body = """
            { 0, 1, -2, kNullThing, 0x10, 3 },
            { 4, "name", 5 },
        """
        self.assertEqual(decomp.int_rows(body), [[0, 1, -2, 3], [4, 5]])


class MatchBrace(unittest.TestCase):
    def test_returns_past_the_matching_close(self):
        text = "enum E { a, b } trailing"
        self.assertEqual(text[: schema._match_brace(text, text.index("{"))], "enum E { a, b }")

    def test_skips_nested_braces(self):
        text = "struct S { enum E { a } m; } after"
        self.assertEqual(text[schema._match_brace(text, text.index("{")) :], " after")

    def test_unbalanced_ends_at_the_text(self):
        text = "struct S { enum E { a }"
        self.assertEqual(schema._match_brace(text, text.index("{")), len(text))


class StripComments(unittest.TestCase):
    def test_removes_line_and_block_comments(self):
        self.assertEqual(schema._strip_comments("a /* b */ c // d\ne"), "a  c \ne")

    def test_a_commented_enum_does_not_swallow_the_next_definition(self):
        src = "// enum Ignored {\nenum Real { a, b };"
        self.assertEqual(schema._strip_comments(src), "\nenum Real { a, b };")

    def test_a_comma_in_a_comment_mints_no_enumerator(self):
        src = "enum E { a, /* one, two */ b };"
        self.assertEqual(schema._strip_comments(src).count(","), 1)


class DeriveLabel(unittest.TestCase):
    def test_drops_the_value_suffix_and_e_prefix_and_splits_camel_case(self):
        self.assertEqual(schema._derive_label("eChaseAndDisappear_4"), "Chase And Disappear")

    def test_keeps_an_e_that_is_part_of_the_word(self):
        self.assertEqual(schema._derive_label("end_3"), "End")

    def test_leaves_an_all_caps_run_alone(self):
        self.assertEqual(schema._derive_label("eTLVSpawn_1"), "TLVSpawn")

    def test_an_underscore_is_a_word_break(self):
        self.assertEqual(schema._derive_label("eMudancheeVault_Ender_7"), "Mudanchee Vault Ender")


class InheritMemberTypes(unittest.TestCase):
    def test_a_base_members_type_reaches_the_derived_struct(self):
        flat = schema._inherit_member_types(
            {("Base", "scale"): "Scale_short"}, {"Derived": "Base"}, {("Base", "scale")})
        self.assertEqual(flat[("Derived", "scale")], "Scale_short")

    def test_the_derived_structs_own_declaration_wins(self):
        types = {("Base", "m"): "A", ("Derived", "m"): "B"}
        flat = schema._inherit_member_types(types, {"Derived": "Base"},
                                            {("Base", "m"), ("Derived", "m")})
        self.assertEqual(flat[("Derived", "m")], "B")

    def test_an_own_declaration_hides_the_base_even_where_a_filter_left_it_untyped(self):
        flat = schema._inherit_member_types({("Base", "m"): "A"}, {"Derived": "Base"},
                                            {("Base", "m"), ("Derived", "m")})
        self.assertNotIn(("Derived", "m"), flat)

    def test_a_chain_resolves_through_every_base(self):
        flat = schema._inherit_member_types({("Top", "m"): "A"}, {"Mid": "Top", "Bottom": "Mid"},
                                            {("Top", "m")})
        self.assertEqual(flat[("Bottom", "m")], "A")

    def test_an_untyped_declaration_midway_hides_the_top_of_the_chain(self):
        flat = schema._inherit_member_types({("Top", "m"): "A"}, {"Mid": "Top", "Bottom": "Mid"},
                                            {("Top", "m"), ("Mid", "m")})
        self.assertNotIn(("Mid", "m"), flat)
        self.assertNotIn(("Bottom", "m"), flat)

    def test_a_cycle_terminates(self):
        flat = schema._inherit_member_types({("A", "m"): "T"}, {"A": "B", "B": "A"},
                                            {("A", "m")})
        self.assertEqual(flat[("B", "m")], "T")


class ArmType(unittest.TestCase):
    TYPES = {("Path_Drill_Data", "field_18_behavior"): "DrillBehavior"}
    STRUCTS = {("Path_Drill", "field_10_data"): "Path_Drill_Data"}

    def arm(self, struct, segs):
        return schema._arm_type(struct, segs, self.TYPES, self.STRUCTS)

    def test_a_bare_member_takes_its_own_declaration(self):
        self.assertEqual(self.arm("Path_Drill_Data", ["field_18_behavior"]), "DrillBehavior")

    def test_a_dotted_expression_types_the_arm_it_ends_on(self):
        self.assertEqual(self.arm("Path_Drill", ["field_10_data", "field_18_behavior"]),
                         "DrillBehavior")

    def test_an_unswept_sub_struct_leaves_the_arm_untyped(self):
        self.assertIsNone(self.arm("Path_Drill", ["field_10_other", "field_18_behavior"]))


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
        return image.decode_fg1(bytes(4) + b"".join(chunks), self.CAM, self.W, self.H)

    def marked(self, overlay):
        return {(i % self.W, i // self.W): bytes(overlay[i * 4:i * 4 + 4])
                for i in range(self.W * self.H) if overlay[i * 4 + 3]}

    def test_a_partial_block_marks_its_pixels_and_leaves_zero_transparent(self):
        overlay, clean = self.decode(self.BLOCK, self.header(0xFFFF))
        self.assertTrue(clean)
        self.assertEqual(self.marked(overlay), {(1, 0): b"\xff\x00\x00\xff"})

    def test_the_same_block_inside_a_sub_stream_marks_the_same_pixels(self):
        overlay, clean = self.decode(self.sub(self.BLOCK + self.header(0xFFFC)), self.header(0xFFFF))
        self.assertTrue(clean)
        self.assertEqual(self.marked(overlay), {(1, 0): b"\xff\x00\x00\xff"})

    def test_a_full_block_copies_the_cam_pixels(self):
        overlay, clean = self.decode(self.header(0xFFFE, x=0, y=1, cw=2, ch=1), self.header(0xFFFF))
        self.assertTrue(clean)
        self.assertEqual(self.marked(overlay), {(0, 1): bytes([0x11]) * 4, (1, 1): bytes([0x11]) * 4})

    def test_a_truncated_block_reports_unclean(self):
        overlay, clean = self.decode(self.BLOCK[:-2])
        self.assertFalse(clean)
        self.assertIsNone(overlay)

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
        R, G, B, W, T = b"\xff\0\0\xff", b"\0\xff\0\xff", b"\0\0\xff\xff", b"\xff\xff\xff\xff", bytes(4)
        cases = [
            (png(2, 1, 8, 3, [b"\0\0\1"], plte=b"\xff\0\0\0\0\0", trns=b"\xff\0"), R + T),
            (png(3, 1, 2, 3, [b"\0" + bytes([0b00011000])], plte=b"\xff\0\0\0\xff\0\0\0\xff"), R + G + B),
            (png(9, 1, 1, 0, [b"\0\xaa\x80"], trns=b"\0\0"), (W + T) * 4 + W),
            (png(2, 1, 8, 0, [b"\0\0\xff"]), b"\0\0\0\xff" + W),
            (png(2, 1, 8, 2, [b"\0\xff\0\0\0\0\xff"], trns=b"\0\xff\0\0\0\0"), b"\xff\0\0\0" + B),
            (png(1, 1, 8, 4, [b"\0\x80\x40"]), b"\x80\x80\x80\x40"),
            (png(1, 1, 8, 6, [b"\0" + G]), G),
        ]
        for data, rgba in cases:
            w, h, got = image.read_png(data)
            self.assertEqual((w * h * 4, got), (len(rgba), rgba), data[16:29].hex())

    def test_each_filter_is_undone(self):
        rows = [bytes((y * 37 + i * 53) & 255 for i in range(8)) for y in range(5)]  # two RGBA pixels a row

        def paeth(a, b, c):
            p = a + b - c
            pa, pb, pc = abs(p - a), abs(p - b), abs(p - c)
            return a if pa <= pb and pa <= pc else b if pb <= pc else c

        def predicted(f, raw, prior, i):
            a, b, c = (raw[i - 4] if i >= 4 else 0), prior[i], (prior[i - 4] if i >= 4 else 0)
            return (0, a, b, (a + b) // 2, paeth(a, b, c))[f]

        prior, lines = bytes(8), []
        for f, raw in enumerate(rows):  # one filter type a row, applied as the spec defines it
            lines.append(bytes([f]) + bytes((raw[i] - predicted(f, raw, prior, i)) & 255 for i in range(8)))
            prior = raw
        self.assertEqual(image.read_png(png(2, 5, 8, 6, lines)), (2, 5, b"".join(rows)))

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
            mask, cam, dst = (Path(tmp) / n for n in ("a_fg.png", "a.png", "b.png"))
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
            ours, theirs = Path(tmp) / "a_fg.png", Path(tmp) / "b_fg.png"
            image.write_png(ours, 16, 4, self.RGBA, keep_alpha=True)
            with mock.patch.object(image.subprocess, "run"):  # the raw RGBA8 stands for another encoder's bytes
                image.write_png(theirs, 16, 4, self.RGBA, keep_alpha=True)
            self.assertNotEqual(theirs.read_bytes(), ours.read_bytes())
            self.assertEqual(image.reencode_pngs([(ours, ours), (theirs, theirs)]), [theirs])
            self.assertEqual(theirs.read_bytes(), ours.read_bytes())
            self.assertEqual(image.reencode_pngs([]), [])


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


class StringTableParse(unittest.TestCase):
    """the overlay string-table reader, over a synthetic overlay"""

    BASE = 0x80000000
    # varied lengths, so the run of gaps between them is a real signature
    WORDS = ["alpha", "bee", "gamma sun", "delta", "ep", "zeta rain", "eta",
             "theta", "iota moon", "kappa", "lambda", "mu", "nu sky", "xi"]

    def overlay(self, strings, extra=()):
        """`strings` 4-byte aligned as the linker lays them, then a pointer to each
        plus any `extra` slots, closed by the unrelated word that follows a table"""
        blob, offsets = bytearray(), []
        for s in strings:
            offsets.append(len(blob))
            blob += s.encode("latin1") + b"\x00"
            blob += b"\x00" * (-len(blob) % 4)
        for off in list(offsets) + list(extra):
            blob += struct.pack("<I", self.BASE + off)
        return bytes(blob) + struct.pack("<I", 0)

    def test_reads_the_strings_the_pointers_name(self):
        got = messages.string_table(self.overlay(self.WORDS), "alpha", 0, len(self.WORDS))
        self.assertEqual(got, self.WORDS)

    def test_the_anchor_need_not_be_the_first_entry(self):
        words = [""] + self.WORDS
        got = messages.string_table(self.overlay(words), "alpha", 1, len(words))
        self.assertEqual(got[:2], ["", "alpha"])

    def test_a_missing_anchor_finds_nothing(self):
        self.assertIsNone(messages.string_table(self.overlay(self.WORDS), "omega", 0, 14))

    def test_slots_sharing_one_pointer_all_read_as_that_string(self):
        """the empty entries of a real table all point at one shared string"""
        words = [""] + self.WORDS
        blob = self.overlay(words, extra=[0] * 3)
        got = messages.string_table(blob, "alpha", 1, len(words) + 3)
        self.assertEqual(got[-4:], ["xi", "", "", ""])

    def test_a_table_that_runs_on_past_its_length_is_refused(self):
        """the slot after the last must point nowhere, or the length is a guess"""
        self.assertIsNone(messages.string_table(self.overlay(self.WORDS), "alpha", 0, 10))

    def test_a_pointer_out_of_the_overlay_is_refused(self):
        blob = self.overlay(self.WORDS, extra=[1 << 20])
        self.assertIsNone(messages.string_table(blob, "alpha", 0, len(self.WORDS) + 1))


class MessageJson(unittest.TestCase):
    def test_a_button_code_is_written_as_an_escape_not_as_whitespace(self):
        text = messages.message_json({"lcd": ["hold \x0a then \x09"]})
        self.assertIn("hold \\u000a then \\u0009", text)
        self.assertEqual(json.loads(text)["lcd"], ["hold \x0a then \x09"])


class PinnedCheckout(unittest.TestCase):
    """a cache regenerates from the pinned tree or not at all"""

    def repo(self):
        d = Path(tempfile.mkdtemp(prefix="pin-"))
        self.addCleanup(shutil.rmtree, d, ignore_errors=True)  # a late write into .git must not red the suite
        (d / "Source").mkdir()
        (d / "Source" / "a.hpp").write_text("x\n")
        (d / ".gitignore").write_text("build/\n*.gen.h\n")
        git = ["git", "-C", str(d)]
        subprocess.run([*git, "init", "-q"], check=True)
        # an identity to commit as, and nothing that runs a hook or a signer
        for key, value in (("user.name", "t"), ("user.email", "t@t"), ("commit.gpgsign", "false"),
                           ("core.hooksPath", os.devnull)):
            subprocess.run([*git, "config", key, value], check=True)
        subprocess.run([*git, "add", "-A"], check=True)
        subprocess.run([*git, "commit", "-q", "-m", "one"], check=True)
        head = subprocess.run([*git, "rev-parse", "HEAD"], check=True, stdout=subprocess.PIPE, text=True).stdout.strip()
        return d, head

    def pinned(self, d, sha, ao=None):
        return mock.patch.multiple(decomp, REPO=d, DECOMP_COMMIT=sha, AO_COMMIT=ao or sha)

    def test_a_clean_checkout_at_the_pin_passes(self):
        d, head = self.repo()
        with self.pinned(d, head):
            self.assertEqual(decomp.pinned_checkout(), d)

    def test_a_checkout_off_the_pin_is_refused_naming_both_revisions(self):
        d, head = self.repo()
        with self.pinned(d, "f" * 40, ao=head), self.assertRaisesRegex(RuntimeError, f"at {head[:9]} but.*pinned to fffffffff"):
            decomp.pinned_checkout()

    def test_a_checkout_lacking_ao_commit_is_refused(self):
        d, head = self.repo()
        with self.pinned(d, head, ao="1" * 40), self.assertRaisesRegex(RuntimeError, "lacks 111111111"):
            decomp.pinned_checkout()

    def test_local_changes_under_source_are_refused(self):
        d, head = self.repo()
        (d / "Source" / "b.hpp").write_text("y\n")
        with self.pinned(d, head), self.assertRaisesRegex(RuntimeError, r"(?s)local changes under Source/.*b\.hpp"):
            decomp.pinned_checkout()

    def test_an_ignored_header_under_source_is_refused_and_an_ignored_other_file_is_not(self):
        d, head = self.repo()
        (d / "Source" / "cfg.gen.h").write_text("z\n")
        with self.pinned(d, head):
            self.assertEqual(decomp.pinned_checkout(), d)
        (d / "Source" / "build").mkdir()
        (d / "Source" / "build" / "c d.hpp").write_text("y\n")
        with self.pinned(d, head), self.assertRaisesRegex(RuntimeError, r"(?s)local changes under Source/.*c d\.hpp"):
            decomp.pinned_checkout()

    def test_a_skip_worktree_edit_is_refused(self):
        d, head = self.repo()
        subprocess.run(["git", "-C", str(d), "update-index", "--skip-worktree", "Source/a.hpp"], check=True)
        (d / "Source" / "a.hpp").write_text("y\n")
        with self.pinned(d, head), self.assertRaisesRegex(RuntimeError, r"(?s)not hold Source/ in full.*S Source/a\.hpp"):
            decomp.pinned_checkout()

    def test_a_directory_that_is_no_checkout_is_refused(self):
        d = Path(tempfile.mkdtemp(prefix="pin-"))
        self.addCleanup(shutil.rmtree, d)
        with mock.patch.object(decomp, "REPO", d), self.assertRaisesRegex(RuntimeError, "no git checkout"):
            decomp.pinned_checkout()
        inside, _ = self.repo()
        with mock.patch.object(decomp, "REPO", inside / "Source"), self.assertRaisesRegex(RuntimeError, "no git checkout"):
            decomp.pinned_checkout()

    def test_a_checkout_with_no_commit_is_refused(self):
        d = Path(tempfile.mkdtemp(prefix="pin-"))
        self.addCleanup(shutil.rmtree, d)
        subprocess.run(["git", "-C", str(d), "init", "-q"], check=True)
        with mock.patch.object(decomp, "REPO", d), self.assertRaisesRegex(RuntimeError, "no commit checked out"):
            decomp.pinned_checkout()

    def test_a_present_cache_is_read_without_asking(self):
        data = Path(tempfile.mkdtemp(prefix="data-"))
        self.addCleanup(shutil.rmtree, data)
        (data / "c.json").write_text('{"a": 1}')
        parse = mock.Mock(side_effect=AssertionError("parsed a cache that exists"))
        with mock.patch.object(decomp, "pinned_checkout", side_effect=RuntimeError("guard")):
            self.assertEqual(decomp.cached(data / "c.json", parse), {"a": 1})
        parse.assert_not_called()

    def test_every_cache_loader_asks_before_parsing(self):
        data = Path(tempfile.mkdtemp(prefix="data-"))
        self.addCleanup(shutil.rmtree, data)
        (data / "data").mkdir()
        parsed = mock.Mock(side_effect=AssertionError("parsed past the guard"))
        game = {"cache": "p.json", "schema_cache": "o.json", "enum_cache": "e.json", "relive_cache": "r.json",
                "parse_tables": parsed}
        loaders = [(decomp, None, lambda: decomp.load_cache(game)),
                   (schema, "parse_object_schema", lambda: schema.load_object_schema("AO", game)),
                   (schema, "parse_enum_labels", lambda: schema.load_enum_labels("AO", game)),
                   (relive, "parse_relive_schema", lambda: relive.load_relive_schema("AO", game))]
        for module, parser, load in loaders:
            with contextlib.ExitStack() as patched:
                patched.enter_context(mock.patch.object(module, "HERE", data))
                if parser:
                    patched.enter_context(mock.patch.object(module, parser, parsed))
                patched.enter_context(mock.patch.object(decomp, "pinned_checkout", side_effect=RuntimeError("guard")))
                with self.assertRaisesRegex(RuntimeError, "guard"):
                    load()
        parsed.assert_not_called()


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


class CacheStamp(unittest.TestCase):
    """the artwork cache name answers to the artwork and to nothing else"""

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


class MemberTypes(unittest.TestCase):
    @needs_decomp
    def test_a_base_structs_member_carries_its_declared_type(self):
        types, _ = schema.parse_member_types("AE")
        self.assertEqual(types[("Path_WellLocal", "field_0_scale")], "Scale_short")

    @needs_decomp
    def test_a_union_typed_member_carries_no_type(self):
        types, _ = schema.parse_member_types("AO")
        self.assertEqual(types[("Path_WellLocal", "field_18_scale")], "Scale_short")
        self.assertNotIn(("Path_WellLocal", "field_24_off_level_or_dx"), types)

    @needs_decomp
    def test_a_sub_struct_and_a_union_are_swept_for_their_arms(self):
        types, structs = schema.parse_member_types("AE")
        self.assertEqual(structs[("Path_Drill", "field_10_data")], "Path_Drill_Data")
        self.assertEqual(types[("Path_Drill_Data", "field_18_behavior")], "DrillBehavior")
        types, structs = schema.parse_member_types("AO")
        self.assertEqual(structs[("Path_WellExpress", "field_24_off_level_or_dx")], "OffLevelOrDx")
        self.assertEqual(types[("OffLevelOrDx", "level")], "LevelIds")


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
    def test_the_readme_names_both_pins(self):
        readme = (HERE.parent / "README.md").read_text()
        self.assertIn(DECOMP_COMMIT[:9], readme)
        self.assertIn(AO_COMMIT[:9], readme)

    def test_the_readme_names_the_oxipng_pin(self):
        self.assertIn(image.OXIPNG_VERSION, (HERE.parent / "README.md").read_text())


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
        few = [p for p in pngs if p.name.endswith("_fg.png") or p.parent.name == "sprites"]
        sample = few + [p for p in pngs if p not in few][::40]
        with tempfile.TemporaryDirectory() as tmp:
            moved = image.reencode_pngs([(p, Path(tmp) / f"{i}.png") for i, p in enumerate(sample)])
        self.assertFalse(moved, f"{len(moved)} of {len(sample)} committed images do not reproduce at oxipng "
                                f"{image.OXIPNG_VERSION}, so the tree encodes with another release: --reencode-images "
                                f"it at the pin in a commit of its own, or move OXIPNG_VERSION to the release that "
                                f"wrote it. First: " + ", ".join(p.relative_to(SITE).as_posix() for p in moved[:5]))


if __name__ == "__main__":
    unittest.main()
