// What each placed object looks like the moment the game constructs it from
// its TLV: the animation it stands in, where its anchor is, its scale, facing,
// colour and draw layer — the constructors' own rules, one per type and game,
// over the archive's fields and the path's collision lines. A rule returns
// draw records; the painter draws them and the motion clock advances them.
// No DOM, so it stays importable in bare Node.

import { onBackgroundPlane } from "./fields.js";
import { raycastDiag, raycastDown, snapX } from "./collide.js";
import { sligBounds, tlvCell } from "./model.js";
import { lcdMessages } from "./messages.js";
import { AE_MUDOKONS_IN_LEVEL, AO_MUDOKONS, TALLY_EDGE, lcdIds } from "./lcd.js";

// collision-line types a constructor raycasts against; the background plane's
// copies sit four above the foreground's
const FLOOR = [0];
const FLOOR_WALLS = [0, 1, 2];
const FLOOR_WALLS_CEIL = [0, 1, 2, 3];
const TRACK = [8];
const bgOf = (types) => types.map((t) => t + 4);
const planeTypes = (half, types) => (half ? bgOf(types) : types);

// Oddysee snaps in the current camera's own coordinates (MapFollowMe), the
// camera being the object's own on a map
const snapAt = (c, x) => {
  if (c.game === "AE") return snapX("AE", x, c.half);
  const camX = Math.floor(x / c.geo.worldW) * c.geo.worldW;
  return camX + snapX("AO", x - camX, c.half);
};

const trunc = Math.trunc;
const mid = (t) => trunc((t.x1 + t.x2) / 2);
const midY = (t) => trunc((t.y1 + t.y2) / 2);
const ALL_LINES = [0, 1, 2, 3, 4, 5, 6, 7, 8];
// the levels whose themed art and tints differ
const AE_VAULTS = new Set(["NE", "PV", "SV"]);
const AO_STOCKYARDS = new Set(["E1", "E2"]);
const AO_YARDS_TINT = (c, yards, other) => (AO_STOCKYARDS.has(c.lvl.short) ? yards : other);
const NE_TINT = (c) => (c.lvl.short === "NE" ? [137, 137, 137] : [127, 127, 127]);

// a brain rolls the game's dice from a seed; the game's is wherever its
// counter stood, the record's is its place in the path
const brain = (c, name, emo = false, p = null) => ({
  kind: "brain",
  brain: name,
  game: c.game,
  seed: c.index & 255,
  emo,
  p,
});
// a brain on patrol walks the path: its lines and their links, its objects,
// and the spawn the constructor's own raycast stands it on
const patrol = (c, name, p, spawn) => ({
  ...brain(c, name, false, p),
  patrol: true,
  world: {
    game: c.game,
    half: c.half,
    lines: c.lines,
    links: c.links,
    tlvs: c.path.tlvs,
    spawn,
  },
});

// the record a rule returns, with the engine's defaults: full scale on layer
// 27 and half on layer 8, the game's base colour, a semi-transparent polygon
function draw(c, anim, x, y, o = {}) {
  const scale = o.scale ?? (c.half ? 0.5 : 1);
  return {
    anim,
    x,
    y: y + (o.yOff ?? c.yOff),
    scale,
    flip: !!o.flip,
    flipY: !!o.flipY,
    layer: o.layer ?? (scale === 1 ? 27 : 8),
    rgb: o.rgb ?? (c.game === "AO" ? [105, 105, 105] : [127, 127, 127]),
    semi: o.semi ?? true,
    blend: o.blend ?? 0,
    frame: o.frame ?? 0,
    frozen: !!o.frozen,
    swap: !!o.swap,
    cycle: o.cycle ?? null,
    tile: o.tile ?? null,
    camAt: o.camAt ?? null,
  };
}

// the frame-0 bounding rectangle of an animation, from the sidecar
const bound = (c, anim) => c.anims?.[anim]?.bound ?? [0, 0, 0, 0];

// one entry per level row of a tint table, the rest the fallback
const tint = (table, lv, fallback) => table[lv] ?? fallback;

const rules = { AO: {}, AE: {} };
const rule = (game, type, fn) => (rules[game][type] = fn);
const both = (type, fn) => {
  rule("AO", type, fn);
  rule("AE", type, fn);
};

// ---- doors and furniture ------------------------------------------------

const AE_DOOR_THEME = {
  MI: "Mines",
  ST: "Mines",
  NE: "Temple",
  PV: "Temple",
  SV: "Temple",
  FD: "Feeco",
  BA: "Barracks",
  BW: "Bonewerkz",
  BR: "Brewery",
  BM: "Brewery",
};
// the Barracks paths whose overlay id picks the metal door
const BARRACKS_METAL_PATHS = [3, 5, 10];

rule("AE", "Door", (c) => {
  const { t, f } = c;
  const lv = c.lvl.short;
  let theme = AE_DOOR_THEME[lv];
  if (!theme || f.start_state === 0) return []; // an open door draws nothing
  const metal = lv === "BA" && BARRACKS_METAL_PATHS.includes(c.path.id);
  if (metal) theme = "BarracksMetal";
  const s = c.half ? 0.5 : 1;
  const xm = mid(t);
  const hit = raycastDown(c.lines, xm, t.y1, t.y2, planeTypes(c.half, FLOOR_WALLS_CEIL));
  let x, y;
  if (hit !== null) {
    y = hit - 12 * s;
    x = snapAt(c, xm);
  } else {
    x = t.x1 + 12;
    y = t.y1 + 24;
  }
  x += f.x_offset || 0;
  y += f.y_offset || 0;
  if (lv === "BA" && !metal) y += 14 * s;
  else if (lv === "BW") y += 10 * s;
  return [draw(c, `Door_${theme}_Closed`, x, y, { layer: s === 1 ? 25 : 6 })];
});

rule("AE", "DoorBlocker", (c) => [
  draw(c, "Door_Lock_Idle", mid(c.t), c.t.y1, { layer: c.half ? 7 : 26 }),
]);

// Oddysee's start_state word picks the art set as well as the state
const AO_DOOR_SET = {
  R1: "RuptureFarms",
  R6: "RuptureFarms",
  R2: "RuptureFarms",
  L1: "Lines",
  F2: "Forest",
  F4: "Forest",
  D2: "Desert",
  D7: "Desert",
};
rule("AO", "Door", (c) => {
  const { t, f } = c;
  const lv = c.lvl.short;
  const set = AO_DOOR_SET[lv];
  if (!set || f.door_closed !== 1) return [];
  const kind = f.start_state;
  const xm = mid(t);
  let x, y, anim, layer, scale;
  if (kind === 1) {
    // the hub door's art, placed at the half grid outside Rupture Farms
    const snapHalf = lv !== "R2";
    layer = snapHalf ? 6 : 25;
    const hit = raycastDown(c.lines, xm, t.y1, t.y2, planeTypes(snapHalf, FLOOR_WALLS));
    if (hit !== null) {
      y = hit + 4;
      x = snapAt({ ...c, half: snapHalf }, xm);
    } else {
      x = t.x1;
      y = t.y1;
    }
    anim = `HubDoor_${set}_Closed`;
    scale = 1;
  } else if (kind === 2) {
    layer = 6;
    scale = 1;
    if (lv === "R1" || lv === "R2") {
      const hit = raycastDown(c.lines, xm, t.y1, t.y2, FLOOR_WALLS);
      if (hit !== null) {
        y = hit - 12;
        x = snapAt({ ...c, half: false }, xm);
      } else {
        x = t.x1 + 12;
        y = t.y1 + 24;
      }
    } else {
      x = t.x1 + 9;
      y = t.y1 + 20;
    }
    anim = `FinalTestDoor_${set}_Closed`;
  } else {
    const s = c.half ? 0.5 : 1;
    layer = c.half ? 6 : 25;
    scale = s;
    const hit = raycastDown(c.lines, xm, t.y1, t.y2, planeTypes(c.half, FLOOR_WALLS));
    if (hit !== null) {
      y = hit - 12 * s;
      x = snapAt(c, xm);
    } else {
      x = t.x1 + 12;
      y = t.y1 + 24;
    }
    anim = `Door_${set}_Closed`;
  }
  // the Rupture Farms and Lines sets carry one art for all three kinds
  if (set === "RuptureFarms" || set === "Lines") anim = `Door_${set}_Closed`;
  x += f.x_offset || 0;
  y += f.y_offset || 0;
  return [draw(c, anim, x, y, { layer, scale })];
});

// a trapdoor or lift platform stands so that its closed frame's top edge meets
// the rect's top (PlatformBase)
const platformY = (c, anim, s) => c.t.y1 + trunc(-bound(c, anim)[1] * s);

const AE_TRAP_THEME = { PV: "Tribal", SV: "Tribal" };
rule("AE", "TrapDoor", (c) => {
  const { t, f } = c;
  if (c.lvl.short === "CR") return [];
  const theme = AE_TRAP_THEME[c.lvl.short];
  const name = (state) => (theme ? `Trap_Door_${theme}_${state}` : `Trap_Door_${state}`);
  const s = c.half ? 0.5 : 1;
  const anim = name(f.start_state === 0 ? "Open" : "Closed");
  return [
    draw(c, anim, mid(t) + (f.x_offset || 0), platformY(c, name("Closed"), s), {
      layer: c.half ? 7 : 26,
      flip: f.direction === 1,
    }),
  ];
});

const AO_TRAP_THEME = {
  R1: "R1",
  R6: "R1",
  R2: "R1",
  D1: "Desert",
  D2: "Desert",
  D7: "Desert",
  C1: "Desert",
};
rule("AO", "TrapDoor", (c) => {
  const { t, f } = c;
  const theme = AO_TRAP_THEME[c.lvl.short] || "Lines";
  const name = (state) => `${theme}_TrapDoor_${state}`;
  const s = c.half ? 0.5 : 1;
  const anim = name(f.start_state === 0 ? "Open" : "Closed");
  return [
    draw(c, anim, mid(t) + (f.x_offset || 0), platformY(c, name("Closed"), s), {
      yOff: 0,
      layer: c.half ? 6 : 25,
      flip: f.direction === 1,
    }),
  ];
});

rule("AE", "SlamDoor", (c) => {
  const { t, f } = c;
  if (f.start_shut !== 1) return [];
  const s = c.half ? 0.5 : 1;
  const x = mid(t);
  const hit = raycastDown(c.lines, x, t.y1, t.y1 + 24, planeTypes(c.half, FLOOR));
  const y = (hit ?? t.y1) + (f.flip_on_y_axis === 1 ? trunc(-68 * s) : 0);
  const theme = AE_VAULTS.has(c.lvl.short) ? "Vault" : "Industrial";
  return [
    draw(c, `Slam_Door_${theme}_Closed`, x, y, {
      layer: c.half ? 6 : 25,
      flipY: f.flip_on_y_axis === 1,
      rgb: [102, 87, 118],
    }),
  ];
});

rule("AE", "Lever", (c) => {
  const { t } = c;
  const x = snapX("AE", mid(t), c.half);
  const hit = raycastDown(c.lines, x, t.y1, t.y1 + 24, planeTypes(c.half, FLOOR));
  return [draw(c, "Lever_Idle", x, hit ?? t.y1, { layer: c.half ? 6 : 25 })];
});

const AO_LEVER = {
  R1: "RuptureFarms_Lever_Idle",
  E2: "RuptureFarms_Lever_Idle",
  R6: "RuptureFarms_Lever_Idle",
  R2: "RuptureFarms_Lever_Idle",
  L1: "Lines_Lever_Idle",
};
rule("AO", "Switch", (c) => [
  draw(c, AO_LEVER[c.lvl.short] || "Lever_Idle", mid(c.t), c.t.y1, { layer: c.half ? 6 : 25 }),
]);

const AE_FOOT = { PV: "Vault", SV: "Vault", BW: "Bonewerkz" };
rule("AE", "FootSwitch", (c) => [
  draw(c, `Foot_Switch_${AE_FOOT[c.lvl.short] || "Industrial"}_Idle`, mid(c.t), c.t.y2, {
    layer: c.half ? 6 : 25,
  }),
]);
rule("AO", "FootSwitch", (c) => [
  draw(c, "Foot_Switch_Temple", c.t.x1 + 12, c.t.y1, { layer: 25 }),
]);

// a rope is one frame tiled upward from its bottom to its top, every segment
// clipped to that span (Rope)
const rope = (c, anim, x, y, top, bottom, s, o = {}) =>
  draw(c, anim, x, y, {
    scale: c.game === "AE" && s === 0.5 ? 0.7 : s,
    layer: s === 1 ? 24 : 5,
    semi: false,
    tile: { top, bottom, step: s === 1 ? 15 : 7 },
    yOff: 0,
    ...o,
  });

const aeRope = (c) => (AE_VAULTS.has(c.lvl.short) ? "AE_Rope@NECROPE" : "AE_Rope");
const AO_R1_ROPE = new Set(["R1", "D1", "D2", "R6", "R2", "D7"]);
const aoRope = (c) => (AO_R1_ROPE.has(c.lvl.short) ? "Rope_R1" : "Rope_Lines");

rule("AE", "PullRingRope", (c) => {
  const { t, f } = c;
  const s = c.half ? 0.5 : 1;
  const len = f.rope_length || 0;
  const x = snapX("AE", mid(t), c.half);
  const y = t.y1 + 24 + len;
  return [
    rope(c, aeRope(c), x + 2, trunc(y - 16 * s), y - len, y, s),
    draw(c, "PullRingRope_Idle", x, y),
  ];
});
const AO_PULLRING_FARMS = new Set(["R1", "R6", "R2"]);
rule("AO", "PullRingRope", (c) => {
  const { t, f } = c;
  const s = c.half ? 0.5 : 1;
  const len = f.rope_length || 0;
  const farms = AO_PULLRING_FARMS.has(c.lvl.short);
  const nudge = farms ? -2 : c.lvl.short === "D1" ? 2 : 0;
  const x = t.x1 + 12;
  const y = len + t.y1 + 24;
  return [
    rope(c, aoRope(c), x + nudge + 1, y + c.yOff, y - len, y + c.yOff, s, { rgb: [128, 128, 128] }),
    draw(c, farms ? "Pullring_Farms_Idle" : "Pullring_Desert_Idle", x, y),
  ];
});

rule("AE", "SlapLock", (c) => [
  draw(c, "SlapLock_Initiate", mid(c.t), c.t.y2, { layer: c.half ? 6 : 25 }),
]);

rule("AE", "WorkWheel", (c) => {
  const { t } = c;
  const s = c.half ? 0.5 : 1;
  const x = mid(t);
  const hit = raycastDown(c.lines, x, t.y1, t.y1 + 24, planeTypes(c.half, FLOOR_WALLS_CEIL));
  return [draw(c, "Work_Wheel_Idle", x, hit ?? t.y1 + 20 * s, { layer: c.half ? 6 : 25 })];
});

// the platform the start-point TLV of a lift column spawns, with its bottom
// wheel, its two ropes and the top wheel at the pulley the column carries
const AO_LIFT = {
  R1: "RuptureFarms",
  R6: "RuptureFarms",
  R2: "RuptureFarms",
  L1: "Lines",
  D1: "Desert",
  D2: "Desert2",
  D7: "Desert2",
};
const AO_LIFT_WHEEL = { Desert2: "Desert" };
const AO_ROPE_NUDGE = { D1: [2, 1], D2: [2, 1], D7: [2, 1] };
// a camera builds its lifts in its list's order, and the factory gives a start
// point none where one already stands within its span (Exoddus also asking for
// the same lift id), so of two start points on one shaft the first builds it
function liftStanding(c) {
  const { t, path, geo } = c;
  const cell = (o) => `${Math.floor(o.x1 / geo.worldW)},${Math.floor(o.y1 / geo.worldH)}`;
  const built = [];
  for (const o of path.tlvs) {
    if (o.name !== "LiftPoint" || o.fields?.start_point !== 1 || cell(o) !== cell(t)) continue;
    const id = o.fields.lift_point_id;
    const standing = built.some(
      (b) => o.x1 <= b.x && b.x <= o.x2 && (c.game === "AO" || b.id === id),
    );
    if (o === t) return standing;
    if (!standing)
      built.push({ x: snapAt({ ...c, half: onBackgroundPlane(c.game, o) }, mid(o)), id });
  }
  return false;
}
function liftPoint(c) {
  const { t, f } = c;
  if (f.start_point !== 1 || liftStanding(c)) return [];
  const ae = c.game === "AE";
  const theme = ae
    ? AE_VAULTS.has(c.lvl.short)
      ? "Necrum"
      : "Mines"
    : AO_LIFT[c.lvl.short] || "Forest";
  const wheelTheme = ae ? theme : AO_LIFT_WHEEL[theme] || theme;
  const s = c.half ? 0.5 : 1;
  const platform = `LiftPlatform_${theme}`;
  const x = snapAt(c, mid(t));
  const y = platformY(c, platform, s);
  const layer = c.half ? 6 : 25;
  const rgb = ae ? (c.lvl.short === "BA" ? [107, 107, 107] : [127, 127, 127]) : [105, 105, 105];
  const wheelRgb = ae ? rgb : [128, 128, 128];
  const out = [];
  const wheel = draw(c, `LiftBottomWheel_${wheelTheme}`, x + 3 * s, y - 5 * s, {
    yOff: 0,
    layer,
    rgb: wheelRgb,
    semi: false,
  });
  const plat = draw(c, platform, x, y, { layer, rgb, yOff: 0 });
  if (ae && c.lvl.short !== "NE") out.push(wheel, plat);
  else out.push(plat, wheel);
  // the pulley: Exoddus walks up the column camera by camera, Oddysee looks in
  // the lift's own camera only
  const grid = c.half ? 13 : 25;
  const col = Math.floor(t.x1 / c.geo.worldW);
  const row = Math.floor(t.y1 / c.geo.worldH);
  const pulleys = c.path.tlvs.filter(
    (p) =>
      p.name === "Pulley" &&
      Math.floor(p.x1 / c.geo.worldW) === col &&
      Math.floor(p.y1 / c.geo.worldH) <= row,
  );
  let pulley = null;
  if (ae) {
    pulley = pulleys
      .filter((p) => p.x1 >= t.x1 + grid / 2 && p.x1 <= t.x2 - grid / 2)
      .sort((a, b) => b.y1 - a.y1)[0];
  } else {
    pulley = pulleys.find(
      (p) => Math.floor(p.y1 / c.geo.worldH) === row && p.x1 >= t.x1 && p.x1 <= t.x2,
    );
  }
  let top = 0;
  if (pulley) {
    top = pulley.y1 - 19 * s;
    const px = trunc((-10 * s + 13 * s) / 2 + Math.floor(x));
    out.push(
      draw(c, `LiftTopWheel_${wheelTheme}`, px, pulley.y1, {
        layer,
        rgb: wheelRgb,
        semi: false,
        yOff: 0,
      }),
    );
  }
  const [n1, n2] = AO_ROPE_NUDGE[c.lvl.short] || [0, 0];
  const bottom = Math.floor(t.y1 + 25 * s);
  const step = s === 1 ? 15 : 7;
  // the engine's phase: a 16.16 remainder read raw, so a fraction of a unit;
  // Exoddus takes it off the near rope and Oddysee adds it to both
  const v = Math.trunc(y * 1.5 * s) / 65536;
  const ropeName = ae ? aeRope(c) : aoRope(c);
  const ropeRgb = ae ? [127, 127, 127] : [128, 128, 128];
  out.push(
    rope(
      c,
      ropeName,
      Math.floor(x + 13 * s + (ae ? 0 : n2)),
      trunc(ae ? 25 * s + y + step - v : y + v - 25 * s + step),
      top,
      bottom,
      s,
      { rgb: ropeRgb },
    ),
    rope(
      c,
      ropeName,
      Math.floor(x - 10 * s + (ae ? 0 : n1)),
      trunc(v + 25 * s + y + step),
      top,
      bottom,
      s,
      { rgb: ropeRgb },
    ),
  );
  return out;
}
both("LiftPoint", liftPoint);

rule("AE", "RockSack", (c) => [draw(c, "RockSack_Idle", mid(c.t), c.t.y2, { semi: false })]);
rule("AO", "RockSack", (c) => [
  draw(
    c,
    AO_STOCKYARDS.has(c.lvl.short) ? "RockSack_Idle@BlueRockSack" : "RockSack_Idle",
    c.t.x1,
    c.t.y1,
    { semi: false },
  ),
]);
rule("AE", "MeatSack", (c) => [
  draw(c, "MeatSack_Idle", c.t.x1, c.t.y1, {
    rgb: NE_TINT(c),
  }),
]);
rule("AO", "MeatSack", (c) => [draw(c, "MeatSack_Idle", c.t.x1, c.t.y1)]);
rule("AE", "BoneBag", (c) => [
  draw(c, "BoneBag_Idle", mid(c.t), c.t.y2, {
    semi: false,
    rgb: NE_TINT(c),
  }),
]);

rule("AE", "FallingItem", (c) => {
  const { t } = c;
  if (c.lvl.short === "CR") return [];
  const anim = c.lvl.short === "BW" ? "FallingCrate_Falling" : "AE_FallingRock_Falling";
  // the item waits no lower than the top of the camera that builds it, the
  // one holding its rect's midpoint, and a camera change removes it, so it
  // shows on that camera's screen alone
  const at = { x: mid(t), y: midY(t) };
  const camTop = Math.floor(at.y / c.geo.worldH) * c.geo.worldH + c.geo.winY;
  return [draw(c, anim, t.x1, Math.min(t.y1, camTop), { layer: c.half ? 12 : 31, camAt: at })];
});
rule("AO", "FallingItem", (c) => {
  const farms = c.lvl.short === "R1" || c.lvl.short === "R2";
  return [
    draw(c, farms ? "FallingMeat_Falling" : "AO_FallingRock_Falling", c.t.x1, c.t.y1, {
      layer: 31,
      rgb: c.lvl.short === "L1" ? [77, 120, 190] : [105, 105, 105],
    }),
  ];
});

rule("AO", "BellHammer", (c) => [
  draw(c, "BellHammer_Idle", c.t.x1 + 82, c.t.y1 + 94, {
    layer: c.half ? 6 : 25,
    flip: c.f.direction === 1,
    semi: false,
  }),
]);

rule("AO", "ChimeLock", (c) => {
  const { t } = c;
  const s = c.half ? 0.5 : 1;
  return [
    ...["BigChime", "MediumChime", "SmallChime"].map((a) =>
      draw(c, a, t.x1, t.y1, { scale: s, layer: 36 }),
    ),
    draw(c, "Chime_Ball", t.x1 + 5, t.y1 + 43, {
      scale: 1,
      layer: 37,
      cycle: { kind: "chime", x: t.x1, y: t.y1 + 40 + c.yOff },
    }),
  ];
});

// an Oddysee well is drawn by the background animation its camera carries
const aoWell = (c) => {
  const id = c.f.animation_id;
  if (!id) return [];
  return [
    draw(c, `bg:${id}`, c.t.x1, c.t.y1, {
      scale: 1,
      layer: c.half ? 4 : 23,
      rgb: [128, 128, 128],
      semi: false,
    }),
  ];
};
rule("AO", "WellLocal", aoWell);
rule("AO", "WellExpress", aoWell);

// ---- hazards and machines -------------------------------------------------

rule("AE", "Mine", (c) => {
  const { t } = c;
  const x = mid(t);
  const hit = raycastDown(c.lines, x, t.y1, t.y1 + 24, planeTypes(c.half, FLOOR));
  const y = hit ?? t.y1;
  const layer = c.half ? 16 : 35;
  return [
    draw(c, "Mine_Flash", x, y, { layer, rgb: [128, 128, 128] }),
    draw(c, "Mine", x, y, { layer }),
  ];
});
rule("AO", "Mine", (c) => {
  const { t } = c;
  const x = t.x1 + 12,
    y = t.y1 + 24;
  const layer = c.half ? 16 : 35;
  const rgb = AO_YARDS_TINT(c, [50, 50, 50], [105, 105, 105]);
  return [
    draw(c, "Mine_Flash", x, y, { layer, rgb: [128, 128, 128] }),
    draw(c, "Mine", x, y, { layer, rgb }),
  ];
});

function uxbCycle(f) {
  let len = f.pattern_length;
  if (!(len >= 1 && len <= 4)) len = 1;
  let pattern = f.pattern || 11111;
  const digits = [];
  for (let i = 0; i < len; i++) digits.push(Math.floor(pattern / 10 ** (len - 1 - i)) % 10);
  return { kind: "uxb", digits };
}
rule("AE", "UXB", (c) => {
  const { t, f } = c;
  const x = mid(t);
  const hit = raycastDown(c.lines, x, t.y1, t.y1 + 24, planeTypes(c.half, FLOOR));
  const y = hit ?? t.y1;
  const s = c.half ? 0.5 : 1;
  const layer = c.half ? 16 : 35;
  const rgb = NE_TINT(c);
  const off = f.start_state === 1;
  return [
    draw(c, off ? "Bomb_RedGreenTick@GreenFlash" : "Bomb_RedGreenTick", x, y - trunc(s * 17), {
      layer,
      rgb: [128, 128, 128],
      blend: 1,
      cycle: off ? null : uxbCycle(f),
    }),
    draw(c, off ? "UXB_Disabled" : "UXB_Active", x, y, { layer, rgb }),
  ];
});
rule("AO", "UXB", (c) => {
  const { t, f } = c;
  const x = t.x1 + 12,
    y = t.y1 + 24;
  const s = c.half ? 0.5 : 1;
  const layer = c.half ? 16 : 35;
  const rgb = AO_YARDS_TINT(c, [80, 90, 110], [105, 105, 105]);
  const off = f.start_state === 1;
  return [
    draw(c, off ? "Bomb_RedGreenTick@GreenFlash" : "Bomb_RedGreenTick", x, y - trunc(s * 12), {
      yOff: 0,
      layer,
      rgb: [128, 128, 128],
      blend: 1,
      cycle: off ? null : uxbCycle(f),
    }),
    draw(c, off ? "UXB_Disabled" : "UXB_Active", x, y, { layer, rgb }),
  ];
});

rule("AO", "TimedMine", (c) => {
  const { t } = c;
  const x = t.x1 + 12,
    y = t.y1 + 24;
  const s = c.half ? 0.5 : 1;
  const layer = c.half ? 16 : 35;
  return [
    draw(c, "Bomb_RedGreenTick", x, y - trunc(s * 14), {
      layer,
      rgb: [128, 128, 128],
      blend: 1,
      yOff: 0,
    }),
    draw(c, "TimedMine_Idle", x, y, { layer, rgb: [105, 105, 105] }),
  ];
});

const AE_BOMB_TINT = { BA: [97, 97, 97] };
const AO_BOMB_TINT = { E1: [30, 30, 55], E2: [30, 30, 55] };
both("MovingBomb", (c) => {
  const { t, f } = c;
  if (f.triggered_by_alarm === 1) return []; // hidden until the alarm
  const hit = raycastDiag(c.lines, t.x1, t.y1, t.x1 + 24, t.y1 + 24, TRACK);
  const x = hit ? hit.x : t.x1,
    y = hit ? hit.y : t.y1;
  const rgb =
    c.game === "AE"
      ? tint(AE_BOMB_TINT, c.lvl.short, [127, 127, 127])
      : tint(AO_BOMB_TINT, c.lvl.short, [127, 127, 127]);
  // only a bomb whose switch is the always-on id 1 sets off at a fresh start
  const switchId = f.start_moving_switch_id ?? f.switch_id;
  const p = { speed: f.speed / 256, startSpeed: f.start_speed / 256, switchId };
  return [
    draw(c, "MovingBomb", x, y, {
      yOff: 0,
      layer: c.half ? 16 : 35,
      rgb,
      cycle: switchId === 1 ? patrol(c, "bomb", p, { x: t.x1, y: t.y1 }) : null,
    }),
  ];
});

both("ElectricWall", (c) => {
  const { t, f } = c;
  if (f.start_state !== 1) return []; // off until its switch flips
  return [
    draw(c, "Electric_Wall", t.x1, t.y1, {
      layer: 36,
      rgb: [80, 80, 80],
      blend: 1,
      cycle: { kind: "flip8" },
    }),
  ];
});

rule("AO", "MeatSaw", (c) => {
  const { t, f } = c;
  const x = t.x1 + 8;
  const rise = f.max_rise_time || 0;
  const layer = c.half ? 5 : 24;
  const p = {
    type: f.type,
    start: f.start_state,
    speed: f.speed,
    offSpeed: f.off_speed,
    maxRise: rise,
    switchMin: f.switch_min_time_off,
    switchMax: f.switch_max_time_off,
    autoMin: f.automatic_min_time_off,
    autoMax: f.automatic_max_time_off,
    initial: f.initial_position === 1,
    switchId: f.switch_id,
  };
  return [
    draw(c, "MeatSaw_Idle", x, t.y1 - rise, {
      layer,
      cycle: brain(c, "meatsaw", false, p),
      yOff: 0,
    }),
    draw(c, "MeatSawMotor", x, t.y1, { layer, semi: true, yOff: 0 }),
  ];
});

// the drill's stroke is the brain's: the record stands at the base of its travel
rule("AE", "Drill", (c) => {
  const { t, f } = c;
  const dir = f.start_direction;
  const vertical = dir === 0;
  const p = {
    behavior: f.behavior,
    startOn: f.start_state_on === 1,
    speed: f.speed === 250 ? 0.2 : f.speed,
    offSpeed: f.off_speed === 250 ? 0.2 : f.off_speed,
    minOff: f.min_off_time,
    maxOff: f.max_off_time,
    minOffChange: f.min_off_time_speed_change,
    maxOffChange: f.max_off_time_speed_change,
    startBottom: f.start_position_bottom === 1,
    direction: dir,
    width: vertical ? t.y2 - t.y1 : t.x2 - t.x1,
    switchId: f.switch_id,
  };
  return [
    draw(
      c,
      vertical ? "Drill_Vertical_Off" : "Drill_Horizontal_Off",
      dir === 2 ? t.x2 - 12 : t.x1 + 12,
      t.y2,
      {
        layer: c.half ? 5 : 24,
        rgb: NE_TINT(c),
        flip: dir === 2,
        cycle: brain(c, "drill", false, p),
      },
    ),
  ];
});

// the detector's flare where the device sits and the laser sweeping the rect
both("MotionDetector", (c) => {
  const { t, f } = c;
  const ae = c.game === "AE";
  const s = c.half ? 0.5 : 1;
  const out = [];
  if (f.draw_flare === 1) {
    let fx, fy;
    if (ae) {
      const abe = c.abeStart || [0, 0];
      [fx, fy] = f.device_x ? [f.device_x - abe[0], f.device_y - abe[1]] : [t.x1, t.y1];
    } else [fx, fy] = [f.device_x + 11, f.device_y];
    out.push(
      draw(c, "MotionDetector_Flare", fx, fy, {
        yOff: 0,
        scale: s,
        layer: 36,
        rgb: [64, 0, 0],
        blend: 1,
        swap: !ae,
      }),
    );
  }
  const speed = (f.speed || 0) / 256;
  const left = f.initial_move_direction === 1;
  out.push(
    draw(c, "MotionDetector_Laser", left ? t.x2 : t.x1, t.y2, {
      yOff: 0,
      scale: s,
      layer: 36,
      blend: 1,
      cycle: speed > 0 && t.x2 > t.x1 ? { kind: "laser", x1: t.x1, x2: t.x2, speed, left } : null,
    }),
  );
  return out;
});

const AE_ORB_TINT = { NE: [137, 137, 137] };
const securityOrbAE = (c) => [
  draw(c, "Security_Orb", c.t.x1, c.t.y1, { rgb: tint(AE_ORB_TINT, c.lvl.short, [127, 127, 127]) }),
];
rule("AE", "SecurityOrb", securityOrbAE);
rule("AE", "SecurityClaw", securityOrbAE);
rule("AO", "SecurityOrb", (c) => [draw(c, "Security_Orb", c.t.x1, c.t.y1, { layer: 27 })]);
rule("AO", "SecurityClaw", (c) => {
  const { t } = c;
  const s = c.half ? 0.5 : 1;
  const yards = AO_STOCKYARDS.has(c.lvl.short);
  return [
    draw(c, "Security_Claw_Lower_Idle", t.x1, t.y1, {
      layer: c.half ? 9 : 28,
      rgb: yards ? [80, 55, 55] : [127, 127, 127],
    }),
    draw(c, "Security_Claw_Upper_Rotating", t.x1, t.y1 + 8 * s, {
      layer: 27,
      rgb: yards ? [105, 55, 55] : [127, 127, 127],
    }),
  ];
});

const ZBALL_SPEED = ["Normal", "Fast", "Slow"];
const ZBALL_START = [6, 0, 13];
rule("AO", "ZBall", (c) => {
  if (c.lvl.short !== "F2") return [];
  const { t, f } = c;
  return [
    draw(c, `Swinging_Ball_${ZBALL_SPEED[f.speed] || "Normal"}`, t.x1, t.y1, {
      layer: 27,
      rgb: [128, 128, 128],
      frame: ZBALL_START[f.start_position] ?? 0,
    }),
  ];
});

both("BoomMachine", (c) => {
  const { t, f } = c;
  const ae = c.game === "AE";
  const s = c.half ? 0.5 : 1;
  const x = t.x1 + (c.half ? 6.5 : 12.5);
  const y = t.y1;
  const left = f.nozzle_side === 1;
  const rgb = ae ? [127, 127, 127] : [105, 105, 105];
  return [
    draw(c, "BoomMachine_Pipe_Idle", x + (left ? -1 : 1) * 30 * s, y - 30 * s, {
      scale: s,
      layer: 27,
      rgb,
      semi: false,
      flip: left,
    }),
    draw(c, "BoomMachine_Button_On", x, y, { scale: s, layer: 27, rgb, blend: 1, yOff: 0 }),
  ];
});

rule("AE", "BrewMachine", (c) => [
  draw(c, "BrewMachine_Button", mid(c.t), c.t.y1, { scale: 1, layer: 23 }),
]);

const AO_FLINTLOCK = new Set(["L1", "F2", "D2"]);
rule("AO", "FlintLockFire", (c) => {
  if (!AO_FLINTLOCK.has(c.lvl.short)) return [];
  const { t } = c;
  const layer = c.half ? 6 : 25;
  return [
    draw(c, "FlintLock_Hammers_Disabled", t.x1, t.y1, { layer }),
    draw(c, "FlintLock_Gourd", t.x1, t.y1, { layer, frozen: true }),
  ];
});

rule("AO", "RollingBall", (c) => {
  const { t, f } = c;
  const hit = raycastDown(c.lines, t.x1, t.y1, t.y1 + 24, planeTypes(c.half, FLOOR));
  return [
    draw(c, "Stone_Ball", snapAt(c, t.x1), hit ?? t.y1, {
      layer: c.half ? 12 : 31,
      flip: f.roll_direction === 0,
    }),
  ];
});
rule("AO", "RollingBallStopper", (c) => [
  draw(c, "Stone_Ball_Stopper", c.t.x1, c.t.y1, { layer: 37, flip: c.f.direction === 0 }),
]);

// an Oddysee light effect is one of the door lights; the star draws nothing
const AO_LIGHT = {
  1: "GoldGlow",
  2: "GreenGlow",
  3: "FlintGlow",
  4: "RedDoorLight",
  5: "RedHubLight",
};
rule("AO", "LightEffect", (c) => {
  const { t, f } = c;
  const anim = AO_LIGHT[f.type];
  if (!anim) return [];
  const flip = f.direction === 0;
  const xoff = f.type === 4 ? 6 : 0;
  // the sheet at the pulse's peak; the pulse itself is the additive pass's alpha.
  // The flint glow is the switchable light, red until its switch is thrown
  return [
    draw(c, anim, t.x1 + (flip ? -xoff : xoff), t.y1, {
      scale: 1,
      layer: 17,
      flip,
      blend: 3,
      rgb: f.type === 3 ? [255, 32, 32] : [255, 255, 255],
      cycle: { kind: "pulse" },
    }),
  ];
});

const AE_BG_LAYER = { 0: 1, 1: 20, 2: 39 };
both("BackgroundAnimation", (c) => {
  const { t, f } = c;
  if (!f.animation_id) return [];
  const ae = c.game === "AE";
  return [
    draw(c, `bg:${f.animation_id}`, t.x1, t.y1, {
      yOff: 0,
      scale: 1,
      layer: ae ? (AE_BG_LAYER[f.layer] ?? 27) : 1,
      semi: f.is_semi_trans === 1,
      blend: f.semi_trans_mode || 0,
    }),
  ];
});

// ---- creatures --------------------------------------------------------------

// the render offset the engine stacks same-type objects by: the n-th of a kind
// in a camera takes the n-th entry, scaled in Exoddus (StackOnObjectsOfType)
const STACK = [0, 3, -3, 6, -6, 2];
function stackOffset(c) {
  const { t, path, geo } = c;
  const cell = (o) => `${Math.floor(o.x1 / geo.worldW)},${Math.floor(o.y1 / geo.worldH)}`;
  const here = cell(t);
  let n = 0;
  for (const o of path.tlvs) {
    if (o === t) break;
    if (o.name === t.name && cell(o) === here) n++;
  }
  const s = c.game === "AE" ? (c.half ? 0.5 : 1) : 1;
  return trunc(STACK[n % 6] * s);
}
const camOf = (c, t) =>
  c.path.cams.find(
    (cm) =>
      cm.cell === Math.floor(t.y1 / c.geo.worldH) * c.path.w + Math.floor(t.x1 / c.geo.worldW),
  );

both("Slig", (c) => {
  const { t, f } = c;
  const ae = c.game === "AE";
  const hit = raycastDown(c.lines, t.x1, t.y1, t.y1 + 24, planeTypes(c.half, FLOOR));
  const spawnX = snapAt(c, t.x1);
  // one Bonewerkz screen stands its sligs unstacked
  const unstacked =
    ae && c.lvl.short === "BW" && c.path.id === 2 && camOf(c, t)?.name?.endsWith("C05");
  const x = spawnX + (unstacked ? 0 : stackOffset(c));
  const y = hit ?? t.y1;
  const asleep = f.start_state === 2;
  const yards = !ae && AO_STOCKYARDS.has(c.lvl.short);
  const anim = (asleep ? "Slig_Sleeping" : "Slig_Idle") + (yards ? "@StockYardsSlig" : "");
  const rgb = ae ? [102, 127, 118] : yards ? [127, 127, 127] : [105, 105, 105];
  let cycle = asleep ? brain(c, "sligSleep") : null;
  if (f.start_state === 1) {
    const { left, right } = sligBounds(t, c.path, c.geo, c.game);
    // a side with none reads zero, as Oddysee's decomp clears the zone before
    // its scan; a slig there that no bound matched at all takes the decomp's
    // hack values
    const zone =
      ae || left || right ? { x: left?.x1 ?? 0, w: right?.x1 ?? 0 } : { x: 12809, w: 6405 };
    const p = {
      pauseTime: f.pause_time,
      leftMin: f.pause_left_min,
      leftMax: f.pause_left_max,
      rightMin: f.pause_right_min,
      rightMax: f.pause_right_max,
      zone,
    };
    cycle = patrol(c, "slig", p, { x: spawnX, y: t.y1 });
  }
  return [
    draw(c, anim, x, y, { layer: c.half ? 14 : 33, flip: f.start_direction === 0, rgb, cycle }),
  ];
});

const locker = (c) => [
  draw(c, "CrawlingSligLocker_Closed", mid(c.t), c.t.y2, { layer: c.half ? 6 : 25 }),
];
rule("AE", "SligGetPants", locker);
rule("AE", "SligGetWings", locker);

rule("AE", "CrawlingSlig", (c) => {
  const { t, f } = c;
  const x = mid(t);
  const hit = raycastDown(c.lines, x, t.y1, t.y1 + 37, planeTypes(c.half, FLOOR));
  const awake = f.state === 2;
  return [
    draw(c, awake ? "CrawlingSlig_Idle" : "CrawlingSlig_Snoozing", x, hit ?? t.y1, {
      layer: awake ? (c.half ? 8 : 27) : c.half ? 6 : 25,
      rgb: NE_TINT(c),
      cycle: awake ? null : brain(c, "crawlSleep"),
    }),
  ];
});
// a spawner draws nothing itself: its brain breathes out the Zs
rule("AE", "ZzzSpawner", (c) => [
  draw(c, null, c.t.x1, c.t.y1, {
    cycle: brain(c, "zzz", false, {
      switchId: c.f.switch_id,
      interval: c.f.zzz_interval,
      layer: 39,
      scale: c.half ? 0.5 : 1,
    }),
  }),
]);
rule("AE", "CrawlingSligButton", (c) => [
  draw(c, "CrawlingSligButton", mid(c.t), c.t.y2, { layer: c.half ? 6 : 25 }),
]);

// a flying slig hangs twenty units under the track line its rect's diagonal
// crosses, and bobs about that
rule("AE", "FlyingSlig", (c) => {
  const { t, f } = c;
  const hit = raycastDiag(c.lines, t.x1, t.y1, t.x2, t.y2, TRACK);
  if (!hit) return [];
  const p = {
    left: f.start_direction === 0,
    delayed: f.spawn_delay_state === 1,
    delay: f.spawn_move_delay,
    pauseMin: f.patrol_pause_min,
    pauseMax: f.patrol_pause_max,
    maxSpeed: f.max_velocity,
  };
  return [
    draw(c, "FlyingSlig_Idle", hit.line[0], hit.line[1] + 20 * (c.half ? 0.5 : 1), {
      layer: c.half ? 14 : 33,
      flip: f.start_direction === 0,
      cycle: patrol(c, "flyslig", p, { x1: t.x1, y1: t.y1, x2: t.x2, y2: t.y2 }),
    }),
  ];
});

both("Slog", (c) => {
  const { t, f } = c;
  const ae = c.game === "AE";
  const hit = raycastDown(c.lines, t.x1, t.y1, t.y1 + 24, ae ? FLOOR : planeTypes(c.half, FLOOR));
  const x = t.x1 + (ae ? stackOffset(c) : 0);
  const y = hit ?? t.y1;
  const rgb = ae ? [127, 127, 127] : AO_YARDS_TINT(c, [48, 48, 48], [127, 127, 127]);
  const asleep = f.asleep === 1;
  return [
    draw(c, asleep ? "Slog_Sleeping" : "Slog_Idle", x, y, {
      yOff: ae ? (c.half ? 2 : 1) : c.yOff,
      layer: ae ? 34 : c.half ? 15 : 34,
      flip: f.start_direction === 0,
      rgb,
      cycle: brain(c, asleep ? "slogSleep" : "slog"),
    }),
  ];
});

both("Scrab", (c) => {
  const { t, f } = c;
  const ae = c.game === "AE";
  let x = t.x1 + 12;
  const hit = raycastDown(c.lines, x, t.y1, t.y1 + 30, planeTypes(c.half, FLOOR));
  if (hit !== null) x = snapAt(c, x);
  const anim = ae && hit === null ? "Scrab_JumpAndRunToFall" : "Scrab_Idle";
  const rgb = ae ? NE_TINT(c) : [127, 127, 127];
  const p = {
    chance: ae ? f.patrol_type_run_or_walk_chance : f.patrol_type,
    leftMin: f.left_min_delay,
    leftMax: f.left_max_delay,
    rightMin: f.right_min_delay,
    rightMax: f.right_max_delay,
  };
  return [
    draw(c, anim, x, hit ?? t.y1, {
      rgb,
      cycle: hit === null ? null : patrol(c, "scrab", p, { x, y: t.y1 }),
    }),
  ];
});

both("Paramite", (c) => {
  const { t, f } = c;
  const ae = c.game === "AE";
  if (ae && f.entrance_type >= 2) return []; // hidden until it drops from its web
  let x = ae ? t.x1 + 12 : t.x1;
  const hit = raycastDown(c.lines, x, t.y1, t.y1 + 24, ae ? planeTypes(c.half, FLOOR) : FLOOR);
  if (ae || f.enter_from_web === 1) x = snapAt(c, x);
  x += stackOffset(c);
  const patrol = ae ? f.entrance_type === 0 : f.enter_from_web === 0;
  return [
    draw(c, "Paramite_Idle", x, hit ?? t.y1, {
      rgb: [105, 105, 105],
      cycle: patrol ? brain(c, "paramite") : null,
    }),
  ];
});

// the web a paramite drops down: one segment tiled along the track line
rule("AE", "ParamiteWebLine", (c) => {
  const { t } = c;
  const hit = raycastDiag(c.lines, t.x1, t.y1, t.x1 + 20, t.y1 + 20, TRACK);
  if (!hit) return [];
  const [lx, ly1, , ly2] = hit.line;
  const camTop = Math.floor(t.y1 / c.geo.worldH) * c.geo.worldH + c.geo.winY;
  const top = Math.max(Math.min(ly1, ly2), camTop);
  const bottom = Math.min(Math.max(ly1, ly2), camTop + 240);
  const s = c.half ? 0.7 : 1;
  return [
    draw(c, "ParamiteWeb", lx, bottom, {
      scale: s,
      layer: c.half ? 5 : 24,
      rgb: c.half ? [50, 50, 200] : [10, 10, 10],
      semi: false,
      tile: { top, bottom, step: c.half ? 7 : 15 },
    }),
  ];
});

rule("AE", "Fleech", (c) => {
  const { t, f } = c;
  const hit = raycastDown(c.lines, t.x1, t.y1, t.y1 + 24, planeTypes(c.half, FLOOR));
  const spawnX = snapAt(c, t.x1);
  let x = spawnX + stackOffset(c);
  let y = hit ?? t.y1;
  let anim = f.asleep === 1 ? "Fleech_Sleeping" : "Fleech_Idle";
  let cycle = null;
  if (f.hanging === 1) {
    anim = "Fleech_SleepingWithTongue";
    x = mid(t);
    y += t.y2 - t.y1;
    cycle = brain(c, "fleechHang");
  } else if (f.asleep === 1) cycle = brain(c, "fleechSleep");
  else {
    const p = {
      goesToSleep: f.goes_to_sleep === 1,
      increaser: f.attack_anger_increaser + 2,
      range: (f.patrol_range || 0) * (c.half ? 13 : 25),
    };
    cycle = patrol(c, "fleech", p, { x: spawnX, y: t.y1 });
  }
  return [
    draw(c, anim, x, y, {
      layer: c.half ? 15 : 34,
      flip: f.start_direction === 0,
      rgb: NE_TINT(c),
      cycle,
    }),
  ];
});

rule("AE", "Slurg", (c) => {
  const { t, f } = c;
  const x = mid(t) + stackOffset({ ...c, half: false });
  const hit = raycastDown(c.lines, x, t.y1, t.y1 + 24, planeTypes(c.half, FLOOR));
  const p = { delay: f.time_until_turning_around, right: f.start_direction === 1 };
  // the half-scale slurg keeps a full-size sprite on the half layer
  return [
    draw(c, "Slurg_Move", x, hit ?? t.y1, {
      scale: 1,
      layer: c.half ? 14 : 33,
      rgb: [102, 127, 118],
      cycle: patrol(c, "slurg", p, { x: mid(t), y: t.y1 }),
    }),
  ];
});

rule("AE", "Greeter", (c) => {
  const { t, f } = c;
  const s = c.half ? 0.5 : 1;
  const x = mid(t);
  const hit = raycastDown(c.lines, x, t.y1, t.y1 + 24, planeTypes(c.half, FLOOR));
  const y = hit ?? t.y1;
  // the three records run one brain, each reading its own part of it
  const part = (name) => patrol(c, "greeter", { part: name }, { x, y: t.y1 });
  return [
    draw(c, "Greeter_Moving", x, y, {
      layer: c.half ? 14 : 33,
      flip: f.start_direction === 0,
      cycle: part("body"),
    }),
    draw(c, "MotionDetector_Flare", x, y - 20 * s, {
      scale: s,
      layer: 36,
      rgb: [64, 0, 0],
      blend: 1,
      cycle: part("flare"),
    }),
    draw(c, "MotionDetector_Laser", x, y, { scale: s, layer: 36, blend: 1, cycle: part("laser") }),
  ];
});

rule("AO", "Bat", (c) => {
  const { t, f } = c;
  const hit = raycastDiag(c.lines, t.x1, t.y1, t.x2, t.y2, TRACK);
  if (!hit) return [];
  const p = { wait: f.ticks_before_moving, speed: f.speed / 256 };
  return [
    draw(c, "Bat", hit.line[0], hit.line[1], {
      layer: c.half ? 6 : 25,
      cycle: patrol(c, "bat", p, { x1: t.x1, y1: t.y1, x2: t.x2, y2: t.y2 }),
    }),
  ];
});

// the flies hover about the hint's point; the hint itself waits on Abe's chant
rule("AO", "HintFly", (c) => [
  draw(c, null, c.t.x1, c.t.y1, { cycle: brain(c, "hintfly"), yOff: 0 }),
]);

// an LCD screen scrolls its messages in the game's font, by the lcd brain; one
// whose fixed message and whole random range are blank runs dark and draws
// nothing
rule("AO", "LCDScreen", lcdScreen);
rule("AE", "LCD", lcdScreen);
function lcdScreen(c) {
  const table = lcdMessages(c.game);
  if (!table || !c.font) return [];
  const { t, f } = c;
  const p = {
    x1: t.x1,
    x2: t.x2,
    y: midY(t) - 7,
    font: c.font,
    table,
    fixed1: f.message_1_id ?? 0,
    fixed2: f.message_2_id ?? null,
    sw: f.toggle_message_switch_id ?? 0,
    pool: [f.random_message_min_id ?? 0, f.random_message_max_id ?? 0],
  };
  if (lcdIds(p).every((id) => !table[id])) return [];
  const layer = c.game === "AO" ? 22 : 24;
  return [draw(c, null, t.x1, midY(t), { yOff: 0, layer, cycle: brain(c, "lcd", false, p) })];
}

// a tally board counts as a fresh game does, nobody rescued and nobody killed.
// The one object that writes a counter on loading, the Stockyards entrance's
// KillUnsavedMuds, counts its kills for a board on its own screen
const KILL_UNSAVED = 28;
const pad = (n, width, fill) => String(n).padStart(width, fill);
both("LCDStatusBoard", tallyBoard);
function tallyBoard(c) {
  const { t, f } = c;
  if (!c.font || f.hide_board) return [];
  let lines;
  if (c.game === "AO") {
    const cell = tlvCell(t, c.path, c.geo);
    const killed = c.path.tlvs.some(
      (o) => o.name === "KillUnsavedMuds" && tlvCell(o, c.path, c.geo) === cell,
    )
      ? KILL_UNSAVED
      : 0;
    lines = [AO_MUDOKONS - killed, killed, 0].map((n) => pad(n, 2, "0"));
  } else {
    const inLevel = AE_MUDOKONS_IN_LEVEL[c.lvl.id] ?? 0;
    lines = [inLevel, f.number_of_mudokons ?? 0, 0, 0].map((n) => pad(n, 3, " "));
  }
  const p = { x1: t.x1, y1: t.y1, font: c.font, lines, edge: TALLY_EDGE[c.game] };
  return [draw(c, null, t.x1, t.y1, { yOff: 0, layer: 22, cycle: brain(c, "tally", false, p) })];
}
rule("AO", "Honey", (c) => [
  draw(c, "Honey", c.t.x1 + trunc((c.t.x2 - c.t.x1) / 2), c.t.y1 + 24, {
    scale: 1,
    layer: 27,
    rgb: [128, 128, 128],
  }),
]);
rule("AO", "HoneySack", (c) => [draw(c, "HoneySack_Hanging", c.t.x1, c.t.y1, { layer: 31 })]);

// ---- Mudokons, Glukkons and the rest ----------------------------------------

// a mudokon stands where the rect's diagonal crosses the floor
const AO_MUD_JOB = {
  0: "Mudokon_StandScrubLoop",
  1: "Mudokon_CrouchScrub",
  2: "Mudokon_CrouchChant",
};
const AO_MUD_BRAIN = { 0: "standscrub", 1: "crouchscrub", 2: "chant" };
const aoMudTint = (c) => AO_YARDS_TINT(c, [25, 25, 25], [87, 103, 67]);
function mudokonAO(c, anim, snap, flip, xNudge = 0, cycle = null) {
  const { t } = c;
  const hit = raycastDiag(c.lines, t.x1, t.y1, t.x2, t.y2, planeTypes(c.half, FLOOR_WALLS));
  let x = mid(t);
  if (snap) x = snapAt(c, x);
  x += xNudge;
  return [
    draw(c, anim, x, hit ? hit.y : t.y2, {
      layer: c.half ? 13 : 32,
      flip,
      rgb: aoMudTint(c),
      cycle,
    }),
  ];
}
rule("AO", "Mudokon", (c) => {
  const { f } = c;
  const job = AO_MUD_BRAIN[f.job];
  return mudokonAO(
    c,
    AO_MUD_JOB[f.job] || "Mudokon_Idle",
    f.job === 0 || f.job === 1,
    f.start_direction === 0,
    0,
    job ? brain(c, job) : null,
  );
});
rule("AO", "LiftMudokon", (c) => mudokonAO(c, "Mudokon_Idle", false, c.f.start_direction === 1));
rule("AO", "RingMudokon", (c) =>
  mudokonAO(c, "Mudokon_Idle", false, c.f.start_direction === 0, c.f.action === 0 ? 8 : 0),
);

const AE_MUD_STATE = { 0: "Mudokon_Chisel", 1: "Mudokon_CrouchScrub" };
const AE_MUD_BRAIN = { 0: "chisel", 1: "scrub" };
rule("AE", "Mudokon", (c) => {
  const { t, f } = c;
  const hit = raycastDiag(c.lines, t.x1, t.y1, t.x2, t.y2, planeTypes(c.half, FLOOR));
  let anim,
    snap = false,
    cycle = null;
  if (f.emotion === 4) anim = "Mudokon_CrouchIdle";
  else if (f.emotion === 3) anim = "Mudokon_Idle";
  else {
    anim = AE_MUD_STATE[f.state] || "Mudokon_Idle";
    snap = f.state === 0 || f.state === 1;
    if (AE_MUD_BRAIN[f.state])
      cycle = brain(c, AE_MUD_BRAIN[f.state], f.emotion !== 0, { sad: f.emotion === 2 });
  }
  let x = mid(t);
  if (snap) x = snapAt(c, x);
  // the constructor stacks before it sets the scale, so at full size
  x += stackOffset({ ...c, half: false });
  const blind = f.blind === 1;
  return [
    draw(c, anim + (blind ? "@BlindMud" : ""), x, hit ? hit.y : t.y2, {
      layer: c.half ? 9 : 28,
      flip: f.start_direction === 0,
      rgb: blind ? [63, 63, 63] : [87, 103, 67],
      cycle,
    }),
  ];
});

rule("AE", "TorturedMudokon", (c) => [
  draw(c, "Tortured_Mudokon", c.t.x1, c.t.y1, { scale: 1, layer: 27 }),
  draw(c, "Tortured_Mudokon_Tears", c.t.x1, c.t.y1, { scale: 1, layer: 27, rgb: [128, 128, 128] }),
]);

const GLUKKON_TYPE = { 1: "Aslik", 2: "Dripik", 3: "Phleg" };
rule("AE", "Glukkon", (c) => {
  const { t, f } = c;
  if (f.spawn_switch_id) return []; // waits unseen for its switch
  const x = mid(t);
  const hit = raycastDown(c.lines, x, t.y1, t.y1 + 79, planeTypes(c.half, FLOOR));
  const type = GLUKKON_TYPE[f.glukkon_type] || "Normal";
  return [
    draw(c, `Glukkon_${type}_Idle`, x, hit ?? t.y1, {
      flip: f.start_direction === 1,
      rgb: [137, 137, 137],
      cycle: patrol(c, "glukkon", { type, checkWalls: f.behavior === 1 }, { x, y: t.y1 }),
    }),
  ];
});
const AO_GLUKKON_PAL = { 825: "@GlukRed", 826: "@GlukGreen", 827: "@GlukBlue", 828: "@GlukAqua" };
rule("AO", "Glukkon", (c) => [
  draw(c, "Background_Glukkon_Idle" + (AO_GLUKKON_PAL[c.f.pal_id] || ""), c.t.x1, c.t.y1, {
    scale: (c.f.scale_percent || 100) / 100,
    layer: 27,
    cycle: brain(c, "glukkonAO"),
  }),
]);

// a dove placed by hand sits where the rect says; one scattered at random sits
// at the rect's middle, the expected spot
both("Dove", (c) => {
  const { t, f } = c;
  const ae = c.game === "AE";
  const [x, y] = f.pixel_perfect === 1 ? [t.x1, t.y1 + 10] : [mid(t), midY(t) + 10];
  const rgb = ae ? [127, 127, 127] : AO_YARDS_TINT(c, [30, 30, 30], [105, 105, 105]);
  return [draw(c, "Dove_Idle", x, y, { semi: false, rgb })];
});

rule("AE", "MineCar", (c) => {
  const { t } = c;
  const x = snapAt(c, t.x1);
  const hit = raycastDown(c.lines, x, t.y1, t.y1 + 24, planeTypes(c.half, FLOOR));
  const y = hit ?? t.y1;
  const layer = c.half ? 7 : 26;
  return [
    draw(c, "Mine_Car_Tread_Idle", x, y, { layer, rgb: [128, 128, 128] }),
    draw(c, "Mine_Car_Open", x, y, { layer }),
  ];
});

const AO_ABE_TINT = { E1: [25, 25, 25], E2: [25, 25, 25], D1: [125, 125, 95], D2: [120, 120, 90] };
const AE_ABE_TINT = {
  NE: [102, 102, 80],
  PV: [120, 90, 120],
  SV: [102, 70, 90],
  FD: [120, 102, 82],
};
// Abe starts in a fall from the rect's top and lands on the floor beneath,
// within the screen the rect sits on
both("AbeStart", (c) => {
  const { t } = c;
  const ae = c.game === "AE";
  const rgb = tint(ae ? AE_ABE_TINT : AO_ABE_TINT, c.lvl.short, [102, 102, 102]);
  const x = t.x1 + 12;
  const bottom = Math.floor(t.y1 / c.geo.worldH) * c.geo.worldH + c.geo.winY + c.geo.visH;
  const hit = raycastDown(c.lines, x, t.y1, bottom, planeTypes(false, FLOOR));
  return [draw(c, "Mudokon_Idle", x, hit ?? t.y1, { scale: 1, layer: 32, rgb })];
});

// a portal's six doves circle its anchor; an Abe portal's ring breathes
both("BirdPortal", (c) => {
  const { t, f } = c;
  const ae = c.game === "AE";
  if (ae && f.create_portal_switch_id > 1) return []; // waits unseen for its switch
  const s = c.half ? 0.5 : 1;
  const hit = raycastDiag(
    c.lines,
    t.x1,
    t.y1,
    t.x2,
    t.y2,
    ae ? planeTypes(c.half, FLOOR) : ALL_LINES,
  );
  if (!hit) return [];
  const px = ae ? mid(t) : t.x1;
  const py = hit.y - 55 * s;
  const rgb = ae ? [127, 127, 127] : AO_YARDS_TINT(c, [30, 30, 30], [105, 105, 105]);
  const abe = f.portal_type === 0 ? (ae ? { width: 0, dir: 1 } : { width: 30, dir: -1 }) : null;
  const out = [];
  for (let i = 0; i < 6; i++)
    out.push(
      draw(c, "Dove_Flying", px, py + 30 * s, {
        semi: false,
        rgb,
        cycle: {
          kind: "orbit",
          cx: px,
          cy: py + 30 * s + c.yOff,
          phase: 42 * i,
          rx: 30 * s,
          ry: 35 * s,
          abe,
        },
      }),
    );
  return out;
});

// every record a placed object draws, or [] for a type without a sprite
export function spriteDraws(data, lvl, path, t, set) {
  const fn = rules[data.id]?.[t.name];
  if (!fn) return [];
  const c = {
    game: data.id,
    geo: data.geometry,
    lvl,
    path,
    lines: path.lines,
    links: set.links?.[lvl.short]?.[path.id] ?? null,
    t,
    index: path.tlvs.indexOf(t),
    f: t.fields || {},
    half: onBackgroundPlane(data.id, t),
    yOff: data.id === "AO" ? 5 : 0,
    anims: set.anims,
    font: set.font ?? null,
    abeStart: set.abe?.[lvl.short]?.[path.id],
  };
  return fn(c) || [];
}

export const spriteTypes = (gameId) => Object.keys(rules[gameId] || {});
