"""The engine's 16.16 arithmetic as its compiled code does it."""

FP = 65536


def s32(v):
    v &= 0xFFFFFFFF
    return v - (1 << 32) if v >> 31 else v


def s16(v):
    v &= 0xFFFF
    return v - (1 << 16) if v >> 15 else v


def fpmul(a, b):
    """the engine's product of two 16.16 numbers"""
    return s32(a * b >> 16)


def fpdiv(a, b):
    """the engine's quotient of two 16.16 numbers: of their sizes, the whole
    part and then the fraction cut down, which a divisor past 24 bits gives
    a byte at a time, shed of its low bytes, and the sign put back"""
    n, d = abs(a), abs(b)
    out, rest = n // d << 16, n % d
    if d > 0xFFFFFF:
        d >>= 8
        out, rest = out + (rest // d << 8), rest % d
        out += rest // (d >> 8)
    else:
        out += (rest << 16) // d
    return s32(-out if (a < 0) != (b < 0) else out)


def by_hand():
    """pairs for what a port's own quotients cannot be relied on to reach:
    sizes under a whole and past it, over divisors either side of 24 bits,
    up to a quotient past 32, under each pair of signs"""
    sizes = (1, 7, FP - 1, FP, 268 * FP, 777 * FP + 1, 2501 * FP, 0x7FFFFFFF)
    divisors = (2, 3 * FP, 15 * FP, 64 * FP, 100 * FP, 0xFFFFFF, 0x1000000, 0x10000FF, 300 * FP + 77, 0x7FFFFFFF)
    return [(a * sign, b * under) for a in sizes for b in divisors for sign in (1, -1) for under in (1, -1)]


def whole(v):
    """a 16.16 number's whole part, cut toward zero"""
    return s16((v + 0xFFFF if v < 0 else v) >> 16)
