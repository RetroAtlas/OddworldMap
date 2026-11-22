"""The PlayStation's hint fly: a model of the routines an Oddysee overlay runs
it with, a step of the model to a tick of the game; where an overlay holds
those routines and what they reach for in the executable, each found by its
shape so that no overlay and no release needs an address given; and the
numbers a release lays its words out and holds them by, read off them.

The model is the routines as the disc has them, which is not everywhere how
the decomp writes them, and is right only as far as a disc's own code agrees
with it."""
import collections

from oddmap.exe import (A1, JR_RA, Image, added, argument, callers, calls, entry, executable, first_argument,
                        loaded_overlays, one, references, steps, words_loaded)
from oddmap.fixed import FP, fpmul, s16, s32, whole
from oddmap.games import GAMES
from oddmap.messages import LETTER_FIRST, MESSAGE_TABLES, alphabets, lead_table, letter_tables, pointer_tables

SWARM = 20                          # the flies of a hint at rest
SPARE = 12                          # the flies left looping beside a word
TOP = 8                             # how far over the hint's point a letter's grid opens
PAUSE_FOR = 15                      # the timer before a word, outlasted by a tick
RESIZE_BY = 8                       # the flies a tick adds to the swarm or takes from it
SOUND = 60                          # the flies' sound, as the engine numbers it
IDLE, RESIZE, PAUSE, HOLD, UNWIND = 1, 2, 3, 4, 5       # the hint's states
TO_DOT, ON_DOT, LOOPING = 1, 2, 3                       # what a fly is doing

# the engine's sine over a quarter turn of 64 steps, 16.16
QUARTER = (
    0, 1633, 3266, 4897, 6525, 8148, 9767, 11380, 12985, 14582, 16171, 17749, 19316, 20872, 22414, 23942,
    25456, 26953, 28434, 29897, 31342, 32767, 34172, 35555, 36917, 38255, 39570, 40860, 42125, 43363, 44575,
    45758, 46914, 48040, 49136, 50202, 51237, 52240, 53210, 54147, 55051, 55920, 56754, 57554, 58317, 59044,
    59735, 60388, 61004, 61582, 62122, 62623, 63085, 63508, 63891, 64235, 64539, 64803, 65026, 65209, 65351,
    65453, 65514, 65535,
)

# a step of a letter's grid in 16.16, a letter's cell, and the timer on a word, outlasted by a tick
Spelling = collections.namedtuple("Spelling", "dot letter hold")
BASE_SPELLING = Spelling(dot=0xCCCC, letter=16, hold=30)
Tables = collections.namedtuple("Tables", "dice alphabet messages spelling", defaults=(BASE_SPELLING,))
Code = collections.namedtuple(
    "Code", "longest init update form render event frame drawing screen player roll voices bank")
FLY = ("x", "y", "mode", "vx", "vy", "tx", "ty", "pitch", "pitch_step", "angle", "speed")


def sine(a):
    """the engine's sine of an angle of 256 to the turn, 16.16"""
    a &= 255
    if a < 64:
        return QUARTER[a]
    if a < 128:
        return QUARTER[127 - a]
    return -QUARTER[a - 128] if a < 192 else -QUARTER[255 - a]


class World:
    """what a hint fly shares with the rest of the game: the frame counter,
    whether Abe chants, the sounds asked for, each its volume and the pitch
    given it, and the dice with the two cursors into them, the flies' own and
    the one every roll of the engine's moves"""
    def __init__(self, tables, own, dice):
        self.tables, self.own, self.dice = tables, own & 255, dice & 255
        self.frame, self.chant, self.sounds = 0, False, []

    def byte(self):
        """the flies' own next byte of the dice"""
        v = self.tables.dice[self.own]
        self.own = (self.own + 1) & 255
        return v

    def roll(self, lo, hi):
        """the engine's roll over a range of under 256, which takes one byte"""
        v = self.tables.dice[self.dice]
        self.dice = (self.dice + 1) & 255
        return lo + v % (hi - lo + 1)

    def play(self, volume, pitch=None):
        """ask the engine for the flies' sound; its player rolls a pitch for
        one given none"""
        if pitch is None:
            self.roll(-127, 127)
        self.sounds.append((volume, pitch))

    def letter(self, char):
        """the dots of the letter a code spells"""
        at = ord(char) - LETTER_FIRST
        if not 0 <= at < len(self.tables.alphabet):
            raise ValueError(f"{ord(char):#04x} is outside the alphabet's {len(self.tables.alphabet)} letters, "
                             "where the console reads a pointer out of whatever lies there")
        return self.tables.alphabet[at]


class Fly:
    __slots__ = FLY

    def __init__(self):
        for name in FLY:
            setattr(self, name, 0)


class HintFly:
    """a hint at a point of its screen, as its constructor leaves it. The
    console allocates the flies it counts for the longest word and writes
    past them where a swarm outgrows that; here a fly is there once reached."""
    def __init__(self, world, x, y, message):
        self.world, self.x, self.y = world, x, y
        self.message = world.tables.messages[message]
        self.count, self.pos = SWARM, 0
        self.allocated = self.longest() + SPARE
        self.flies = []
        self.state, self.timer, self.renewed, self.target = IDLE, 0, 0, 0
        self.words = []
        for i in range(SWARM):
            self.init(i)

    def word(self, at):
        """(the word of the message at `at`, the dots of each of its letters,
        where the next word begins)"""
        end = at
        while end < len(self.message) and self.message[end] != " ":
            end += 1
        word = self.message[at:end]
        return word, [self.world.letter(c) for c in word], end + (end < len(self.message))

    def longest(self):
        """the dots of the longest word, the scan ending at the first of none"""
        most, at = 0, 0
        while True:
            _, letters, at = self.word(at)
            dots = sum(map(len, letters))
            if not dots:
                return most
            most = max(most, dots)

    def init(self, i):
        """set a fly looping from a spot about the hint's point"""
        self.flies += [Fly() for _ in range(len(self.flies), i + 1)]
        fly, own = self.flies[i], self.world.byte
        fly.mode = LOOPING
        fly.x = s32((self.x + (own() & 31) - 16) * FP)
        fly.y = s32((self.y + (own() & 31) - 16) * FP)
        fly.angle = own()
        fly.speed = (own() & 3) + 12
        if own() & 1:
            fly.speed = -fly.speed & 255

    def form(self):
        """send a fly to each dot of the next word, centred on the hint's point,
        at a sixteenth of the way a tick, and leave the rest looping"""
        word, letters, self.pos = self.word(self.pos)
        by = self.world.tables.spelling
        x, y = self.x - by.letter * len(letters) // 2, self.y - TOP
        flies = iter(self.flies[:self.count])
        for dots in letters:
            for dot in dots:
                fly = next(flies)
                fly.tx = s32(x * FP + fpmul(by.dot, (dot >> 4) * FP))
                fly.ty = s32(y * FP + fpmul(by.dot, (dot & 15) * FP))
                fly.vx = (fly.tx - fly.x) >> 4
                fly.vy = (fly.ty - fly.y) >> 4
                fly.mode = TO_DOT
                fly.pitch = self.world.roll(-127, 127)
                fly.pitch_step = fly.pitch >> 4
            x += by.letter
        for fly in flies:
            fly.mode = LOOPING
        self.words.append((self.world.frame, word))

    def move(self):
        """a tick of every fly, the first one's rolling the dice for a sound"""
        world = self.world
        for i, fly in enumerate(self.flies[:self.count]):
            if fly.mode == TO_DOT:
                if abs(fly.tx - fly.x) < FP and abs(fly.ty - fly.y) < FP:
                    fly.mode, fly.pitch = ON_DOT, 0
                else:
                    fly.x, fly.y = s32(fly.x + fly.vx), s32(fly.y + fly.vy)
                    fly.pitch = s16(fly.pitch + fly.pitch_step)
                if not i and world.roll(0, 100) < 40:
                    world.play(world.roll(24, 30), fly.pitch)
            elif fly.mode == ON_DOT:
                if not world.byte() & 3:
                    fly.x = s32(fly.tx + (world.byte() & 1) * FP)
                if not i and world.roll(0, 100) < 40:
                    world.play(world.roll(24, 30), 0)
            elif fly.mode == LOOPING:
                fly.angle = (fly.angle + fly.speed) & 255
                fly.x = s32(fly.x + fpmul(sine(fly.angle + 64), 5 * FP))
                fly.y = s32(fly.y + fpmul(-sine(fly.angle), 2 * FP))
                if not i and world.roll(0, 100) < 20:
                    world.play(world.roll(18, 24))

    def scatter(self):
        """set the flies looping, up to the first that already is"""
        for fly in self.flies[:self.count]:
            if fly.mode == LOOPING:
                break
            fly.mode = LOOPING

    def let_go(self):
        self.scatter()
        self.renewed, self.state = 0, UNWIND

    def update(self):
        """a tick of the game"""
        world = self.world
        if self.state == IDLE:
            self.move()
            if world.chant:
                self.pos, self.state, self.timer = 0, PAUSE, world.frame + PAUSE_FOR
        elif self.state == PAUSE:
            self.move()
            if not world.chant:
                self.let_go()
            elif self.timer < world.frame:
                self.target = sum(map(len, self.word(self.pos)[1])) + SPARE
                self.renewed, self.state = 0, RESIZE
        elif self.state == RESIZE:
            for _ in range(RESIZE_BY):
                if self.count < self.target:
                    self.count += 1
                    self.init(self.count - 1)
                elif self.count > self.target:
                    self.count -= 1
                    if self.renewed < self.count:
                        self.renewed += 1
                        self.init(self.renewed - 1)
            self.move()
            if not world.chant:
                self.let_go()
            elif self.count == self.target:
                self.form()
                self.state, self.timer = HOLD, world.frame + world.tables.spelling.hold
        elif self.state == HOLD:
            self.move()
            if not world.chant:
                self.let_go()
            elif self.timer < world.frame:
                self.scatter()
                self.state, self.timer = PAUSE, world.frame + PAUSE_FOR
        elif self.state == UNWIND:
            if self.count == SWARM and world.chant:
                self.state = IDLE
            self.move()
            if self.renewed < SWARM:
                self.renewed += 1
                self.init(self.renewed - 1)
            else:
                self.count = max(self.count - RESIZE_BY, SWARM)
            if self.count == SWARM and not world.chant:
                self.state = IDLE

    def sprites(self):
        """the corner each fly's sprite is drawn from, in the order the engine
        is handed them"""
        return [(whole(fly.x), whole(fly.y)) for fly in self.flies[:self.count]]


def overlays(disc):
    """({overlay: its bytes} for each the game's paths load that holds an
    alphabet, the address they load at)"""
    loaded = loaded_overlays(executable(disc)[1], GAMES["AO"]["path_record"])
    blobs = {name: disc.read(*disc.files[name]) for name in sorted(loaded) if name in disc.files}
    leads = (lead_table(blob, MESSAGE_TABLES["AO"]["lcd"][0]) for blob in blobs.values())
    base = one({lead[1] for lead in leads if lead}, "the address the overlays load at")
    held = {}
    for name, blob in blobs.items():
        try:
            if alphabets(blob, base):
                held[name] = blob
        except RuntimeError as e:
            raise RuntimeError(f"{name}: {e}") from None
    return held, base


def tables(dice, blob, base, spelling=BASE_SPELLING):
    """the model's tables as an overlay loaded at `base` holds them, beside
    the executable's dice and the numbers the overlay's code spells by"""
    count = MESSAGE_TABLES["AO"]["hintfly"][0]
    messages = one([table for table in pointer_tables(blob, count, base) if table], "the messages")
    letters = one(letter_tables(blob, base), "the alphabet")
    return Tables(dice, [bytes.fromhex(dots) for dots in letters], messages, spelling)


def code(blob, base, exe):
    """where an overlay loaded at `base` holds the hint fly's routines, and
    what they reach for in the executable, given its image.

    The routines that spell index the alphabet through an address they build,
    the table's less the first letter's code. Of those the update is the one
    an object's table of virtual functions names, with the render in the slot
    after it, and the update calls the one that forms a word. Its other
    callees in the overlay are the flies' tick and, making no call itself, a
    fly's setup, and the speller that measures the longest word is the one
    called by what also sets a fly up, the constructor. Outside the overlay
    the update calls only to ask for an event and loads only the frame
    counter, and the render calls the engine's drawing and loads the one
    pointer it draws through. The flies' tick passes the sound's number to the
    routines that make a sound, which all call the engine's player; of what
    the player calls, the one the flies' own routines call too is the roll of
    the dice and the rest are the voices it plays on, and the one word it
    loads is where its sounds are kept."""
    img = Image(blob, base)
    alphabet = base + one(alphabets(blob, base), "the alphabet")[0]
    spell = {entry(img, site) for site in references(img, alphabet - 4 * LETTER_FIRST)}
    if not spell:
        raise RuntimeError("no routine indexes the alphabet by a letter's code")
    update = one({f for f in spell if img.words_equal(f)}, "the update, a speller a table of functions names")
    render = img.word(one(img.words_equal(update), "the update's slot") + 8)
    if not img.holds(render) or img.word(render - 8) != JR_RA:
        raise RuntimeError("no function in the slot after the update's")
    targets = {target for _, target in calls(img, update)}
    inside = {t for t in targets if img.holds(t)}
    form = one(inside & spell, "the routine forming a word, a speller the update calls")
    init = one({f for f in inside - spell if not calls(img, f)}, "a fly's setup, a callee making no call")
    move = one(inside - spell - {init}, "the flies' tick")
    builds = {f for f in spell - {update, form}
              if any(init in {t for _, t in calls(img, entry(img, site))} for site in callers(img, f))}
    longest = one(builds, "the routine measuring the longest word, a speller called by what sets a fly up")
    ticked = {t for _, t in calls(img, move)}
    sounds = {target for site, target in calls(img, move)
              if not img.holds(target) and first_argument(img, site) == SOUND}
    if not sounds:
        raise RuntimeError("the flies' tick passes its sound to nothing")
    player = one({t for f in sounds for _, t in calls(exe, f)}, "the engine's player, what a sound routine calls")
    plays = {t for _, t in calls(exe, player)}
    drawing = {t for _, t in calls(img, render) if not img.holds(t)}
    if not drawing:
        raise RuntimeError("the render hands the engine nothing to draw")
    return Code(longest=longest, init=init, update=update, form=form, render=render,
                event=one(targets - inside, "the event query, the update's call out of the overlay"),
                frame=one({a for a in words_loaded(img, update) if not img.holds(a)},
                           "the frame counter, the word the update loads from outside the overlay"),
                drawing=drawing,
                screen=one({a for a in words_loaded(img, render) if not img.holds(a)},
                            "the pointer the render draws through"),
                player=player, roll=one(plays & ticked, "the roll of the dice, what the player and the flies call"),
                voices=plays - ticked,
                bank=one(words_loaded(exe, player), "where the player's sounds are kept, the word it loads"))


def spelling(blob, base, routines):
    """the numbers an overlay loaded at `base` spells by, off the routines
    `code` finds in it.

    The one forming a word hands the engine's product a step of a letter's
    grid, for a dot's column and again for its row, and steps a register on by
    a letter's cell. The update adds the hold to the frame counter once it has
    formed one."""
    img = Image(blob, base)
    made = calls(img, routines.form)
    product = one({target for _, target in made} - {routines.roll},
                  "the engine's product, what the routine forming a word calls beside the roll")
    dots = {argument(img, site, A1, reach=24) for site, target in made if target == product}
    formed = one([site for site, target in calls(img, routines.update) if target == routines.form],
                 "the update's call that forms a word")
    return Spelling(
        dot=one(dots if None not in dots else (), "a step of a letter's grid, the constant the product is handed"),
        letter=one([n for n in steps(img, routines.form) if n > 1],
                   "a letter's cell, what the routine forming a word steps a register on by"),
        hold=one(added(img, formed + 8, routines.frame), "the hold, what the update adds to the frame counter there"))


def spellings(disc):
    """{overlay: the numbers it spells by} for each `overlays` gives of a disc"""
    blobs, base = overlays(disc)
    exe, out = Image(executable(disc)[1]), {}
    for name, blob in blobs.items():
        try:
            out[name] = spelling(blob, base, code(blob, base, exe))
        except RuntimeError as e:
            raise RuntimeError(f"{name}: {e}") from None
    return out
