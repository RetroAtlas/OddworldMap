"""The PlayStation's render of an animated object: a model of the test it makes
of the frame an object stands in and of the quad it hands the GPU for one that
passes, where an executable holds the routines, found by their shape, how a
machine is set to run them over an object laid out in it, and where an object
is stood by hand to reach what placed ones do not.

Both games render every animated object through the one routine, which the
object's table of virtual functions names, so the model serves any object and
is right only as far as a disc's own code agrees with it."""
import collections
import struct

from oddmap.exe import calls, one, words_loaded
from oddmap.fixed import FP, whole

WIDE, HIGH = 368, 240                                   # the camera's window
ON, ABOVE, BELOW, LEFT, RIGHT, NOWHERE = range(6)       # where the engine finds a rect by that window
ROUND = 0x7FBE                                          # the 0.499 a measure takes on before it is cut
SHOWN, FLIPPED, UPENDED = 0x4, 0x10, 0x20               # an animation's flags
A0 = 4

Frame = collections.namedtuple("Frame", "w h x y rect")
Code = collections.namedtuple("Code", "render where event draw add after map screen")


class Stage:
    """what a render shares with the game: the corner of the camera's window,
    the level and path the map stands in, whether the event that ends a life
    is out, and whether the game's drawing upends a frame at all"""
    def __init__(self, left, top, level=1, path=1, dying=False, upends=True):
        self.left, self.top, self.level, self.path = left, top, level, path
        self.dying, self.upends = dying, upends


class Sprite:
    """what the render reads of an object: its point and its scale in 16.16,
    the level and path it was made in, how far its render draws it from its
    point, and whether its animation is shown, flipped side to side and
    upended"""
    def __init__(self, x, y, scale=FP, level=1, path=1, across=0, down=0, shown=True, flip=False, upend=False):
        self.x, self.y, self.scale, self.level, self.path = x, y, scale, level, path
        self.across, self.down, self.shown, self.flip, self.upend = across, down, shown, flip, upend


def bounding(frame, sprite):
    """a frame's rect as the engine stands it at an object: mirrored with the
    animation, scaled, and each side cut toward zero, as the point is"""
    x1, y1, x2, y2 = frame.rect
    if sprite.flip:
        x1, x2 = -x2, -x1
    if sprite.upend:
        y1, y2 = -y2, -y1
    x, y = whole(sprite.x), whole(sprite.y)
    return tuple(whole(side * sprite.scale) + at for side, at in ((x1, x), (y1, y), (x2, x), (y2, y)))


def side(rect, stage):
    """where the engine finds a rect by the camera's window, an edge on an
    edge being on it: it asks right, below, left and above, in that order"""
    if stage.dying:
        return NOWHERE
    x1, y1, x2, y2 = rect
    if x1 > stage.left + WIDE:
        return RIGHT
    if y1 > stage.top + HIGH:
        return BELOW
    if x2 < stage.left:
        return LEFT
    return ABOVE if y2 < stage.top else ON


def quad(frame, sprite, stage):
    """the corners of the quad the drawing hands the GPU for a frame, on the
    screen: the frame's offset and size scaled, a scaled frame a unit higher,
    and a flipped one measured back from the object by its offset and size
    together"""
    w, h, across, down = (measure * sprite.scale for measure in (frame.w, frame.h, frame.x, frame.y))
    if sprite.scale != FP:
        down -= FP
    x = whole(sprite.x - stage.left * FP + sprite.across * FP)
    y = whole(sprite.y - stage.top * FP + sprite.down * FP)
    x += -whole(w + across + ROUND) if sprite.flip else whole(across + ROUND)
    y += -whole(h + down + ROUND) if sprite.upend and stage.upends else whole(down + ROUND)
    return (x, y), (x + whole(w - FP + ROUND), y + whole(h - FP + ROUND))


def render(frame, sprite, stage):
    """what the render hands the GPU of an object standing in a frame: the
    quad's corners, or nothing where its animation is not shown, it was made
    in another path or level, or the frame's rect lies off the camera's
    window"""
    if not sprite.shown or sprite.path != stage.path or sprite.level != stage.level:
        return None
    if side(bounding(frame, sprite), stage) != ON:
        return None
    return quad(frame, sprite, stage)


SCALES = (0x4CCC, 0x18000)          # two scales to stand an object in by hand
FLIPS = ((False, False), (True, False), (False, True), (True, True))
OFF = (375, 260)                    # a window away from the path's origin


def edged(frame):
    """the scales that put a measure of a frame a 65536th either side of
    where its rounding carries"""
    for measure in (frame.w, frame.h, frame.x, frame.y, frame.w + frame.x, frame.h + frame.y):
        for carry in (-1, 0, 1) if measure % 2 else ():
            yield FP + (FP - ROUND + carry) * pow(measure, -1, FP) % FP


def by_hand(frame, own, upends):
    """(a sprite, a stage) for an object stood where placed ones cannot be
    relied on to stand: either side of each edge of a window at the path's
    origin and off each of its corners, on whole and on half units, at its own
    scale and two others, mirrored each way; half a unit over the left and the
    top of a window away from the origin; in the window at each scale that
    puts a measure of the frame on a carry, and with its render's offsets
    moved; and each way a render draws nothing on the window"""
    stage = dict(left=0, top=0, level=own.level, path=own.path, upends=upends)
    look = dict(level=own.level, path=own.path, across=own.across, down=own.down)
    looks = [(dict(look, scale=scale, flip=flip, upend=upend),
              bounding(frame, Sprite(0, 0, scale, flip=flip, upend=upend)))
             for scale in (own.scale,) + SCALES for flip, upend in FLIPS]
    for seen, (x1, y1, x2, y2) in looks:
        for x, y in ((100, -y2), (100, -y2 - 1), (100, HIGH - y1), (100, HIGH - y1 + 1), (-x2, 100), (-x2 - 1, 100),
                     (WIDE - x1, 100), (WIDE - x1 + 1, 100), (WIDE - x1 + 1, HIGH - y1 + 1), (-x2 - 1, -y2 - 1),
                     (-x2 - 1, HIGH - y1 + 1), (WIDE - x1 + 1, -y2 - 1)):
            for part in (0, FP // 2):
                yield Sprite(x * FP + part, y * FP + part, **seen), Stage(**stage)
    for seen, (x1, y1, x2, y2) in looks:
        for x, y in ((-x2, 100), (100, -y2)):
            yield (Sprite((x + OFF[0]) * FP + FP // 2, (y + OFF[1]) * FP + FP // 2, **seen),
                   Stage(**dict(stage, left=OFF[0], top=OFF[1])))
    for scale in edged(frame):
        for flip, upend in FLIPS:
            yield Sprite(WIDE // 2 * FP, HIGH // 2 * FP, scale, flip=flip, upend=upend, **look), Stage(**stage)
    here = dict(x=100 * FP, y=100 * FP, scale=own.scale, across=own.across, down=own.down)
    yield Sprite(**dict(here, level=own.level, path=own.path, across=own.across + 3, down=own.down - 7)), Stage(**stage)
    yield Sprite(level=own.level, path=own.path, shown=False, **here), Stage(**stage)
    yield Sprite(level=own.level + 1, path=own.path, **here), Stage(**stage)
    yield Sprite(level=own.level, path=own.path + 1, **here), Stage(**stage)
    yield Sprite(level=own.level, path=own.path, **here), Stage(dying=True, **stage)


def _handed(exe, site):
    """the address a call is handed first, built by the `lui` and `addiu`
    before it"""
    for a in range(site - 4, site - 40, -4):
        lo, hi = exe.word(a), exe.word(a - 4)
        if lo >> 26 == 9 and lo >> 21 & 31 == A0 and lo >> 16 & 31 == A0:
            if hi >> 26 == 15 and hi >> 16 & 31 == A0:
                return ((hi & 0xFFFF) << 16) + (lo & 0xFFFF) - (lo & 0x8000) * 2
            break
    raise RuntimeError("the render hands the test of a rect no address it builds")


def code(exe, at):
    """where an executable holds what an object's render reaches for, given
    the render, the routine an object's table of virtual functions names
    after its update.

    Of the routines the render calls, one makes a single call, the query of
    an event: the test of where a rect lies by the camera, which the render
    hands the map's address. One makes calls of its own and is called again
    by another of them, the shadow's render: the drawing of a frame, whose
    last call hands the quad to the ordering table. The one word the render
    loads by name is the pointer it finds the camera through."""
    made = calls(exe, at)
    targets = {target for _, target in made}
    where = one({t for t in targets if len(calls(exe, t)) == 1},
                "the test of where a rect lies, a callee making one call")
    draw = one({t for t in targets if calls(exe, t) and any(t in {c for _, c in calls(exe, u)} for u in targets - {t})},
               "the drawing of a frame, a callee that calls and that another calls again")
    return Code(render=at, where=where, event=calls(exe, where)[0][1], draw=draw, add=calls(exe, draw)[-1][1],
                after=targets - {where, draw}, map=_handed(exe, next(site for site, t in made if t == where)),
                screen=one(words_loaded(exe, at), "the pointer to the camera, the word the render loads"))


# where each game keeps what its render reads
LAYOUT = {
    "AE": dict(animation=0x20, x=0xB8, y=0xBC, path=0xC0, level=0xC2, scale=0xCC, down=0xD8, across=0xDA,
               flags=0, table=0x18, block=0x20, frame=0x92, map_level=0, map_path=2, camera=0x24, pointer=0x20,
               half=None, upends=True),
    "AO": dict(animation=0x10, x=0xA0, y=0xA4, path=0xA8, level=0xAA, scale=0xB4, down=0xC0, across=0xC2,
               flags=0, table=0x18, block=0x20, frame=0x8A, map_level=0, map_path=2, camera=0x2C, pointer=0x10,
               half=(0x14, 0x16), upends=False),
}
POLY = (8, 16, 24, 32)              # where a quad keeps its four corners


def frames(data, table):
    """the frames of the animation whose table lies at an offset of its chunk"""
    out = []
    for info in struct.unpack_from(f"<{struct.unpack_from('<h', data, table + 2)[0]}I", data, table + 8):
        header, = struct.unpack_from("<I", data, info)
        x, y, *rect = struct.unpack_from("<6h", data, info + 8)
        out.append(Frame(data[header + 4], data[header + 5], x, y, tuple(rect)))
    return out


class Console:
    """a disc's render in a machine that holds its executable, run over an
    object the caller has laid out there: the map and the camera's pointer
    set as a stage has them, the object's animation as its setup would leave
    it, the event answered, every routine the render calls but the test and
    the drawing answered with nothing, and the quad the drawing hands the
    ordering table read back"""
    def __init__(self, m, found, game, spare):
        self.m, self.code, self.at = m, found, LAYOUT[game]
        self.camera, self.cell, self.rect, self.order, self.data = (spare + at for at in (0, 0x40, 0x50, 0x80, 0x100))
        self.dying, self.handed = False, []
        self.stubs = {routine: self.nothing for routine in found.after}
        self.stubs.update({found.event: self.event, found.add: self.added})

    def nothing(self, m):
        return 0

    def event(self, m):
        return int(self.dying)

    def added(self, m):
        self.handed.append(m.r[5])

    def stage(self, stage):
        m, at, found = self.m, self.at, self.code
        left, top = (stage.left + WIDE // 2, stage.top + HIGH // 2) if at["half"] else (stage.left, stage.top)
        m.w16(found.map + at["map_level"], stage.level)
        m.w16(found.map + at["map_path"], stage.path)
        m.w32(found.map + at["camera"], left * FP)
        m.w32(found.map + at["camera"] + 4, top * FP)
        m.w32(found.screen, self.camera)
        m.w32(self.camera + at["pointer"], found.map + at["camera"])
        if at["half"]:
            m.w16(self.camera + at["half"][0], WIDE // 2)
            m.w16(self.camera + at["half"][1], HIGH // 2)
        self.dying = stage.dying

    def show(self, data):
        """a chunk of animations where the object's will be set up over it"""
        self.m.load(self.data, data)
        self.m.w32(self.cell, self.data)

    def stand(self, obj, table, frame, sprite):
        """the object's animation as the engine's setup leaves it over the
        chunk, standing in a frame of a table, with the flags a sprite names"""
        m, at = self.m, self.at
        animation = obj + at["animation"]
        m.w32(animation + at["flags"], SHOWN * sprite.shown | FLIPPED * sprite.flip | UPENDED * sprite.upend)
        m.w32(animation + at["table"], table)
        m.w32(animation + at["block"], self.cell)
        m.w16(animation + at["frame"], frame)

    def place(self, obj, sprite):
        m, at = self.m, self.at
        for name in ("x", "y", "scale"):
            m.w32(obj + at[name], getattr(sprite, name))
        for name in ("path", "level", "down", "across"):
            m.w16(obj + at[name], getattr(sprite, name))

    def where(self, rect):
        """where the disc's test finds a rect by the camera's window, asked
        as the render asks: Oddysee's takes a flag that widens the window,
        which the render leaves unset"""
        m = self.m
        for k, side in enumerate(rect):
            m.w16(self.rect + 2 * k, side)
        m.stubs = self.stubs
        return m.call(self.code.where, self.code.map, self.rect, 0)

    def render(self, obj):
        """the corners of the quad the disc's render hands the ordering table
        for the object, or nothing where it hands it none"""
        m = self.m
        self.handed, m.stubs = [], self.stubs
        m.call(self.code.render, obj, self.order)
        if not self.handed:
            return None
        if len(self.handed) > 1:
            raise RuntimeError(f"the render hands the ordering table {len(self.handed)} quads")
        corners = [(m.s16(self.handed[0] + at), m.s16(self.handed[0] + at + 2)) for at in POLY]
        (x1, y1), (x2, y2) = corners[0], corners[3]
        if corners[1] != (x2, y1) or corners[2] != (x1, y2):
            raise RuntimeError(f"the render hands the ordering table no upright quad: {corners}")
        return corners[0], corners[3]
