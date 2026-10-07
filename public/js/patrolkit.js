// The brain kit: the tables, the dice and switch reads, and the patrol runtime
// that walks a creature along the path's collision lines.
// No DOM, so it stays importable in bare Node.

import { camVoidX, camVoidY, gridSize, moveOnLine, raycast, tlvAt, wallHit } from "./collide.js";

// the engine's frame counter stands far past any timer a brain sets as an
// absolute frame by the time a screen has loaded
export const SPAWN_FRAME = 1000;

// the brain, motion and construction tables
export const STARTS = {};
export const BRAINS = {};
export const MOTIONS = {};

// Math_RandomRange: equal ends roll nothing, a range past a byte rolls twice
export function randomRange(st, rnd, min, max) {
  if (min > max) [min, max] = [max, min];
  const range = max - min;
  if (range === 0) return max;
  if (range < 256) return min + (rnd() % (range + 1));
  const b = rnd();
  st.seed++;
  return min + ((257 * b) % (range + 1));
}

// a fresh game's switches: id 1 reads on, nothing else does until a device
// writes it, and id 0 reads off whatever was written
export const switchGet = (st, id) => (id === 1 ? 1 : id === 0 ? 0 : (st.sw[id] ?? 0));

// the engine's 16.16 fixed-point values, one per frame, as pixels
export const fp16 = (raw) => raw.map((v) => v / 65536);

// ---- the creatures on patrol -------------------------------------------------
// A patrol brain owns a position on the path's collision lines and walks it
// with PathLine::MoveOnLine, handing over to the linked line; its world is the
// path's lines, their links and its objects, and nobody is ever in sight.

export const TRACK = [8];
export const floorOf = (half) => (half ? [4] : [0]);

// the line under a spawn, as the constructor's downward raycast found it
export function standOn(st, x, y, reach) {
  const hit = raycast(st.w.lines, x, y, x, y + reach, floorOf(st.w.half));
  st.line = hit ? hit.line : null;
  st.x = x;
  st.y = hit ? hit.y : y;
  st.x0 = st.x;
  st.y0 = st.y;
  st.velx = 0;
  st.placedInVoid =
    st.w.game === "AO" && (camVoidX(st.x, 0, 12) !== null || camVoidY(st.y, 0, 12) !== null);
}

// a step along the held line; a chain that ends leaves the creature standing
// at its edge, where the game would have it fall. In Oddysee a step that lands
// in the void between screens is carried into the next, onto the line a probe
// finds there, as the engine carries Abe and its moving bombs; a walker placed
// in the void walks it uncarried, as the game does, its beat running there
export function follow(st, types = floorOf(st.w.half), yVelAgainstX = false) {
  if (st.line === null || st.velx === 0) return;
  const ox = st.x,
    oy = st.y;
  const r = moveOnLine(st.w.lines, st.w.links, st.line, st.x, st.y, st.velx, st.w.game === "AO");
  if (!r) {
    st.line = null;
    st.velx = 0;
    return;
  }
  st.line = r.line;
  st.x = r.x;
  st.y = r.y;
  if (st.w.game !== "AO" || st.placedInVoid) return;
  const sx = camVoidX(ox, st.x - ox, 12);
  if (sx !== null) {
    st.x = sx;
    const hit = raycast(st.w.lines, sx, st.y - 20, sx, st.y + 20, types);
    if (hit) {
      st.y = hit.y;
      st.line = hit.line;
    }
  }
  const sy = camVoidY(oy, yVelAgainstX ? st.y - ox : st.y - oy, 12);
  if (sy !== null) {
    st.y = sy;
    const hit = raycast(st.w.lines, st.x - 20, st.y, st.x + 20, st.y, types);
    if (hit) {
      st.x = hit.x;
      st.line = hit.line;
    }
  }
}

export const place = (st) => {
  st.dx = st.x - st.x0;
  st.dy = st.y - st.y0;
};

export const scaleOf = (st) => (st.w ? (st.w.half ? 0.5 : 1) : st.r.scale);
export const grid = (st) => gridSize(st.w.half);
export const wall = (st, offY, offX) => wallHit(st.w.lines, st.x, st.y, offY, offX, st.w.half);

// HandleEnemyStopper: a stopper set to stop this way; Exoddus heeds one whose
// switch is on, Oddysee one whose switch is off
export function stopperBlocks(st, t, left) {
  if (!t) return false;
  const f = t.fields || {};
  const dir = f.stop_direction;
  if (!(dir === 2 || (dir === 0 && left) || (dir === 1 && !left))) return false;
  const on = switchGet(st, f.switch_id) !== 0;
  return st.w.game === "AE" ? on : !on;
}
export function enemyStopper(st, grids, left, aboveGrid) {
  const g = grid(st) * grids;
  const y2 = st.y - (aboveGrid ? grid(st) : 0);
  return stopperBlocks(
    st,
    tlvAt(st.w.tlvs, st.x, st.y, st.x + (left ? -g : g), y2, "EnemyStopper"),
    left,
  );
}

// a SlamDoor across the probe that the switches hold shut: one shut at a fresh
// start with its switch off, or one open at a fresh start with its switch on
export function slamDoorBlocks(st, x1, y1, x2, y2) {
  const t = tlvAt(st.w.tlvs, x1, y1, x2, y2, "SlamDoor");
  if (!t) return false;
  const f = t.fields || {};
  const on = switchGet(st, f.switch_id) !== 0;
  return f.start_shut === 1 ? !on : on;
}
