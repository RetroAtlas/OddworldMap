// A release over the base: its overlay's final values stood up over the base
// as it shipped, through the sandbox's own pieces, and what each object, line
// and screen owes to the release. Nothing here writes into the base.
// Importable in bare Node.

import { objectKeys, pristineLevels, pristineOf, typeTable } from "./edits.js";
import { deriveExtra } from "./extra.js";
import { newObject } from "./objecttypes.js";

// a release's object -> the base object it stands for and the delta it carries
const fromBase = new WeakMap();
const addedBy = new WeakSet();
// a camera entry whose art is the release's own
const regional = new WeakSet();

const sameLine = (a, b) => a.length === b.length && a.every((v, i) => v === b[i]);

// the release's dataset: the base's identity and geometry, the release's title,
// and every path the overlay names stood up anew, the others the base's own
export function materializeRelease(base, overlay, levelShort) {
  if (overlay.game !== base.id) throw new Error(`${overlay.code}: an overlay of ${overlay.game}`);
  const table = typeTable(base);
  const entries = overlay.paths ?? {};
  const levels = pristineLevels(base).map((L) =>
    L.paths.some((P) => entries[`${L.short}/${P.id}`])
      ? {
          ...L,
          paths: L.paths.map((P) => {
            const e = entries[`${L.short}/${P.id}`];
            return e ? releasePath(base.id, P, e, table, levelShort) : P;
          }),
        }
      : L,
  );
  const release = Object.fromEntries(
    Object.entries(overlay).filter(([k]) => k !== "game" && k !== "paths"),
  );
  return { ...base, game: overlay.title, levels, release };
}

function releasePath(gameId, P, e, table, levelShort) {
  const out = { ...P };
  const record = { objects: false, removed: [], lines: null, gone: [], cams: false };
  if (e.objects) {
    record.objects = true;
    const keys = objectKeys(P);
    const standing = new Map();
    const tlvs = [];
    for (const t of P.tlvs) {
      const key = keys.get(t);
      const d = e.objects[key];
      if (d?.removed) {
        record.removed.push(t);
        continue;
      }
      let o = t;
      if (d) {
        o = { ...t };
        if (d.rect) [o.x1, o.y1, o.x2, o.y2] = d.rect;
        if (t.fields && d.fields) o.fields = { ...t.fields, ...d.fields };
        o.extra = deriveExtra(gameId, o, levelShort);
        fromBase.set(o, { base: t, delta: d });
      }
      standing.set(key, o);
      tlvs.push(o);
    }
    // each addition after the object it follows in the release's list, in the
    // order they were numbered, which is that list's
    const additions = Object.entries(e.objects)
      .filter(([k]) => /^\+\d+$/.test(k))
      .sort(([a], [b]) => +a.slice(1) - +b.slice(1));
    for (const [key, d] of additions) {
      const o = newObject(table, d.name, d.rect, d.fields);
      o.extra = deriveExtra(gameId, o, levelShort);
      addedBy.add(o);
      const at = d.after == null ? 0 : tlvs.indexOf(standing.get(d.after)) + 1;
      if (!at && d.after != null) throw new Error(`${key} follows ${d.after}, which no object is`);
      tlvs.splice(at, 0, o);
      standing.set(key, o);
    }
    out.tlvs = tlvs;
  }
  if (e.lines) {
    out.lines = e.lines;
    const left = [...P.lines];
    record.lines = new Set();
    e.lines.forEach((l, i) => {
      const j = left.findIndex((b) => sameLine(b, l));
      if (j < 0) record.lines.add(i);
      else left.splice(j, 1);
    });
    record.gone = left;
    record.links = e.links;
  }
  if (e.cams) {
    record.cams = true;
    // a camera the base holds keeps its screen under whatever patches the release draws over it
    const own = (c, v, base) => {
      const cam = { cell: v.cell, name: c, png: v.png ?? base?.png };
      if (v.patches) cam.patches = v.patches;
      if (v.masks) cam.masks = v.masks;
      regional.add(cam);
      return cam;
    };
    const cams = P.cams
      .filter((c) => e.cams[c.name] !== null)
      .map((c) => (e.cams[c.name] ? own(c.name, { ...e.cams[c.name], cell: c.cell }, c) : c));
    for (const [name, v] of Object.entries(e.cams))
      if (v && !P.cams.some((c) => c.name === name)) cams.push(own(name, v));
    out.cams = cams.sort((a, b) => a.cell - b.cell);
    record.dropped = P.cams.filter((c) => e.cams[c.name] === null).map((c) => c.name);
  }
  if (e.messages) record.messages = e.messages;
  out.release = record;
  return out;
}

// the release a dataset stands for, or null for the base
export const releaseOf = (G) => G?.release ?? null;
// the base object a release's object stands for: itself where the release
// leaves it as the base has it, none where the release adds it
export function baseObject(t) {
  const p = pristineOf(t);
  if (addedBy.has(p)) return null;
  return fromBase.get(p)?.base ?? p;
}
export const releaseAdded = (t) => addedBy.has(pristineOf(t));
// what the release changes on an object: each field's base and release value,
// then whether it moved and whether it was resized; an addition is the whole of it
export function releaseChanges(t) {
  const p = pristineOf(t);
  if (addedBy.has(p)) return { added: true };
  const o = fromBase.get(p);
  if (!o) return null;
  const fields = Object.entries(o.delta.fields ?? {}).map(([f, v]) => [f, o.base.fields[f], v]);
  const b = o.base;
  return {
    fields,
    moved: b.x1 !== p.x1 || b.y1 !== p.y1,
    resized: b.x2 - b.x1 !== p.x2 - p.x1 || b.y2 - b.y1 !== p.y2 - p.y1,
  };
}
export const isRegional = (cam) => regional.has(cam);
// what the release changes on a path, or null where it is the base's
export const pathRelease = (P) => P?.release ?? null;

// a release's sprite sidecar: the base's with the release's own parts over it,
// and its line links for every path whose lines the release carries
export function releaseSprites(base, R) {
  const rel = R.release;
  const links = { ...base.links };
  for (const L of R.levels)
    for (const P of L.paths)
      if (P.release?.links)
        links[L.short] = {
          ...links[L.short],
          [P.id]: P.release.links.map((row) => row.slice(0, 2)),
        };
  return {
    ...base,
    anims: { ...base.anims, ...rel.sprites?.anims },
    sheets: { ...base.sheets, ...rel.sheets },
    font: rel.font ? { ...rel.font, sheet: base.font.sheet } : base.font,
    dice: rel.dice ?? base.dice,
    links,
  };
}

// releaseChanges as words, none for an object the release leaves as the base has it
export function releaseNotes(t) {
  const c = releaseChanges(t);
  if (!c) return [];
  if (c.added) return ["added"];
  return [
    ...c.fields.map(([f, from, to]) => `${f} ${from} → ${to}`),
    ...(c.moved ? ["moved"] : []),
    ...(c.resized ? ["resized"] : []),
  ];
}
// a release's own words for an object, `Europe: zone_number 31 → 29`, or null
export function releaseNote(G, t) {
  const notes = G?.release ? releaseNotes(t) : [];
  return notes.length ? `${G.release.name}: ${notes.join(", ")}` : null;
}
// whether a release changes anything on a path: its objects, lines or screens
export const pathReleased = (P) => {
  const r = pathRelease(P);
  return !!r && (r.objects || !!r.lines || r.cams);
};
