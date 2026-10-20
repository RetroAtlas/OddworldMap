"""What a path chunk holds: TLV records decoded per type for the viewer's
navigation, the schema-driven field archive beside them, and the grid a path
carries when the decomp tabulates none for it."""
import re
import struct

# types whose full disc field set is extracted raw into `fields`, matched by
# name (per-game type ids differ).
GAMEPLAY_FIELD_TYPES = {
    # creatures + spawners
    "Mudokon", "SlingMudokon", "RingMudokon", "LiftMudokon", "TorturedMudokon", "MudokonPathTrans",
    "Slig", "Slog", "Paramite", "Scrab", "Bat", "Fleech", "Slurg", "Greeter", "Glukkon",
    "FlyingSlig", "CrawlingSlig", "SligGetPants", "SligGetWings", "Bees", "SlogHut", "BeeSwarmHole",
    "SligSpawner", "SlogSpawner", "ScrabSpawner", "SlurgSpawner", "FlyingSligSpawner", "ZzzSpawner",
    # doors / travel
    "Door", "SlamDoor", "MineCar", "PathTransition", "BirdPortal", "BirdPortalExit",
    "WellLocal", "LocalWell", "WellExpress", "Teleporter",
    # switches / triggers
    "Switch", "Lever", "InvisibleSwitch", "FootSwitch", "BellHammer", "HandStone", "IdSplitter",
    "SecurityDoor", "BellSongStone", "ChimeLock", "MovieHandStone", "GlukkonSwitch",
    "CrawlingSligButton", "MultiSwitchController", "WheelSyncer", "WorkWheel", "SlapLock", "PullRingRope",
    "ResetPath", "ResetSwitchRange",
    # hazards
    "DeathDrop", "TimedMine", "Mine", "UXB", "ElectricWall", "MovingBomb", "MeatSaw",
    "DeathClock", "GasEmitter", "GasCountdown", "TrapDoor", "FallingItem",
    "RollingBall", "RollingRock", "ZBall", "Drill", "LaughingGas", "ExplosionSet", "Water",
    "SecurityOrb", "SecurityClaw", "MotionDetector",
    # info / interactables
    "LCDStatusBoard", "LCDScreen", "LCD", "MovieStone", "DemoPlaybackStone", "HintFly", "DoorFlame",
    "ContinuePoint", "ContinueZone", "AbeStart", "ElumStart",
    # scenery / helpers / pickups
    "LightEffect", "ShadowZone", "Hoist", "Edge", "StatusLight", "BackgroundAnimation", "ParamiteWebLine",
    "SligBoundLeft", "SligBoundRight", "EnemyStopper", "SligPersist", "MovingBombStopper", "RollingBallStopper",
    "LiftPoint", "LiftMover", "Pulley", "SoftLanding", "FlintLockFire",
    "MusicTrigger", "TimerTrigger", "Alarm", "Preloader", "LevelLoader", "TrainDoor",
    "RingCancel", "Null", "ElumPathTrans", "DoorBlocker", "ColourfulMeter",
    "RockSack", "MeatSack", "HoneySack", "Honey", "BoneBag", "Dove", "BoomMachine", "BrewMachine",
}

def tlv_extra_ao(t, blob, pos, length, level_short):
    """decode useful payload fields per type (payload starts at +0x18)"""
    def s16s(n, off=0x18):
        cnt = min(n, (length - off) // 2)
        return struct.unpack_from(f"<{cnt}h", blob, pos + off) if cnt > 0 else ()
    e = {}
    if t == 6:
        v = s16s(8)
        if len(v) >= 7:
            e = {"to_level": level_short.get(v[0], v[0]), "to_path": v[1], "to_cam": v[2],
                 "door#": v[4] & 0xFFFF, "target_door#": v[6]}
    elif t == 1:
        v = s16s(3)
        if len(v) >= 2:
            e = {"to_level": level_short.get(v[0], v[0]), "to_path": v[1]}
    elif t == 0:
        v = s16s(3)
        if v: e = {"zone": v[0]}
    elif t == 51:
        v = s16s(1)
        if v: e = {"movie": v[0]}
    elif t == 100:  # HandStone: scale, then up to three viewed (level, path, camera) triples
        v = s16s(10)
        if len(v) >= 10:
            for n in range(3):
                lv, pa, ca = v[1 + n * 3:4 + n * 3]
                # unused slots carry stale level ids with zeroed path/camera
                if 1 <= lv <= 15 and pa >= 1 and ca >= 1:
                    e[f"view{n + 1}_level"] = level_short.get(lv, lv)
                    e[f"view{n + 1}_path"] = pa
                    e[f"view{n + 1}_cam"] = ca
    elif t == 45:  # WellExpress: off/on destinations (level/path/camera/well id), switched by trigger id
        v = s16s(14)
        if len(v) >= 14:
            def dest(lv, pa, ca):
                # level 0 is the menu; wells never really go there (zeroed fields)
                return {"to_level": level_short.get(lv, lv), "to_path": pa, "to_cam": ca} \
                    if 1 <= lv <= 15 else {}
            off = dest(v[6], v[7], v[8])
            on = dest(v[10], v[11], v[12])
            alt = bool(on) and (on != off or v[13] != v[9])
            e = dict(off)
            if alt:
                e.update({"alt_level": on["to_level"], "alt_path": on["to_path"], "alt_cam": on["to_cam"]})
            e["trigger_id"] = v[1]
            # arrival lands on the well answering to the id in the destination camera
            e["well#"] = v[2]
            if off:
                e["target_well#"] = v[9]
            if alt:
                e["alt_target_well#"] = v[13]
    elif t == 11:  # WellLocal: WellBase header; the id is how express wells land on it
        v = s16s(3)
        if len(v) >= 3:
            e = {"well#": v[2]}
    elif t == 52:  # BirdPortal: side, dest level/path/camera, scale, movie, type
        v = s16s(7)
        if len(v) >= 7:
            kind = {0: "travel", 1: "rescue", 2: "shrykull"}.get(v[6], v[6])
            e = {"portal": kind}
            if v[6] == 0:  # only travel portals have a real destination
                e.update({"to_level": level_short.get(v[1], v[1]), "to_path": v[2], "to_cam": v[3]})
    # gameplay objects get their full field set decoded generically into
    # `fields`; see walk_obj_region
    if not e:
        v = s16s(6)
        e = {"raw": " ".join(str(x) for x in v)} if v else {}
    return e

def tlv_extra_ae(t, blob, pos, length, level_short):
    """decode useful payload fields per type (payload starts at +0x10)"""
    def s16s(n, off=0x10):
        cnt = min(n, (length - off) // 2)
        return struct.unpack_from(f"<{cnt}h", blob, pos + off) if cnt > 0 else ()
    def dest(lv, pa, ca):
        return {"to_level": level_short.get(lv, lv), "to_path": pa, "to_cam": ca} \
            if 1 <= lv <= 16 else {}
    e = {}
    if t == 5:  # Door: level, path, camera, scale, door#, switch id, target door
        v = s16s(7)
        if len(v) >= 7:
            e = {"to_level": level_short.get(v[0], v[0]), "to_path": v[1], "to_cam": v[2],
                 "door#": v[4] & 0xFFFF, "target_door#": v[6]}
    elif t == 1:  # PathTransition
        v = s16s(3)
        if len(v) >= 2:
            e = {"to_level": level_short.get(v[0], v[0]), "to_path": v[1]}
    elif t == 23:  # WellExpress: WellBase then exit x/y, disabled dest, enabled dest (each with a well id)
        v = s16s(14)
        if len(v) >= 14:
            off = dest(v[6], v[7], v[8])
            on = dest(v[10], v[11], v[12])
            alt = bool(on) and (on != off or v[13] != v[9])
            e = dict(off)
            if alt:
                e.update({"alt_level": on["to_level"], "alt_path": on["to_path"], "alt_cam": on["to_cam"]})
            # arrival lands on the well answering to the id in the destination camera
            e["well#"] = v[2]
            if off:
                e["target_well#"] = v[9]
            if alt:
                e["alt_target_well#"] = v[13]
    elif t == 8:  # WellLocal: WellBase header; the id is how express wells land on it
        v = s16s(3)
        if len(v) >= 3:
            e = {"well#": v[2]}
    elif t == 61:  # HandStone: scale, up to three viewed camera ids (current path), trigger switch
        v = s16s(5)
        if len(v) >= 5:
            for n in range(3):
                if v[1 + n]:
                    e[f"view{n + 1}_cam"] = v[1 + n]
            if v[4]:
                e["switch_id"] = v[4]
    elif t == 88:  # Teleporter: own id, other id, camera, path, level, switch id
        v = s16s(6)
        if len(v) >= 6:
            e = {"tp#": v[0], "target_tp#": v[1]}
            e.update(dest(v[4], v[3], v[2]))
    elif t == 28:  # BirdPortal: side, dest level/path/camera, scale, movie, type
        v = s16s(7)
        if len(v) >= 7:
            e = {"portal": {0: "travel", 1: "rescue", 2: "shrykull"}.get(v[6], v[6])}
            if v[6] == 0:  # only travel portals have a real destination
                e.update(dest(v[1], v[2], v[3]))
    elif t == 86:  # LevelLoader: switch id, dest level/path/camera, movie
        v = s16s(5)
        if len(v) >= 5:
            e = dest(v[1], v[2], v[3])
    # gameplay objects get their full field set decoded generically into
    # `fields`; see walk_obj_region
    if not e:
        v = s16s(6)
        e = {"raw": " ".join(str(x) for x in v)} if v else {}
    return e

def object_fields(schema, t, blob, pos, length, header_len):
    """the complete raw field set for a gameplay object, every field read as an
    s16 at its schema word (values fit s16 in practice, even nominal s32 ids). A
    schema'd type always yields a dict — empty for the field-less ones — so the
    caller can retire its raw fallback; a type with no schema entry returns None
    and keeps that fallback."""
    layout = schema.get(t)
    if layout is None:
        return None
    navail = max((length - header_len) // 2, 0)
    words = struct.unpack_from(f"<{navail}h", blob, pos + header_len) if navail else ()
    return {name: words[w] for w, name, *_ in layout if 0 <= w < navail}

def tlv_header_ok(fmt, flags, length, typ):
    """the record test both walks share. How far a record may reach is left to
    the caller: one is reading inside a region whose end it already knows, the
    other is deciding where that end is, and a record overrunning an advisory
    end is real object data in dozens of AO paths."""
    return (fmt["min_len"] <= length <= fmt["max_len"] and (typ & 0xFFFF) <= fmt["max_type"]
            and (not (flags & ~7) if fmt["check_flags"] else True))

def contiguous_objects(blob, start, fmt):
    """object records from `start` while they stay contiguous, and where they
    stop. Unlike the resyncing walk this refuses to skip, because what follows
    the region is an index table whose -1 links read as plausible rects."""
    pos, origins = start, []
    while pos + fmt["header_len"] <= len(blob):
        flags, _, length, typ = struct.unpack_from("<BBhI", blob, pos)
        if not (tlv_header_ok(fmt, flags, length, typ) and pos + length <= len(blob)):
            break
        x, y = struct.unpack_from("<hh", blob, pos + fmt["rect_off"])
        if x >= 0 and y >= 0:
            origins.append((x, y))
        pos += length
    return pos, origins

def _entries_land(blob, table, obj_off, fmt):
    """every camera's index entry starts a record when the object region does"""
    for v in table:
        if v == -1:
            continue
        pos = obj_off + v
        if v < 0 or pos + fmt["header_len"] > len(blob):
            return False
        flags, _, length, typ = struct.unpack_from("<BBhI", blob, pos)
        if not tlv_header_ok(fmt, flags, length, typ):
            return False
    return True

def audit_path_meta(blob, meta, fmt, cells):
    """the tabulated offsets against the chunk's own evidence. The decomp's
    tables come from the PC build and two PS1 paths disagree with them by a
    collision line, which slides the object region and leaves the index table
    unreadable — so the count is taken from the chunk: the table ends the
    chunk at 4 bytes a cell, its entries are offsets from the object region,
    and only the true count puts that region where every entry starts a record.
    Silent where the table already agrees, and raising rather than guessing
    where no count answers or more than one does."""
    idx_off = len(blob) - cells * 4
    table = struct.unpack_from(f"<{cells}i", blob, idx_off) if idx_off > meta["coll_off"] else ()
    if all(v == -1 for v in table):  # nothing to place the region against
        return meta
    fits = [n for n in range(max(0, meta["coll_count"] - 2), meta["coll_count"] + 3)
            if _entries_land(blob, table, meta["coll_off"] + n * 20, fmt)]
    if len(fits) != 1:
        raise RuntimeError(f"collision count undetermined: tabulated {meta['coll_count']}, "
                           f"index table at {idx_off} answers {fits}")
    return {**meta, "coll_count": fits[0], "obj_off": meta["coll_off"] + fits[0] * 20,
            "idx_off": idx_off}

def discover_path_meta(blob, fmt, cell_w, cell_h):
    """the table for a path the decomp leaves null, read off the chunk itself.
    The camera-name table heads it at one 8-byte slot per cell, so the run of
    slots is the cell count; the objects behind it pick which factorisation of
    that count is the grid, since every one has to land inside it. Collision
    would sit between the two and this assumes none: its records stop the walk
    where the objects should start, and with no origins to narrow it every
    factorisation stands, so such a path is refused rather than read."""
    n = 0
    while (n + 1) * 8 <= len(blob):
        slot = blob[n * 8:(n + 1) * 8]
        if any(slot) and not re.fullmatch(r"[A-Z0-9]{4,8}", slot.decode("latin1").strip("\0 ")):
            break
        n += 1
    obj_off = n * 8
    end, origins = contiguous_objects(blob, obj_off, fmt)
    fits = [(w, n // w) for w in range(1, n + 1)
            if n % w == 0 and all(x // cell_w < w and y // cell_h < n // w for x, y in origins)]
    if len(fits) != 1:
        raise RuntimeError(f"grid undetermined: {n} cells, {len(origins)} objects, fits {fits}")
    W, H = fits[0]
    # the index table behind the objects runs 4 bytes per cell on most paths, so
    # a tail of that size corroborates the end the walk stopped at; a few chunks
    # carry slack, which is why this reports rather than refuses
    if len(blob) - end != n * 4:
        print(f"    ! objects end at {end}, leaving {len(blob) - end} bytes where a "
              f"per-cell index table would take {n * 4}")
    return {"w_units": W * cell_w, "h_units": H * cell_h, "obj_off": obj_off,
            "idx_off": end, "coll_off": obj_off, "coll_count": 0}

def resolve_path_meta(blob, path_id, tabulated, fmt, cell_w, cell_h):
    """the offsets a path is read at: the decomp's row audited against the chunk,
    or, where the decomp tabulates nothing, a row discovered from the chunk, which
    is already its own reading and is not audited again."""
    if tabulated is None:
        return discover_path_meta(blob, fmt, cell_w, cell_h)
    cells = max(1, tabulated["w_units"] // cell_w) * max(1, tabulated["h_units"] // cell_h)
    meta = audit_path_meta(blob, tabulated, fmt, cells)
    if meta["coll_count"] != tabulated["coll_count"]:
        print(f"  path {path_id}: {tabulated['coll_count']} collision lines tabulated, "
              f"{meta['coll_count']} in the chunk")
    return meta

def walk_obj_region(blob, obj_off, region_end, game, level_short, positions=None):
    """linear walk of the packed TLV region with resync on garbage, each record's
    offset into the region appended to `positions` where one is given"""
    fmt = game["tlv"]
    rect_off, payload = fmt["rect_off"], fmt["extra_fn"]
    names, schema = game["tlv_names"], game["schema"]
    tlvs = []
    pos = obj_off
    end = min(region_end, len(blob))
    while pos + fmt["header_len"] <= end:
        flags, unk, length, typ32 = struct.unpack_from("<BBhI", blob, pos)
        t = typ32 & 0xFFFF
        if tlv_header_ok(fmt, flags, length, typ32):
            x1, y1, x2, y2 = struct.unpack_from("<hhhh", blob, pos + rect_off)
            name = names.get(t, f"type{t}")
            extra = payload(t, blob, pos, length, level_short)
            fields = object_fields(schema, t, blob, pos, length, fmt["header_len"]) \
                if name in GAMEPLAY_FIELD_TYPES else None
            # a schema'd gameplay type owns its fields; the archive (empty for the
            # field-less ones) supersedes the raw dump, so none falls back to raw=
            if fields is not None:
                extra = {k: v for k, v in extra.items() if k != "raw"}
            tlv = {"t": t, "name": name, "x1": x1, "y1": y1, "x2": x2, "y2": y2, "extra": extra}
            if fields:
                tlv["fields"] = fields
            tlvs.append(tlv)
            if positions is not None:
                positions.append(pos - obj_off)
            pos += length
        else:
            pos += 2  # resync
    return tlvs
