// The painter: the live view's affordances, the frame, draw and paint with the map's
// own layers and the markers, and the minimap

import { scheduleDraw } from "../ui/redraw.js";
import {
  ENEMY_CAT,
  FLASH_HOLD_MAX_MS,
  FLASH_MS,
  LINE_COLORS,
  PENS,
  barrierDir,
  catOf,
} from "../config.js";
import { $, COLOR, cv, cvCtx } from "../ui/dom.js";
import { isEdited, removedObjects } from "../data/edits.js";
import { onBackgroundPlane } from "../model/fields.js";
import { drawX, drawY } from "../model/geometry.js";
import { drawnAs } from "./kept.js";
import { camCenter, centerCam, drawBox, lineRuns, offScreen, screenRuns } from "../model/model.js";
import { motionRunning, patrolTick, sceneTick } from "../engine/motion.js";
import {
  labelled,
  outline,
  paintConnections,
  paintFlash,
  paintGhosts,
  paintHighlight,
  paintMarkerNotes,
  paintReleaseGhosts,
  paintReleaseTags,
  paintRoute,
  paintRuler,
  paintSelection,
  paintWires,
} from "./overlays.js";
import { pathRelease, releaseNotes } from "../data/release.js";
import { wanted } from "./artorder.js";
import { arrived, asked, screenOf, tintedMasks } from "./screens.js";
import {
  artOf,
  setOf,
  setPainted,
  spriteArtSettled,
  spriteRecords,
  spriteSet,
  spritesDrawn,
  spritesReady,
} from "./spriteart.js";
import { movedBy, paintSprites, spriteBoxes } from "./spritepaint.js";
import { spriteDraws } from "../rules/sprites.js";
import { CELL_H, CELL_W, GEO, LAYOUT, cellOrigin, state } from "../data/state.js";

// follow-destination highlight: a fading ring at (x, y) in draw space. A held
// flash (object permalink) pulses at full strength until the normal timeout
// has passed AND the user has interacted, or the hold cap runs out.
let flash = null; // {x, y, t0, hold}
let flashInteracted = false;
let flashRaf = null;
for (const ev of ["pointerdown", "pointermove", "wheel", "keydown"])
  window.addEventListener(
    ev,
    () => {
      flashInteracted = true;
    },
    { capture: true, passive: true },
  );

export function flashAt(x, y, hold = false) {
  flash = { x, y, t0: performance.now(), hold };
  flashInteracted = false;
  cancelAnimationFrame(flashRaf);
  animateFlash();
}

function animateFlash() {
  if (!flash) return;
  if (flash.hold) {
    const el = performance.now() - flash.t0;
    if ((el > FLASH_MS && flashInteracted) || el > FLASH_HOLD_MAX_MS) {
      flash.hold = false;
      flash.t0 = performance.now(); // released: fade out from here
    }
  } else if (performance.now() - flash.t0 > FLASH_MS) {
    flash = null;
    draw();
    return;
  }
  draw();
  flashRaf = requestAnimationFrame(animateFlash);
}

// hovered followable object: its connection edges render emphasized while
// the rest dim, so one object's circulation reads out of a dense path
let connFocus = null;
export function setConnFocus(t) {
  if (connFocus === t) return;
  connFocus = t;
  scheduleDraw();
}
window.addEventListener("selection-changed", () => setConnFocus(null));

// hovered wired object: same spotlight for the wiring overlay
let wireFocus = null;
export function setWireFocus(t) {
  if (wireFocus === t) return;
  wireFocus = t;
  scheduleDraw();
}
window.addEventListener("selection-changed", () => setWireFocus(null));

// pointed-at object: a dashed outline around one TLV, for hover affordances
// that reference an object without selecting it (camera-panel rows, a hovered
// door's partner)
let highlight = null;
export function setHighlight(t) {
  if (highlight === t) return;
  highlight = t;
  scheduleDraw();
}
window.addEventListener("selection-changed", () => setHighlight(null)); // TLVs don't outlive their path

// hovered Slig's patrol pen: a shaded band between its own pair of bounds
let patrol = null;
const sameRect = (a, b) =>
  a && b && a.x1 === b.x1 && a.x2 === b.x2 && a.y1 === b.y1 && a.y2 === b.y2;
export function setPatrol(z) {
  if (z === patrol || sameRect(z, patrol)) return;
  patrol = z;
  scheduleDraw();
}
window.addEventListener("selection-changed", () => setPatrol(null));

// the rect a drag would commit, where the selection stands while the pointer carries it
let carriedRect = null;
export function setCarried(rect) {
  if (rect === carriedRect) return;
  carriedRect = rect;
  scheduleDraw();
}
window.addEventListener("selection-changed", () => setCarried(null));

// the carried object: a copy standing at the carried rect, in a copy of the
// path holding it in the original's place, with the records its rule draws
// there. A live paint stands it in for the original in every pass
let held = null;
let heldCache = null;
function holding(data, lvl, path, set, from, rect) {
  const key = rect.join();
  const c = heldCache;
  if (c?.from === from && c.path === path && c.set === set && c.key === key) return c;
  const to = { ...from, x1: rect[0], y1: rect[1], x2: rect[2], y2: rect[3] };
  const there = { ...path, tlvs: path.tlvs.map((o) => (o === from ? to : o)) };
  const recs = set ? spriteDraws(data, lvl, there, to, set) : [];
  heldCache = { from, path, set, key, to, recs };
  return heldCache;
}
const at = (t) => (held && t === held.from ? held.to : t);
// the standing records with the carried object's own in its place
function heldRecords(path, sprites) {
  const out = new Map();
  for (const t of path.tlvs) {
    if (t !== held.from) {
      if (sprites.has(t)) out.set(t, sprites.get(t));
    } else if (held.recs.length) out.set(held.to, held.recs);
  }
  return out;
}

// an edit stands the path as new objects, which none of these point at any more
window.addEventListener("data-changed", () => {
  setConnFocus(null);
  setWireFocus(null);
  setHighlight(null);
  setPatrol(null);
  scheduleDraw();
});

// the camera holds a corner, so a viewport that changes size would slide the view;
// the middle is held instead, the spot a permalink names. The observer reports a
// size only after the frame's layout, so whatever reads or places the camera by
// the canvas's size settles it at that size first, or the late report would move
// it again
let viewW = 0,
  viewH = 0;

export function settleView() {
  const w = cv.clientWidth,
    h = cv.clientHeight;
  if (!w || !h) return;
  if (viewW && (w !== viewW || h !== viewH))
    Object.assign(state.cam, centerCam(camCenter(state.cam, viewW, viewH), w, h));
  viewW = w;
  viewH = h;
}

export function resize() {
  settleView();
  cv.width = cv.clientWidth * devicePixelRatio;
  cv.height = cv.clientHeight * devicePixelRatio;
  draw();
}
window.addEventListener("resize", resize); // catches devicePixelRatio changes, which leave the map box untouched
new ResizeObserver(resize).observe($("main")); // the sidebar slide resizes the map without a window resize

// a barrier post: dashed vertical on the boundary the engine enforces — the
// stamp's top-left x, which is also the edge a hovered pen band ends on —
// extended past the stamp so it reads at any zoom, with a solid foot pointing
// into the pen where the type claims a side. It dots like a marker box when it
// stands in the slack between windows
function drawBarrier({ ctx, cam, layout }, t, dir) {
  const cx = drawX(t.x1, layout);
  const box = drawBox(t, layout);
  const y1 = box.y - 26,
    y2 = box.y + box.h + 6;
  ctx.strokeStyle = ENEMY_CAT.color;
  ctx.lineWidth = 2 / cam.z;
  ctx.setLineDash(offScreen(t, layout) ? [2 / cam.z, 3 / cam.z] : [5 / cam.z, 4 / cam.z]);
  ctx.beginPath();
  ctx.moveTo(cx, y1);
  ctx.lineTo(cx, y2);
  ctx.stroke();
  ctx.setLineDash([]);
  if (dir) {
    ctx.beginPath();
    ctx.moveTo(cx, y2);
    ctx.lineTo(cx + 9 * dir, y2);
    ctx.stroke();
  }
}

export function draw() {
  if (!state.path) {
    cvCtx.fillStyle = COLOR.bg;
    cvCtx.fillRect(0, 0, cv.width, cv.height);
    mm.hidden = true;
    return;
  }
  paint(cvCtx, state.cam, cv.clientWidth, cv.clientHeight, devicePixelRatio);
  paintMinimap(state.cam, state.path);
}
window.addEventListener("frame-due", draw);

// one frame of the map into any canvas: the live one at the view's zoom, or an
// offscreen one sized to a whole path. The hover, navigation and selection
// affordances are the live view's alone — standing in an image they read as
// marks on the map
export function paint(ctx, cam, w, h, dpr, transients = true) {
  const { data, lvl, path, show, ruler, route, sel } = state;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.fillStyle = COLOR.mapBg;
  ctx.fillRect(0, 0, w, h);
  ctx.save();
  ctx.scale(cam.z, cam.z);
  ctx.translate(-cam.x, -cam.y);
  ctx.imageSmoothingEnabled = cam.z < 1;
  // back to front. A layer sets the fill, stroke and shadow colours, the line
  // width and the font before drawing with them, and may leave them changed;
  // whatever else it changes it puts back. The place and the geometry it draws
  // from come off the frame, read once per paint
  const f = {
    ctx,
    cam,
    data,
    lvl,
    path,
    layout: LAYOUT,
    origin: cellOrigin(),
    view: { x: cam.x, y: cam.y, w: w / cam.z, h: h / cam.z },
    showLabels: show.labels && cam.z > 0.45,
    // what the release in hand changes, marked while the toggle is on
    released: show.release && !!data.release,
    at,
  };
  paintScreens(f, show.dim);
  // the sprites and the foreground masks share the game's layers; an export
  // draws the first frame, so two exports agree
  const set = show.objects && spriteSet(data.id) ? setOf(data) : null;
  const standing = set ? spriteRecords(data, lvl, path, set) : null;
  setPainted(standing, !!standing && spritesReady(set, transients));
  held = transients && sel && carriedRect ? holding(data, lvl, path, set, sel, carriedRect) : null;
  f.held = held;
  const sprites = held && standing ? heldRecords(path, standing) : standing;
  if (sprites && spritesDrawn) {
    const live = transients && motionRunning();
    paintSprites(f, sprites, set, live ? sceneTick() : 0, live ? patrolTick() : 0, show.dim);
  } else {
    movedBy.clear();
    spriteBoxes.clear();
  }
  if (show.fg) paintMasks(f);
  if (show.grid) paintGrid(f);
  if (show.coll) paintLines(f);
  if (f.released) paintReleaseGhosts(f, pathRelease(path)?.removed ?? []);
  if (transients && patrol) paintPatrol(f, patrol);
  const art = artOf();
  paintMarkers(f, sprites, art);
  if (show.wires) paintWires(f, transients ? wireFocus : null);
  if (show.conn) paintConnections(f, transients ? connFocus : null);
  if (transients && state.edit) paintGhosts(f, removedObjects(path));
  if (f.released) paintReleaseTags(f);
  if (transients && highlight) paintHighlight(f, at(highlight));
  if (transients && sel) paintSelection(f, at(sel));
  if (ruler) paintRuler(f, ruler);
  if (route) paintRoute(f, route);
  if (transients && flash) paintFlash(f, flash);
  ctx.restore();
}

function paintScreens({ ctx, path, layout, view }, dim) {
  const want = wanted(path, layout, view, { asked, arrived, settled: spriteArtSettled });
  for (const c of path.cams) {
    const cx = (c.cell % path.w) * layout.cellW,
      cy = Math.floor(c.cell / path.w) * layout.cellH;
    // a screen is its window, never the whole cell: (cx, cy) is where the
    // transform puts the window's corner at either pitch, so the slack stays bare
    if (c.png) {
      if (!want.has(c) && !asked(c)) continue;
      const im = screenOf(c);
      if (im) {
        ctx.globalAlpha = dim ? 0.35 : 1;
        ctx.drawImage(im, 0, 0, layout.visW, layout.visH, cx, cy, layout.visW, layout.visH);
        ctx.globalAlpha = 1;
      }
    } else {
      ctx.fillStyle = COLOR.cellEmpty;
      ctx.fillRect(cx, cy, layout.visW, layout.visH);
    }
  }
}

// foreground occlusion masks, tinted so they stand out from the identical background art
function paintMasks({ ctx, path, layout }) {
  for (const c of path.cams) {
    if (!c.masks) continue;
    const t = tintedMasks(c);
    if (!t) continue;
    const cx = (c.cell % path.w) * layout.cellW,
      cy = Math.floor(c.cell / path.w) * layout.cellH;
    ctx.globalAlpha = 0.6;
    ctx.drawImage(t, cx, cy, layout.visW, layout.visH);
    ctx.globalAlpha = 1;
  }
}

function paintGrid({ ctx, cam, path, layout, origin }) {
  ctx.strokeStyle = "rgba(255,255,255,.18)";
  ctx.lineWidth = 1.5 / cam.z;
  // the grid marks the cell, not the screen inside it
  const [ox, oy] = origin;
  for (let gx = 0; gx <= path.w; gx++) {
    ctx.beginPath();
    ctx.moveTo(ox + gx * layout.cellW, oy);
    ctx.lineTo(ox + gx * layout.cellW, oy + path.h * layout.cellH);
    ctx.stroke();
  }
  for (let gy = 0; gy <= path.h; gy++) {
    ctx.beginPath();
    ctx.moveTo(ox, oy + gy * layout.cellH);
    ctx.lineTo(ox + path.w * layout.cellW, oy + gy * layout.cellH);
    ctx.stroke();
  }
  if (layout.visW * cam.z > 90) {
    ctx.fillStyle = "rgba(255,255,255,.8)";
    ctx.font = `${12 / cam.z}px sans-serif`;
    ctx.shadowColor = "rgba(0,0,0,.9)";
    ctx.shadowBlur = 3 / cam.z;
    for (const c of path.cams) {
      const cx = (c.cell % path.w) * layout.cellW,
        cy = Math.floor(c.cell / path.w) * layout.cellH;
      ctx.fillText(c.name, cx + 10, cy + 18 / cam.z);
    }
    ctx.shadowBlur = 0;
  }
}

// collision lines, dotted over the slack the packing folded away, as markers are;
// a line a release moves or adds in the mark's colour, and one it drops a ghost
function paintLines({ ctx, cam, path, layout, released }) {
  ctx.lineWidth = 2.5 / cam.z;
  const bg = [8 / cam.z, 6 / cam.z],
    slack = [2 / cam.z, 3 / cam.z];
  const own = released ? pathRelease(path)?.lines : null;
  if (released)
    for (const [x1, y1, x2, y2] of pathRelease(path)?.gone ?? []) {
      ctx.strokeStyle = `rgba(${COLOR.releaseRgb}, 0.55)`;
      ctx.setLineDash(slack);
      for (const r of lineRuns(x1, y1, x2, y2, layout)) {
        ctx.beginPath();
        ctx.moveTo(r.x1, r.y1);
        ctx.lineTo(r.x2, r.y2);
        ctx.stroke();
      }
    }
  path.lines.forEach(([x1, y1, x2, y2, t], i) => {
    ctx.strokeStyle = own?.has(i) ? `rgb(${COLOR.releaseRgb})` : LINE_COLORS[t] || "#999";
    for (const r of lineRuns(x1, y1, x2, y2, layout)) {
      ctx.setLineDash(r.on ? (t >= 4 ? bg : []) : slack);
      ctx.beginPath();
      ctx.moveTo(r.x1, r.y1);
      ctx.lineTo(r.x2, r.y2);
      ctx.stroke();
    }
  });
  ctx.setLineDash([]);
}

function paintPatrol({ ctx }, zone) {
  ctx.fillStyle = ENEMY_CAT.color + "22";
  ctx.fillRect(zone.x1, zone.y1 - 8, zone.x2 - zone.x1, zone.y2 - zone.y1 + 16);
}

function paintMarkers(f, sprites, art) {
  const { ctx, cam, data, path, layout } = f;
  ctx.font = `${11 / cam.z}px sans-serif`;
  for (const o of path.tlvs) {
    const t = at(o);
    const as = drawnAs(t, sprites, art);
    if (!as) continue;
    const showLabels = f.showLabels && labelled(t);
    const edited = isEdited(o);
    const released = f.released && releaseNotes(o).length > 0;
    if (as !== "marker") {
      // the sprite stands for the marker; the edited and release marks stay,
      // and the label where there is a sprite to name
      const label = showLabels && as === "sprite";
      if (label || edited || released) paintMarkerNotes(f, t, label, edited, released);
      continue;
    }
    const dir = PENS.on ? barrierDir(t) : null; // pens off: barriers are plain meta boxes
    if (dir !== null) {
      drawBarrier(f, t, dir);
      if (showLabels) {
        ctx.fillStyle = ENEMY_CAT.color;
        ctx.fillText(t.name, drawX(t.x1, layout), drawY(t.y1, layout) - 3 / cam.z);
      }
      continue;
    }
    const c = catOf(t);
    const box = drawBox(t, layout);
    const x1 = box.x,
      y1 = box.y;
    const w = Math.max(box.w, 10),
      h = Math.max(box.h, 10);
    const bg = onBackgroundPlane(data.id, t);
    if (bg) ctx.globalAlpha = 0.5;
    ctx.strokeStyle = c.color;
    ctx.fillStyle = c.color + "26";
    ctx.lineWidth = (t.name === "LCDStatusBoard" ? 3.5 : 2) / cam.z;
    // solid and filled where the marker covers screen, hollow and dotted over
    // the slack the packing folded away, which is a neighbour's artwork
    const onScreen = () => {
      ctx.setLineDash(bg ? [8 / cam.z, 6 / cam.z] : []);
      ctx.strokeRect(x1, y1, w, h);
      ctx.fillRect(x1, y1, w, h);
    };
    const inSlack = () => {
      ctx.setLineDash([2 / cam.z, 3 / cam.z]);
      ctx.strokeRect(x1, y1, w, h);
    };
    const runs = screenRuns(t, layout);
    if (runs.whole) onScreen();
    else if (!runs.xs.length || !runs.ys.length) inSlack();
    else {
      // straddling the two: one pass each, partitioned by a clip on the runs,
      // so neither can paint over the other's half of a shared edge
      const covered = new Path2D();
      const pad = ctx.lineWidth / 2;
      for (const [ax, bx] of runs.xs)
        for (const [ay, by] of runs.ys)
          covered.rect(ax - pad, ay - pad, bx - ax + 2 * pad, by - ay + 2 * pad);
      const rest = new Path2D();
      rest.rect(x1 - pad, y1 - pad, w + 2 * pad, h + 2 * pad);
      rest.addPath(covered);
      ctx.save();
      ctx.clip(rest, "evenodd");
      inSlack();
      ctx.restore();
      ctx.save();
      ctx.clip(covered);
      onScreen();
      ctx.restore();
    }
    // an edited object says so on the map itself, exports included, and so
    // does one the release changes, outside the edit's outline when it has both
    if (edited) outline(f, x1, y1, w, h, 3, COLOR.editRgb);
    if (released) outline(f, x1, y1, w, h, edited ? 6 : 3, COLOR.releaseRgb);
    if (showLabels) {
      ctx.fillStyle = c.color;
      ctx.fillText(t.name, x1, y1 - 3 / cam.z);
    }
    ctx.globalAlpha = 1;
    ctx.setLineDash([]);
  }
}

// ---- minimap: the path's cell grid in a corner, the viewport drawn on it ----
const mm = $("minimap");
const mmCtx = mm.getContext("2d");
const MM_MAX_W = 180,
  MM_MAX_H = 120;

// draw units to minimap pixels
export const minimapScale = (path) =>
  Math.min(MM_MAX_W / (path.w * CELL_W), MM_MAX_H / (path.h * CELL_H));

function paintMinimap(cam, path) {
  // the inset earns its corner only while some of the path lies off-screen
  const fits =
    path.w * CELL_W * cam.z <= cv.clientWidth && path.h * CELL_H * cam.z <= cv.clientHeight;
  mm.hidden = fits;
  if (fits) return;
  const s = minimapScale(path);
  const w = Math.round(path.w * CELL_W * s),
    h = Math.round(path.h * CELL_H * s);
  // rounded before comparing: canvas sizes truncate to ints, and a fractional
  // devicePixelRatio would otherwise defeat the guard and realloc every frame
  const bw = Math.round(w * devicePixelRatio),
    bh = Math.round(h * devicePixelRatio);
  if (mm.width !== bw || mm.height !== bh) {
    mm.width = bw;
    mm.height = bh;
    mm.style.width = w + "px";
    mm.style.height = h + "px";
  }
  mmCtx.setTransform(devicePixelRatio, 0, 0, devicePixelRatio, 0, 0);
  mmCtx.clearRect(0, 0, w, h); // the tinted CSS background is the empty-cell colour
  mmCtx.fillStyle = "rgba(216, 219, 226, 0.22)";
  const [ox, oy] = cellOrigin();
  for (const c of path.cams) {
    mmCtx.fillRect(
      ((c.cell % path.w) * CELL_W - ox) * s + 0.5,
      (Math.floor(c.cell / path.w) * CELL_H - oy) * s + 0.5,
      GEO.visW * s - 1,
      GEO.visH * s - 1,
    );
  }
  // unclamped on purpose: a viewport out in the margins really is out there
  mmCtx.strokeStyle = `rgb(${COLOR.accentRgb})`;
  mmCtx.lineWidth = 1;
  mmCtx.strokeRect(
    (cam.x - ox) * s + 0.5,
    (cam.y - oy) * s + 0.5,
    (cv.clientWidth / cam.z) * s,
    (cv.clientHeight / cam.z) * s,
  );
}
