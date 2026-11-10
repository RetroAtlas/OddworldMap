// The sprite art a path draws from: the game's sidecar and its sheets, what a place has
// asked for and whether it has arrived, whether an object is there at all, and the clock's
// switch

import { scheduleDraw } from "./ui/redraw.js";
import { CACHE_MAX_IMAGES, SPRITE_ZOOM } from "./config.js";
import { loadSprites } from "./data.js";
import { drawnAs, resetKept } from "./kept.js";
import { resetScene, setMotionRunning, setPatrolsRunning } from "./engine/motion.js";
import { releaseSprites } from "./release.js";
import { compose, composed, dimCache, images, img, tintCache } from "./screens.js";
import { getSettings } from "./settings.js";
import { ownSheet, recordSheets, spriteDraws } from "./sprites.js";
import { state } from "./state.js";

// game id -> sidecar, null while it is coming, false once a fetch failed. A
// failure is asked again only from a deliberate point, never by the paint it
// would drive
const spriteSets = {};
export function spriteSet(gameId) {
  if (gameId in spriteSets) return spriteSets[gameId] || null;
  spriteSets[gameId] = null;
  loadSprites(gameId).then((d) => {
    spriteSets[gameId] = d || false;
    scheduleDraw();
  });
  return null;
}
const spritesFailed = (gameId) => spriteSets[gameId] === false;
// the sidecar a dataset draws from: its game's, a release's own parts over it
const releaseSets = new WeakMap();
export function setOf(G) {
  const base = spriteSets[G.id];
  if (!base || !G.release) return base;
  let set = releaseSets.get(G);
  if (!set) releaseSets.set(G, (set = releaseSprites(base, G)));
  return set;
}
export function warmSprites(gameId) {
  spriteSet(gameId);
}
const sheetSrcs = (gameId) =>
  Object.values((state.data?.id === gameId ? setOf(state.data) : spriteSets[gameId])?.sheets ?? {});
const settled = (src) => !!images[src]?.complete;
const failed = (src) => settled(src) && !images[src].naturalWidth;
function retrySprites(gameId) {
  let dropped = spritesFailed(gameId);
  if (dropped) delete spriteSets[gameId];
  for (const src of sheetSrcs(gameId))
    if (failed(src)) {
      delete images[src];
      dropped = true;
    }
  if (dropped) scheduleDraw();
}

// a frame as one object draws it: the texels the semi-transparency bit marks
// blend only where the polygon is semi-transparent, and the engine modulates
// every texel by the object's colour, 128 being neutral. The frame is cut
// alone, so a smoothed draw repeats its own edge rather than reading the art
// packed beside it
const frameCache = new Map();
export function processedFrame(src, frame, semi, rgb) {
  const [, fx, fy, fw, fh] = frame;
  const key = `${src}|${fx},${fy},${fw},${fh}|${semi ? 1 : 0}|${rgb}`;
  if (frameCache.has(key)) return frameCache.get(key);
  const im = img(src);
  if (!im.complete || !im.naturalWidth) return null;
  const oc = document.createElement("canvas");
  oc.width = fw;
  oc.height = fh;
  const octx = oc.getContext("2d");
  if (!octx) return null;
  octx.drawImage(im, -fx, -fy);
  const id = octx.getImageData(0, 0, fw, fh);
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
  frameCache.set(key, oc);
  return oc;
}

// the draw records of the standing path, keyed by object, and the sheet files
// they draw from; an edit swaps the path and the records with it
let spriteCache = { path: null, set: null, byTlv: null, sheets: null };
export function spriteRecords(data, lvl, path, set) {
  if (spriteCache.path !== path || spriteCache.set !== set) {
    const byTlv = new Map();
    for (const t of path.tlvs) {
      const recs = spriteDraws(data, lvl, path, t, set);
      if (recs.length) byTlv.set(t, recs);
    }
    const sheets = recordSheets(set, [...byTlv.values()].flat()).map((k) => set.sheets[k]);
    spriteCache = { path, set, byTlv, sheets };
    resetScene();
    frameCache.clear();
  }
  return spriteCache.byTlv;
}
// the sheet files a path's sprites draw from; a path other than the standing
// one is asked for whole
function pathSheets(path, set) {
  if (path !== state.path) return Object.values(set.sheets);
  spriteRecords(state.data, state.lvl, path, set);
  return spriteCache.sheets;
}

// what the standing path's sprites are drawn with: its sheets and the foreground
// masks that go down among them
const spriteArt = (set) => [
  ...state.path.cams.flatMap((c) => (c.masks ?? []).map(([, src]) => src)),
  ...pathSheets(state.path, set),
];

// the places whose sprites have drawn: an edit there, and a family it brings,
// draw as their sheets land rather than holding back what already stands
const shownPlaces = new Set();
const place = () => `${state.data.id}/${state.lvl.short}/${state.path.id}`;
const placeShown = () => !!state.path && shownPlaces.has(place());
// the places where the objects were turned on, which asks for them at any zoom
const askedPlaces = new Set();

// a place yet to draw its sprites asks for their art a frame after the paint
// that wants it, against the view as it settles, since a link paints its path
// at the fit zoom before its own zoom lands; below SPRITE_ZOOM it waits, unless
// the objects were turned on there or the mode is editing them
let asking = false;
function askSoon() {
  if (asking) return;
  asking = true;
  requestAnimationFrame(() => {
    asking = false;
    const set = state.show.objects && state.data && setOf(state.data);
    if (!set || !state.path) return;
    if (state.cam.z < SPRITE_ZOOM && !state.edit && !askedPlaces.has(place())) return;
    for (const src of spriteArt(set)) img(src);
  });
}

// the standing path's sprites draw once its sheets and its foreground masks have
// all arrived or failed, so they appear together, and the scene starts then
export function spritesReady(set, live) {
  const art = spriteArt(set);
  if (!live || placeShown()) for (const src of art) img(src);
  else askSoon();
  if (placeShown()) return true;
  if (!art.every(settled)) return false;
  if (live) {
    shownPlaces.add(place());
    resetScene();
    syncMotion();
  }
  return true;
}

export let paintedSprites = null,
  spritesDrawn = false;
export function setPainted(standing, drawn) {
  paintedSprites = standing;
  spritesDrawn = drawn;
}
// a record whose own sheet failed to load leaves its object a marker
function lostSheet(r) {
  const set = setOf(state.data);
  const k = set && ownSheet(set, r);
  return !!k && failed(set.sheets[k]);
}
// the sprite art an object's drawing is judged by
export const artOf = () => ({
  failed: spritesFailed(state.data.id),
  drawn: spritesDrawn,
  lost: lostSheet,
});
export const objectShown = (t) => drawnAs(t, paintedSprites, artOf()) !== null;

// draw() skips an image that has not arrived and repaints when it does; a
// one-shot paint has no second chance. The masks are waited for whatever the
// toggle says: a percent of the bytes, and one keypress from being wanted
export async function preloadPath(path) {
  const srcs = [];
  for (const c of path.cams) {
    if (c.png) srcs.push(c.png);
    for (const [, , src] of c.patches ?? []) srcs.push(src);
    for (const [, src] of c.masks ?? []) srcs.push(src);
  }
  if (state.show.objects) {
    // the sheets are known only once the sidecar is in
    spriteSet(state.data.id);
    if (spriteSets[state.data.id] === null) await loadSprites(state.data.id);
    const set = setOf(state.data);
    if (set) srcs.push(...pathSheets(path, set));
  }
  await Promise.all(
    srcs.map((src) => {
      let im = img(src);
      // a load that failed reports itself complete with no width, so it would
      // pass for arrived forever; drop it and let this attempt refetch
      if (im.complete && !im.naturalWidth) {
        delete images[src];
        delete composed[src];
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
  // a patched screen paints from its composed picture, which follows its parts
  await Promise.all(path.cams.filter((c) => c.patches).map((c) => compose(c)?.done));
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
    if (c.patches && !composed[c.patches[0][2]]?.ready) return false;
    if (state.show.fg || state.show.objects)
      for (const [, src] of c.masks ?? []) if (!decoded(src)) return false;
  }
  if (state.show.objects) {
    // a sidecar still coming keeps the paint waiting; a failed one has nothing more to wait for
    const set = setOf(state.data);
    if (!set && !spritesFailed(state.data.id)) return false;
    if (set) for (const s of pathSheets(path, set)) if (!decoded(s)) return false;
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
    for (const [, , src] of c.patches ?? []) keep.add(src);
    for (const [, src] of c.masks ?? []) keep.add(src);
  }
  for (const src of Object.keys(images)) {
    if (keep.has(src)) continue;
    images[src].onload = images[src].onerror = null; // in-flight loads must not repaint after eviction
    delete images[src];
    delete composed[src];
    delete tintCache[src];
    delete dimCache[src];
  }
});

// an edit stands the path as new objects, which the kept set no longer answers for
window.addEventListener("data-changed", resetKept);

// a visitor who asks for reduced motion still sees the sprites, on their first frame
const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
// null until the first sync: the boot is neither a flip nor a switch
let objectsShown = null,
  shownGame = null;
export function syncMotion() {
  const shown = !!state.show.objects;
  const game = state.data?.id ?? null;
  const flippedOn = shown && objectsShown === false;
  const switched = shownGame !== null && game !== shownGame;
  if (flippedOn || switched) retrySprites(game);
  if (flippedOn && state.path) askedPlaces.add(place());
  if (shown && !objectsShown) resetScene();
  objectsShown = shown;
  shownGame = game;
  const on =
    shown &&
    getSettings().animate &&
    !state.graph &&
    !document.hidden &&
    !reducedMotion.matches &&
    placeShown();
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
window.addEventListener("edit-changed", scheduleDraw);
reducedMotion.addEventListener("change", syncMotion);
window.addEventListener("selection-changed", syncMotion); // a game switch wants its own sheets
window.addEventListener("online", () => {
  if (!state.data) return;
  retrySprites(state.data.id);
  syncMotion();
});
