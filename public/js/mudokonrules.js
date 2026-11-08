import { raycastDiag, raycastDown } from "./collide.js";
import {
  FLOOR,
  FLOOR_WALLS,
  planeTypes,
  snapAt,
  mid,
  midY,
  ALL_LINES,
  AO_YARDS_TINT,
  brain,
  patrol,
  draw,
  tint,
  rule,
  both,
  stackOffset,
} from "./spritekit.js";

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
