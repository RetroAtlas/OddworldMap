"""Camera artwork: MDEC strips decoded through the bundled cam2rgba, the
foreground masks, and PNG encoding."""
import shutil
import struct
import subprocess
import sys
import zlib
from concurrent.futures import ProcessPoolExecutor
from pathlib import Path

from oddmap.disc import parse_chunks
from oddmap.paths import CAM2RGBA, HERE

OXIPNG = shutil.which("oxipng")
OXIPNG_VERSION = "10.2.1"  # the release the committed images encode with: oxipng's bytes move between releases

def oxipng_version(binary):
    answer = subprocess.run([binary, "--version"], stdout=subprocess.PIPE, text=True, check=True).stdout
    words = answer.split()  # "oxipng 10.2.1"
    if len(words) != 2 or words[0] != "oxipng":
        sys.exit(f"{binary} --version answered {answer.strip()!r}, not a release")
    return words[1]

def ensure_oxipng():
    global OXIPNG
    OXIPNG = shutil.which("oxipng")
    if not OXIPNG:
        sys.exit(f"oxipng {OXIPNG_VERSION} is required so rebuilds stay byte-identical to the committed images "
                 f"(brew install oxipng, or cargo install oxipng --version {OXIPNG_VERSION} --locked)")
    version = oxipng_version(OXIPNG)
    if version != OXIPNG_VERSION:
        sys.exit(f"oxipng {version} is installed but the committed images encode with oxipng {OXIPNG_VERSION}, "
                 f"and oxipng's bytes move between releases: install that release (cargo install oxipng "
                 f"--version {OXIPNG_VERSION} --locked), or move OXIPNG_VERSION and re-encode the tree with "
                 "--reencode-images in a commit of its own")

def ensure_tools():
    ensure_oxipng()
    if CAM2RGBA.exists():
        return
    print("compiling cam2rgba...")
    subprocess.run(["c++", "-O2", "-std=c++17", f"-I{HERE}", "-include", "Types.hpp",
                    str(HERE / "cam2rgba.cpp"), str(HERE / "PSXMDECDecoder.cpp"),
                    "-o", str(CAM2RGBA)], check=True)

def write_png(path, w, h, rgba, keep_alpha=False):
    def chunk(tag, data):
        c = tag + data
        return struct.pack(">I", len(data)) + c + struct.pack(">I", zlib.crc32(c))
    rgba = bytearray(rgba)
    if not keep_alpha:
        for i in range(3, len(rgba), 4):
            rgba[i] = 255
    scan = b"".join(b"\x00" + bytes(rgba[y*w*4:(y+1)*w*4]) for y in range(h))
    png = (b"\x89PNG\r\n\x1a\n"
           + chunk(b"IHDR", struct.pack(">IIBBBBB", w, h, 8, 6, 0, 0, 0))
           + chunk(b"IDAT", zlib.compress(scan, 6))
           + chunk(b"IEND", b""))
    Path(path).write_bytes(png)
    # lossless recompression (~30% smaller), forced so a file it cannot shrink is still its own bytes
    subprocess.run([OXIPNG, "-o", "2", "--strip", "safe", "--force", "-q", str(path)], check=True)

def read_png(data):
    """(w, h, RGBA8) of a PNG write_png emitted: any colour type oxipng reduces
    RGBA8 to, at 8 bits a sample or fewer, never interlaced"""
    if data[:8] != b"\x89PNG\r\n\x1a\n":
        raise ValueError("not a PNG")
    idat, plte, trns, pos = [], b"", None, 8
    while pos < len(data):
        n, = struct.unpack_from(">I", data, pos)
        tag, body, pos = data[pos+4:pos+8], data[pos+8:pos+8+n], pos + n + 12
        if tag == b"IHDR":
            w, h, depth, ctype, _, _, interlace = struct.unpack(">IIBBBBB", body)
        elif tag == b"PLTE":
            plte = body
        elif tag == b"tRNS":
            trns = body
        elif tag == b"IDAT":
            idat.append(body)
        elif tag == b"IEND":
            break
    if interlace or depth > 8 or ctype not in (0, 2, 3, 4, 6):
        raise ValueError(f"not a shape write_png emits: depth {depth}, colour type {ctype}, interlace {interlace}")
    channels = {0: 1, 2: 3, 3: 1, 4: 2, 6: 4}[ctype]
    stride = (w * channels * depth + 7) // 8
    bpp = max(1, channels * depth // 8)
    raw = zlib.decompress(b"".join(idat))
    out, prev, top = bytearray(), bytearray(stride), (1 << depth) - 1
    for y in range(h):
        at = y * (stride + 1)
        f, line = raw[at], bytearray(raw[at+1:at+1+stride])
        if f == 1:
            for i in range(bpp, stride):
                line[i] = (line[i] + line[i-bpp]) & 255
        elif f == 2:
            for i in range(stride):
                line[i] = (line[i] + prev[i]) & 255
        elif f == 3:
            for i in range(stride):
                line[i] = (line[i] + ((line[i-bpp] if i >= bpp else 0) + prev[i]) // 2) & 255
        elif f == 4:
            for i in range(stride):
                a, b, c = line[i-bpp] if i >= bpp else 0, prev[i], prev[i-bpp] if i >= bpp else 0
                pa, pb, pc = abs(b - c), abs(a - c), abs(a + b - c - c)
                line[i] = (line[i] + (a if pa <= pb and pa <= pc else b if pb <= pc else c)) & 255
        elif f:
            raise ValueError(f"filter {f}")
        prev = line
        if depth < 8:
            samples = [(byte >> (8 - depth * (k + 1))) & top for byte in line for k in range(8 // depth)]
            samples = samples[:w * channels]
        else:
            samples = line
        if ctype == 3:
            for i in samples:
                out += plte[i*3:i*3+3]
                out.append(trns[i] if trns and i < len(trns) else 255)
        elif ctype == 0:
            key = struct.unpack(">H", trns)[0] if trns else None
            for g in samples:
                v = g * 255 // top
                out += bytes((v, v, v, 0 if g == key else 255))
        elif ctype == 2:
            key = struct.unpack(">HHH", trns) if trns else None
            for i in range(0, len(samples), 3):
                px = tuple(samples[i:i+3])
                out += bytes(px) + (b"\0" if px == key else b"\xff")
        elif ctype == 4:
            for i in range(0, len(samples), 2):
                g, a = samples[i:i+2]
                out += bytes((g, g, g, a))
        else:
            out += samples
    return w, h, bytes(out)

def reencode_png(src, dst):
    """write src's own pixels to dst through write_png; True where the bytes moved.
    A cam decodes opaque, so keeping the alpha hands both kinds their raw input."""
    data = Path(src).read_bytes()
    w, h, rgba = read_png(data)
    write_png(dst, w, h, rgba, keep_alpha=True)
    return Path(dst).read_bytes() != data

def reencode_pngs(pairs):
    """re-emit every (src, dst) in parallel, returning the srcs whose bytes moved"""
    if not pairs:
        return []
    with ProcessPoolExecutor() as pool:
        moved = list(pool.map(reencode_png, *zip(*pairs), chunksize=8))
    return [src for (src, _), m in zip(pairs, moved) if m]

def decompress_4or5(data):
    """alive LZ variant: 0xxxxxxx = literals run, 1xxxxxyy yyyyyyyy = back-copy"""
    dst_len = struct.unpack_from("<I", data, 0)[0]
    out = bytearray()
    pos = 4
    while len(out) < dst_len and pos < len(data):
        c = data[pos]; pos += 1
        if c & 0x80:
            if pos >= len(data): break
            n = ((c & 0x7C) >> 2) + 3
            back = ((c & 0x03) << 8) + data[pos] + 1; pos += 1
            start = len(out) - back
            if start < 0: break
            for i in range(n):
                out.append(out[start + i])
        else:
            n = c + 1
            out += data[pos:pos + n]
            pos += n
    return bytes(out)

def rgb555(px):
    r = (px & 0x1F) << 3; g = ((px >> 5) & 0x1F) << 3; b = ((px >> 10) & 0x1F) << 3
    return bytes((r | r >> 5, g | g >> 5, b | b >> 5, 255))

def decode_fg1(fg1, cam_rgba, w, h):
    """walk an FG1 chunk stream, return (overlay RGBA or None, walked clean).

    Partial blocks carry their own RGB555 pixels in both games, and Exoddus
    keeps every block inside an LZ-compressed sub-stream: the per-row u32
    bitmask form and a game that never compresses are both PC facts. A walk
    that bails at any depth has lost the stride and is dropping blocks, which
    is silent in the output and so is reported rather than left to be noticed."""
    overlay = bytearray(w * h * 4)
    any_px = False
    clean = True
    stack = []          # saved (buffer, pos) while inside compressed sub-streams
    buf, pos = fg1, 4   # skip u32 count
    while True:
        if pos + 12 > len(buf):
            clean = False
            if stack: buf, pos = stack.pop(); continue
            break
        typ, layer, x, y, cw, ch = struct.unpack_from("<HHhhHH", buf, pos)
        if typ == 0xFFFF:            # end
            if stack: buf, pos = stack.pop(); continue
            break
        if typ == 0xFFFC:            # end of compressed sub-stream
            if stack: buf, pos = stack.pop(); continue
            clean = False
            break
        if typ == 0xFFFD:            # compressed sub-stream (layer=decomp size, x=comp size)
            comp = x & 0xFFFF
            if comp < 4 or pos + 12 + comp > len(buf):
                clean = False
                break                # truncated chunk
            sub = decompress_4or5(buf[pos + 12:pos + 12 + comp])
            stack.append((buf, pos + 12 + comp))
            buf, pos = sub, 0
            continue
        if typ == 0xFFFE:            # full block: copy cam pixels
            for j in range(ch):
                yy = y + j
                if not (0 <= yy < h): continue
                x0 = max(0, x); x1 = min(w, x + cw)
                if x1 > x0:
                    o = (yy * w + x0) * 4
                    overlay[o:o + (x1 - x0) * 4] = cam_rgba[o:o + (x1 - x0) * 4]
                    any_px = True
            pos += 12
            continue
        if typ == 0:                 # partial block: own RGB555 pixels follow
            px_off = pos + 12
            if px_off + cw * ch * 2 > len(buf):
                clean = False
                break                # truncated chunk
            for j in range(ch):
                yy = y + j
                for i in range(cw):
                    px = struct.unpack_from("<H", buf, px_off + (j * cw + i) * 2)[0]
                    if px == 0: continue
                    xx = x + i
                    if 0 <= xx < w and 0 <= yy < h:
                        overlay[(yy * w + xx) * 4:(yy * w + xx) * 4 + 4] = rgb555(px)
                        any_px = True
            pos = px_off + cw * ch * 2
            continue
        # unknown chunk type: bail out of this stream
        clean = False
        if stack: buf, pos = stack.pop(); continue
        break
    return (bytes(overlay) if any_px else None), clean

def decode_cam(lvl, cam_name, out_png, tmpdir):
    try:
        cam = lvl.read(cam_name + ".CAM")
    except KeyError:
        print(f"    ! cam file missing: {cam_name}.CAM")
        return False
    chunks = parse_chunks(cam)
    bits = next((v for (tag, _), v in chunks.items() if tag == "Bits"), None)
    if not bits:
        return False
    bits_file = tmpdir / "cam.bits"
    rgba_file = tmpdir / "cam.rgba"
    bits_file.write_bytes(bits)
    r = subprocess.run([str(CAM2RGBA), str(bits_file), str(rgba_file)], capture_output=True)
    if r.returncode != 0:
        print(f"    ! cam decode failed: {cam_name}")
        return False
    raw = rgba_file.read_bytes()
    w, h = struct.unpack_from("<II", raw, 0)
    rgba = raw[8:]
    # the MDEC stream pads 368 visible columns up to 384 (24 macroblocks);
    # crop the junk columns off before writing
    VISIBLE_W = 368
    if w > VISIBLE_W:
        rgba = b"".join(rgba[y*w*4:(y*w + VISIBLE_W)*4] for y in range(h))
        w = VISIBLE_W
    write_png(out_png, w, h, rgba)

    # foreground occlusion overlay from the FG1 chunk(s)
    fg_png = out_png.with_name(out_png.stem + "_fg.png")
    fg_parts = [v for (tag, _), v in chunks.items() if tag == "FG1 "]
    overlay = None
    for part in fg_parts:
        got, clean = decode_fg1(part, rgba, w, h)
        if not clean:
            print(f"    ! FG1 stream not walked clean: {cam_name}")
        if got is None:
            continue
        if overlay is None:
            overlay = bytearray(got)
        else:
            for px in range(0, len(got), 4):
                if got[px + 3]:
                    overlay[px:px + 4] = got[px:px + 4]
    if overlay:
        write_png(fg_png, w, h, bytes(overlay), keep_alpha=True)
    return True
