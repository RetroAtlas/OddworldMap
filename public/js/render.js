// Canvas rendering: cameras, overlays, markers, and the image caches.

import { formatDist } from "./util.js";
import {
  CACHE_MAX_IMAGES,
  CATS,
  CONN_COLORS,
  ENEMY_CAT,
  FLASH_HOLD_MAX_MS,
  FLASH_MS,
  LINE_COLORS,
  PENS,
  WIRE_COLOR,
  barrierDir,
  catOf,
  markerShown,
  KEPT_UNSEEN,
} from "./config.js";
import { $, cv, cvCtx, cssVar } from "./dom.js";
import { editedFields } from "./edits.js";
import { drawX, drawY } from "./geometry.js";
import { state, GEO, LAYOUT, CELL_W, CELL_H, cellOrigin, worldLen } from "./state.js";
import {
  camCenter,
  cellCentre,
  centerCam,
  computeConnections,
  computeWiring,
  drawBox,
  lineRuns,
  destOf,
  destTrusted,
  markerCentre,
  offScreen,
  screenRuns,
} from "./model.js";
import { onBackgroundPlane } from "./fields.js";
import { loadSprites } from "./data.js";
import { getSettings } from "./settings.js";
import {
  motionRunning,
  patrolTick,
  resetScene,
  resolveEffects,
  resolveRecord,
  sceneTick,
  setMotionRunning,
  setPatrolsRunning,
} from "./motion.js";
import { spriteDraws, spriteTypes } from "./sprites.js";

// canvas colors shared with the stylesheet, read once from the tokens
const COLOR = {
  bg: cssVar("--bg"),
  mapBg: cssVar("--map-bg"),
  mapBgRgb: cssVar("--map-bg-rgb"),
  cellEmpty: cssVar("--cell-empty"),
  accentRgb: cssVar("--accent-rgb"),
  editRgb: cssVar("--edit-rgb"),
};

const images = {}; // png -> Image
function img(src) {
  if (!images[src]) {
    const im = new Image();
    im.src = src;
    im.onload = scheduleDraw;
    images[src] = im;
  }
  return images[src];
}

const tintCache = {};
// the foreground masks under Dim: the mask's pixels dimmed the way the screens
// are, but opaque, so a sprite behind a piece of foreground stays hidden
const dimCache = {};
function dimmedImg(src) {
  if (dimCache[src]) return dimCache[src];
  const im = img(src);
  if (!im.complete || !im.naturalWidth) return null;
  const oc = document.createElement("canvas");
  oc.width = im.naturalWidth;
  oc.height = im.naturalHeight;
  const octx = oc.getContext("2d");
  octx.drawImage(im, 0, 0);
  octx.globalCompositeOperation = "source-atop";
  octx.globalAlpha = 0.65;
  octx.fillStyle = COLOR.mapBg;
  octx.fillRect(0, 0, oc.width, oc.height);
  dimCache[src] = oc;
  return oc;
}
function tintedImg(src) {
  if (tintCache[src]) return tintCache[src];
  const im = img(src);
  if (!im.complete || !im.naturalWidth) return null; // retried next draw
  const oc = document.createElement("canvas");
  oc.width = im.naturalWidth;
  oc.height = im.naturalHeight;
  const octx = oc.getContext("2d");
  octx.drawImage(im, 0, 0);
  octx.globalCompositeOperation = "source-in";
  octx.fillStyle = "#ff4fd8";
  octx.fillRect(0, 0, oc.width, oc.height);
  tintCache[src] = oc;
  return oc;
}

// game id -> sidecar, null while it is coming, false once a fetch failed. A
// failure is asked again only from a deliberate point, never by the paint it
// would drive
const spriteSets = {};
function spriteSet(gameId) {
  if (gameId in spriteSets) return spriteSets[gameId] || null;
  spriteSets[gameId] = null;
  loadSprites(gameId).then((d) => {
    spriteSets[gameId] = d || false;
    scheduleDraw();
  });
  return null;
}
const spritesFailed = (gameId) => spriteSets[gameId] === false;
function retrySprites(gameId) {
  if (spritesFailed(gameId)) delete spriteSets[gameId];
}
const sheetSrcs = (gameId) => spriteSets[gameId]?.sheets || [];

// a sheet as one object draws it: the texels the semi-transparency bit marks
// blend only where the polygon is semi-transparent, and the engine modulates
// every texel by the object's colour, 128 being neutral
const sheetCache = new Map();
function processedSheet(src, semi, rgb) {
  const key = `${src}|${semi ? 1 : 0}|${rgb}`;
  if (sheetCache.has(key)) return sheetCache.get(key);
  const im = img(src);
  if (!im.complete || !im.naturalWidth) return null;
  const oc = document.createElement("canvas");
  oc.width = im.naturalWidth;
  oc.height = im.naturalHeight;
  const octx = oc.getContext("2d");
  if (!octx) return null;
  octx.drawImage(im, 0, 0);
  const id = octx.getImageData(0, 0, oc.width, oc.height);
  const px = id.data;
  const [r, g, b] = rgb;
  for (let i = 0; i < px.length; i += 4) {
    const a = px[i + 3];
    if (!a) continue;
    px[i] = Math.min(255, (px[i] * r) >> 7);
    px[i + 1] = Math.min(255, (px[i + 1] * g) >> 7);
    px[i + 2] = Math.min(255, (px[i + 2] * b) >> 7);
    px[i + 3] = a === 254 ? (semi ? 128 : 255) : 255;
  }
  octx.putImageData(id, 0, 0);
  sheetCache.set(key, oc);
  return oc;
}

// the draw records of the standing path, keyed by object; an edit swaps the
// path and the records with it
let spriteCache = { path: null, set: null, byTlv: null };
function spriteRecords(data, lvl, path, set) {
  if (spriteCache.path !== path || spriteCache.set !== set) {
    const byTlv = new Map();
    for (const t of path.tlvs) {
      const recs = spriteDraws(data, lvl, path, t, set);
      if (recs.length) byTlv.set(t, recs);
    }
    spriteCache = { path, set, byTlv };
    resetScene();
    // a processed sheet is a whole atlas: keep only the colourings this path draws
    const wanted = new Set();
    for (const recs of byTlv.values())
      for (const r of recs) wanted.add(`${r.semi ? 1 : 0}|${r.rgb}`);
    for (const key of [...sheetCache.keys()])
      if (!wanted.has(key.slice(key.indexOf("|") + 1))) sheetCache.delete(key);
  }
  return spriteCache.byTlv;
}

let paintedSprites = null;
const ruled = {};
const hasRule = (game, name) => (ruled[game] ??= new Set(spriteTypes(game))).has(name);
// connection edges, computed lazily and keyed by path object identity —
// selection-changed alone won't do: it re-fires for the same path on every
// pushed hash write
let connCache = { path: null, edges: null };
const connections = (data, lvl, path) => {
  if (connCache.path !== path) connCache = { path, edges: computeConnections(data, lvl, path) };
  return connCache.edges;
};
let keptCache = { path: null, conn: null, wires: null, filters: null, set: null };
function kept(t) {
  const { data, lvl, path } = state;
  const conn = !!state.show.conn,
    wires = !!state.show.wires;
  const filters = CATS.map((c) => (c.on ? 1 : 0)).join("") + (PENS.on ? "p" : "");
  if (
    keptCache.path !== path ||
    keptCache.conn !== conn ||
    keptCache.wires !== wires ||
    keptCache.filters !== filters
  ) {
    const follows = (o) => {
      const d = destOf(o, data, lvl, path);
      return d && destTrusted(d, data, lvl);
    };
    const set = new Set(path.tlvs.filter((o) => KEPT_UNSEEN.includes(o.name) || follows(o)));
    if (conn)
      for (const e of connections(data, lvl, path)) if (e.dst && catOf(e.src).on) set.add(e.dst);
    if (wires)
      for (const e of computeWiring(path, data.id).edges)
        if (markerShown(e.src) && markerShown(e.dst)) {
          set.add(e.src);
          set.add(e.dst);
        }
    keptCache = { path, conn, wires, filters, set };
  }
  return keptCache.set.has(t);
}
// what an object is drawn as: its sprite, its marker, unseen (there to point
// at, nothing to paint) or nothing. A type the rules know stays present when
// its own state draws nothing, an open door included: a marker while the
// markers are on, unseen otherwise; what the kept set holds stays present
// unseen while the markers are off
function drawnAs(t, sprites) {
  if (!markerShown(t)) return null;
  if (PENS.on && barrierDir(t) !== null) return "marker";
  if (!state.show.objects) return "marker";
  if (hasRule(state.data.id, t.name)) {
    if (sprites) return sprites.has(t) ? "sprite" : state.show.markers ? "marker" : "unseen";
    return spritesFailed(state.data.id) ? "marker" : null;
  }
  if (state.show.markers) return "marker";
  return kept(t) ? "unseen" : null;
}
export const objectShown = (t) => drawnAs(t, paintedSprites) !== null;

// draw() skips an image that has not arrived and repaints when it does; a
// one-shot paint has no second chance. The masks are waited for whatever the
// toggle says: a percent of the bytes, and one keypress from being wanted
export async function preloadPath(path) {
  const srcs = [];
  for (const c of path.cams) {
    if (c.png) srcs.push(c.png);
    if (c.fg) srcs.push(c.fg);
  }
  if (state.show.objects) {
    // the sheets are known only once the sidecar is in
    spriteSet(state.data.id);
    if (spriteSets[state.data.id] === null) await loadSprites(state.data.id);
    srcs.push(...sheetSrcs(state.data.id));
  }
  return Promise.all(
    srcs.map((src) => {
      let im = img(src);
      // a load that failed reports itself complete with no width, so it would
      // pass for arrived forever; drop it and let this attempt refetch
      if (im.complete && !im.naturalWidth) {
        delete images[src];
        delete tintCache[src];
        delete dimCache[src];
        im = img(src);
      }
      if (im.complete) return null;
      return new Promise((done) => {
        im.addEventListener("load", done, { once: true });
        im.addEventListener("error", done, { once: true });
      });
    }),
  );
}

// whether a paint of this path would reach a decoded image everywhere it draws
// one. Waiting is not enough by itself: the cache's own eviction can drop this
// path while another selection passes through, leaving img() to mint blanks the
// paint silently skips
export function artworkReady(path) {
  const decoded = (src) => {
    const im = images[src];
    return !!im?.complete && im.naturalWidth > 0;
  };
  for (const c of path.cams) {
    if (c.png && !decoded(c.png)) return false;
    if (state.show.fg && c.fg && !decoded(c.fg)) return false;
  }
  if (state.show.objects) {
    // a sidecar still coming keeps the paint waiting; a failed one has nothing more to wait for
    if (!spriteSets[state.data.id] && !spritesFailed(state.data.id)) return false;
    for (const s of sheetSrcs(state.data.id)) if (!decoded(s)) return false;
  }
  return true;
}

// a long browse would pin every visited cam's compressed PNG (and tint canvas)
// for the session; once past the cap, drop what the new path doesn't reference
window.addEventListener("selection-changed", () => {
  if (Object.keys(images).length <= CACHE_MAX_IMAGES) return;
  const keep = new Set(sheetSrcs(state.data.id));
  for (const c of state.path.cams) {
    if (c.png) keep.add(c.png);
    if (c.fg) keep.add(c.fg);
  }
  for (const src of Object.keys(images)) {
    if (keep.has(src)) continue;
    images[src].onload = null; // in-flight loads must not repaint after eviction
    delete images[src];
    delete tintCache[src];
    delete dimCache[src];
  }
});

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

// an edit stands the path as new objects, which none of these point at any more
window.addEventListener("data-changed", () => {
  setConnFocus(null);
  setWireFocus(null);
  setHighlight(null);
  setPatrol(null);
  keptCache = { path: null, conn: null, wires: null, filters: null, set: null };
  connCache = { path: null, edges: null };
  scheduleDraw();
});

// a visitor who asks for reduced motion still sees the sprites, on their first frame
const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
let objectsShown = false,
  shownGame = null;
export function syncMotion() {
  const shown = !!state.show.objects;
  const game = state.data?.id ?? null;
  if ((shown && !objectsShown) || game !== shownGame) retrySprites(game);
  if (shown && !objectsShown) resetScene();
  objectsShown = shown;
  shownGame = game;
  const on =
    shown && getSettings().animate && !state.graph && !document.hidden && !reducedMotion.matches;
  setMotionRunning(on, scheduleDraw);
  setPatrolsRunning(!!state.show.patrols);
  if (shown && state.data) spriteSet(state.data.id);
}
document.addEventListener("visibilitychange", syncMotion);
window.addEventListener("settings-changed", (e) => {
  if (e.detail?.key === "animate") {
    syncMotion();
    scheduleDraw();
  }
  if (e.detail?.key === "labelScenery") scheduleDraw();
});
window.addEventListener("graph-changed", syncMotion);
reducedMotion.addEventListener("change", syncMotion);
window.addEventListener("selection-changed", syncMotion); // a game switch wants its own sheets
window.addEventListener("online", () => {
  if (!state.data) return;
  retrySprites(state.data.id);
  syncMotion();
});

// coalesce bursty redraw sources (pointer moves, image loads) into one paint per frame
let drawPending = false;
export function scheduleDraw() {
  if (drawPending) return;
  drawPending = true;
  requestAnimationFrame(() => {
    drawPending = false;
    draw();
  });
}

// the camera holds a corner, so a viewport that changes size would slide the view;
// the middle is held instead, the spot a permalink names
let viewW = 0,
  viewH = 0;

export function resize() {
  const w = cv.clientWidth,
    h = cv.clientHeight;
  if (w && h) {
    if (viewW && (w !== viewW || h !== viewH))
      Object.assign(state.cam, centerCam(camCenter(state.cam, viewW, viewH), w, h));
    viewW = w;
    viewH = h;
  }
  cv.width = w * devicePixelRatio;
  cv.height = h * devicePixelRatio;
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

// filled arrowhead at (tx, ty) pointing along (dx, dy), h long in draw units
function arrowhead(ctx, tx, ty, dx, dy, h) {
  const l = Math.hypot(dx, dy) || 1;
  const ux = dx / l,
    uy = dy / l;
  const bx = tx - h * ux,
    by = ty - h * uy;
  ctx.beginPath();
  ctx.moveTo(tx, ty);
  ctx.lineTo(bx - 0.45 * h * uy, by + 0.45 * h * ux);
  ctx.lineTo(bx + 0.45 * h * uy, by - 0.45 * h * ux);
  ctx.closePath();
  ctx.fill();
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
    showLabels: show.labels && cam.z > 0.45,
  };
  paintScreens(f, show.dim);
  // the sprites stand between the artwork and its foreground masks, which the
  // game draws over them; an export draws the first frame, so two exports agree
  const set = show.objects ? spriteSet(data.id) : null;
  const sprites = set ? spriteRecords(data, lvl, path, set) : null;
  paintedSprites = sprites;
  if (sprites) {
    const live = transients && motionRunning();
    paintSprites(f, sprites, set, live ? sceneTick() : 0, live ? patrolTick() : 0);
    paintForeground(f, show.dim);
  } else {
    movedBy.clear();
    spriteBoxes.clear();
  }
  if (show.fg) paintMasks(f);
  if (show.grid) paintGrid(f);
  if (show.coll) paintLines(f);
  if (transients && patrol) paintPatrol(f, patrol);
  paintMarkers(f, sprites);
  if (show.wires) paintWires(f, transients ? wireFocus : null);
  if (show.conn) paintConnections(f, transients ? connFocus : null);
  if (transients && highlight) paintHighlight(f, highlight);
  if (transients && sel) paintSelection(f, sel);
  if (ruler) paintRuler(f, ruler);
  if (route) paintRoute(f, route);
  if (transients && flash) paintFlash(f, flash);
  ctx.restore();
}

function paintScreens({ ctx, path, layout }, dim) {
  for (const c of path.cams) {
    const cx = (c.cell % path.w) * layout.cellW,
      cy = Math.floor(c.cell / path.w) * layout.cellH;
    // a screen is its window, never the whole cell: (cx, cy) is where the
    // transform puts the window's corner at either pitch, so the slack stays bare
    if (c.png) {
      const im = img(c.png);
      if (im.complete && im.naturalWidth) {
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
    if (!c.fg) continue;
    const t = tintedImg(c.fg);
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

// collision lines, dotted over the slack the packing folded away, as markers are
function paintLines({ ctx, cam, path, layout }) {
  ctx.lineWidth = 2.5 / cam.z;
  const bg = [8 / cam.z, 6 / cam.z],
    slack = [2 / cam.z, 3 / cam.z];
  for (const [x1, y1, x2, y2, t] of path.lines) {
    ctx.strokeStyle = LINE_COLORS[t] || "#999";
    for (const r of lineRuns(x1, y1, x2, y2, layout)) {
      ctx.setLineDash(r.on ? (t >= 4 ? bg : []) : slack);
      ctx.beginPath();
      ctx.moveTo(r.x1, r.y1);
      ctx.lineTo(r.x2, r.y2);
      ctx.stroke();
    }
  }
  ctx.setLineDash([]);
}

function paintPatrol({ ctx }, zone) {
  ctx.fillStyle = ENEMY_CAT.color + "22";
  ctx.fillRect(zone.x1, zone.y1 - 8, zone.x2 - zone.x1, zone.y2 - zone.y1 + 16);
}

const labelled = (t) => !catOf(t).quietLabels || getSettings().labelScenery;

function paintMarkers(f, sprites) {
  const { ctx, cam, data, path, layout } = f;
  ctx.font = `${11 / cam.z}px sans-serif`;
  for (const t of path.tlvs) {
    const as = drawnAs(t, sprites);
    if (!as) continue;
    const showLabels = f.showLabels && labelled(t);
    if (as !== "marker") {
      // the sprite stands for the marker; the edited mark stays, and the label
      // where there is a sprite to name
      const label = showLabels && as === "sprite";
      if (label || Object.keys(editedFields(t)).length) paintMarkerNotes(f, t, label);
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
    // an edited object says so on the map itself, exports included
    if (Object.keys(editedFields(t)).length) {
      const pad = 3 / cam.z;
      ctx.strokeStyle = `rgb(${COLOR.editRgb})`;
      ctx.lineWidth = 1.5 / cam.z;
      ctx.setLineDash([]);
      ctx.strokeRect(x1 - pad, y1 - pad, w + 2 * pad, h + 2 * pad);
    }
    if (showLabels) {
      ctx.fillStyle = c.color;
      ctx.fillText(t.name, x1, y1 - 3 / cam.z);
    }
    ctx.globalAlpha = 1;
    ctx.setLineDash([]);
  }
}

// how far each object on patrol has walked from its mark this frame, so its
// label and edited mark can follow it
const movedBy = new Map();
// the rectangle each object's sprite was last drawn in, clipped to its camera
const spriteBoxes = new Map();
function noteBox(t, b, cam, layout) {
  const x1 = Math.max(b.x, cam.dx),
    y1 = Math.max(b.y, cam.dy),
    x2 = Math.min(b.x + b.w, cam.dx + layout.visW),
    y2 = Math.min(b.y + b.h, cam.dy + layout.visH);
  if (x2 <= x1 || y2 <= y1) return;
  const u = spriteBoxes.get(t);
  if (!u) {
    spriteBoxes.set(t, { x: x1, y: y1, w: x2 - x1, h: y2 - y1 });
    return;
  }
  const ux2 = Math.max(u.x + u.w, x2),
    uy2 = Math.max(u.y + u.h, y2);
  u.x = Math.min(u.x, x1);
  u.y = Math.min(u.y, y1);
  u.w = ux2 - u.x;
  u.h = uy2 - u.y;
}

// the objects as the game draws them, back to front by layer and, within a
// layer, the later-constructed under the earlier; each clipped to its own
// camera's window, where the game clips too, so a frame reaching past it
// never paints over a neighbouring screen
function paintSprites({ ctx, data, layout, path }, sprites, set, tick, patrolAt) {
  movedBy.clear();
  spriteBoxes.clear();
  const recs = [];
  let order = 0;
  for (const [t, list] of sprites) {
    if (!markerShown(t)) continue;
    order++;
    list.forEach((r, k) => recs.push([r, order, k, t]));
  }
  // what the brains give off joins the records, on layers of its own
  const fx = [];
  for (const [r, order, k, t] of recs)
    if (r.cycle?.kind === "brain")
      resolveEffects(r, set, tick, patrolAt).forEach((e, i) =>
        fx.push([e, order, k + 1 + i / 1000, t, true]),
      );
  recs.push(...fx);
  recs.sort((a, b) => a[0].layer - b[0].layer || b[1] - a[1] || a[2] - b[2]);
  const ae = data.id === "AE";
  for (const [r, , , t, isFx] of recs) {
    if (isFx) {
      paintEffect(ctx, layout, set, r, ae);
      continue;
    }
    const shown = resolveRecord(r, set, tick, patrolAt);
    if (!shown) continue;
    const sc = processedSheet(set.sheets[shown.anim.frames[shown.frame][0]], r.semi, r.rgb);
    if (!sc) continue;
    if (shown.moved && !movedBy.has(t))
      movedBy.set(
        t,
        inScreens(path, layout, shown.x, shown.y) ? [shown.x - r.x, shown.y - r.y] : null,
      );
    // a record is placed in the coordinates of the camera its anchor falls
    // in and clipped to that window, as the game shows an object only on the
    // screen it stands in; a rope tiled across screens is drawn once per screen
    const ax = Math.trunc(shown.x);
    const cams = [];
    if (r.tile) {
      const first = Math.floor(r.tile.top / layout.worldH),
        last = Math.floor((r.tile.bottom - 1) / layout.worldH);
      for (let row = first; row <= last; row++)
        cams.push(cameraAt(layout, ax, row * layout.worldH + layout.winY));
    } else cams.push(cameraAt(layout, ax, Math.trunc(shown.y)));
    const frame = shown.anim.frames[shown.frame];
    for (const cam of cams) {
      ctx.save();
      ctx.beginPath();
      ctx.rect(cam.dx, cam.dy, layout.visW, layout.visH);
      ctx.clip();
      if (r.tile) {
        // a rope or web: one frame tiled upward from its bottom, cut to its span
        ctx.beginPath();
        ctx.rect(cam.dx, cam.dy + (r.tile.top - cam.wy), layout.visW, r.tile.bottom - r.tile.top);
        ctx.clip();
      }
      if (r.blend === 1) ctx.globalCompositeOperation = "lighter";
      else if (r.blend === 3) {
        ctx.globalCompositeOperation = "lighter";
        ctx.globalAlpha = 0.25 * shown.bright;
      }
      if (r.tile) {
        let yy = shown.y;
        const { top, bottom, step } = r.tile;
        if (yy > bottom) yy = bottom + ((yy - bottom) % step);
        for (; yy >= top - step; yy -= step)
          noteBox(t, drawFrame(ctx, cam, sc, frame, r, shown, ae, shown.x, yy), cam, layout);
      } else
        noteBox(t, drawFrame(ctx, cam, sc, frame, r, shown, ae, shown.x, shown.y), cam, layout);
      ctx.restore();
    }
  }
}

// a camera's window and coordinates for a world point
function cameraAt(layout, x, y) {
  const cam = {
    wx: Math.floor(x / layout.worldW) * layout.worldW + layout.winX,
    wy: Math.floor(y / layout.worldH) * layout.worldH + layout.winY,
  };
  cam.dx = drawX(cam.wx, layout);
  cam.dy = drawY(cam.wy, layout);
  return cam;
}

// an effect a brain gave off: a particle sprite drawn additively, a sleeper's
// Z or a spark's lines drawn as the engine's gouraud lines, clipped to the
// camera the point falls in
function paintEffect(ctx, layout, set, e, ae) {
  const cam = cameraAt(layout, Math.trunc(e.x), Math.trunc(e.y));
  ctx.save();
  ctx.beginPath();
  ctx.rect(cam.dx, cam.dy, layout.visW, layout.visH);
  ctx.clip();
  ctx.globalCompositeOperation = "lighter";
  if (e.kind === "sprite") {
    const sc = processedSheet(set.sheets[e.anim.frames[e.frame][0]], true, e.rgb);
    if (sc) {
      const r = { scale: e.scale, flipY: false, swap: false };
      drawFrame(ctx, cam, sc, e.anim.frames[e.frame], r, { flip: false }, ae, e.x, e.y);
    }
  } else {
    const px = cam.dx + (e.x - cam.wx),
      py = cam.dy + (e.y - cam.wy);
    const segs =
      e.kind === "lines"
        ? e.segs
        : e.burst
          ? Z_BURST
          : [
              [-4, -4, 4, -4],
              [4, -4, -4, 4],
              [-4, 4, 4, 4],
            ];
    const rgb = e.kind === "lines" ? [31, 31, 127] : e.rgb;
    ctx.lineWidth = 1;
    for (const [x0, y0, x1, y1] of segs) {
      const ax = px + x0 * e.scale,
        ay = py + y0 * e.scale,
        bx = px + x1 * e.scale,
        by = py + y1 * e.scale;
      const g = ctx.createLinearGradient(ax, ay, bx, by);
      g.addColorStop(0, `rgb(${rgb.map((v) => Math.trunc(v / 2)).join(",")})`);
      g.addColorStop(1, `rgb(${rgb.join(",")})`);
      ctx.strokeStyle = g;
      ctx.beginPath();
      ctx.moveTo(ax, ay);
      ctx.lineTo(bx, by);
      ctx.stroke();
    }
  }
  ctx.restore();
}
// the six rays of a Z's burst, inner end to outer
const Z_BURST = [
  [-3, -4, -6, -7],
  [3, -4, 6, -7],
  [4, -1, 7, -1],
  [-4, 1, -7, 1],
  [-3, 4, -6, 7],
  [3, 4, 6, 7],
];

// one frame at a world anchor, placed as Animation::vRender places it: the
// frame's own offset scaled, a half-scale frame's y offset a unit less and
// Exoddus's a pixel larger, every rounding a truncation of v + 0.499
function drawFrame(ctx, cam, sheet, frame, r, shown, ae, wx, wy) {
  const [, sx, sy, w, h, xoff, yoff] = frame;
  const t = (v) => Math.trunc(v + 0.499);
  const s = r.scale;
  let fw = w,
    fh = h,
    ox = xoff,
    oy = yoff;
  if (s !== 1) {
    fw *= s;
    fh *= s;
    ox *= s;
    oy = oy * s - 1;
    if (ae && s === 0.5) {
      fw += 1;
      fh += 1;
    }
  }
  const xpos = cam.dx + (Math.trunc(wx) - cam.wx),
    ypos = cam.dy + (Math.trunc(wy) - cam.wy);
  const dw = Math.floor(fw - 0.501) + 1,
    dh = Math.floor(fh - 0.501) + 1;
  const x0 = shown.flip ? xpos - t(ox) - t(fw) : xpos + t(ox);
  const y0 = r.flipY ? ypos - t(oy) - t(fh) : ypos + t(oy);
  ctx.save();
  ctx.translate(x0, y0);
  if (shown.flip) {
    ctx.translate(dw, 0);
    ctx.scale(-1, 1);
  }
  if (r.flipY) {
    ctx.translate(0, dh);
    ctx.scale(1, -1);
  }
  if (r.swap) {
    // the texture's axes swapped: the frame stands on its side
    ctx.transform(0, 1, 1, 0, 0, 0);
    ctx.drawImage(sheet, sx, sy, w, h, 0, 0, dh, dw);
  } else ctx.drawImage(sheet, sx, sy, w, h, 0, 0, dw, dh);
  ctx.restore();
  return { x: x0, y: y0, w: dw, h: dh };
}

// the foreground masks as the game draws them, over the sprites and untinted
function paintForeground({ ctx, path, layout }, dim) {
  for (const c of path.cams) {
    if (!c.fg) continue;
    const im = dim ? dimmedImg(c.fg) : img(c.fg);
    if (!im || (im instanceof Image && !(im.complete && im.naturalWidth))) continue;
    const cx = (c.cell % path.w) * layout.cellW,
      cy = Math.floor(c.cell / path.w) * layout.cellH;
    ctx.drawImage(im, cx, cy, layout.visW, layout.visH);
  }
}

// whether a world point lies inside one of the path's screens
function inScreens(path, layout, x, y) {
  const cx = Math.floor(x / layout.worldW),
    cy = Math.floor(y / layout.worldH);
  if (!path.cams.some((c) => c.cell === cy * path.w + cx && c.png)) return false;
  const lx = x - cx * layout.worldW,
    ly = y - cy * layout.worldH;
  return (
    lx >= layout.winX &&
    lx < layout.winX + layout.visW &&
    ly >= layout.winY &&
    ly < layout.winY + layout.visH
  );
}

// the marker's box carried to wherever its creature has walked, or null while
// it stands outside every screen
export function standingBox(t, layout) {
  const box = drawBox(t, layout);
  const walked = movedBy.get(t);
  if (walked === null) return null;
  if (walked) {
    box.x += drawX(t.x1 + walked[0], layout) - drawX(t.x1, layout);
    box.y += drawY(t.y1 + walked[1], layout) - drawY(t.y1, layout);
  }
  return box;
}

// where an object can be pointed at: its marker's box, carried by any walk,
// and the rectangle its sprite was last drawn in, each saying whether it is
// what the eye sees there
export function hitBoxes(t, layout) {
  const boxes = [];
  const b = standingBox(t, layout);
  if (b) boxes.push({ ...b, drawn: drawnAs(t, paintedSprites) === "marker" });
  const s = spriteBoxes.get(t);
  if (s) boxes.push({ ...s, drawn: true });
  return boxes;
}

// the label and the edited mark of an object its sprite stands for
function paintMarkerNotes({ ctx, cam, layout }, t, label) {
  const box = standingBox(t, layout);
  if (!box) return;
  const w = Math.max(box.w, 10),
    h = Math.max(box.h, 10);
  if (Object.keys(editedFields(t)).length) {
    const pad = 3 / cam.z;
    ctx.strokeStyle = `rgb(${COLOR.editRgb})`;
    ctx.lineWidth = 1.5 / cam.z;
    ctx.setLineDash([]);
    ctx.strokeRect(box.x - pad, box.y - pad, w + 2 * pad, h + 2 * pad);
  }
  if (label) {
    ctx.fillStyle = catOf(t).color;
    ctx.fillText(t.name, box.x, box.y - 3 / cam.z);
  }
}

// switch wiring: dotted hairlines from each producer to its id's consumers,
// straight and thin so the circulation arrows' solid curves stay a separate
// voice. Hovering a wired object spotlights its own wires and gives them
// arrowheads at the consumer end; an edge hides with either endpoint. A wire
// to a barrier post lands on the post's line, as the ruler's snap does.
function paintWires({ ctx, cam, data, path, layout }, focus) {
  const centre = (t) => {
    const post = PENS.on && barrierDir(t) !== null;
    const [cx, cy] = markerCentre(t, layout);
    return [post ? drawX(t.x1, layout) : cx, cy];
  };
  // the spotlight judges what is drawn: a hovered object whose wires are
  // all hidden must not dim the rest with nothing to show for it
  const drawn = computeWiring(path, data.id).edges.filter(
    (e) => objectShown(e.src) && objectShown(e.dst),
  );
  const focusActive = focus && drawn.some((e) => e.src === focus || e.dst === focus);
  ctx.strokeStyle = ctx.fillStyle = WIRE_COLOR;
  const dash = [2.5 / cam.z, 4.5 / cam.z];
  ctx.setLineDash(dash);
  for (const e of drawn) {
    const focused = focusActive && (e.src === focus || e.dst === focus);
    ctx.globalAlpha = focusActive ? (focused ? 0.95 : 0.12) : 0.5;
    ctx.lineWidth = (focused ? 2.5 : 1.25) / cam.z;
    const [sx, sy] = centre(e.src);
    const [tx, ty] = centre(e.dst);
    const len = Math.hypot(tx - sx, ty - sy);
    if (len < 1) continue;
    ctx.beginPath();
    ctx.moveTo(sx, sy);
    ctx.lineTo(tx, ty);
    ctx.stroke();
    if (focused) {
      ctx.setLineDash([]);
      arrowhead(ctx, tx, ty, tx - sx, ty - sy, Math.min(10 / cam.z, 0.3 * len));
      ctx.setLineDash(dash);
    }
  }
  ctx.setLineDash([]);
  ctx.globalAlpha = 1;
}

// connection arrows: the path's circulation — curves between resolved
// pairs (double-headed when mutual), dashed to a bare camera, and fixed
// 45° labelled stubs for destinations on other paths
function paintConnections({ ctx, cam, data, lvl, path, layout, showLabels }, focus) {
  const edges = connections(data, lvl, path);
  // focus only dims the rest when the hovered object actually has edges
  const focusActive = focus && edges.some((e) => e.src === focus || e.dst === focus);
  const headLen = 12 / cam.z;
  const stubLen = Math.min(Math.max(56 / cam.z, 60), 150);
  const S = Math.SQRT1_2;
  ctx.font = `${11 / cam.z}px sans-serif`;
  for (const e of edges) {
    if (!catOf(e.src).on) continue; // hidden markers keep their arrows hidden too
    const focused = focusActive && (e.src === focus || e.dst === focus);
    ctx.globalAlpha = focusActive ? (focused ? 0.95 : 0.15) : 0.65;
    ctx.lineWidth = (focused ? 3 : 2) / cam.z;
    ctx.strokeStyle = ctx.fillStyle = CONN_COLORS[e.src.name] || "#ffffff";
    const [sx, sy] = markerCentre(e.src, layout);
    if (e.label !== undefined) {
      // off-path stub: a constant diagonal reads as "leaves this path"
      // without pretending to know the direction
      const tx = sx + stubLen * S,
        ty = sy - stubLen * S;
      ctx.beginPath();
      ctx.moveTo(sx, sy);
      ctx.lineTo(tx, ty);
      ctx.stroke();
      arrowhead(ctx, tx, ty, S, -S, Math.min(headLen, 0.25 * stubLen));
      if (showLabels) {
        ctx.shadowColor = "rgba(0,0,0,.9)";
        ctx.shadowBlur = 3 / cam.z;
        ctx.fillText(`→ ${e.label}`, tx + 8 / cam.z, ty - 4 / cam.z);
        ctx.shadowBlur = 0;
      }
      continue;
    }
    const [tx, ty] = e.dst ? markerCentre(e.dst, layout) : cellCentre(e.cell, path, layout);
    const dx = tx - sx,
      dy = ty - sy;
    const len = Math.hypot(dx, dy);
    if (len < 1) continue;
    // control point to the left of travel: near-coincident reversed pairs
    // (stacked double doors) arc apart instead of overlapping
    const k = Math.min(Math.max(0.18 * len, 24), 110);
    const cpx = (sx + tx) / 2 - (dy / len) * k,
      cpy = (sy + ty) / 2 + (dx / len) * k;
    if (!e.dst) ctx.setLineDash([6 / cam.z, 5 / cam.z]); // camera, not exact object
    ctx.beginPath();
    ctx.moveTo(sx, sy);
    ctx.quadraticCurveTo(cpx, cpy, tx, ty);
    ctx.stroke();
    ctx.setLineDash([]);
    const h = Math.min(headLen, 0.25 * len);
    arrowhead(ctx, tx, ty, tx - cpx, ty - cpy, h); // the curve's end tangent is P2 − C
    if (e.twoWay) arrowhead(ctx, sx, sy, sx - cpx, sy - cpy, h);
  }
  ctx.globalAlpha = 1;
}

function paintHighlight({ ctx, cam, layout }, t) {
  // drawn even when the object's category is toggled off: the outline is
  // what locates a listed object whose marker is hidden
  const box = standingBox(t, layout) ?? drawBox(t, layout);
  const x1 = box.x,
    y1 = box.y;
  const w = Math.max(box.w, 10),
    h = Math.max(box.h, 10);
  const pad = 3 / cam.z;
  ctx.strokeStyle = `rgb(${COLOR.accentRgb})`;
  ctx.lineWidth = 2.5 / cam.z;
  ctx.setLineDash([7 / cam.z, 5 / cam.z]);
  ctx.strokeRect(x1 - pad, y1 - pad, w + 2 * pad, h + 2 * pad);
  ctx.setLineDash([]);
}

function paintSelection({ ctx, cam, layout }, t) {
  // the object being edited, outlined whether or not its category is on
  const box = standingBox(t, layout) ?? drawBox(t, layout);
  const w = Math.max(box.w, 10),
    h = Math.max(box.h, 10);
  const pad = 5 / cam.z;
  ctx.strokeStyle = `rgb(${COLOR.editRgb})`;
  ctx.lineWidth = 3 / cam.z;
  ctx.setLineDash([]);
  ctx.strokeRect(box.x - pad, box.y - pad, w + 2 * pad, h + 2 * pad);
}

function paintRuler({ ctx, cam }, ruler) {
  const dx = ruler.x2 - ruler.x1,
    dy = ruler.y2 - ruler.y1;
  ctx.strokeStyle = "#ffffff";
  ctx.lineWidth = 2 / cam.z;
  ctx.setLineDash([6 / cam.z, 5 / cam.z]);
  ctx.beginPath();
  ctx.moveTo(ruler.x1, ruler.y1);
  ctx.lineTo(ruler.x2, ruler.y2);
  ctx.stroke();
  ctx.setLineDash([]);
  for (const [ex, ey] of [
    [ruler.x1, ruler.y1],
    [ruler.x2, ruler.y2],
  ]) {
    ctx.beginPath();
    ctx.arc(ex, ey, 3.5 / cam.z, 0, Math.PI * 2);
    ctx.fillStyle = "#ffffff";
    ctx.fill();
  }
  const label = `${Math.round(worldLen(dx, 0))} × ${Math.round(worldLen(0, dy))} · ${formatDist(worldLen(dx, dy))}`;
  ctx.font = `${13 / cam.z}px sans-serif`;
  const midx = (ruler.x1 + ruler.x2) / 2,
    midy = (ruler.y1 + ruler.y2) / 2 - 10 / cam.z;
  ctx.fillStyle = `rgba(${COLOR.mapBgRgb},.85)`;
  const tw = ctx.measureText(label).width;
  ctx.fillRect(midx - tw / 2 - 5 / cam.z, midy - 13 / cam.z, tw + 10 / cam.z, 18 / cam.z);
  ctx.fillStyle = "#ffffff";
  ctx.fillText(label, midx - tw / 2, midy);
}

// route-planner polylines: solid accent (the ruler stays dashed white), one
// per segment of this path — a seam (a followed door or well) breaks the
// line, since the travel between the halves isn't walked. A ring marks the
// route's start when it is on this path; per-leg lengths label each segment
function paintRoute({ ctx, cam, lvl, path }, route) {
  const col = `rgb(${COLOR.accentRgb})`;
  ctx.font = `${12 / cam.z}px sans-serif`;
  route.forEach((seg, si) => {
    if (seg.lv !== lvl.short || seg.pa !== path.id) return;
    const pts = seg.pts;
    ctx.strokeStyle = col;
    ctx.fillStyle = col;
    ctx.lineWidth = 2.5 / cam.z;
    if (pts.length > 1) {
      ctx.beginPath();
      ctx.moveTo(pts[0].x, pts[0].y);
      for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i].x, pts[i].y);
      ctx.stroke();
    }
    for (const p of pts) {
      ctx.beginPath();
      ctx.arc(p.x, p.y, 3.5 / cam.z, 0, Math.PI * 2);
      ctx.fill();
    }
    if (si === 0 && pts.length) {
      ctx.lineWidth = 2 / cam.z;
      ctx.beginPath();
      ctx.arc(pts[0].x, pts[0].y, 6.5 / cam.z, 0, Math.PI * 2);
      ctx.stroke();
    }
    for (let i = 1; i < pts.length; i++) {
      const a = pts[i - 1],
        b = pts[i];
      const dx = b.x - a.x,
        dy = b.y - a.y;
      if (Math.hypot(dx, dy) * cam.z < 60) continue; // zoomed out, the labels would drown the route
      const label = formatDist(worldLen(dx, dy));
      const midx = (a.x + b.x) / 2,
        midy = (a.y + b.y) / 2 - 10 / cam.z;
      const tw = ctx.measureText(label).width;
      ctx.fillStyle = `rgba(${COLOR.mapBgRgb},.85)`;
      ctx.fillRect(midx - tw / 2 - 5 / cam.z, midy - 12 / cam.z, tw + 10 / cam.z, 17 / cam.z);
      ctx.fillStyle = "#ffffff";
      ctx.fillText(label, midx - tw / 2, midy);
    }
  });
}

function paintFlash({ ctx, cam }, ring) {
  const el = performance.now() - ring.t0;
  const a = ring.hold ? 1 : Math.max(0, 1 - el / FLASH_MS);
  ctx.strokeStyle = `rgba(${COLOR.accentRgb},${a})`;
  ctx.lineWidth = 3.5 / cam.z;
  const r = (46 + 10 * Math.sin(el / 110)) / Math.sqrt(cam.z);
  ctx.beginPath();
  ctx.arc(ring.x, ring.y, r, 0, Math.PI * 2);
  ctx.stroke();
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
