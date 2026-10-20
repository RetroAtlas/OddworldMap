"""What a disc's PlayStation executable says about the game beyond its code: the
path records, the overlay each path loads and the rate its frames run at, each
found by its shape rather than an address, since every release links its
executable differently.

The executable is a PS-X EXE: its text from byte 0x800, loaded at the address
the header holds at 0x18."""
import re
import struct

EXECUTABLES = ("SLUS_", "SLES_", "SLPS_")


def executable(disc):
    """(name, bytes) of the disc's executable"""
    name = next(n for n in sorted(disc.files) if n.startswith(EXECUTABLES))
    return name, disc.read(*disc.files[name])


class Image:
    """an executable's words by address"""
    def __init__(self, data):
        self.data = data
        self.load = struct.unpack_from("<I", data, 0x18)[0]
        self.end = self.load + len(data) - 0x800

    def holds(self, addr):
        return self.load <= addr < self.end

    def offset(self, addr):
        return addr - self.load + 0x800

    def addr(self, offset):
        return offset - 0x800 + self.load

    def word(self, addr):
        return struct.unpack_from("<I", self.data, self.offset(addr))[0]

    def cstring(self, addr):
        at = self.offset(addr)
        return self.data[at:self.data.find(b"\0", at)]

    def words_equal(self, value):
        """the addresses of every aligned word equal to value"""
        packed = struct.pack("<I", value)
        return [self.addr(m.start()) for m in re.finditer(re.escape(packed), self.data)
                if m.start() >= 0x800 and m.start() % 4 == 0]


# --- the few instructions the readers below recognize ---

def _op(w):
    return w >> 26


def _rs(w):
    return (w >> 21) & 31


def _rt(w):
    return (w >> 16) & 31


def _imm(w):
    return w & 0xFFFF


def _simm(w):
    return _imm(w) - 0x10000 if w & 0x8000 else _imm(w)


JR_RA = 0x03E00008
A0, ZERO = 4, 0


def references(img, value):
    """the addresses of the instructions completing a `lui`/`addiu` or `lui`/`ori`
    pair that builds value in a register"""
    hi, lo = (value + 0x8000) >> 16 & 0xFFFF, value & 0xFFFF
    out = []
    for at in range(0x800, len(img.data) - 3, 4):
        w = struct.unpack_from("<I", img.data, at)[0]
        if _op(w) != 15 or _imm(w) != hi:
            continue
        for k in range(1, 12):
            if at + 4 * k + 4 > len(img.data):
                break
            w2 = struct.unpack_from("<I", img.data, at + 4 * k)[0]
            if _op(w2) in (9, 13) and _rs(w2) == _rt(w) and _imm(w2) == lo:
                out.append(img.addr(at + 4 * k))
                break
    return out


def function_start(img, addr):
    """where the function holding addr begins: past the jump and delay slot
    ending the one before it, and the padding after them"""
    a = addr - 4
    while img.holds(a):
        w = img.word(a)
        if _op(w) == 0 and (w & 63) == 8:   # jr
            a += 8
            while img.word(a) == 0:
                a += 4
            return a
        a -= 4
    return None


def callers(img, target):
    return img.words_equal((3 << 26) | ((target >> 2) & 0x3FFFFFF))


def first_argument(img, site):
    """the constant a call passes in a0, read from its delay slot or the few
    instructions before it; None where a0 is set otherwise or not there"""
    for a in [site + 4] + [site - 4 * k for k in range(1, 9)]:
        w = img.word(a)
        if _op(w) == 0:
            if (w & 63) in (8, 9) and a < site:                       # jr, jalr
                return None
            if (w >> 11) & 31 == A0:
                return 0 if (w & 63) == 33 and _rs(w) == ZERO and _rt(w) == ZERO else None
        elif _op(w) in (1, 2, 3, 4, 5, 6, 7):                         # a jump or branch
            if a < site:
                return None
        elif _rt(w) == A0 and (8 <= _op(w) <= 15 or 32 <= _op(w) <= 38):
            if _op(w) in (9, 13) and _rs(w) == ZERO:
                return _simm(w) if _op(w) == 9 else _imm(w)
            return None
    return None


# --- the readers ---

def video_mode(data):
    """the argument the executable's one call to SetVideoMode passes, 0 for NTSC
    and 1 for PAL. SetVideoMode is a setter of one word that returns its old
    value, with the getter of the same word straight after it."""
    img = Image(data)
    found = set()
    for at in range(0x800, len(data) - 24, 4):
        body = struct.unpack_from("<6I", data, at)
        if _op(body[0]) != 15 or JR_RA not in body:
            continue
        end = body.index(JR_RA) + 2
        loads = [w for w in body[:end] if _op(w) == 35 and _rt(w) == 2]       # lw v0
        stores = [w for w in body[:end] if _op(w) == 43 and _rt(w) == A0]     # sw a0
        if not (loads and stores and _imm(loads[0]) == _imm(stores[0])):
            continue
        if any(w and _op(w) not in (15, 35, 43) and w != JR_RA for w in body[:end]):
            continue
        g = at + 4 * end
        while g + 16 <= len(data) and struct.unpack_from("<I", data, g)[0] == 0:
            g += 4
        if g + 16 > len(data):
            continue
        getter = struct.unpack_from("<4I", data, g)
        if not (_op(getter[0]) == 15 and _op(getter[1]) == 35 and _rt(getter[1]) == 2
                and _imm(getter[1]) == _imm(loads[0]) and JR_RA in getter[2:]):
            continue
        sites = callers(img, img.addr(at))
        if len(sites) == 1 and first_argument(img, sites[0]) in (0, 1):
            found.add(first_argument(img, sites[0]))
    if len(found) != 1:
        raise SystemExit(f"executable: {len(found)} candidate SetVideoMode calls, expected one")
    return found.pop()


def vsync_arguments(data):
    """the constants every call to VSync passes. VSync is found through the
    helper that prints its timeout, which only VSync calls."""
    img = Image(data)
    at = data.find(b"VSync: timeout")
    if at < 0:
        raise SystemExit("executable: no VSync timeout message")
    helpers = {function_start(img, r) for r in references(img, img.addr(at))}
    vsyncs = {function_start(img, c) for h in helpers for c in callers(img, h)}
    if len(vsyncs) != 1:
        raise SystemExit(f"executable: {len(vsyncs)} candidate VSync functions, expected one")
    return [first_argument(img, c) for c in callers(img, vsyncs.pop())]


def frame_rate(data):
    """ticks a second: the frame is flipped on VSync(2), every second vertical
    blank, of an NTSC or a PAL display"""
    if 2 not in vsync_arguments(data):
        raise SystemExit("executable: no frame flips on VSync(2)")
    return {0: 30, 1: 25}[video_mode(data)]


def path_records(data, layout):
    """{(level short, path id): the path's table row} read through the records
    that name each path's BLY file, which point at its path data and its
    collision record. `layout` places the fields a game's records hold, Abe's
    start among them where the path data carries one."""
    img = Image(data)
    rows = {}
    for m in re.finditer(rb"([A-Z0-9]{2})P(\d{1,2})\.BLY\0", data):
        recs = img.words_equal(img.addr(m.start()))
        if len(recs) != 1:
            raise SystemExit(f"executable: {m.group(0)[:-1].decode()} is named by {len(recs)} records")
        pd, ci = img.word(recs[0] + 4), img.word(recs[0] + 8)
        x1, y1, x2, y2 = struct.unpack_from("<4h", data, img.offset(pd) + layout["rect"])
        obj, idx = struct.unpack_from("<II", data, img.offset(pd) + layout["objects"])
        coll, count = struct.unpack_from("<II", data, img.offset(ci) + layout["collision"])
        row = {"w_units": x2 - x1, "h_units": y2 - y1, "obj_off": obj, "idx_off": idx,
               "coll_off": coll, "coll_count": count}
        if layout.get("overlay") is not None:
            row["overlay"] = struct.unpack_from("<H", data, img.offset(recs[0]) + layout["overlay"])[0]
        if layout.get("abe") is not None:
            row["abe_x"], row["abe_y"] = struct.unpack_from("<2h", data, img.offset(pd) + layout["abe"])
        rows[(m.group(1).decode(), int(m.group(2)))] = row
    return rows


def cd_files(data, first):
    """the executable's table of the disc's files, by the id a record names one
    by: pairs of a name pointer and a sector, the longest run of them that opens
    on an entry naming `first`"""
    img = Image(data)
    best = []
    for m in re.finditer(re.escape(first.encode()) + b"\0", data):
        for ref in img.words_equal(img.addr(m.start())):
            names, a = [], ref
            while img.holds(a) and img.holds(img.word(a)) and img.cstring(img.word(a)).startswith(b"\\"):
                names.append(img.cstring(img.word(a)).decode("latin1").split("\\")[-1].split(";")[0])
                a += 8
            if len(names) > len(best):
                best = names
    return best


def path_overlays(data, layout):
    """{(level short, path id): the overlay file the path loads}, where the game's
    records name it by an id into the executable's file table; None where they
    name it otherwise"""
    if layout.get("overlay") is None:
        return None
    files = cd_files(data, layout["files_from"])
    if not files:
        raise SystemExit("executable: no file table")
    return {key: files[row["overlay"]] for key, row in path_records(data, layout).items()}
