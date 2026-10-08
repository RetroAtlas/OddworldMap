"""Tests for the visit tool: the memory card layout, the Oddysee save's fields,
checksum and object flags over synthetic path data, and how a permalink
becomes a place on a floor."""

import configparser
import struct
import sys
import tempfile
import unittest
from pathlib import Path

sys.path[:0] = [str(Path(__file__).resolve().parents[1])]

import visit  # noqa: E402
from oddmap import memcard, savegame  # noqa: E402

GEOMETRY = {"cellW": 368, "cellH": 240, "worldW": 1024, "worldH": 480,
            "winX": 256, "winY": 120, "visW": 368, "visH": 240}
CONTINUE_POINT = {"t": 0, "name": "ContinuePoint", "x1": 4625, "y1": 1638, "x2": 4649, "y2": 1779,
                  "extra": {"zone": 31},
                  "fields": {"zone_number": 31, "clear_from_id": 2, "clear_to_id": 80,
                             "elum_restarts": 1, "abe_spawn_direction": 1}}
DATA = {"geometry": GEOMETRY, "levels": [{
    "id": 8, "short": "D1", "name": "Scrabania", "paths": [{
        "id": 7, "w": 9, "h": 5,
        "cams": [{"cell": 31, "name": "D1P07C13"}, {"cell": 32, "name": "D1P07C14"}],
        "tlvs": [CONTINUE_POINT],
        "lines": [[4575, 1759, 4825, 1759, 0], [4575, 1600, 4825, 1600, 3], [5400, 1700, 5500, 1720, 4]],
    }],
}]}


def xor(frame):
    x = 0
    for b in frame[:127]:
        x ^= b
    return x


class MemoryCard(unittest.TestCase):
    def test_blank_card_is_formatted(self):
        card = memcard.blank_card()
        self.assertEqual(len(card), memcard.CARD_SIZE)
        frames = [card[i * 128:(i + 1) * 128] for i in range(64)]
        self.assertEqual(frames[0][:2], b"MC")
        for i in range(1, 16):
            self.assertEqual(struct.unpack_from("<IIH", frames[i]), (memcard.FREE, 0, 0xFFFF))
        for i in list(range(0, 36)) + [63]:
            self.assertEqual(frames[i][127], xor(frames[i]))
        self.assertEqual(frames[63], frames[0])
        self.assertEqual(set(card[memcard.BLOCK:]), {0xFF})

    def test_saves_round_trip_and_chain(self):
        one = bytes(range(256)) * 32
        two = b"\x01" * memcard.BLOCK + b"\x02" * memcard.BLOCK
        card = memcard.write_card([("BASLUS-00190ABEaaaaa", one), ("BASLUS-00190ABEbbbbb", two)])
        self.assertEqual(memcard.read_saves(card),
                         [("BASLUS-00190ABEaaaaa", one), ("BASLUS-00190ABEbbbbb", two)])
        states = [struct.unpack_from("<I", card, i * 128)[0] for i in (1, 2, 3, 4)]
        self.assertEqual(states, [memcard.FIRST, memcard.FIRST, memcard.LAST, memcard.FREE])
        self.assertEqual(struct.unpack_from("<H", card, 2 * 128 + 8)[0], 2)  # block 3, as a directory index
        for i in (1, 2, 3):
            self.assertEqual(card[i * 128 + 127], xor(card[i * 128:(i + 1) * 128]))

    def test_refuses_what_a_card_cannot_hold(self):
        with self.assertRaises(ValueError):
            memcard.write_card([("X" * 21, bytes(memcard.BLOCK))])
        with self.assertRaises(ValueError):
            memcard.write_card([("A", bytes(100))])
        with self.assertRaises(ValueError):
            memcard.write_card([("A", bytes(memcard.BLOCK * 16))])


def path_blob(lists, cells):
    """an object region then an index table: each list a run of (flags, state)
    records 24 bytes long, the table pointing each listed cell at its list"""
    region, entries = bytearray(), [-1] * cells
    for cell, records in lists.items():
        entries[cell] = len(region)
        for flags, state in records:
            region += struct.pack("<BBhI", flags, state, 24, 0) + bytes(16)
    meta = {"obj_off": 0, "idx_off": len(region)}
    return bytes(region) + struct.pack(f"<{cells}i", *entries), meta


class SaveGame(unittest.TestCase):
    def place(self, line_type=0):
        zone = savegame.Zone(31, 2, 80, (4625, 1638, 4649, 1779))
        return savegame.Place(8, 7, 13, 4637, 1759, line_type, 1, zone)

    def test_title_is_full_width_shift_jis(self):
        self.assertEqual(savegame.sjis_title("Abe: P07-1").hex(),
                         "82608282828581468140826f824f8256817c8250")
        with self.assertRaises(ValueError):
            savegame.sjis_title("x" * 33)

    def test_header_is_the_first_of_two(self):
        first, second = b"SC\x11\x01" + b"\x01" * 0x1FC, b"SC\x11\x01" + b"\x02" * 0x1FC
        self.assertEqual(savegame.save_header(b"\0" * 16 + first + second), first)
        with self.assertRaises(ValueError):
            savegame.save_header(first)

    def test_object_flags_follow_the_index_table(self):
        blob, meta = path_blob({1: [(0, 5), (4, 0)], 3: [(4, 9)]}, 4)
        self.assertEqual(savegame.tlv_flags(blob, meta, 4), bytes([0, 5, 4, 0, 4, 9]))
        far = bytearray(blob)
        struct.pack_into("<i", far, meta["idx_off"] + 4, 0x100000)
        self.assertEqual(savegame.tlv_flags(bytes(far), meta, 4), bytes([4, 9]))

    def test_flag_block_holds_switches_then_paths(self):
        block = savegame.flag_block([b"\x04\x00", b"\x00\x01\x04\x02"])
        self.assertEqual(block, bytes(savegame.SWITCHES) + b"\x04\x00\x00\x01\x04\x02")
        with self.assertRaises(ValueError):
            savegame.flag_block([bytes(savegame.FLAGS_CAP)])

    def test_save_fields_and_checksum(self):
        header = b"SC\x11\x01" + bytes(range(256)) * 2
        header = header[:savegame.HEADER_SIZE]
        flags = savegame.flag_block([b"\x04\x07"])
        data = savegame.ao_save(header, "Abe: Scrabania P07 C13", self.place(), flags)
        self.assertEqual(len(data), savegame.SAVE_SIZE)
        self.assertEqual(data[:4], b"SC\x11\x01")
        self.assertEqual(data[0x44:savegame.HEADER_SIZE], header[0x44:])
        self.assertEqual(data[4:0x44].rstrip(b"\0"), savegame.sjis_title("Abe: Scrabania P07 C13"))
        self.assertEqual(struct.unpack_from("<i", data, 0x200)[0], savegame.save_hash(data))
        self.assertEqual(struct.unpack_from("<7h", data, 0x204), (31, 2, 80, 4625, 1638, 4649, 1779))
        self.assertEqual(struct.unpack_from("<3hi", data, 0x212), (8, 7, 13, savegame.FP_ONE))
        self.assertEqual(struct.unpack_from("<iIii3h2h", data, 0x224),
                         (4637, 1759, savegame.FP_ONE, savegame.FP_ONE, 8, 7, 13, 0, 1))
        self.assertEqual(data[0x2B0:0x2B0 + len(flags)], flags)
        half = savegame.ao_save(header, "Abe", self.place(line_type=4), flags)
        self.assertEqual(struct.unpack_from("<i", half, 0x230)[0], savegame.FP_ONE // 2)
        self.assertEqual(struct.unpack_from("<h", half, 0x23A)[0], 4)

    def test_checksum_wraps_to_a_signed_word(self):
        data = bytearray(savegame.SAVE_SIZE)
        struct.pack_into("<II", data, 0x204, 0x7FFFFFFF, 2)
        self.assertEqual(savegame.save_hash(data), -0x7FFFFFFF)


class Permalinks(unittest.TestCase):
    def test_reads_view_and_object(self):
        link = visit.parse_permalink(
            "http://localhost:8471/#AO/D1/7/4637/1709/1.60/ContinuePoint@4625,1638")
        self.assertEqual(link, {"game": "AO", "level": "D1", "path": 7, "view": (4637.0, 1709.0),
                                "obj": ("ContinuePoint", 4625, 1638)})

    def test_object_token_needs_a_view_before_it(self):
        self.assertEqual(visit.parse_permalink("#ao/d1/7")["view"], None)
        link = visit.parse_permalink("AO/D1/7/10/20/1/route=x/Slig%405600%2C1170")
        self.assertEqual((link["view"], link["obj"]), ((10.0, 20.0), ("Slig", 5600, 1170)))
        with self.assertRaises(ValueError):
            visit.parse_permalink("#AO/D1")

    def test_first_floor_at_or_below(self):
        lines = [[0, 100, 200, 100, 0], [0, 70, 200, 70, 4], [100, 0, 100, 300, 1], [0, 300, 200, 100, 0]]
        self.assertEqual(visit.floor_under(lines, 100, 90), ((100, 0), []))
        self.assertEqual(visit.floor_under(lines, 100, 50), ((70, 4), []))
        self.assertEqual(visit.floor_under(lines, 50, 110), ((250, 0), []))
        self.assertEqual(visit.floor_under(lines, 100, 100)[0], (100, 0))
        self.assertEqual(visit.floor_under([[0, 100, 200, 100, 0], [0, 20, 200, 20, 0]], 10, 50),
                         ((100, 0), []))
        self.assertEqual(visit.floor_under(lines, 300, 0), (None, []))

    def test_floor_within_reach_above_is_reported(self):
        floor, above = visit.floor_under([[0, 100, 200, 100, 0], [0, 50, 40, 50, 0]], 20, 60)
        self.assertEqual((floor, above), ((100, 0), [(50, 0)]))


class Places(unittest.TestCase):
    def link(self, **kw):
        base = {"game": "AO", "level": "D1", "path": 7, "view": None, "obj": None}
        return {**base, **kw}

    def test_continue_point_brings_its_zone_and_facing(self):
        place, level, cam, notes = visit.resolve_place(self.link(obj=("ContinuePoint", 4625, 1638)), DATA)
        self.assertEqual(place, savegame.Place(8, 7, 13, 4637, 1759, 0, 1,
                                               savegame.Zone(31, 2, 80, (4625, 1638, 4649, 1779))))
        self.assertEqual((level, cam, notes), ("Scrabania", "D1P07C13", []))
        right = visit.resolve_place(self.link(obj=("ContinuePoint", 4625, 1638)), DATA, face="right")[0]
        self.assertEqual(right.flip, 0)

    def test_view_or_point_respawns_where_it_lands(self):
        place = visit.resolve_place(self.link(view=(4637.4, 1709.0)), DATA)[0]
        self.assertEqual(place, savegame.Place(8, 7, 13, 4637, 1759, 0, 0,
                                               savegame.Zone(0, 0, 0, (4625, 1687, 4649, 1765))))
        place, _, cam, notes = visit.resolve_place(self.link(), DATA, at=(5450, 1600))
        self.assertEqual((place.camera, place.y, place.line_type, cam), (14, 1710, 4, "D1P07C14"))
        self.assertEqual(notes, [])

    def test_a_place_off_the_visible_screen_is_noted(self):
        notes = visit.resolve_place(self.link(), DATA, at=(4580, 1700))[3]
        self.assertEqual(notes, [])
        notes = visit.resolve_place(self.link(), DATA, at=(4800, 1700))[3]
        self.assertEqual(notes, ["4800,1759 is outside D1P07C13's visible screen"])

    def test_what_cannot_be_placed(self):
        for link, at in ((self.link(level="D2"), None),
                         (self.link(obj=("Slig", 1, 2)), None),
                         (self.link(), None),
                         (self.link(), (100, 100)),
                         (self.link(), (4600, 1800))):
            with self.subTest(link=link, at=at), self.assertRaises(ValueError):
                visit.resolve_place(link, DATA, at=at)

    def test_save_names_stay_unique_in_the_game_pattern(self):
        place = visit.resolve_place(self.link(view=(4637, 1709)), DATA)[0]
        first = visit.save_name(place, set())
        second = visit.save_name(place, {first})
        self.assertNotEqual(first, second)
        for name in (first, second):
            self.assertTrue(name.startswith(savegame.NAME_PREFIX))
            self.assertEqual(len(name), memcard.NAME_LEN)
            self.assertTrue(all("!" <= c <= "u" for c in name[len(savegame.NAME_PREFIX):]))


class Profile(unittest.TestCase):
    def test_data_root_follows_duckstation(self):
        home = Path("/h")
        self.assertEqual(visit.data_root("Darwin", {}, home), home / "Library/Application Support/DuckStation")
        self.assertEqual(visit.data_root("Linux", {}, home), home / ".local/share/duckstation")
        self.assertEqual(visit.data_root("Linux", {"XDG_CONFIG_HOME": "/x"}, home), Path("/x/duckstation"))
        self.assertEqual(visit.data_root("Linux", {"XDG_CONFIG_HOME": "rel"}, home), home / ".local/share/duckstation")
        profile = Path("/p")
        for system in ("Darwin", "Linux"):
            env = visit.profile_env(system, profile)
            self.assertEqual(visit.data_root(system, env, profile).parents[-2], profile)
        self.assertIsNone(visit.profile_env("Windows", profile))
        self.assertEqual(visit.program_path(Path("/A/DuckStation.app")), Path("/A/DuckStation.app/Contents/MacOS/DuckStation"))
        self.assertEqual(visit.program_path(Path("/b/duckstation-qt")), Path("/b/duckstation-qt"))

    def test_made_once_from_your_settings(self):
        with tempfile.TemporaryDirectory() as tmp:
            tmp = Path(tmp)
            mine = tmp / "DuckStation"
            (mine / "bios").mkdir(parents=True)
            (mine / "bios" / "scph5501.bin").write_bytes(b"bios")
            (mine / "settings.ini").write_text(
                "[Cheevos]\nEnabled = true\nToken = secret\nUsername = me\n\n"
                "[Pad1]\nCross = SDL-0/A\n\n[MemoryCards]\nCard1Type = PerGameTitle\n")
            card = tmp / "out" / "visit.mcd"
            data = tmp / "out" / "profile" / "duckstation"
            visit.make_profile(data, card, mine)
            ini = configparser.ConfigParser(interpolation=None)
            ini.optionxform = str
            ini.read(data / "settings.ini")
            self.assertEqual(dict(ini["Cheevos"]), {"Enabled": "false"})
            self.assertEqual(ini["Pad1"]["Cross"], "SDL-0/A")
            self.assertEqual((ini["MemoryCards"]["Card1Type"], ini["MemoryCards"]["Card1Path"]),
                             ("Shared", str(card)))
            self.assertEqual((data / "bios" / "scph5501.bin").read_bytes(), b"bios")
            (data / "settings.ini").write_text("[Main]\nkept = yes\n")
            visit.make_profile(data, card, mine)
            self.assertEqual((data / "settings.ini").read_text(), "[Main]\nkept = yes\n")


if __name__ == "__main__":
    unittest.main()
