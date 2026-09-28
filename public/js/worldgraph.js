// The whole game as one diagram: every path a node, every trusted transition
// between two of them an edge, laid out as a column per level in progression
// order with its paths stacked in play order. Importable in bare Node: no DOM.

import { GRAPH } from "./config.js";
import { pathVisible } from "./pathvisible.js";
import { pathIn, wayThrough } from "./model.js";
import { levelOrder } from "./pathorder.js";

const key = (lv, pa) => `${lv} P${pa}`;

// nodes and edges of one game. An edge is the pair of paths, whichever way its
// objects run: `fwd` counts the ones travelling from a to b and `rev` the ones
// coming back, so a way through the game offers one way only says so.
export function worldGraph(data) {
  const cols = data.levels.map((L, col) => ({
    L,
    col,
    nodes: levelOrder(data, L)
      .map((pa) => L.paths.find((P) => P.id === pa))
      .filter(pathVisible)
      .map((P, row) => ({ key: key(L.short, P.id), lv: L.short, pa: P.id, L, P, col, row })),
  }));
  const nodes = new Map(cols.flatMap((c) => c.nodes).map((n) => [n.key, n]));
  const rank = new Map([...nodes.keys()].map((k, i) => [k, i]));
  const found = new Map();
  for (const L of data.levels)
    for (const P of L.paths)
      for (const t of P.tlvs) {
        const d = wayThrough(t, L, P, data.geometry, data);
        if (!d || !pathIn(data, d.lv, d.pa)) continue;
        if (d.lv === L.short && d.pa === P.id) continue; // a ride inside one path
        const from = key(L.short, P.id),
          to = key(d.lv, d.pa);
        if (!nodes.has(from) || !nodes.has(to)) continue; // a copy the map is not listing
        const back = rank.get(to) < rank.get(from);
        const [a, b] = back ? [to, from] : [from, to];
        let e = found.get(`${a}|${b}`);
        if (!e) found.set(`${a}|${b}`, (e = { a, b, fwd: 0, rev: 0, n: 0, kinds: {}, kind: "" }));
        e[back ? "rev" : "fwd"]++;
        e.n++;
        e.kinds[t.name] = (e.kinds[t.name] || 0) + 1;
      }
  for (const e of found.values())
    e.kind = Object.keys(e.kinds).sort((p, q) => e.kinds[q] - e.kinds[p] || (p < q ? -1 : 1))[0];
  return { cols, nodes, edges: [...found.values()] };
}

// a lane per span such that no two overlapping spans share one, shortest first
// so the tightest route runs nearest whatever it hugs
function lanes(spans) {
  const taken = [],
    lane = new Map();
  for (const [item, lo, hi] of [...spans].sort((p, q) => p[2] - p[1] - (q[2] - q[1]))) {
    let l = 0;
    while ((taken[l] || []).some(([a, b]) => lo < b && a < hi)) l++;
    (taken[l] ??= []).push([lo, hi]);
    lane.set(item, l);
  }
  return { lane, count: taken.length };
}

const push = (m, k, v) => (m.get(k) ?? m.set(k, []).get(k)).push(v);

// Where every node and edge is drawn. An edge is an orthogonal polyline routed
// in the gutter right of a column: one inside a level hugs its own boxes, one
// between neighbouring levels crosses a single gutter, and one reaching further
// travels the band above every column. Each takes a lane of its own, so two
// never run down the same line.
export function graphLayout(g, geo = GRAPH) {
  const at = (k) => g.nodes.get(k);
  const inner = [],
    outer = [];
  for (const e of g.edges) (at(e.a).col === at(e.b).col ? inner : outer).push(e);

  const byCol = new Map();
  for (const e of inner) push(byCol, at(e.a).col, e);
  const iLane = new Map(),
    iCount = new Map();
  for (const [c, list] of byCol) {
    const packed = lanes(list.map((e) => [e, ...[at(e.a).row, at(e.b).row].sort((p, q) => p - q)]));
    for (const [e, l] of packed.lane) iLane.set(e, l);
    iCount.set(c, packed.count);
  }

  // an edge between levels drops into the gutter at each end; both ends reserve
  // up to the band whether they reach it or not, so one lane serves either shape
  const ends = new Map(
    outer.map((e) => {
      const [p, q] = [at(e.a), at(e.b)].sort((x, y) => x.col - y.col);
      return [e, { p, q, gp: p.col, gq: q.col - 1 }];
    }),
  );
  const byGut = new Map();
  for (const [e, x] of ends) for (const gi of new Set([x.gp, x.gq])) push(byGut, gi, e);
  const gLane = new Map(),
    gCount = new Map();
  for (const [gi, list] of byGut) {
    const packed = lanes(
      list.map((e) => [e, -1, ends.get(e)[gi === ends.get(e).gp ? "p" : "q"].row]),
    );
    for (const [e, l] of packed.lane) gLane.set(`${gi} ${e.a} ${e.b}`, l);
    gCount.set(gi, packed.count);
  }
  const band = lanes(
    outer
      .filter((e) => ends.get(e).gq > ends.get(e).gp)
      .map((e) => [e, ends.get(e).gp, ends.get(e).gq + 1]),
  );

  const xs = [geo.pad];
  for (let c = 0; c < g.cols.length; c++)
    xs.push(
      xs[c] +
        geo.nodeW +
        Math.max(
          geo.gutter,
          geo.laneGap * 2 + geo.lane * ((iCount.get(c) || 0) + (gCount.get(c) || 0)),
        ),
    );
  const top = geo.pad + (band.count ? (band.count + 1) * geo.bandLane : 0) + geo.headH;
  // an Exoddus level's ender half is a contiguous tail of the walk, so the break
  // before it is one row offset per column rather than a test per row
  const secAt = g.cols.map((c) => {
    const i = c.nodes.findIndex((n) => n.P.section);
    return i < 0 ? Infinity : i;
  });
  const colX = (c) => xs[c];
  const rowY = (n) => top + n.row * geo.rowPitch + (n.row >= secAt[n.col] ? geo.secGap : 0);
  const mid = (n) => rowY(n) + geo.nodeH / 2;
  const right = (n) => colX(n.col) + geo.nodeW;
  // a route's own line: a level's own edges hug the boxes, the ones leaving it
  // hang off the gutter's far side
  const iX = (n, e) => right(n) + geo.laneGap + iLane.get(e) * geo.lane;
  const gX = (gi, e) => colX(gi + 1) - geo.laneGap - gLane.get(`${gi} ${e.a} ${e.b}`) * geo.lane;

  // Every route as the two stubs it leaves its boxes by: the side, the line it
  // turns at and the y it is heading for. `depY` then spreads a box's stubs
  // across its own height, so a ten-link hub reads as an interchange instead of
  // one wire painted over nine others.
  const stubs = g.edges.map((e) => {
    const a = at(e.a),
      b = at(e.b);
    if (a.col === b.col) {
      const x = iX(a, e);
      return [
        { e, n: a, side: "r", x, dest: mid(b) },
        { e, n: b, side: "r", x, dest: mid(a) },
      ];
    }
    const { p, q, gp, gq } = ends.get(e);
    const xp = gX(gp, e),
      xq = gX(gq, e);
    if (gp === gq)
      return [
        { e, n: p, side: "r", x: xp, dest: mid(q) },
        { e, n: q, side: "l", x: xp, dest: mid(p) },
      ];
    const y = geo.pad + (band.lane.get(e) + 1) * geo.bandLane;
    return [
      { e, n: p, side: "r", x: xp, dest: y },
      { e, n: q, side: "l", x: xq, dest: y },
    ];
  });
  const depY = new Map();
  const bySide = new Map();
  for (const [s, t] of stubs) for (const x of [s, t]) push(bySide, `${x.n.key} ${x.side}`, x);
  for (const [, list] of bySide) {
    const m = mid(list[0].n);
    // everything heading up above everything heading down, and inside each half
    // the nearer turn where it cannot cut across a farther one: that ordering is
    // what makes a fan crossing-free rather than merely spread out
    const up = (s) => s.dest < m;
    const order = [...list].sort((s, t) =>
      up(s) !== up(t)
        ? up(s)
          ? -1
          : 1
        : (s.x - t.x) * (up(s) ? 1 : -1) * (s.side === "r" ? 1 : -1),
    );
    const pitch = order.length > 1 ? Math.min(geo.fan, (geo.nodeH - 2) / (order.length - 1)) : 0;
    order.forEach((s, i) => depY.set(s, m + (i - (order.length - 1) / 2) * pitch));
  }

  const routes = stubs.map(([s, t]) => {
    const from = [s.side === "r" ? right(s.n) : colX(s.n.col), depY.get(s)];
    const into = [t.side === "r" ? right(t.n) : colX(t.n.col), depY.get(t)];
    const pts = [from, [s.x, from[1]]];
    if (s.x !== t.x) pts.push([s.x, s.dest], [t.x, s.dest]);
    pts.push([t.x, into[1]], into);
    return { e: s.e, pts };
  });

  const bottom = Math.max(...g.cols.flatMap((c) => c.nodes.map((n) => rowY(n) + geo.nodeH)));
  return {
    w: colX(g.cols.length - 1) + geo.nodeW + geo.pad,
    h: bottom + geo.pad,
    top,
    cols: g.cols.map((c, i) => ({
      ...c,
      x: colX(c.col),
      // the gap the sectioned rows were pushed down by is the caption's band
      sec:
        secAt[i] === Infinity
          ? null
          : {
              y: rowY(c.nodes[secAt[i]]) - geo.secGap,
              label: c.nodes[secAt[i]].P.section,
            },
    })),
    box: (n) => ({ x: colX(n.col), y: rowY(n) }),
    routes,
  };
}
