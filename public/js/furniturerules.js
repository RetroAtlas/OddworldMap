import { onBackgroundPlane } from "./fields.js";
import { raycastDown, snapX } from "./engine/collide.js";
import { filedAt, filedCell } from "./model.js";
import {
  FLOOR,
  FLOOR_WALLS,
  FLOOR_WALLS_CEIL,
  planeTypes,
  snapAt,
  trunc,
  mid,
  cellOf,
  AE_VAULTS,
  AO_STOCKYARDS,
  NE_TINT,
  brain,
  draw,
  bound,
  rules,
  rule,
  both,
} from "./spritekit.js";

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
// wheel, its two ropes and the top wheel at the pulley the column carries; the
// wheels turn only while the lift moves
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
  const cell = (o) => filedCell(o, path, geo, c.game);
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
    frozen: true,
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
        frozen: true,
      }),
    );
  }
  const [n1, n2] = AO_ROPE_NUDGE[c.lvl.short] || [0, 0];
  const bottom = Math.floor(t.y1 + 25 * s);
  const step = s === 1 ? 15 : 7;
  // the ropes hang as the update rehangs them each tick, the phase a 16.16
  // remainder read raw
  const v = Math.trunc(y * 1.5 * s) / 65536;
  const ropeName = ae ? aeRope(c) : aoRope(c);
  const ropeRgb = ae ? [127, 127, 127] : [128, 128, 128];
  out.push(
    rope(
      c,
      ropeName,
      Math.floor(x + 13 * s + (ae ? 0 : n2)),
      trunc(25 * s + y + step - v),
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

// a falling item stands in its first art until its switch reads on and in its
// second from then; a camera change removes one that is not falling, so it
// shows on the screen of the camera that builds it alone, the one whose list
// holds it, and it retires after a fall where its rect's foot lies off that
// screen
function fallingItem(c, [art, waiting], y, debris, blast = false) {
  const { t, f, geo } = c;
  const cam = filedAt(t, c.game);
  const left = Math.floor(cam.x / geo.worldW) * geo.worldW + geo.winX;
  const top = Math.floor(cam.y / geo.worldH) * geo.worldH + geo.winY;
  const win = [left, top, left + geo.visW, top + geo.visH];
  const [fx, fy] = [mid(t), t.y2];
  const p = {
    switchId: f.switch_id,
    interval: f.fall_interval,
    max: f.max_falling_items,
    reset: f.reset_switch_id_after_use === 1,
    art,
    waiting,
    x: t.x1,
    y,
    lines: c.lines,
    floor: planeTypes(c.half, FLOOR),
    win,
    cam,
    stays: fx >= win[0] && fx <= win[2] && fy >= win[1] && fy <= win[3],
    debris,
    blast,
    stoppers: stoppers(c, cam),
  };
  return { cam, cycle: brain(c, "fallingItem", false, p) };
}

// what an Exoddus falling item stops on: the objects of these types its camera
// builds at its scale, each as drawn, and whether its update comes first in a
// tick, the camera building its objects in its list's order
const STOPPERS = { Drill: "Drill", MineCar: "Mine_Car_Open" };
function stoppers(c, cam) {
  if (c.game !== "AE") return [];
  const here = cellOf(c.geo, cam);
  const out = [];
  c.path.tlvs.forEach((o, index) => {
    const half = onBackgroundPlane(c.game, o);
    if (!STOPPERS[o.name] || half !== c.half || cellOf(c.geo, filedAt(o, c.game)) !== here) return;
    const recs = rules.AE[o.name]({ ...c, t: o, f: o.fields || {}, index, half });
    const rec = recs.find((r) => r.anim.startsWith(STOPPERS[o.name]));
    if (rec) out.push({ rec, first: index < c.index });
  });
  return out;
}

rule("AE", "FallingItem", (c) => {
  const { t } = c;
  if (c.lvl.short === "CR") return [];
  const bw = c.lvl.short === "BW";
  const art = bw
    ? ["FallingCrate_Falling", "FallingCrate_Waiting"]
    : ["AE_FallingRock_Falling", "AE_FallingRock_Waiting"];
  // the item waits no lower than the top of the camera that builds it
  const camTop = Math.floor(filedAt(t, c.game).y / c.geo.worldH) * c.geo.worldH + c.geo.winY;
  const y = Math.min(t.y1, camTop);
  const debris = bw
    ? { anim: "Explosion_Stick", type: "sticks", count: 20 }
    : { anim: "Explosion_Rock", type: "rocks", count: 25 };
  const { cam, cycle } = fallingItem(c, art, y, [debris], bw);
  return [draw(c, art[0], t.x1, y, { layer: c.half ? 12 : 31, camAt: cam, cycle })];
});
rule("AO", "FallingItem", (c) => {
  const { t } = c;
  const farms = c.lvl.short === "R1" || c.lvl.short === "R2";
  const art = farms
    ? ["FallingMeat_Falling", "FallingMeat_Waiting"]
    : ["AO_FallingRock_Falling", "AO_FallingRock_Waiting"];
  const debris = farms
    ? { anim: "Meat_Gib", type: "meat", count: 25 }
    : { anim: "Explosion_Rock", type: "rocks", count: 25 };
  const sticks = { anim: "Explosion_Stick", type: "sticks", count: 25 };
  const { cam, cycle } = fallingItem(c, art, t.y1, [debris, sticks]);
  return [
    draw(c, art[0], t.x1, t.y1, {
      layer: 31,
      rgb: c.lvl.short === "L1" ? [77, 120, 190] : [105, 105, 105],
      camAt: cam,
      cycle,
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
