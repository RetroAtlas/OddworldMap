// The kit the sprite rules are written with: the collision-line lists a rule
// raycasts against, the snaps and midpoints, the tint tables, the record
// builders, and the table a rule registers into, one entry per type and game.
// Nothing here reads the DOM, so the kit and every rule module import in bare Node.

import { snapAt as snapWorldX } from "../engine/collide.js";
import { filedCell } from "../model/model.js";

// collision-line types a constructor raycasts against; the background plane's
// copies sit four above the foreground's
export const FLOOR = [0];
export const FLOOR_WALLS = [0, 1, 2];
export const FLOOR_WALLS_CEIL = [0, 1, 2, 3];
export const TRACK = [8];
const bgOf = (types) => types.map((t) => t + 4);
export const planeTypes = (half, types) => (half ? bgOf(types) : types);

export const snapAt = (c, x) => snapWorldX(c.game, c.geo, x, c.half);

export const trunc = Math.trunc;
export const mid = (t) => trunc((t.x1 + t.x2) / 2);
export const midY = (t) => trunc((t.y1 + t.y2) / 2);
export const cellOf = (geo, at) =>
  `${Math.floor(at.x / geo.worldW)},${Math.floor(at.y / geo.worldH)}`;
export const ALL_LINES = [0, 1, 2, 3, 4, 5, 6, 7, 8];
// the levels whose themed art and tints differ
export const AE_VAULTS = new Set(["NE", "PV", "SV"]);
export const AO_STOCKYARDS = new Set(["E1", "E2"]);
export const AO_YARDS_TINT = (c, yards, other) => (AO_STOCKYARDS.has(c.lvl.short) ? yards : other);
export const NE_TINT = (c) => (c.lvl.short === "NE" ? [137, 137, 137] : [127, 127, 127]);

// a brain rolls the game's dice from a seed; the game's is wherever its
// counter stood, the record's is its place in the path
export const brain = (c, name, emo = false, p = null) => ({
  kind: "brain",
  brain: name,
  game: c.game,
  seed: c.index & 255,
  emo,
  p,
});
// a brain on patrol walks the path: its lines and their links, its objects,
// and the spawn the constructor's own raycast stands it on
export const patrol = (c, name, p, spawn) => ({
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
export function draw(c, anim, x, y, o = {}) {
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

// the bounding rectangle of an animation's first frame, from the sidecar
export const bound = (c, anim) => c.anims?.[anim]?.frames[0].slice(7, 11) ?? [0, 0, 0, 0];

// one entry per level row of a tint table, the rest the fallback
export const tint = (table, lv, fallback) => table[lv] ?? fallback;

export const rules = { AO: {}, AE: {} };
export const rule = (game, type, fn) => (rules[game][type] = fn);
export const both = (type, fn) => {
  rule("AO", type, fn);
  rule("AE", type, fn);
};

// the render offset the engine stacks same-type objects by: the n-th of a kind
// in a camera takes the n-th entry, scaled in Exoddus (StackOnObjectsOfType)
const STACK = [0, 3, -3, 6, -6, 2];
export function stackOffset(c) {
  const { t, path, geo } = c;
  const cell = (o) => filedCell(o, path, geo, c.game);
  const here = cell(t);
  let n = 0;
  for (const o of path.tlvs) {
    if (o === t) break;
    if (o.name === t.name && cell(o) === here) n++;
  }
  const s = c.game === "AE" ? (c.half ? 0.5 : 1) : 1;
  return trunc(STACK[n % 6] * s);
}
