// Edits to the shipped data as a local sandbox. An edit is a delta (fields and
// rect) keyed by the object's pristine origin; a path carrying deltas stands in
// the dataset as a new object built over the pristine one, its unedited TLVs
// kept by identity and its edited ones fresh, with their navigation bucket
// derived again; a path whose deltas are all gone stands as the pristine object
// itself. A path's trail of steps is a trail of its store entry, kept for the
// session. Nothing here writes into a fetched object. Importable in bare Node.

import { state } from "./state.js";
import { clamp } from "./util.js";
import { deriveExtra } from "./extra.js";
import { pathVisible, revealPath } from "./pathvisible.js";
import { invalidateEntry } from "./pathorder.js";
import { onBackgroundPlane, valueMap } from "./fields.js";
import { snapAt } from "./collide.js";
import { store } from "./settings.js";

const S16_MIN = -32768,
  S16_MAX = 32767;

// per game: the level-id -> short map a destination's level reads through
const LEVEL_SHORT = {};
export const setLevelShort = (gameId, map) => {
  LEVEL_SHORT[gameId] = map;
};
export const hasLevelShort = (gameId) => gameId in LEVEL_SHORT;

// an embed is someone else's page showing this map, so it shows the shipped one
let enabled = true;
export const setEnabled = (on) => {
  enabled = on;
};

// {game: {"LV/PA": {objects: {key: {fields: {name: value}, rect: [x1, y1, x2,
// y2], removed: true}}}}}, each part optional, read from the device once and
// written back on every change; shape is all the read checks, each delta
// answering to its object
const EDITS_KEY = "owm:edits";
let edits = null;
const all = () => (edits ??= sanitizeEdits(store.get(EDITS_KEY)));
export const restoreEdits = (obj) => {
  edits = obj;
  histories.clear();
};
export const editStore = () => all();
function persist() {
  if (Object.keys(all()).length) store.set(EDITS_KEY, JSON.stringify(edits));
  else store.remove(EDITS_KEY);
}

export function sanitizeEdits(raw) {
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return {};
  }
  const out = {};
  if (!parsed || typeof parsed !== "object") return out;
  for (const [game, paths] of Object.entries(parsed)) {
    if (!/^[A-Z]{2}$/.test(game) || !paths || typeof paths !== "object") continue;
    for (const [pk, pe] of Object.entries(paths)) {
      if (!/^[A-Z0-9]+\/\d+$/.test(pk) || !pe?.objects || typeof pe.objects !== "object") continue;
      for (const [key, d] of Object.entries(pe.objects)) {
        if (!/^\w+@-?\d+,-?\d+(#\d+)?$/.test(key) || !d || typeof d !== "object") continue;
        const delta = {};
        if (d.fields && typeof d.fields === "object") {
          const fields = {};
          for (const [f, v] of Object.entries(d.fields)) if (s16(v)) fields[f] = v;
          if (Object.keys(fields).length) delta.fields = fields;
        }
        if (rectShaped(d.rect)) delta.rect = d.rect;
        if (d.removed === true) delta.removed = true;
        if (Object.keys(delta).length)
          ((out[game] ??= {})[pk] ??= { objects: {} }).objects[key] = delta;
      }
    }
  }
  return out;
}

const s16 = (v) => Number.isInteger(v) && v >= S16_MIN && v <= S16_MAX;
const rectShaped = (r) =>
  Array.isArray(r) && r.length === 4 && r.every(s16) && r[2] >= r[0] && r[3] >= r[1];
const sameRect = (a, b) => a.every((v, i) => v === b[i]);
const rectOf = (t) => [t.x1, t.y1, t.x2, t.y2];

const pathKey = (lv, pa) => `${lv}/${pa}`;

// the trail of a path's deltas, per place and for the session: its store entry
// as it stood before each step, cloned since the funnels write into the live
// one; steps sharing a tag join into one until another kind of step ends the run
const histories = new Map();
const clone = (pe) => (pe ? JSON.parse(JSON.stringify(pe)) : null);
function trail(gameId, pk) {
  const k = `${gameId}/${pk}`;
  let h = histories.get(k);
  if (!h) histories.set(k, (h = { undo: [], redo: [] }));
  return h;
}
function record(gameId, pk, before, tag = null) {
  const h = trail(gameId, pk);
  const top = h.undo[h.undo.length - 1];
  if (!tag || !top || top.tag !== tag) h.undo.push({ snap: before, tag });
  h.redo.length = 0;
}
export const canUndo = (gameId, lv, pa) =>
  (histories.get(`${gameId}/${pathKey(lv, pa)}`)?.undo.length ?? 0) > 0;
export const canRedo = (gameId, lv, pa) =>
  (histories.get(`${gameId}/${pathKey(lv, pa)}`)?.redo.length ?? 0) > 0;

// a pristine path's objects by origin: name and top-left, with an ordinal where
// the tuple repeats inside the path, so a delta names one object and not the first
// of several
const keysOf = new WeakMap();
export function objectKeys(pristinePath) {
  let m = keysOf.get(pristinePath);
  if (m) return m;
  const count = new Map();
  for (const t of pristinePath.tlvs) {
    const k = `${t.name}@${t.x1},${t.y1}`;
    count.set(k, (count.get(k) || 0) + 1);
  }
  const seen = new Map();
  m = new Map();
  for (const t of pristinePath.tlvs) {
    const k = `${t.name}@${t.x1},${t.y1}`;
    if (count.get(k) === 1) m.set(t, k);
    else {
      const n = (seen.get(k) || 0) + 1;
      seen.set(k, n);
      m.set(t, `${k}#${n}`);
    }
  }
  keysOf.set(pristinePath, m);
  return m;
}
export const objectKey = (pristinePath, t) => objectKeys(pristinePath).get(t) ?? null;

// a materialized TLV -> the pristine one and the delta it carries
const origin = new WeakMap();
// the paths standing as deltas
const edited = new WeakSet();
// a standing path -> the objects removed from it, each as its deltas left it
const removedOf = new WeakMap();
const ghosts = new WeakSet();
// what stood in a dataset before a swap: per dataset, its levels and paths by place
const pristine = new WeakMap();
function shipped(G) {
  let r = pristine.get(G);
  if (!r) pristine.set(G, (r = { levels: new Map(), paths: new Map() }));
  return r;
}

export const pristineOf = (t) => origin.get(t)?.pristine ?? t;
export const editedFields = (t) => origin.get(t)?.delta.fields ?? {};
// the rect the object shipped with, while its own differs
export const editedRect = (t) => {
  const o = origin.get(t);
  return o?.delta.rect ? rectOf(o.pristine) : null;
};
// what an object's delta changes, as the surfaces name it: the fields, then
// where it stands and how big it is
export function editNotes(t) {
  const notes = Object.keys(editedFields(t)).sort();
  const was = editedRect(t);
  if (was) {
    if (was[0] !== t.x1 || was[1] !== t.y1) notes.push("moved");
    if (was[2] - was[0] !== t.x2 - t.x1 || was[3] - was[1] !== t.y2 - t.y1) notes.push("resized");
  }
  return notes;
}
export const isEdited = (t) => editNotes(t).length > 0;
export const pathEdited = (path) => edited.has(path);
export const removedObjects = (path) => removedOf.get(path) ?? [];
export const isRemoved = (t) => ghosts.has(t);

// the object now standing in `path` for a pristine or stale TLV
export function currentOf(t, path = state.path) {
  const p = pristineOf(t);
  if (!path) return null;
  return path.tlvs.find((c) => c === p || origin.get(c)?.pristine === p) ?? null;
}

// the ghost standing in `path` for a TLV removed from it
export function ghostOf(t, path = state.path) {
  const p = pristineOf(t);
  return removedObjects(path).find((g) => origin.get(g).pristine === p) ?? null;
}

export const hasStoredEdits = (gameId) => enabled && Object.keys(all()[gameId] ?? {}).length > 0;

export function gameEdits(gameId) {
  let objects = 0,
    paths = 0;
  for (const pe of Object.values(all()[gameId] ?? {})) {
    const n = Object.keys(pe.objects).length;
    if (n) paths++;
    objects += n;
  }
  return { objects, paths };
}

// the one rule a delta answers to, entered or restored: a field the object has,
// and either the value it shipped with or an integer the archive's word can hold,
// labelled where labels exist
export function validDelta(gameId, pristine, field, value) {
  if (!pristine.fields || !(field in pristine.fields)) return false;
  if (value === pristine.fields[field]) return true;
  if (!s16(value)) return false;
  const map = valueMap(gameId, pristine.name, field);
  return !map || map[value] !== undefined;
}

// a point's column and row on the path's grid, each judged on its own axis: the
// folded cell index would let a column past the edge wrap into the next row
const onGrid = (path, geo, x, y) => {
  const col = Math.floor(x / geo.worldW),
    row = Math.floor(y / geo.worldH);
  return col >= 0 && col < path.w && row >= 0 && row < path.h;
};

// the one rule a rect answers to: s16 words, no negative size, and its corner
// and midpoint both on the grid (either game's camera index); the shipped rect passes
export function validRect(path, geo, rect, shipped = null) {
  if (!Array.isArray(rect) || rect.length !== 4 || !rect.every(s16)) return false;
  if (shipped && sameRect(rect, shipped)) return true;
  const [x1, y1, x2, y2] = rect;
  if (x2 < x1 || y2 < y1) return false;
  return (
    onGrid(path, geo, x1, y1) &&
    onGrid(path, geo, Math.floor((x1 + x2) / 2), Math.floor((y1 + y2) / 2))
  );
}

// the rect shifted along x so its midpoint lands where the engine's grid would
// stand a sprite anchored there, by the object's scale and, in Oddysee, its camera
export function snapRect(gameId, geo, t, [x1, y1, x2, y2]) {
  const mid = Math.trunc((x1 + x2) / 2);
  const dx = snapAt(gameId, geo, mid, onBackgroundPlane(gameId, t)) - mid;
  return [x1 + dx, y1, x2 + dx, y2];
}

// the rect shifted onto the grid, its size kept, or null where no shift puts
// both its corner and its midpoint there
export function fitRect(path, geo, [x1, y1, x2, y2]) {
  const w = x2 - x1,
    h = y2 - y1;
  const maxX = path.w * geo.worldW - 1 - Math.floor(w / 2),
    maxY = path.h * geo.worldH - 1 - Math.floor(h / 2);
  if (maxX < 0 || maxY < 0) return null;
  const nx = clamp(x1, 0, maxX),
    ny = clamp(y1, 0, maxY);
  return [nx, ny, nx + w, ny + h];
}

const liveDelta = (d) => Object.keys(d.fields ?? {}).length > 0 || !!d.rect || d.removed === true;

// the path as its deltas make it: the pristine object itself when there are
// none, else a fresh path whose removed objects stand in a list of their own
export function materializePath(gameId, pristine, pathEdits) {
  const objects = pathEdits?.objects ?? {};
  const live = Object.entries(objects).filter(([, d]) => liveDelta(d));
  if (!live.length) return pristine;
  if (!hasLevelShort(gameId))
    throw new Error(`${gameId}: no level map to derive destinations with`);
  const keys = objectKeys(pristine);
  const byKey = new Map(live);
  const removed = [];
  const tlvs = [];
  for (const t of pristine.tlvs) {
    const delta = byKey.get(keys.get(t));
    if (!delta) {
      tlvs.push(t);
      continue;
    }
    const fresh = { ...t };
    if (delta.rect) [fresh.x1, fresh.y1, fresh.x2, fresh.y2] = delta.rect;
    // a type that archives no fields stays without the key, which the surfaces fork on
    if (t.fields && delta.fields) fresh.fields = { ...t.fields, ...delta.fields };
    fresh.extra = deriveExtra(gameId, fresh, LEVEL_SHORT[gameId]);
    // the delta as materialized, not the live entry a later step writes into
    origin.set(fresh, { pristine: t, delta: clone(delta) });
    if (delta.removed) {
      ghosts.add(fresh);
      removed.push(fresh);
    } else tlvs.push(fresh);
  }
  const fresh = { ...pristine, tlvs };
  edited.add(fresh);
  removedOf.set(fresh, removed);
  return fresh;
}

// the level as the store makes it, over the pristine level and paths recorded
// the first time each was replaced
function rebuildLevel(G, j) {
  const L = G.levels[j];
  const was = shipped(G);
  if (!was.levels.has(L.short)) was.levels.set(L.short, L);
  const PL = was.levels.get(L.short);
  const paths = PL.paths.map((P, i) => {
    const pk = pathKey(L.short, P.id);
    if (!was.paths.has(pk)) was.paths.set(pk, P);
    const fresh = materializePath(G.id, was.paths.get(pk), all()[G.id]?.[pk]);
    // a path already standing as these deltas keeps its identity
    const standing = L.paths[i];
    return standing !== was.paths.get(pk) && sameDeltas(standing, fresh) ? standing : fresh;
  });
  return paths.every((P, i) => P === PL.paths[i]) ? PL : { ...PL, paths };
}

// two materializations of one path over equal deltas draw the same
const sameDeltas = (a, b) =>
  sameObjects(a.tlvs, b.tlvs) && sameObjects(removedObjects(a), removedObjects(b));
const sameObjects = (as, bs) =>
  as.length === bs.length &&
  as.every((t, i) => {
    const u = bs[i];
    if (t === u) return true;
    const da = origin.get(t),
      db = origin.get(u);
    return (
      da &&
      db &&
      da.pristine === db.pristine &&
      JSON.stringify(da.delta) === JSON.stringify(db.delta)
    );
  });

// every swap, in either direction, goes through here: the dataset takes the
// level, the selection follows it, a demo path's reveal survives, the game-wide
// memos let go, and the page is told
export function swapLevel(G, j, L2, pa) {
  const old = G.levels[j];
  G.levels[j] = L2;
  old.paths.forEach((P, i) => {
    if (P !== L2.paths[i] && pathVisible(P)) revealPath(L2.paths[i]);
  });
  if (state.data === G && state.lvl?.short === L2.short) {
    state.lvl = L2;
    if (state.path) state.path = L2.paths.find((P) => P.id === state.path.id) ?? null;
    // a selected ghost stays selected while its object stays removed
    if (state.sel)
      state.sel = currentOf(state.sel, state.path) ?? ghostOf(state.sel, state.path) ?? null;
  }
  invalidateEntry(G);
  if (typeof window !== "undefined")
    window.dispatchEvent(
      new CustomEvent("data-changed", { detail: { game: G.id, lv: L2.short, pa } }),
    );
}

function swapPath(G, lv, pa) {
  const j = G.levels.findIndex((L) => L.short === lv);
  if (j < 0) return;
  swapLevel(G, j, rebuildLevel(G, j), pa);
}

const gameOf = (gameId) => state.games.find((g) => g.id === gameId) ?? null;

// what a funnel works on: the place, its dataset, the pristine path and the
// object's key there, with the level map every materialization needs
function locate(t, where, { ghost = false } = {}) {
  const gameId = where.game ?? state.data.id,
    lv = where.lv ?? state.lvl.short,
    pa = where.pa ?? state.path.id;
  const G = gameOf(gameId);
  const pristine = pristineOf(t);
  if (!hasLevelShort(gameId))
    throw new Error(`${gameId}: no level map to derive destinations with`);
  const pk = pathKey(lv, pa);
  const standingPath = () => G.levels.find((L) => L.short === lv).paths.find((p) => p.id === pa);
  const P = shipped(G).paths.get(pk) ?? standingPath();
  const key = objectKey(P, pristine);
  if (!key) throw new Error(`${pristine.name} is not on ${lv} P${pa}`);
  // a ghost by identity, or a handle taken before the store removed its object
  const removed = isRemoved(t) || !!all()[gameId]?.[pk]?.objects?.[key]?.removed;
  if (!ghost && removed) throw new Error(`${pristine.name} is removed on this device`);
  return { gameId, lv, pa, G, pristine, pk, P, key, standingPath, removed };
}

// the entry a funnel writes into, minted on the way; a delta left with nothing
// in it goes, and the path's and the game's entries with it
const deltaOf = (gameId, pk, key) =>
  (((all()[gameId] ??= {})[pk] ??= { objects: {} }).objects[key] ??= {});
function prune(gameId, pk, key) {
  const game = all()[gameId],
    path = game?.[pk];
  if (!path) return;
  const delta = path.objects[key];
  if (delta?.fields && !Object.keys(delta.fields).length) delete delta.fields;
  if (delta && !liveDelta(delta)) delete path.objects[key];
  if (!Object.keys(path.objects).length) delete game[pk];
  if (!Object.keys(game).length) delete edits[gameId];
}

// one field of one object, on the path in hand; the value it had shipped with
// takes the delta away again. Returns the object now standing for it.
export function applyFieldEdit(t, field, value, where = {}) {
  const { gameId, lv, pa, G, pristine, pk, key, standingPath } = locate(t, where);
  if (!validDelta(gameId, pristine, field, value))
    throw new Error(`${pristine.name}.${field}: ${value} is not a value the archive holds`);
  const standing = all()[gameId]?.[pk]?.objects?.[key]?.fields?.[field] ?? pristine.fields[field];
  if (standing === value) return currentOf(pristine, standingPath());
  record(gameId, pk, clone(all()[gameId]?.[pk] ?? null));
  const delta = deltaOf(gameId, pk, key);
  delta.fields ??= {};
  if (value === pristine.fields[field]) delete delta.fields[field];
  else delta.fields[field] = value;
  prune(gameId, pk, key);
  persist();
  swapPath(G, lv, pa);
  return currentOf(pristine, standingPath());
}

// where one object stands and how big it is, on the path in hand; the rect it
// shipped with takes the delta away again, and a merging call (a nudge) joins
// the merging step before it on the same object. Returns the object now standing for it.
export function applyRectEdit(t, rect, { merge = false, ...where } = {}) {
  const { gameId, lv, pa, G, pristine, pk, P, key, standingPath } = locate(t, where);
  const was = rectOf(pristine);
  if (!validRect(P, G.geometry, rect, was))
    throw new Error(`${pristine.name}: ${rect.join(",")} is not a place on the path's grid`);
  const standing = all()[gameId]?.[pk]?.objects?.[key]?.rect ?? was;
  if (sameRect(rect, standing)) return currentOf(pristine, standingPath());
  record(gameId, pk, clone(all()[gameId]?.[pk] ?? null), merge ? `rect:${key}` : null);
  const delta = deltaOf(gameId, pk, key);
  if (sameRect(rect, was)) delete delta.rect;
  else delta.rect = [...rect];
  prune(gameId, pk, key);
  persist();
  swapPath(G, lv, pa);
  return currentOf(pristine, standingPath());
}

// one object off the path, its deltas kept for a restore; a ghost is no step
export function removeObject(t, where = {}) {
  const { gameId, lv, pa, G, pk, key, removed } = locate(t, where, { ghost: true });
  if (removed) return null;
  record(gameId, pk, clone(all()[gameId]?.[pk] ?? null));
  deltaOf(gameId, pk, key).removed = true;
  persist();
  swapPath(G, lv, pa);
  return null;
}

// a removed object back on the path, as its deltas left it. Returns the
// object now standing for it.
export function restoreObject(t, where = {}) {
  const { gameId, lv, pa, G, pristine, pk, key, standingPath } = locate(t, where, { ghost: true });
  const delta = all()[gameId]?.[pk]?.objects?.[key];
  if (!delta?.removed) return currentOf(pristine, standingPath());
  record(gameId, pk, clone(all()[gameId][pk]));
  delete delta.removed;
  prune(gameId, pk, key);
  persist();
  swapPath(G, lv, pa);
  return currentOf(pristine, standingPath());
}

// one object back as the disc has it, fields and rect alike, in one step.
// Returns the object now standing for it.
export function revertObject(t, where = {}) {
  const { gameId, lv, pa, G, pristine, pk, key, standingPath } = locate(t, where);
  const path = all()[gameId]?.[pk];
  if (!path?.objects[key]) return currentOf(pristine, standingPath());
  record(gameId, pk, clone(path));
  delete path.objects[key];
  prune(gameId, pk, key);
  persist();
  swapPath(G, lv, pa);
  return currentOf(pristine, standingPath());
}

export function revertPath(gameId, lv, pa) {
  const game = all()[gameId];
  if (!game?.[pathKey(lv, pa)]) return;
  record(gameId, pathKey(lv, pa), clone(game[pathKey(lv, pa)]));
  delete game[pathKey(lv, pa)];
  if (!Object.keys(game).length) delete edits[gameId];
  persist();
  const G = gameOf(gameId);
  if (G) swapPath(G, lv, pa);
}

export function forgetAll() {
  const was = all();
  edits = {};
  histories.clear();
  persist();
  for (const [gameId, game] of Object.entries(was)) {
    const G = gameOf(gameId);
    if (!G) continue;
    for (const pk of Object.keys(game)) {
      const [lv, pa] = pk.split("/");
      swapPath(G, lv, +pa);
    }
  }
}

// a step back or forward puts the entry the trail holds into the store and
// swaps, the way a revert does; the map follows through the swap alone
function restore(gameId, lv, pa, snapshot) {
  const pk = pathKey(lv, pa);
  const game = (all()[gameId] ??= {});
  if (snapshot) game[pk] = clone(snapshot);
  else delete game[pk];
  if (!Object.keys(game).length) delete edits[gameId];
  persist();
  const G = gameOf(gameId);
  if (G) swapPath(G, lv, pa);
}

export function undoEdit(gameId, lv, pa) {
  const pk = pathKey(lv, pa),
    h = trail(gameId, pk);
  if (!h.undo.length) return false;
  h.redo.push({ snap: clone(all()[gameId]?.[pk] ?? null), tag: null });
  restore(gameId, lv, pa, h.undo.pop().snap);
  // the step left on top is a run no later nudge may join
  if (h.undo.length) h.undo[h.undo.length - 1].tag = null;
  return true;
}

export function redoEdit(gameId, lv, pa) {
  const pk = pathKey(lv, pa),
    h = trail(gameId, pk);
  if (!h.redo.length) return false;
  h.undo.push({ snap: clone(all()[gameId]?.[pk] ?? null), tag: null });
  restore(gameId, lv, pa, h.redo.pop().snap);
  return true;
}

// the stored deltas over a dataset that has not reached the page yet: each is
// applied where it still answers to its object and dropped where it does not,
// a delta the disc has caught up with among the dropped (it no longer differs,
// and could never be taken away part by part), and the count of both waits
// for the page to say it
const reports = new Map();
export function applyStoredEdits(G) {
  let applied = 0,
    dropped = 0;
  const game = all()[G.id] ?? {};
  for (const [pk, pe] of Object.entries(game)) {
    const [lv, pa] = pk.split("/");
    const L = G.levels.find((l) => l.short === lv);
    const P = L?.paths.find((p) => p.id === +pa);
    const byKey = P && new Map([...objectKeys(P)].map(([t, k]) => [k, t]));
    for (const [key, delta] of Object.entries(pe.objects)) {
      const t = byKey?.get(key);
      for (const [field, value] of Object.entries(delta.fields ?? {})) {
        if (t && validDelta(G.id, t, field, value) && value !== t.fields[field]) applied++;
        else {
          dropped++;
          delete delta.fields[field];
        }
      }
      if (delta.rect) {
        const was = t && rectOf(t);
        if (t && validRect(P, G.geometry, delta.rect, was) && !sameRect(delta.rect, was)) applied++;
        else {
          dropped++;
          delete delta.rect;
        }
      }
      if (delta.removed) {
        if (t) applied++;
        else dropped++;
      }
      if (!t || !liveDelta(delta)) delete pe.objects[key];
    }
    if (!Object.keys(pe.objects).length) delete game[pk];
  }
  if (!Object.keys(game).length) delete edits[G.id];
  if (dropped) persist();
  if (applied)
    G.levels.forEach((L, j) => {
      if (Object.keys(game).some((pk) => pk.startsWith(`${L.short}/`)))
        G.levels[j] = rebuildLevel(G, j);
    });
  reports.set(G.id, { applied, dropped, unapplied: 0 });
  return { applied, dropped };
}

// a dataset whose level map never arrived: nothing applies, the store stays as
// it is, and the page is told how much it is not seeing
export function reportUnapplied(gameId) {
  const parts = (d) => Object.keys(d.fields ?? {}).length + (d.rect ? 1 : 0) + (d.removed ? 1 : 0);
  const unapplied = Object.values(all()[gameId] ?? {}).reduce(
    (n, pe) => n + Object.values(pe.objects).reduce((m, d) => m + parts(d), 0),
    0,
  );
  reports.set(gameId, { applied: 0, dropped: 0, unapplied });
}

export function takeReport(gameId) {
  const r = reports.get(gameId) ?? null;
  reports.delete(gameId);
  return r;
}
