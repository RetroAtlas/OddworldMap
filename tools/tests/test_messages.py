"""Tests for the message tables: the overlay string-table reader, the tables
and the alphabet found by their shape, over a synthetic overlay, and the JSON
they emit."""

import contextlib
import io
import json
import re
import struct
import sys
import unittest
from pathlib import Path
from unittest import mock

sys.path[:0] = [str(Path(__file__).resolve().parents[1]), str(Path(__file__).resolve().parent)]

from oddmap import messages  # noqa: E402
from oddmap.paths import REPO  # noqa: E402
from decomp_checkout import needs_decomp  # noqa: E402


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


class LettersByShape(unittest.TestCase):
    """the hint flies' alphabet found by its shape, with no length given"""

    BASE = 0x800A0000
    # of one, three, four and five dots, and not in the order their hex sorts in
    A, B, C, D = bytes([0x2F, 0x1D, 0x0B]), bytes([0x11, 0x13, 0x15, 0xF7]), bytes([0x15]), \
        bytes([0x1F, 0x13, 0x15, 0x17, 0x19])
    LETTERS = [A, B, C, D]
    HEX = ["2f1d0b", "111315f7", "15", "1f13151719"]

    def overlay(self, letters=LETTERS, order=None, before=b"", between=b"", pad=b"\x00", after=struct.pack("<I", 0)):
        """`before`, then a record per letter, `between`, the table naming them
        in `order`, and `after`, a word that names nothing"""
        blob, offsets = bytearray(before), []
        for dots in letters:
            offsets.append(len(blob))
            blob += bytes([len(dots)]) + dots
            blob += pad * (-len(blob) % 4)
        blob += between
        for i in order if order is not None else range(len(letters)):
            blob += struct.pack("<I", self.BASE + offsets[i])
        return bytes(blob) + after

    def test_an_alphabet_is_its_records_in_the_table_s_order(self):
        blob = self.overlay(before=struct.pack("<2I", 0, 0x25))
        self.assertEqual(messages.letter_tables(blob, self.BASE), [self.HEX])

    def test_a_table_may_name_a_record_twice_and_out_of_order(self):
        blob = self.overlay(order=[0, 3, 0, 2, 1])
        self.assertEqual(messages.letter_tables(blob, self.BASE), [[self.HEX[i] for i in (0, 3, 0, 2, 1)]])

    def test_an_alphabet_is_placed_by_its_table_and_the_record_each_entry_names(self):
        blob = self.overlay(before=struct.pack("<2I", 0, 0x25), order=[0, 3, 0, 2, 1])
        self.assertEqual(messages.alphabets(blob, self.BASE), [(32, [8, 24, 8, 20, 12])])

    def test_a_table_may_end_its_overlay(self):
        self.assertEqual(messages.letter_tables(self.overlay(after=b""), self.BASE), [self.HEX])

    def test_a_table_leaving_a_record_unnamed_is_refused(self):
        with self.assertRaisesRegex(RuntimeError, "leaves 1 of its records unnamed"):
            messages.letter_tables(self.overlay(order=[0, 1, 2]), self.BASE)

    def test_a_table_stopping_at_a_record_before_its_first_is_refused(self):
        """its first entry is not its lowest record, so the run from it reads short"""
        with self.assertRaisesRegex(RuntimeError, "names 3 letters and stops at a word naming a record before them"):
            messages.letter_tables(self.overlay(order=[1, 2, 3, 0]), self.BASE)

    def test_a_word_after_the_table_that_names_no_run_of_records_up_to_them_ends_it(self):
        """the flies' cursor before the letters, and a record that stops short of them"""
        cursor = self.overlay(before=struct.pack("<2I", 0, 0x25), after=struct.pack("<I", self.BASE + 4))
        self.assertEqual(messages.letter_tables(cursor, self.BASE), [self.HEX])
        short = self.overlay(before=bytes([1, 0x55, 0, 0]) + struct.pack("<I", 0), after=struct.pack("<I", self.BASE))
        self.assertEqual(messages.letter_tables(short, self.BASE), [self.HEX])

    def test_a_table_that_does_not_open_where_its_records_end_is_none(self):
        blob = self.overlay(between=struct.pack("<I", 0))
        self.assertEqual(messages.letter_tables(blob, self.BASE), [])

    def test_dots_running_on_into_the_padding_are_no_record(self):
        self.assertEqual(messages.letter_tables(self.overlay(pad=b"\x07"), self.BASE), [])

    def test_at_another_load_address_there_is_none(self):
        self.assertEqual(messages.letter_tables(self.overlay(), self.BASE + 4), [])

    HINTS = ["CAB", "A CAB", "BAD", "ABBA", "A, B", "CACA"]

    def disc(self, *alphabets, bare=()):
        """E1.OVL holding an LCD table, a hint fly table and the alphabets
        given, each its letters or the bytes it was built as, beside the
        overlays of `bare`, each holding an LCD table alone"""
        tables = TablesByShape()
        parts = [tables.overlay(tables.LCD), tables.overlay(self.HINTS),
                 *(a if isinstance(a, bytes) else self.overlay(a) for a in alphabets)]
        blob = b""
        for part in parts:  # each built at the load address, then moved to where it lies
            blob += b"".join(struct.pack("<I", w + len(blob) if w >= self.BASE else w)
                             for (w,) in struct.iter_unpack("<I", part))
        return tables.Disc({"E1.OVL": blob, **{name: tables.overlay(tables.LCD) for name in bare}})

    def extract(self, disc):
        with mock.patch.dict(messages.MESSAGE_TABLES, {"AO": {"lcd": (len(TablesByShape.LCD), True),
                                                              "hintfly": (len(self.HINTS), False)}}), \
                contextlib.redirect_stdout(io.StringIO()):
            return messages.extract_messages("AO", [disc])

    def test_the_alphabet_is_lifted_beside_the_table_spelled_in_it(self):
        got = self.extract(self.disc(self.LETTERS))
        self.assertEqual(got["alphabet"], self.HEX)
        self.assertEqual(got["hintfly"], self.HINTS, "a code below the first letter is no letter past the last")

    def test_an_overlay_without_the_hint_fly_table_owes_no_alphabet(self):
        self.assertEqual(self.extract(self.disc(self.LETTERS, bare=["R1.OVL"]))["alphabet"], self.HEX)

    def test_a_hint_fly_table_with_no_alphabet_beside_it_is_refused(self):
        with self.assertRaisesRegex(RuntimeError, "AO: E1.OVL holds 0 alphabets beside its hintfly table"):
            self.extract(self.disc())

    def test_two_alphabets_beside_a_hint_fly_table_are_refused(self):
        with self.assertRaisesRegex(RuntimeError, "AO: E1.OVL holds 2 alphabets beside its hintfly table"):
            self.extract(self.disc(self.LETTERS, self.LETTERS[:2]))

    def test_a_refused_alphabet_names_its_overlay(self):
        with self.assertRaisesRegex(RuntimeError, "AO: E1.OVL: the alphabet at .* leaves 1 of its records unnamed"):
            self.extract(self.disc(self.overlay(order=[0, 1, 2])))

    def test_a_message_spelling_past_its_alphabet_is_refused(self):
        with self.assertRaisesRegex(RuntimeError, "'BAD' spells 0x44, past the 3 letters of its alphabet"):
            self.extract(self.disc(self.LETTERS[:3]))

    def test_a_disc_with_no_hint_fly_table_is_refused_for_the_table(self):
        tables = TablesByShape()
        with self.assertRaisesRegex(RuntimeError, "AO: no overlay carries the hintfly table"):
            self.extract(tables.Disc({"R1.OVL": tables.overlay(tables.LCD)}))

    @needs_decomp
    def test_the_base_s_letters_are_the_decomp_s_a_to_z_dot_for_dot(self):
        source = (REPO / "Source" / "AliveLibAO" / "HintFly.cpp").read_text()
        arrays = {name: [int(n) for n in re.findall(r"(\d+)u", body)]
                  for name, body in re.findall(r"const u8 (\w+)\[\d+\] = \{(.*?)\};", source, re.S)}
        table = re.search(r"pHintFlyAlphabet_4C7268\[\] = \{(.*?)\};", source, re.S).group(1)
        letters = [arrays[name] for name in re.findall(r"(\w+),", table)]
        for count, *dots in letters:
            self.assertEqual(count, len(dots))
        shipped = json.loads((Path(__file__).resolve().parents[2] / "public" / "messages_ao.json").read_text())
        self.assertEqual(shipped["alphabet"], [bytes(dots).hex() for _count, *dots in letters])


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
