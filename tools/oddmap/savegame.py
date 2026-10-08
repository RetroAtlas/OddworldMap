"""Oddysee's saved game: the 8 KiB `SaveData` (AliveLibAO/SaveGame.hpp) the
PlayStation game writes to one memory card block, PS1 file header included,
and restores a place from. Loading one runs the game's own path start: it
moves to the saved camera, puts Abe at the saved position on the floor within
60 units of it, and rewrites every switch and every object record of the
level from the block at the end, so what that block holds decides which
objects come back."""
import struct
from typing import NamedTuple

SAVE_SIZE = 0x2000
HEADER_SIZE = 0x200
FLAGS_OFF = 0x2B0
FLAGS_CAP = 7501  # the struct's byte array; the save ends in padding after it
SWITCHES = 256
NAME_PREFIX = "BASLUS-00190ABE"  # the game lists the card's files by this prefix
FP_ONE = 0x10000

_FULLWIDTH = {" ": "\u3000", "-": "\u2212"}  # the two Shift-JIS spells outside the +0xFEE0 block


class Zone(NamedTuple):
    """the continue point a death returns Abe to"""
    number: int
    clear_from: int
    clear_to: int
    rect: tuple  # x1, y1, x2, y2


class Place(NamedTuple):
    level: int
    path: int
    camera: int
    x: int
    y: int
    line_type: int
    flip: int
    zone: Zone


def save_header(exe):
    """the file header the game stamps on a save, title frame, palette and icon,
    from the executable: the first of the two it carries, the one a save whose
    alternate-header flag is clear wears"""
    at = [i for i in range(len(exe) - 3) if exe[i:i + 4] == b"SC\x11\x01"]
    if len(at) != 2:
        raise ValueError(f"expected the executable's two save headers, found {len(at)}")
    return exe[at[0]:at[0] + HEADER_SIZE]


def sjis_title(text):
    """`text` as the full-width Shift-JIS a memory card title is written in"""
    out = "".join(_FULLWIDTH.get(c, chr(ord(c) + 0xFEE0) if "!" <= c <= "~" else c) for c in text)
    raw = out.encode("shift_jis")
    if len(raw) > 64:
        raise ValueError(f"title {text!r} is longer than a card title's 32 characters")
    return raw


def tlv_flags(blob, meta, cells):
    """every object record's flag and state bytes in the order the save holds
    them: camera by camera through the index table, each camera's list to the
    record carrying the end-of-list bit"""
    pairs = []
    for entry in struct.unpack_from(f"<{cells}i", blob, meta["idx_off"]):
        if entry == -1 or entry >= 0x100000:
            continue
        pos = meta["obj_off"] + entry
        while True:
            flags, state, length = struct.unpack_from("<BBh", blob, pos)
            pairs += (flags, state)
            if flags & 4:
                break
            if length <= 0:
                raise ValueError(f"object list at {pos} runs on past a zero-length record")
            pos += length
    return bytes(pairs)


def flag_block(path_flags, switches=bytes(SWITCHES)):
    """the switch states, then the object flags of every path the level's table
    names, in path order"""
    block = bytes(switches) + b"".join(path_flags)
    if len(switches) != SWITCHES or len(block) > FLAGS_CAP:
        raise ValueError(f"{len(block)} bytes of switch and object state do not fit a save")
    return block


def save_hash(data):
    """the sum the game stores at 0x200 and checks on load: every 32-bit word
    after it, wrapping"""
    return (sum(struct.unpack_from(f"<{(SAVE_SIZE - 0x204) // 4}I", data, 0x204)) + 2**31) % 2**32 - 2**31


def ao_save(header, title, place, flags):
    """a save that starts Abe at `place` with the level as `flags` leaves it"""
    data = bytearray(SAVE_SIZE)
    data[:HEADER_SIZE] = header
    data[4:0x44] = sjis_title(title).ljust(64, b"\0")
    scale = FP_ONE if place.line_type == 0 else FP_ONE // 2
    z = place.zone
    struct.pack_into("<hhhhhhhhhhiih", data, 0x204, z.number, z.clear_from, z.clear_to, *z.rect,
                     place.level, place.path, place.camera, scale, 0, 0)
    struct.pack_into("<iIiihHhhhhH", data, 0x224, place.x, place.y, FP_ONE, scale,
                     place.level, place.path, place.camera, place.line_type, place.flip, 0, 0)
    data[FLAGS_OFF:FLAGS_OFF + len(flags)] = flags
    struct.pack_into("<i", data, 0x200, save_hash(data))
    return bytes(data)
