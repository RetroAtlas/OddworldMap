"""Exoddus's saved game: the 8 KiB `Quicksave` (AliveLibAE/QuikSave.hpp) the
PlayStation game writes to one memory card block, behind the file header and
checksum Oddysee's saves carry too. It holds the world twice, as it stood when
saved and as Restart Path brings it back, each with Abe's own record, then the
switch states and the list of objects whose state the game keeps, ended by a
zero word and followed by the flag and state bytes of every object record of
the level whose type the game keeps them for. Loading one moves to the saved
camera, rebuilds each listed object, and stands Abe on a line of the saved
type within 20 units of his saved height."""
import struct
from typing import NamedTuple

from oddmap import savegame

AE_NAME_PREFIX = "BASLUS-00710AB2"  # the game lists the card's files by this prefix
WORLD_OFF = 0x204
RESTART_OFF = 0x244
RESTART_ABE_OFF = 0x284
OBJECTS_OFF = 0x55C
OBJECTS_CAP = 6820
ABE_TYPE = 69
ABE_RECORD = 0xD8

# per record type, whether a save keeps its flag and state bytes: 1 with the
# created state cleared, 2 as they stand (kObjectTypeAttributesTable, which
# the executable carries byte for byte for the types it covers)
ATTRIBUTES = bytes.fromhex(
    "0200000000010002000100010000010202000001000000000102020002000201"
    "0000010100020102000200000000000000020000010000000002010000000000"
    "0100020001010001010201000201010201010202020201010101020102020101"
    "0101020101010202010102000000010000000000000000000000000000000000")

# the tint each level id gives Abe (sTintTable_Abe), as his record carries it
ABE_TINTS = {1: (102, 102, 102), 2: (102, 102, 80), 3: (120, 90, 120), 4: (102, 70, 90), 5: (120, 102, 82),
             6: (102, 102, 102), 7: (102, 70, 90), 8: (102, 102, 102), 9: (102, 102, 102), 10: (102, 102, 102),
             11: (120, 90, 120), 12: (120, 102, 82), 13: (102, 102, 102), 14: (120, 90, 80)}

# the name a save's title gives each level id, from the executable's table
LEVEL_NAMES = {1: "Mines", 2: "Necrum", 3: "Paramite", 4: "Scrab", 5: "Feeco", 6: "Barracks", 7: "Scrab",
               8: "Bonewerks", 9: "Brewery", 10: "Brewery", 11: "Paramite", 12: "Feeco", 13: "Barracks",
               14: "Bonewerks"}


class Place(NamedTuple):
    level: int
    path: int
    camera: int
    x: int
    y: int
    line_type: int
    flip: int
    save_num: int  # the continue point Abe last touched


def kept(record_type):
    """whether a save keeps the flag and state bytes of records of this type"""
    return record_type < len(ATTRIBUTES) and ATTRIBUTES[record_type] in (1, 2)


def title(place, label):
    """the title text the game writes: its name for the level and the play time,
    then a name of up to seven characters in quotes"""
    head = f"Abe2 {LEVEL_NAMES[place.level]} 000:00"
    return f'{head:<21}"{label[:7]:<7}"  '


def world_info(place):
    info = bytearray(0x40)
    struct.pack_into("<i7h", info, 0, 0, place.level, place.path, place.camera, place.save_num,
                     place.x, place.y, int(place.line_type == 0))
    return bytes(info)


def abe_record(place):
    """Abe standing still at `place` as a newly made Abe saves: at full health,
    tied to no object and with nothing carried over from play"""
    fg = place.line_type == 0
    rec = bytearray(ABE_RECORD)
    for off, fmt, *values in (
            (0x00, "h", ABE_TYPE),
            (0x04, "ii", place.x << 16, place.y << 16),
            (0x14, "Hh", place.path, place.level),
            (0x18, "iH", savegame.FP_ONE if fg else savegame.FP_ONE // 2, int(fg)),
            (0x1E, "3H", *ABE_TINTS.get(place.level, (102, 102, 102))),
            (0x24, "H", place.flip),
            (0x2A, "H", 1),                             # frame change counter
            (0x2C, "3b", 32 if fg else 13, 1, 1),       # render layer, rendered, drawable
            (0x30, "i", savegame.FP_ONE),               # health
            (0x38, "Hh", place.y, place.line_type),     # last line height, the line type to stand on
            (0x3C, "i", -1),                            # platform
            (0x44, "b", 1),                             # controlled
            (0x62, "h", -1),                            # nothing to say
            (0x74, "H", 0xFFFF),                        # knockdown motion
            (0x7C, "8i", *(-1,) * 8),                   # the objects he is tied to
            (0xC2, "hHH", place.level, place.path, place.camera),
            (0xD0, "i", -1),                            # bird portal
            (0xD4, "H", 0x8000)):                       # shadow
        struct.pack_into("<" + fmt, rec, off, *values)
    return bytes(rec)


def ae_save(header, title_text, place, flags):
    """a save that starts Abe at `place` with the level as `flags` leaves it"""
    abe = abe_record(place)
    objects = abe + bytes(4) + flags
    if len(objects) > OBJECTS_CAP:
        raise ValueError(f"{len(objects)} bytes of object state do not fit a save")
    data = bytearray(savegame.SAVE_SIZE)
    data[:savegame.HEADER_SIZE] = header
    data[4:0x44] = savegame.sjis_title(title_text).ljust(64, b"\0")
    data[WORLD_OFF:WORLD_OFF + 0x40] = data[RESTART_OFF:RESTART_OFF + 0x40] = world_info(place)
    data[RESTART_ABE_OFF:RESTART_ABE_OFF + ABE_RECORD] = abe
    data[OBJECTS_OFF:OBJECTS_OFF + len(objects)] = objects
    struct.pack_into("<i", data, 0x200, savegame.save_hash(data))
    return bytes(data)
