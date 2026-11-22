"""The PlayStation's falling item as its constructor leaves one: a model of
that constructor in both games, where an overlay holds the item's routines,
found by their shape so that no overlay and no release needs an address
given, and the records a game places, each with the camera that builds it.

What an item shows while it waits is the render's matter, every animated
object's, and oddmap/render.py holds it. The model is the constructor as the
discs have it, which is not how the decomp writes Exoddus's, and is right only
as far as a disc's own code agrees with it."""
import collections
import struct

from oddmap import records, render
from oddmap.exe import JR_RA, Image, end, entry, one, references, words_loaded, written
from oddmap.fixed import FP
from oddmap.games import GAMES

NAME = "FallingItem"
GAIN = 0x1CCCC                      # what a tick of a fall adds to its speed, 1.8 in 16.16
PERIOD = 0x2F149903                 # what a division by 87, the period of the item's hum, compiles to multiply by
SLOT = 20                           # the update's place in an object's table of virtual functions
KIND = {"AO": 32, "AE": 48}         # the type an item is made as
DOWN = {"AO": 5, "AE": 0}           # how far under its point a game's render draws an object
GREY = {"AO": 105, "AE": 127}       # the shade a game makes an object in
LINES, LINES_TINT = 2, (77, 120, 190)                   # Oddysee's level that tints its items
FARMS = (1, 13)                     # Oddysee's levels that give the items one to hum for them all
HALF_LAYER, LAYER = 12, 31
A1, VOLATILE = 5, set(range(1, 16)) | {24, 25, 31}

Record = collections.namedtuple("Record", "x1 y1 x2 y2 switch scale interval most reset")
Placed = collections.namedtuple("Placed", "short path record words screen left top")
Code = collections.namedtuple("Code", "construct update render table frame first")


class World:
    """what an item's constructor shares with the game: the level and path
    the map stands in, the frame counter, and whether an item already hums
    for the rest"""
    def __init__(self, game, level=1, path=1, frame=0, led=False):
        self.game, self.level, self.path, self.frame, self.led = game, level, path, frame, led


class FallingItem:
    """an item as its constructor leaves it over a record the path knows by
    `info`: at the record's corner, to wait there and to come back to,
    whatever the camera"""
    def __init__(self, world, record, info=0):
        game = world.game
        self.kind, self.explodes, self.info = KIND[game], True, info
        self.level, self.path, self.across, self.down = world.level, world.path, 0, DOWN[game]
        self.red, self.green, self.blue = LINES_TINT if game == "AO" and world.level == LINES else (GREY[game],) * 3
        self.switch, self.interval, self.reset = record.switch, record.interval, record.reset
        self.most = self.left = record.most
        half = record.scale == 1
        self.scale, self.plane = (FP // 2, 0) if half else (FP, 1)
        self.layer = HALF_LAYER if half and game == "AE" else LAYER
        self.x, self.y = record.x1 * FP, record.y1 * FP
        middle = record.x1 + record.x2
        self.foot_x, self.foot_y = (middle + (middle < 0) >> 1) * FP, record.y2 * FP
        self.start, self.state, self.sounding, self.hit, self.channels = self.y, 0, 1, 0, 0
        self.leads = not world.led and (game == "AE" or world.level in FARMS)
        self.created = world.frame if self.leads else 0
        world.led = world.led or self.leads

    def sprite(self):
        """the item as the render reads it"""
        return render.Sprite(self.x, self.y, self.scale, self.level, self.path, self.across, self.down)


def _built(img, value):
    """the addresses of the instructions completing a `lui`/`ori` pair that
    builds a constant in a register"""
    lo, out = struct.pack("<H", value & 0xFFFF), []
    at = img.data.find(lo, img.head)
    while 0 <= at <= len(img.data) - 4:
        w = struct.unpack_from("<I", img.data, at)[0]
        if (at - img.head) % 4 == 0 and w >> 26 == 13 and w >> 21 & 31 == w >> 16 & 31:
            for back in range(at - 4, max(img.head - 4, at - 36), -4):
                hi = struct.unpack_from("<I", img.data, back)[0]
                if hi >> 26 == 15 and hi >> 16 & 31 == w >> 16 & 31:
                    if hi & 0xFFFF == value >> 16:
                        out.append(img.addr(at))
                    break
        at = img.data.find(lo, at + 1)
    return out


def _reads_through(img, start, register):
    """whether the function at start loads through an argument, followed
    into the registers it is moved to and lost where one is written over"""
    held, called = {register}, False
    for a in range(start, end(img, start) + 8, 4):
        w = img.word(a)
        op, rs, rt, to = w >> 26, w >> 21 & 31, w >> 16 & 31, written(w)
        if 32 <= op <= 38 and rs in held:
            return True
        moved = op == 0 and w & 63 in (33, 37) and rt == 0 and rs in held
        if to is not None:
            (held.add if moved else held.discard)(to)
        if called:
            held -= VOLATILE
        called = op == 3 or op == 0 and w & 63 == 9
    return False


def _updates(img):
    """the routines that build both a fall's gain and the period of its hum"""
    return {entry(img, site) for site in _built(img, GAIN)} & {entry(img, site) for site in _built(img, PERIOD)}


def code(blob, base, exe):
    """where an overlay loaded at `base` holds the falling item's routines,
    and what they reach for, given the executable's image.

    The update is the one routine that builds both the gain of a fall and the
    multiplier its hum's period compiles to. A table of virtual functions
    names it, with the render, the executable's, in the slot after it. Of the
    routines that build that table's address, the constructor is the one that
    reads through its second argument, a record: the destructor and Exoddus's
    constructor for an explosion's rubble are handed none. Of the words it
    loads by name, the one outside the overlay is the frame counter and the
    one inside it names the item that hums for the rest."""
    img = Image(blob, base)
    update = one(_updates(img), "the update, a routine building a fall's gain and the period of its hum")
    slot = one(img.words_equal(update), "the update's slot")
    shown = img.word(slot + 8)
    if not exe.holds(shown) or exe.word(shown - 8) != JR_RA:
        raise RuntimeError("no function of the executable's in the slot after the update's")
    makers = {entry(img, site) for site in references(img, slot - SLOT)}
    construct = one({f for f in makers if _reads_through(img, f, A1)},
                    "the constructor, a routine building the table's address that reads a record")
    loaded = words_loaded(img, construct)
    return Code(construct=construct, update=update, render=shown, table=slot - SLOT,
                frame=one({a for a in loaded if not img.holds(a)},
                          "the frame counter, the word the constructor loads from outside the overlay"),
                first=one({a for a in loaded if img.holds(a)},
                          "the word naming the item that hums, the one the constructor loads from its overlay"))


def overlays(disc, game_key):
    """({overlay: its bytes} for each of a disc's that holds the item's
    update, the address they load at)"""
    blobs, base = records.overlays(disc, game_key)
    return {name: blob for name, blob in blobs.items() if _updates(Image(blob, base))}, base


def placed(discs, game_key):
    """every falling item a game places, as its discs hold it: the record,
    its own bytes, and the screen and the corner of the window of the camera
    whose list holds it, which is the one the builder files it under"""
    geo, out = GAMES[game_key]["geometry"], []
    for found in records.placed(discs, game_key, (NAME,)):
        obj, f, cell = found.object, found.object["fields"], found.cell
        record = Record(obj["x1"], obj["y1"], obj["x2"], obj["y2"], f["switch_id"], f["scale"],
                        f["fall_interval"], f["max_falling_items"], f["reset_switch_id_after_use"])
        out.append(Placed(found.short, found.path, record, found.words,
                          found.blob[cell * 8:cell * 8 + 8].decode("latin1").strip("\0 "),
                          cell % found.across * geo["worldW"] + geo["winX"],
                          cell // found.across * geo["worldH"] + geo["winY"]))
    return out
