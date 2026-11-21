"""The PlayStation's test of a ray against a path's lines, as both games'
compiled code makes it: in 24.8, every product and quotient cut toward zero,
which is not how the decomp writes it, and right only as far as a disc's own
code agrees with it."""
import collections

REACH = 0x200                       # twice a ray's length in 24.8, which no crossing's step comes to

Hit = collections.namedtuple("Hit", "line x y")


def _cut(v):
    """an eighth of a number's bits shed toward zero: 16.16 to 24.8, 24.8 to whole"""
    return -(-v >> 8) if v < 0 else v >> 8


def _times(a, b):
    return _cut(a * b)


def raycast(lines, x1, y1, x2, y2, kinds):
    """the nearest crossing of a ray in 16.16 with a line of the kinds a mask
    asks for: (which line, where in 16.16), or nothing. A line is its two ends
    in whole units and its kind. One whose box the ray's, cut to whole units,
    does not reach is passed over, as is one the ray runs along; a crossing
    counts on either end of the ray and of the line, and is placed by a
    quotient of the determinant's whole part, so a 256th or two off its line"""
    ax, ay, bx, by = _cut(x1), _cut(y1), _cut(x2), _cut(y2)
    left, right = sorted((_cut(ax), _cut(bx)))
    top, foot = sorted((_cut(ay), _cut(by)))
    dx, dy = bx - ax, by - ay
    nearest, found = REACH, None
    for at, (lx1, ly1, lx2, ly2, kind) in enumerate(lines):
        if not kinds >> (kind & 31) & 1:
            continue
        if min(lx1, lx2) > right or max(lx1, lx2) < left or min(ly1, ly2) > foot or max(ly1, ly2) < top:
            continue
        across, down = lx2 - lx1 << 8, ly2 - ly1 << 8
        det = _times(across, dy) - _times(dx, down)
        if abs(det) < 0x100:
            continue
        ox, oy = (lx1 << 8) - ax, (ly1 << 8) - ay
        along = _times(across, oy) - _times(down, ox)
        on = _times(dx, oy) - _times(dy, ox)
        if any(part < 0 or part > det if det > 0 else part > 0 or part < det for part in (along, on)):
            continue
        step = along // _cut(det)
        if step < nearest:
            nearest, found = step, at
    if found is None:
        return None
    return Hit(found, ax + _times(nearest, dx) << 8, ay + _times(nearest, dy) << 8)


def by_hand():
    """rays over lines of their own for what a flight cannot be relied on to
    throw, each group (its lines, its rays, a ray being its two ends in 16.16
    and the kinds asked for). Over two floors, the plane behind's above the
    plane in front's, a slope off the lower one's end, a floor above zero, a
    floor 64 long and a line upright from zero: down across a floor and from
    above both, the same ray asked for the plane in front alone, a ray ending
    on its line, a 512th short of it and a 512th past it, one starting on it
    and one along it, up a slope's face, a crawl of three 256ths across, a
    fall of a 256th onto a floor and one of two, past a line's end, and below
    zero; then about a line's ends, down from the joint of two lines and from
    a floor's first point, a 64th before a floor's start across its height,
    which below zero is on it and above is not, the same beside the upright
    line, a fall of a 64th onto the short floor, whose determinant is a
    whole, across a floor's line before its start and from there off its
    height, from under a floor on down, and up onto one. And over lines of
    kinds past 15 and past 31, which a mask asks for by their low five bits"""
    floors = [(0, 100, 200, 100, 0), (0, 80, 200, 80, 4), (200, 100, 260, 130, 0), (-40, -20, 40, -20, 0),
              (300, 100, 364, 100, 0), (50, 0, 50, 40, 0)]
    both, front, behind = 0x11, 0x01, 0x10
    over = (3309568, 4603904, 3457024, 6914048)
    rays = [((3309568, 5914624, 3457024, 6914048), both), (over, both), (over, front),
            ((1966080, 6225920, 2228224, 6553600), both), ((1966080, 6225920, 2228224, 6553472), both),
            ((1966080, 6225920, 2228224, 6553728), both), ((1966080, 6553600, 2228224, 6324224), both),
            ((1966080, 6553600, 3932160, 6553600), both), ((15092941, 7910195, 14948762, 7090995), both),
            ((655360, 6553088, 656640, 6553856), both), ((655360, 6553344, 655360, 6553600), both),
            ((655360, 6553088, 655360, 6553600), both), ((13434880, 6225920, 13565952, 6488064), both),
            ((-216269, -1684275, -72090, -996147), both)]
    near, floor = 1024, 100 << 16
    ends = [(200 << 16, floor, 200 << 16, floor + 2 * near), (0, floor, 0, floor + near),
            (-near, floor - near, -near, floor), ((300 << 16) - near, floor - near, (300 << 16) - near, floor),
            ((50 << 16) - 2 * near, -near, 50 << 16, -near), (300 << 16, floor - near, 300 << 16, floor),
            (-3 * near, floor - 3 * near, 0, floor + 3 * near), (-near, floor, 0, floor - 32 * near),
            (0, floor + near, 0, floor + 2 * near), (0, floor + near, 0, floor)]
    past = [(0, 100, 200, 100, 32), (0, 80, 200, 80, 36), (0, 90, 200, 90, 33), (0, 75, 200, 75, 16)]
    return [(floors, rays + [(ray, both) for ray in ends]),
            (past, [(over, both), (over, front), (over, behind), (over, 0x02), (over, 0x10000)])]
