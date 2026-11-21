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


def whole(v):
    """a 16.16 number's whole part, cut toward zero"""
    return s16((v + 0xFFFF if v < 0 else v) >> 16)
