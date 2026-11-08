"""Tests for the message tables: the overlay string-table reader and the tables
found by their shape, over a synthetic overlay, and the JSON they emit."""

import contextlib
import io
import json
import struct
import sys
import unittest
from pathlib import Path
from unittest import mock

sys.path[:0] = [str(Path(__file__).resolve().parents[1])]

from oddmap import messages  # noqa: E402


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


class TablesByShape(unittest.TestCase):
    """the message tables found by their shape, with no anchor string"""

    BASE = 0x800A0000

    def overlay(self, strings, count=None, extra=()):
        """strings laid out 4-byte aligned, then the table naming each, then a
        word that names nothing"""
        blob, offsets = bytearray(), []
        for s in strings:
            offsets.append(len(blob))
            blob += s.encode("latin1") + b"\x00"
            blob += b"\x00" * (-len(blob) % 4)
        blob += struct.pack("<I", 0)
        for off in list(offsets) + list(extra):
            blob += struct.pack("<I", self.BASE + off)
        return bytes(blob) + struct.pack("<I", 0)

    LCD = ["", " " * 31 + "The profits justify the means.", " " * 31 + "Work!", " " * 31 + "Eat.",
           " " * 31 + "Sleep now.", " " * 31 + "Again", " " * 31 + "Go on then", " " * 31 + "Rest",
           " " * 31 + "The end of it"]

    def test_the_table_opening_on_the_lead_is_found_and_gives_the_load_address(self):
        strings, base = messages.lead_table(self.overlay(self.LCD), len(self.LCD))
        self.assertEqual((strings, base), (self.LCD, self.BASE))

    def test_a_lead_in_another_character_is_a_lead(self):
        lcd = [s.replace(" ", "\x02") for s in self.LCD]
        self.assertEqual(messages.lead_table(self.overlay(lcd), len(lcd))[0], lcd)

    HINTS = ["SNEAK TO BOMB", "ABE WAS HERE", "TEST THREE", "LEARN THE SONG", "BRAVE THE RING",
             "OUT OF SHADOWS"]

    def test_a_table_of_text_pointers_is_found_at_the_load_address(self):
        self.assertEqual(messages.pointer_tables(self.overlay(self.HINTS), 6, self.BASE), [self.HINTS])

    def test_a_table_of_one_pointer_repeated_is_no_message_table(self):
        self.assertEqual(messages.pointer_tables(self.overlay(["P"], extra=[0] * 5), 6, self.BASE), [])

    def test_a_longer_run_than_the_table_is_none(self):
        self.assertEqual(messages.pointer_tables(self.overlay(self.HINTS), 5, self.BASE), [])

    class Disc:
        def __init__(self, blobs):
            self.blobs = blobs
            self.files = {name: (i, len(b)) for i, (name, b) in enumerate(blobs.items())}

        def read(self, lba, size):
            return list(self.blobs.values())[lba]

    def test_an_overlay_no_path_loads_is_left_out_of_the_agreement(self):
        stale = self.LCD[:2] + [" " * 31 + "Older wording"] + self.LCD[3:]
        disc = self.Disc({"R1.OVL": self.overlay(self.LCD), "D6.OVL": self.overlay(stale)})
        with mock.patch.dict(messages.MESSAGE_TABLES, {"AO": {"lcd": (len(self.LCD), True)}}), \
                contextlib.redirect_stdout(io.StringIO()):
            with self.assertRaises(RuntimeError):
                messages.extract_messages("AO", [disc])
            got = messages.extract_messages("AO", [disc], overlays={"R1.OVL"})
        self.assertEqual(got["lcd"][1], "The profits justify the means.")


class MessageJson(unittest.TestCase):
    def test_a_backslash_drawn_as_a_glyph_survives_beside_a_button_code(self):
        tables = {"lcd": ["a\\b\x0bc", "\\"]}
        text = messages.message_json(tables)
        self.assertEqual(json.loads(text), tables)
        self.assertIn("\\u000b", text)

    def test_a_button_code_is_written_as_an_escape_not_as_whitespace(self):
        text = messages.message_json({"lcd": ["hold \x0a then \x09"]})
        self.assertIn("hold \\u000a then \\u0009", text)
        self.assertEqual(json.loads(text)["lcd"], ["hold \x0a then \x09"])


if __name__ == "__main__":
    unittest.main()
