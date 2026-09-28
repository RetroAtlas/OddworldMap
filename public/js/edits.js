// Edits to the shipped data as a local sandbox. An edit is a per-field delta
// keyed by the object's pristine origin; a path carrying deltas stands in the
// dataset as a new object built over the pristine one, its unedited TLVs kept by
// identity and its edited ones fresh, with their navigation bucket derived
// again; a path whose deltas are all gone stands as the pristine object itself.
// A path's trail of steps is a trail of its store entry, kept for the session.
// Nothing here writes into a fetched object. Importable in bare Node: no DOM.

import { state } from "./state.js";
import { deriveExtra } from "./extra.js";
import { pathVisible, revealPath } from "./pathvisible.js";
import { invalidateEntry } from "./pathorder.js";
import { valueMap } from "./fields.js";
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

// {game: {"LV/PA": {objects: {key: {fields: {name: value}}}}}}, read from the
// device once and written back on every change; shape is the only thing the
// read checks, each delta answering to its object when its dataset arrives
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
        if (!/^\w+@-?\d+,-?\d+(#\d+)?$/.test(key) || !d?.fields || typeof d.fields !== "object")
          continue;
        const fields = {};
        for (const [f, v] of Object.entries(d.fields))
          if (Number.isInteger(v) && v >= S16_MIN && v <= S16_MAX) fields[f] = v;
        if (Object.keys(fields).length)
          ((out[game] ??= {})[pk] ??= { objects: {} }).objects[key] = { fields };
      }
    }
  }
  return out;
}

const pathKey = (lv, pa) => `${lv}/${pa}`;

// the trail of a path's deltas, per place and for the session: its store entry
// as it stood before each step, cloned since the funnels write into the live one
const histories = new Map();
const clone = (pe) => (pe ? JSON.parse(JSON.stringify(pe)) : null);
function trail(gameId, pk) {
  const k = `${gameId}/${pk}`;
  let h = histories.get(k);
  if (!h) histories.set(k, (h = { undo: [], redo: [] }));
  return h;
}
function record(gameId, pk, before) {
  const h = trail(gameId, pk);
  h.undo.push(before);
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
// what stood in a dataset before a swap: per dataset, its levels and paths by place
const pristine = new WeakMap();
function shipped(G) {
  let r = pristine.get(G);
  if (!r) pristine.set(G, (r = { levels: new Map(), paths: new Map() }));
  return r;
}

export const pristineOf = (t) => origin.get(t)?.pristine ?? t;
export const editedFields = (t) => origin.get(t)?.delta.fields ?? {};
export const pathEdited = (path) => edited.has(path);

// the object now standing in `path` for a pristine or stale TLV
export function currentOf(t, path = state.path) {
  const p = pristineOf(t);
  if (!path) return null;
  return path.tlvs.find((c) => c === p || origin.get(c)?.pristine === p) ?? null;
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
  if (!Number.isInteger(value) || value < S16_MIN || value > S16_MAX) return false;
  const map = valueMap(gameId, pristine.name, field);
  return !map || map[value] !== undefined;
}

// the path as its deltas make it: the pristine object itself when there are none
export function materializePath(gameId, pristine, pathEdits) {
  const objects = pathEdits?.objects ?? {};
  const live = Object.entries(objects).filter(([, d]) => Object.keys(d.fields ?? {}).length);
  if (!live.length) return pristine;
  if (!hasLevelShort(gameId))
    throw new Error(`${gameId}: no level map to derive destinations with`);
  const keys = objectKeys(pristine);
  const byKey = new Map(live);
  const tlvs = pristine.tlvs.map((t) => {
    const delta = byKey.get(keys.get(t));
    if (!delta) return t;
    const fields = { ...t.fields, ...delta.fields };
    const fresh = {
      ...t,
      fields,
      extra: deriveExtra(gameId, { ...t, fields }, LEVEL_SHORT[gameId]),
    };
    // the delta as materialized, not the live entry a later step writes into
    origin.set(fresh, { pristine: t, delta: clone(delta) });
    return fresh;
  });
  const fresh = { ...pristine, tlvs };
  edited.add(fresh);
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
  a.tlvs.length === b.tlvs.length &&
  a.tlvs.every((t, i) => {
    const u = b.tlvs[i];
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
    if (state.sel) state.sel = currentOf(state.sel, state.path);
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

// one field of one object, on the path in hand; the value it had shipped with
// takes the delta away again. Returns the object now standing for it.
export function applyFieldEdit(t, field, value, where = {}) {
  const gameId = where.game ?? state.data.id,
    lv = where.lv ?? state.lvl.short,
    pa = where.pa ?? state.path.id;
  const G = gameOf(gameId);
  const pristine = pristineOf(t);
  if (!hasLevelShort(gameId))
    throw new Error(`${gameId}: no level map to derive destinations with`);
  if (!validDelta(gameId, pristine, field, value))
    throw new Error(`${pristine.name}.${field}: ${value} is not a value the archive holds`);
  const pk = pathKey(lv, pa);
  const P =
    shipped(G).paths.get(pk) ?? G.levels.find((L) => L.short === lv).paths.find((p) => p.id === pa);
  const key = objectKey(P, pristine);
  if (!key) throw new Error(`${pristine.name} is not on ${lv} P${pa}`);
  const standing = all()[gameId]?.[pk]?.objects?.[key]?.fields?.[field] ?? pristine.fields[field];
  if (standing === value)
    return currentOf(
      pristine,
      G.levels.find((L) => L.short === lv).paths.find((p) => p.id === pa),
    );
  record(gameId, pk, clone(all()[gameId]?.[pk] ?? null));
  const game = (all()[gameId] ??= {});
  const path = (game[pk] ??= { objects: {} });
  const delta = (path.objects[key] ??= { fields: {} });
  if (value === pristine.fields[field]) delete delta.fields[field];
  else delta.fields[field] = value;
  if (!Object.keys(delta.fields).length) delete path.objects[key];
  if (!Object.keys(path.objects).length) delete game[pk];
  if (!Object.keys(game).length) delete edits[gameId];
  persist();
  swapPath(G, lv, pa);
  return currentOf(
    pristine,
    G.levels.find((L) => L.short === lv).paths.find((p) => p.id === pa),
  );
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
  h.redo.push(clone(all()[gameId]?.[pk] ?? null));
  restore(gameId, lv, pa, h.undo.pop());
  return true;
}

export function redoEdit(gameId, lv, pa) {
  const pk = pathKey(lv, pa),
    h = trail(gameId, pk);
  if (!h.redo.length) return false;
  h.undo.push(clone(all()[gameId]?.[pk] ?? null));
  restore(gameId, lv, pa, h.redo.pop());
  return true;
}

// the stored deltas over a dataset that has not reached the page yet: each is
// applied where it still answers to its object and dropped where it does not,
// a delta the disc has caught up with among the dropped (it no longer differs,
// and could never be taken away field by field), and the count of both waits
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
      if (!t || !Object.keys(delta.fields ?? {}).length) delete pe.objects[key];
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
  const unapplied = Object.values(all()[gameId] ?? {}).reduce(
    (n, pe) => n + Object.values(pe.objects).reduce((m, d) => m + Object.keys(d.fields).length, 0),
    0,
  );
  reports.set(gameId, { applied: 0, dropped: 0, unapplied });
}

export function takeReport(gameId) {
  const r = reports.get(gameId) ?? null;
  reports.delete(gameId);
  return r;
}
