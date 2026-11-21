"""The PlayStation's wells and the leaves they let go: a model of the well's
constructor and update and of the leaf's in both games, a tick of the model to
a pass of the engine's loop over them, where an overlay holds those routines
and what they reach for in the executable, each found by its shape so that no
overlay and no release needs an address given, and the cameras whose wells let
leaves go, as a game's discs place them.

The model is the routines as the discs have them, which is not everywhere how
the decomp writes them, and is right only as far as a disc's own code agrees
with it."""
import collections
import struct

from oddmap import records, render
from oddmap.collide import raycast
from oddmap.exe import JR_RA, Image, bytes_loaded, callers, calls, end, entry, one, references, words_loaded
from oddmap.fallingitem import DOWN
from oddmap.fixed import FP, fpdiv, fpmul, s32, whole
from oddmap.games import GAMES

EXPRESS = "WellExpress"
NAMES = {"AO": ("WellLocal", EXPRESS), "AE": ("LocalWell", EXPRESS)}
SLOT = 20                           # the update's place in an object's table of virtual functions
LOWER = {"AO": 0, "AE": 5}          # how far under its record's corner a game's factory hands a well its point
CHANCE = 10                         # the bytes of the dice under this let a leaf go
ALWAYS = 1                          # the switch that reads on from the start
THROWN = (2 * FP, -20 * FP)         # the speed Exoddus's wells let a leaf go at
FALL, DRAG = FP // 2, 0xCCCC        # what a tick adds to a leaf's fall, and the four fifths of its speed it keeps
MIDDLE, SHAKE = 127, 64 * FP        # a byte of the dice less the first, over the second, is a tick's jitter
TINT = 100
LAYER, HALF_LAYER, BEHIND, HALF_BEHIND = 27, 8, 22, 3
FLOOR, HALF_FLOOR = 0, 4            # the kinds of line the two planes stand on
FLOORS = 1 << FLOOR | 1 << HALF_FLOOR

Record = collections.namedtuple("Record", "x1 y1 x2 y2 express scale switch exit_x exit_y emit leaf_x leaf_y")
Screen = collections.namedtuple("Screen", "short path cell left top seed wells floors")
Code = collections.namedtuple("Code", "construct update well_table inits leaf fly leaf_table render event allot "
                              "switches resource setup product roll sound quotient raycast within lines start "
                              "wells leaves")


class World:
    """what a camera's wells and their leaves share with the game: the dice
    and the two cursors into them, the wells' and the leaves', the path's
    lines, the camera's window with the level and path the map stands in,
    Abe's start, the switches written on, and the objects the engine's loop
    walks, in the order of its list"""
    def __init__(self, game, dice, lines, stage, abe=(0, 0), wells=4, leaves=8, on=()):
        self.game, self.dice, self.lines, self.stage, self.abe = game, dice, lines, stage, abe
        self.wells, self.leaves, self.on, self.objects = wells & 255, leaves & 255, set(on), []

    def roll(self):
        """the wells' next byte of the dice"""
        v = self.dice[self.wells]
        self.wells = (self.wells + 1) & 255
        return v

    def byte(self):
        """the leaves' next byte of the dice"""
        v = self.dice[self.leaves]
        self.leaves = (self.leaves + 1) & 255
        return v

    def switched(self, switch):
        """whether a switch reads on: the first always, and any other as it
        was written"""
        if not 0 <= switch <= 255:
            raise ValueError(f"switch {switch} is off the table's 256, where the console reads whatever lies there")
        return switch == ALWAYS or switch in self.on

    def tick(self):
        """a pass of the engine's loop over its list: every object updated in
        the list's order, one made during the pass in its turn, an object with
        a delay spending a tick of it; then the dead taken out, the list's
        last into the place of each"""
        at = 0
        while at < len(self.objects):
            obj, at = self.objects[at], at + 1
            if obj.dead:
                continue
            if obj.delay:
                obj.delay -= 1
            else:
                obj.update()
        at = 0
        while at < len(self.objects):
            if self.objects[at].dead:
                last = self.objects.pop()
                if at < len(self.objects):
                    self.objects[at] = last
            else:
                at += 1


class Well:
    """a well as its constructor leaves it over a record, handed the point
    its factory hands it, of which its leaves take the height"""
    def __init__(self, world, record, x, y):
        self.world, self.dead, self.delay = world, False, 0
        self.scale, self.switch, self.emit = FP // 2 if record.scale else FP, record.switch, record.emit & 0xFFFF
        self.exit_x, self.exit_y = (fpdiv(speed * FP, 100 * FP) for speed in (record.exit_x, record.exit_y))
        self.leaf_x = self.leaf_y = 0
        if self.emit:
            ax, ay = world.abe if world.game == "AE" else (0, 0)
            middle = record.x1 + record.x2
            self.leaf_x = s32((record.leaf_x + ax) * FP) if record.leaf_x else (middle + (middle < 0) >> 1) * FP
            self.leaf_y = s32((record.leaf_y + ay) * FP) if record.leaf_y else y
        world.objects.append(self)

    def update(self):
        """a tick: a well told to let leaves go, on no switch or one that
        reads on, takes a byte of the dice, and one under ten lets a leaf go"""
        world = self.world
        if not self.emit or self.switch and not world.switched(self.switch):
            return
        if world.roll() >= CHANCE:
            return
        if world.game == "AE":
            Leaf(world, self.leaf_x, self.leaf_y, *THROWN, self.scale)
            return
        leaf = Leaf(world, self.leaf_x, self.leaf_y, self.exit_x, self.exit_y, self.scale)
        if self.exit_y > 0:
            leaf.layer = HALF_BEHIND if self.scale == FP // 2 else BEHIND


class Leaf:
    """a leaf as its constructor leaves it, let go at a point with a speed
    its well's scale shortens"""
    def __init__(self, world, x, y, vx, vy, scale):
        self.world, self.dead, self.delay = world, False, int(world.game == "AE")
        self.red = self.green = self.blue = TINT
        self.scale, self.landed = scale, False
        self.layer, self.plane = (LAYER, 1) if scale == FP else (HALF_LAYER, 0)
        self.x, self.y, self.vx, self.vy = x, y, fpmul(vx, scale), fpmul(vy, scale)
        self.level, self.path, self.across, self.down = world.stage.level, world.stage.path, 0, DOWN[world.game]
        world.leaves = (world.leaves + 1) & 255
        world.objects.append(self)

    def update(self):
        """a tick: the fall gains, both speeds keep four fifths of
        themselves and take a jitter off the dice, and the step is tried
        against the floors of both planes. A leaf of the plane behind dies on
        a floor of the plane in front; a leaf comes to rest once, on the
        first floor of its own plane; any other step is taken whole. And it
        dies off the camera's window"""
        world = self.world
        self.vy = s32(self.vy + FALL)
        self.vx, self.vy = fpmul(self.vx, DRAG), fpmul(self.vy, DRAG)
        self.vx = s32(self.vx + fpmul(self.scale, fpdiv((world.byte() - MIDDLE) * FP, SHAKE)))
        self.vy = s32(self.vy + fpmul(self.scale, fpdiv((world.byte() - MIDDLE) * FP, SHAKE)))
        x, y = s32(self.x + self.vx), s32(self.y + self.vy)
        hit = raycast(world.lines, self.x, self.y, x, y, FLOORS)
        kind, half = hit and world.lines[hit.line][4], self.scale == FP // 2
        if hit and half and kind == FLOOR:
            self.dead = True
            return
        if hit and not self.landed and kind == (HALF_FLOOR if half else FLOOR):
            self.vx = self.vy = 0
            self.x, self.y, self.landed = hit.x, hit.y, True
        else:
            self.x, self.y = x, y
        self.dead = render.side((whole(self.x), whole(self.y)) * 2, world.stage) != render.ON

    def sprite(self):
        """the leaf as the render reads it"""
        return render.Sprite(self.x, self.y, self.scale, self.level, self.path, self.across, self.down)


def record(obj):
    """what a well's constructor reads of its record, as the builder reads
    one: no exit where the type holds none"""
    f = obj["fields"]
    return Record(obj["x1"], obj["y1"], obj["x2"], obj["y2"], obj["name"] == EXPRESS, f["scale"], f["switch_id"],
                  f.get("exit_x", 0), f.get("exit_y", 0), f["emit_leaves"],
                  f.get("leaf_x", f.get("leaf_xpos")), f.get("leaf_y", f.get("leaf_ypos")))


def handed(game_key, held):
    """the point a game's factory hands a well's constructor: its record's
    corner, in Exoddus five lower"""
    return held.x1 * FP, (held.y1 + LOWER[game_key]) * FP


def lets(held):
    """whether a fresh game has a well let leaves go: one told to, on no
    switch or the one that reads on from the start"""
    return bool(held.emit) and held.switch in (0, ALWAYS)


def screens(game_key, paths):
    """the cameras whose wells let leaves go in a fresh game. A path is
    (level, path, how many cells across, its lines, its wells), each well (its
    place among the path's objects, the cell of the camera that lists it, its
    record, whatever the caller keeps beside it); a camera is every well its
    list holds, in the list's order, with the corner of its window and the
    seed the map reads its dice from, the place of the first of its wells
    that lets leaves go"""
    geo, out = GAMES[game_key]["geometry"], []
    for short, path, across, lines, wells in paths:
        for cell in sorted({cell for _, cell, held, _ in wells if lets(held)}):
            here = [well for well in wells if well[1] == cell]
            out.append(Screen(short, path, cell, cell % across * geo["worldW"] + geo["winX"],
                              cell // across * geo["worldH"] + geo["winY"],
                              next(place for place, _, held, _ in here if lets(held)) & 255, here, lines))
    return out


def placed(discs, game_key):
    """the cameras whose wells let leaves go, as a game's discs hold them:
    each well with its record's own bytes, under the camera whose list holds
    it, and the lines of its path"""
    paths = {}
    for found in records.placed(discs, game_key, NAMES[game_key]):
        meta, blob = found.meta, found.blob
        lines = [struct.unpack_from("<4hB", blob, meta["coll_off"] + 20 * k) for k in range(meta["coll_count"])
                 if meta["coll_off"] + 20 * k + 20 <= len(blob)]
        wells = paths.setdefault((found.short, found.path), (found.short, found.path, found.across, lines, []))[4]
        wells.append((found.place, found.cell, record(found.object), found.words))
    return screens(game_key, paths.values())


def _holding(img, test):
    """the routines holding an instruction that passes a test"""
    return {entry(img, img.addr(at)) for at in range(img.head, len(img.data) - 3, 4)
            if test(struct.unpack_from("<I", img.data, at)[0])}


def _indexed(img, start):
    """the tables the function at start loads a signed byte from by an index:
    an `lb` through the assembler's register, a `lui` and an `addu` before it"""
    out = set()
    for a in range(start, end(img, start), 4):
        hi, add, lo = img.word(a), img.word(a + 4), img.word(a + 8)
        if hi >> 16 == 0x3C01 and add >> 26 == 0 and add & 0x7FF == 33 and add >> 11 & 31 == 1 and lo >> 21 == 0x401:
            out.add(((hi & 0xFFFF) << 16) + (lo & 0xFFFF) - (lo & 0x8000) * 2)
    return out


def _flies(img):
    """the routines that hand a call 0xCCCC as its third argument and take
    127 from a number"""
    return (_holding(img, lambda w: w == 0x3406CCCC)
            & _holding(img, lambda w: w >> 26 == 9 and w & 0xFFFF == 0x10000 - MIDDLE))


def code(blob, base, exe):
    """where an overlay loaded at `base` holds the wells' routines and the
    leaves', and what they reach for, given the executable's image.

    The leaf's update is the one routine that hands a call 0xCCCC as its
    third argument and takes 127 from a number. A table of virtual functions
    names it, with the render, the executable's, in the slot after it. Of the
    routines that build that table's address the leaf's constructor is the
    one another calls, and its caller is the well's update, which a table of
    its own names; of the routines that build that one's address the well's
    constructor is the one that calls into the overlay, its two inits.

    The leaf's constructor makes eight calls: its base's constructor, the
    resource, the animation's setup, the product twice, the roll of the
    engine's dice twice, and the sound. Its update makes eight: the product
    twice, the quotient and the product, twice over, then the raycast and
    the test of a point by the camera's window, and the one word it loads
    from outside the overlay is the pointer to the path's lines. The well's
    update makes five: it opens on the event query, the one the render's
    test of a rect makes, and ends on the allocation and the leaf's
    constructor; the switch states are the table a signed byte is loaded
    from by an index, by the update itself or by the one of the two calls
    between that makes no call of its own. What the inits call beyond those
    is the query of Abe's start, which Oddysee's make none of. Each update
    loads one byte of its overlay by name, its cursor into the dice."""
    img = Image(blob, base)
    fly = one(_flies(img), "the leaf's update, a routine handing a call four fifths and taking 127 from a number")
    slot = one(img.words_equal(fly), "the leaf's update's slot")
    shown = img.word(slot + 8)
    if not exe.holds(shown) or exe.word(shown - 8) != JR_RA:
        raise RuntimeError("no function of the executable's in the slot after the leaf's update's")
    drawn = render.code(exe, shown)
    makers = {entry(img, site) for site in references(img, slot - SLOT)}
    leaf = one({f for f in makers if callers(img, f)},
               "the leaf's constructor, a routine building its table's address that another calls")
    update = one({entry(img, site) for site in callers(img, leaf)},
                 "the well's update, the leaf's constructor's caller")
    well_table = one(img.words_equal(update), "the well's update's slot") - SLOT
    construct = one({f for f in {entry(img, site) for site in references(img, well_table)}
                     if any(img.holds(t) for _, t in calls(img, f))},
                    "the well's constructor, a routine building its table's address that calls into the overlay")
    inits = sorted({t for _, t in calls(img, construct) if img.holds(t)})
    made = [t for _, t in calls(img, leaf)]
    if [made.index(t) for t in made] != [0, 1, 2, 3, 3, 5, 5, 7] or any(map(img.holds, made)):
        raise RuntimeError(f"the leaf's constructor makes {len(made)} calls, not its base's, a resource's, a "
                           "setup's, a product's twice, a roll's twice and a sound's, all the executable's")
    resource, setup, product, roll, sound = made[1], made[2], made[3], made[5], made[7]
    flown = [t for _, t in calls(img, fly)]
    if [flown.index(t) for t in flown] != [0, 0, 2, 0, 2, 0, 6, 7] or flown[0] != product:
        raise RuntimeError(f"the leaf's update makes {len(flown)} calls, not the product's twice, a quotient's and "
                           "the product's, twice over, a raycast's and a test of a point's")
    quotient, ray, within = flown[2], flown[6], flown[7]
    asked = [t for _, t in calls(img, update)]
    if len(asked) != 5 or asked[0] != drawn.event or asked[4] != leaf or img.holds(asked[3]):
        raise RuntimeError(f"the well's update makes {len(asked)} calls, not five that open on the event query and "
                           "end on an allocation and the leaf's constructor")
    asks = {t for t in asked[1:3] if t != drawn.event and not calls(exe, t)}
    switches = one(_indexed(exe, one(asks, "the query of a switch, a call of the update's making none"))
                   if asks else _indexed(img, update),
                   "the switch states, a table a signed byte is loaded from by an index")
    beyond = {t for init in inits for _, t in calls(img, init)} - {resource, setup, quotient}
    if len(inits) != 2 or len(beyond) > 1:
        raise RuntimeError(f"the well's constructor calls {len(inits)} routines of its overlay that call "
                           f"{len(beyond)} besides, not two inits and a query of Abe's start at most")
    return Code(construct=construct, update=update, well_table=well_table, inits=inits, leaf=leaf, fly=fly,
                leaf_table=slot - SLOT, render=drawn, event=drawn.event, allot=asked[-2], switches=switches,
                resource=resource, setup=setup, product=product, roll=roll, sound=sound, quotient=quotient,
                raycast=ray, within=within,
                lines=one({a for a in words_loaded(img, fly) if not img.holds(a)},
                          "the pointer to the path's lines, the word the leaf's update loads from outside the overlay"),
                start=next(iter(beyond), None),
                wells=one({a for a in bytes_loaded(img, update) if img.holds(a)},
                          "the wells' cursor, the byte the well's update loads from its overlay"),
                leaves=one({a for a in bytes_loaded(img, fly) if img.holds(a)},
                           "the leaves' cursor, the byte the leaf's update loads from its overlay"))


def overlays(disc, game_key):
    """({overlay: its bytes} for each of a disc's that holds the leaf's
    update, the address they load at)"""
    blobs, base = records.overlays(disc, game_key)
    return {name: blob for name, blob in blobs.items() if _flies(Image(blob, base))}, base
