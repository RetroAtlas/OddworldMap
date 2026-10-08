"""PlayStation memory card images: the raw 128 KiB card DuckStation mounts
(.mcd), a directory block of 128-byte frames ahead of fifteen 8 KiB blocks of
save data. A blank card is laid out the way DuckStation formats one."""
import struct

FRAME = 128
BLOCK = 8192
BLOCKS = 16
CARD_SIZE = BLOCK * BLOCKS
NAME_LEN = 20

FREE, FIRST, MIDDLE, LAST = 0xA0, 0x51, 0x52, 0x53


def _sealed(frame):
    """a frame with its last byte set to the XOR of the 127 before it"""
    f = bytearray(frame)
    x = 0
    for b in f[:FRAME - 1]:
        x ^= b
    f[FRAME - 1] = x
    return bytes(f)


def _frame(*fields):
    """a frame of zeros with each (offset, bytes) written into it, sealed"""
    f = bytearray(FRAME)
    for off, data in fields:
        f[off:off + len(data)] = data
    return _sealed(f)


def blank_card():
    card = bytearray(b"\xff" * CARD_SIZE)
    frames = [_frame((0, b"MC"))]
    frames += [_frame((0, bytes([FREE])), (8, b"\xff\xff"))] * 15
    frames += [_frame((0, b"\xff" * 4), (8, b"\xff\xff"))] * 20  # broken sector list
    frames += [bytes(FRAME)] * 27  # broken sector replacements, then unused frames
    frames.append(frames[0])  # write test frame
    card[:BLOCK] = b"".join(frames)
    return card


def write_card(saves):
    """a card holding each (name, data) save in the order given, data a whole
    number of blocks; a save spanning several blocks chains them"""
    card = blank_card()
    block = 1
    for name, data in saves:
        raw = name.encode("ascii")
        if len(raw) > NAME_LEN or not data or len(data) % BLOCK:
            raise ValueError(f"{name!r}: a save needs a name of at most {NAME_LEN} characters "
                             f"and whole {BLOCK}-byte blocks")
        count = len(data) // BLOCK
        if block + count > BLOCKS:
            raise ValueError("the saves do not fit on one card")
        for i in range(count):
            state = FIRST if i == 0 else LAST if i == count - 1 else MIDDLE
            nxt = block + i if i < count - 1 else 0xFFFF  # the block after this one, as a directory index
            fields = [(0, struct.pack("<I", state)), (8, struct.pack("<H", nxt))]
            if i == 0:
                fields += [(4, struct.pack("<I", len(data))), (10, raw)]
            card[(block + i) * FRAME:(block + i + 1) * FRAME] = _frame(*fields)
            card[(block + i) * BLOCK:(block + i + 1) * BLOCK] = data[i * BLOCK:(i + 1) * BLOCK]
        block += count
    return bytes(card)


def read_saves(card):
    """the (name, data) of every save a card holds, by its first directory frame"""
    if len(card) != CARD_SIZE or card[:2] != b"MC":
        raise ValueError("not a raw PlayStation memory card image")
    saves = []
    for d in range(1, BLOCKS):
        frame = card[d * FRAME:(d + 1) * FRAME]
        state, size = struct.unpack_from("<II", frame)
        if state != FIRST:
            continue
        name = frame[10:10 + NAME_LEN + 1].split(b"\0")[0].decode("ascii")
        data, block = bytearray(), d
        while block != 0xFFFF and len(data) < size:
            data += card[block * BLOCK:(block + 1) * BLOCK]
            block = struct.unpack_from("<H", card, block * FRAME + 8)[0]
            block = block + 1 if block != 0xFFFF else block
        saves.append((name, bytes(data[:size])))
    return saves
