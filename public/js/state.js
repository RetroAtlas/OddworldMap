// Shared mutable viewer state, and the world-to-draw transforms bound to the
// live layout.

import { GRID_UNIT } from "./config.js";
import { drawX, drawY, worldX, worldY } from "./geometry.js";

// Both games address cameras on a grid coarser than the screen (data.geometry):
// a visW x visH window of world units sits inside the cell at winX/winY, world
// units being PS1 screen pixels and the artwork 1:1 with them. AO's cell is
// 1024x480 with a 368x240 window at +256/+120; AE's is 375x260 with the same
// window at +0/+0. Draw space is world units too, so a screen's interior maps
// 1:1 whatever the pitch, and CELL_W/CELL_H are only how far apart screens are
// laid out: packed edge to edge, which folds the slack between windows away.
//
// Spacing them at the cell's own pitch instead puts every screen where the
// game addresses it, and the transform degenerates to dX(wx) = wx - winX,
// draw space becoming world space shifted. Nothing else in the viewer knows
// which it is looking at.
export let GEO = null,
  CELL_W = 368,
  CELL_H = 240;
let spaced = false;

export function setGeometry(g) {
  GEO = g;
  applyPitch();
}

function applyPitch() {
  CELL_W = spaced ? GEO.worldW : GEO.cellW;
  CELL_H = spaced ? GEO.worldH : GEO.cellH;
  // the geometry as the map is laid out right now: the data's windows, with
  // cellW/cellH standing for the pitch in force. What reads a pitch reads this
  LAYOUT = { ...GEO, cellW: CELL_W, cellH: CELL_H };
}
export let LAYOUT = null;

// Flipping the pitch moves every draw coordinate, so whatever the viewer holds
// in draw space is the caller's to carry across.
export function setSpacing(on) {
  if (!GEO || on === spaced) return false;
  spaced = on;
  applyPitch();
  return true;
}
export const isSpaced = () => spaced;

// a cell's own corner in draw space, relative to its screen's. Packed the two
// are the same point, the slack having no draw space to sit in; spaced the
// screen sits winX/winY inside its cell, so the cell starts that much earlier
export const cellOrigin = () => (spaced ? [-GEO.winX, -GEO.winY] : [0, 0]);

export const dX = (wx) => drawX(wx, LAYOUT);
export const dY = (wy) => drawY(wy, LAYOUT);
export const wX = (dx) => worldX(dx, LAYOUT);
export const wY = (dy) => worldY(dy, LAYOUT);

// position within its own screen, in grid squares (measured from the visible
// window's corner, so both games read 0 at a screen's left/top edge)
export const gX = (wx) => (wx - Math.floor(wx / GEO.worldW) * GEO.worldW - GEO.winX) / GRID_UNIT;
export const gY = (wy) => (wy - Math.floor(wy / GEO.worldH) * GEO.worldH - GEO.winY) / GRID_UNIT;

// world-unit length of a draw-space delta: a screen's interior is 1:1, so the
// delta is already a world length; the folded-away slack stays uncounted
export const worldLen = (dx, dy) => Math.hypot(dx, dy);

// total world-unit length over [{x, y}, …] draw-space waypoints
export const routeTotal = (pts) =>
  pts.reduce((sum, p, i) => (i ? sum + worldLen(p.x - pts[i - 1].x, p.y - pts[i - 1].y) : 0), 0);

export const state = {
  games: [], // one dataset per available game
  data: null, // current game's dataset
  lvl: null, // current level
  path: null, // current path
  entry: {}, // per game: level short -> Set of path ids arrived into from other levels
  cam: { x: 0, y: 0, z: 0.3 }, // view offset + zoom (px per draw unit)
  show: {}, // display toggles, mirrored from the sidebar checkboxes
  ruler: null, // {x1, y1, x2, y2} in draw space
  graph: false, // the world graph is on screen in place of the map
  route: null, // route segments [{lv, pa, pts: [{x, y}, …]}, …], pts in draw space; drawn whenever set (show.route only gates editing)
  edit: false, // edit mode: a click selects an object instead of following it
  sel: null, // the object selected for editing
};
