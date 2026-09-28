// The order a level lists its paths in: the order a player meets them. One walk
// of the level's own transitions out from the way in, with each area taken whole
// before the walk leaves it and the level's own numbering deciding which branch
// to take first. Importable in bare Node: no DOM.

import { pathDisplayName } from "./annotations.js";
import { pathIn, wayThrough } from "./model.js";

const DEMO = "[Demo] ";

// where a path sits: the area its name names, with the demo mark and any
// sub-area clause dropped, and its own place inside that area
function place(raw) {
  const demo = raw ? raw.startsWith(DEMO) : false;
  const name = demo ? raw.slice(DEMO.length) : (raw ?? "");
  const cut = name.indexOf(":"); // a curated colon divides an area
  return { area: cut < 0 ? name : name.slice(0, cut).trim(), sub: cut < 0 ? 0 : 1, demo: +demo };
}

// the run a numbered area belongs to: the word before its first number, plural
// folded, so "Annexes 3-6" and "Entrance and Annex 2" sit with "Annex 1"
function run(area) {
  const m = /^(.*?)(\d+)/.exec(area);
  if (!m) return null;
  const stem = m[1].trim().split(/\s+/).pop().toLowerCase();
  return { stem: stem.replace(/e?s$/, ""), num: +m[2] };
}

// the areas a level is built from, each holding its own paths. A path the discs
// never named is an area of one: nothing but a name can pool two of them
function areasOf(gameId, level) {
  const byKey = new Map();
  for (const P of level.paths) {
    const raw = pathDisplayName(gameId, level.short, P);
    const p = place(raw);
    const key = raw ? JSON.stringify([P.section || "", p.area]) : `#${P.id}`;
    let A = byKey.get(key);
    if (!A) {
      A = { section: P.section || "", run: raw ? run(p.area) : null, first: P.id, paths: [] };
      byKey.set(key, A);
    }
    A.paths.push({ P, sub: p.sub, demo: p.demo });
    A.first = Math.min(A.first, P.id);
  }
  return [...byKey.values()];
}

// the numbering the level counts itself with — the run naming the most of its
// areas, the zulags rather than the Brewery's three hubs. Numbers only ever
// compare inside one run, so a level gets at most one
function numbering(areas) {
  const tally = new Map();
  for (const A of areas) if (A.run) tally.set(A.run.stem, (tally.get(A.run.stem) || 0) + 1);
  let stem = null,
    most = 0;
  for (const s of [...tally.keys()].sort())
    if (tally.get(s) > most) [stem, most] = [s, tally.get(s)];
  return stem;
}

// every path a path's objects travel to inside its own level, in the order the
// path stores them, and whether any of them travels out of the level at all
function transitions(data, level) {
  const to = new Map(),
    away = new Map();
  for (const P of level.paths) {
    const here = [];
    let leaves = false;
    for (const t of P.tlvs) {
      const d = wayThrough(t, data, level, P);
      if (!d || !pathIn(data, d.lv, d.pa)) continue;
      if (d.lv !== level.short) leaves = true;
      else if (d.pa !== P.id) here.push(d.pa);
    }
    to.set(P.id, here);
    away.set(P.id, leaves);
  }
  return { to, away };
}

let ordered = new WeakMap();

// every path id in the level, in the order a player meets them, memoized whole
export function levelOrder(data, level) {
  let ids = ordered.get(level);
  if (!ids) ordered.set(level, (ids = walkLevel(data, level)));
  return ids.slice(); // the memo is nobody's to sort
}

function walkLevel(data, level) {
  const areas = areasOf(data.id, level);
  const stem = numbering(areas);
  const num = (A) => (A.run && A.run.stem === stem ? A.run.num : null);
  const home = new Map();
  for (const A of areas) for (const m of A.paths) home.set(m.P.id, A);
  const { to, away } = transitions(data, level);
  // the ways out of each area, each naming the path it lands on
  const ways = new Map(areas.map((A) => [A, []]));
  for (const A of areas)
    for (const m of A.paths)
      for (const pa of to.get(m.P.id)) {
        const B = home.get(pa);
        if (B !== A) ways.get(A).push({ B, at: pa });
      }

  const entry = levelEntry(data)[level.short];
  const start = home.get(entry) ?? areas[0];
  const seen = new Set([start]);
  const walk = [{ A: start, at: entry }];

  // the lowest number still ahead of an area, itself included, or null where the
  // branch reaches no number at all. What the numbers count is the route through
  // the level, so the branch whose number comes soonest is the one a player is
  // sent down first, and one reaching none of them is a pocket looked into first
  const route = (A) => {
    const met = new Set([A]);
    const q = [A];
    let best = null;
    while (q.length) {
      const X = q.shift();
      const n = num(X);
      if (n != null && (best == null || n < best)) best = n;
      for (const w of ways.get(X))
        if (!seen.has(w.B) && !met.has(w.B)) {
          met.add(w.B);
          q.push(w.B);
        }
    }
    return best;
  };
  const before = (a, b) => a[0] - b[0] || a[1] - b[1] || a[2] - b[2];

  for (;;) {
    const open = new Map();
    for (const w of walk)
      for (const e of ways.get(w.A)) if (!seen.has(e.B) && !open.has(e.B)) open.set(e.B, e.at);
    if (!open.size) break;
    let pick = null;
    for (const [A, at] of open) {
      const n = route(A);
      const k = [n == null ? 0 : 1, n ?? 0, A.first];
      if (!pick || before(k, pick.k) < 0) pick = { A, at, k };
    }
    seen.add(pick.A);
    walk.push({ A: pick.A, at: pick.at });
  }

  // an area nothing travels to still belongs to the run its name counts in
  let out = walk.slice();
  for (const A of areas) {
    if (seen.has(A)) continue;
    const n = num(A);
    const k = n == null ? -1 : out.findIndex((w, i) => i > 0 && num(w.A) > n);
    out.splice(k < 0 ? out.length : k, 0, { A, at: null });
  }
  // an Exoddus level's endgame half sits at its tail, in the order it was met
  out = [...out.filter((w) => !w.A.section), ...out.filter((w) => w.A.section)];

  // and inside an area the same walk again, from the path it was entered at. A
  // path you can only come back from goes before one that carries you on, which
  // is the pocket rule again at path scale
  const cmp = (a, b) => a.demo - b.demo || a.sub - b.sub || a.P.id - b.P.id;
  const ids = [];
  for (const { A, at } of out) {
    const mine = new Map(A.paths.map((m) => [m.P.id, m]));
    const got = new Set();
    const spent = (id) => !away.get(id) && to.get(id).every((v) => mine.has(v) && got.has(v));
    const step = (id) => {
      got.add(id);
      ids.push(id);
      const next = [...new Set(to.get(id))].filter((v) => mine.has(v) && !got.has(v));
      next.sort((x, y) => spent(y) - spent(x) || cmp(mine.get(x), mine.get(y)));
      for (const v of next) if (!got.has(v)) step(v);
    };
    if (at != null && mine.has(at)) step(at);
    for (const m of [...A.paths].sort(cmp)) if (!got.has(m.P.id)) step(m.P.id);
  }
  return ids;
}

// a permutation of the paths handed in, same objects, input left alone; the
// order is the level's whole one, so a subset of it comes back in that order too
export function orderPaths(data, level, paths) {
  const at = new Map(levelOrder(data, level).map((id, i) => [id, i]));
  return [...paths].sort((a, b) => at.get(a.id) - at.get(b.id));
}

let elected = new WeakMap();

// a dataset whose transitions changed: the elections and every walk seeded from
// them are recomputed on the next ask, whichever level's object the change sat in
export function invalidateEntry(data) {
  elected.delete(data);
  ordered = new WeakMap();
}

// where each level is entered: the way in from a level before it, else the
// game's own start marker, else any arrival — a later level's door back in is
// not the way in, and a start marker can sit deep inside the level
export function levelEntry(data) {
  let e = elected.get(data);
  if (e) return e;
  const order = new Map(data.levels.map((L, i) => [L.short, i]));
  const fwd = {},
    back = {},
    start = {};
  const keep = (m, lv, pa) => {
    if (m[lv] == null || pa < m[lv]) m[lv] = pa;
  };
  for (const L of data.levels)
    for (const P of L.paths)
      for (const t of P.tlvs) {
        if (t.name === "AbeStart") keep(start, L.short, P.id);
        const d = wayThrough(t, data, L, P);
        if (!d || d.lv === L.short || !pathIn(data, d.lv, d.pa)) continue;
        keep(order.get(d.lv) > order.get(L.short) ? fwd : back, d.lv, d.pa);
      }
  e = {};
  for (const L of data.levels)
    e[L.short] = fwd[L.short] ?? start[L.short] ?? back[L.short] ?? L.paths[0].id;
  elected.set(data, e);
  return e;
}
