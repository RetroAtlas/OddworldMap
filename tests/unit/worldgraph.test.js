import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { graphLayout, worldGraph } from "../../public/js/worldgraph.js";
import { CONN_COLORS, GRAPH } from "../../public/js/config.js";
import { setAnnotations } from "../../public/js/model/annotations.js";
import { CROSS_LEVEL_FOLLOWS, dataset, level, path, tlv } from "./fixtures.js";

const load = (name) =>
  JSON.parse(readFileSync(new URL(`../../public/${name}`, import.meta.url), "utf8"));

const games = () => {
  setAnnotations(load("annotations.json"));
  return [load("map_data_ao.json"), load("map_data_ae.json")];
};

// a plain same-level transition names no partner, so it is trusted as it lies
const to = (lv, pa, name = "PathTransition") => tlv(name, { to_level: lv, to_path: pa });

test("an edge is the pair of paths, counted each way its objects run", () => {
  const L = level("L", path(1, [to("L", 2), to("L", 2, "Door")]), path(2, [to("L", 1)]));
  const { nodes, edges } = worldGraph(dataset([L]));
  assert.deepEqual([...nodes.keys()], ["L P1", "L P2"]);
  assert.equal(edges.length, 1);
  const [e] = edges;
  assert.deepEqual(
    { a: e.a, b: e.b, fwd: e.fwd, rev: e.rev, n: e.n, kinds: e.kinds, kind: e.kind },
    // the kind most of the pair is made of is the one it draws in
    {
      a: "L P1",
      b: "L P2",
      fwd: 2,
      rev: 1,
      n: 3,
      kinds: { PathTransition: 2, Door: 1 },
      kind: "PathTransition",
    },
  );
});

test("a ride inside one path is no edge, and a hand stone's view is no way through", () => {
  const L = level(
    "L",
    path(1, [to("L", 1), tlv("HandStone", { view1_level: "L", view1_path: 2, view1_cam: 1 })]),
    path(2, []),
  );
  assert.equal(worldGraph(dataset([L])).edges.length, 0);
});

test("a destination the map does not believe reaches the graph no more than the map", () => {
  // the level exists and the path does not: nothing to draw an edge to
  const L = level("L", path(1, [to("L", 9)]), path(2, []));
  assert.equal(worldGraph(dataset([L])).edges.length, 0);
});

test("nodes are the columns' own order, level by level and play order within", () => {
  const A = level("A", path(2, [to("A", 1)]), path(1, []));
  const B = level("B", path(1, []));
  const g = worldGraph(dataset([A, B]));
  assert.deepEqual(
    g.cols.map((c) => [c.L.short, c.nodes.map((n) => n.pa)]),
    [
      ["A", [2, 1]],
      ["B", [1]],
    ],
  );
  assert.deepEqual([...g.nodes.keys()], ["A P2", "A P1", "B P1"]);
});

// the shipped shape, pinned: the graph is a second reading of the same walk the
// entry badges and the follows take, so a change here is a change in the data
test("the shipped games' graphs are exactly this size", () => {
  const found = games().map((data) => {
    const g = worldGraph(data);
    const L = graphLayout(g);
    return {
      id: data.id,
      nodes: g.nodes.size,
      edges: g.edges.length,
      // which end an arrowhead goes on is read straight off these
      ways: [
        g.edges.filter((e) => e.fwd && e.rev).length,
        g.edges.filter((e) => e.fwd && !e.rev).length,
        g.edges.filter((e) => !e.fwd && e.rev).length,
      ],
      rows: g.cols.map((c) => c.nodes.length),
      size: [L.w, L.h],
    };
  });
  assert.deepEqual(found, [
    {
      id: "AO",
      nodes: 74,
      edges: 77,
      ways: [64, 9, 4],
      rows: [5, 5, 5, 7, 8, 1, 8, 10, 1, 3, 18, 1, 1, 1],
      size: [3491, 809],
    },
    {
      id: "AE",
      nodes: 92,
      edges: 97,
      ways: [69, 17, 11],
      rows: [8, 6, 13, 11, 10, 11, 8, 21, 1, 2, 1],
      size: [2799, 896],
    },
  ]);
});

// a path nothing reaches and nothing leaves is a statement of its own, so it
// keeps its slot in the column rather than being dropped
test("a path with no link is still a node", () => {
  const found = games().map((data) => {
    const g = worldGraph(data);
    const linked = new Set(g.edges.flatMap((e) => [e.a, e.b]));
    return [...g.nodes.keys()].filter((k) => !linked.has(k));
  });
  // the credits and the menu, which nothing walks to: the demo copies that are
  // also edgeless are off the map by their own setting
  assert.deepEqual(found, [["C1 P1"], ["CR P1", "CR P2", "ST P1"]]);
});

// an edge with no colour would draw white and say nothing, so every kind the
// shipped data produces has to be one CONN_COLORS names
test("every edge kind the games produce has a connection colour", () => {
  for (const data of games())
    for (const e of worldGraph(data).edges)
      for (const kind of Object.keys(e.kinds))
        assert.ok(kind in CONN_COLORS, `${data.id} ${e.a}~${e.b}: ${kind}`);
});

test("the graph's cross-level edges are the pinned cross-level follows", () => {
  const found = {};
  for (const data of games()) {
    const drawn = new Set();
    for (const e of worldGraph(data).edges) {
      if (e.a.split(" ")[0] === e.b.split(" ")[0]) continue;
      if (e.fwd) drawn.add(`${e.a} -> ${e.b}`);
      if (e.rev) drawn.add(`${e.b} -> ${e.a}`);
    }
    found[data.id] = [...drawn].sort();
  }
  assert.deepEqual(found, CROSS_LEVEL_FOLLOWS);
});

// a hub of ten links used to leave its box ten times at the same point, so nine
// of the wires were painted over by the tenth and the colour was whichever came
// last. Every stub takes a line of its own across the box's own height instead.
test("no two edges are drawn on top of each other", () => {
  for (const data of games()) {
    const L = graphLayout(worldGraph(data));
    const segs = L.routes.flatMap(({ e, pts }) =>
      pts.slice(1).map((b, i) => ({ e, a: pts[i], b })),
    );
    for (let i = 0; i < segs.length; i++)
      for (let j = i + 1; j < segs.length; j++) {
        const [p, q] = [segs[i], segs[j]];
        if (p.e === q.e) continue;
        for (const ax of [0, 1]) {
          const co = 1 - ax;
          if (p.a[co] !== p.b[co] || q.a[co] !== q.b[co] || p.a[co] !== q.a[co]) continue;
          const lo = Math.max(Math.min(p.a[ax], p.b[ax]), Math.min(q.a[ax], q.b[ax]));
          const hi = Math.min(Math.max(p.a[ax], p.b[ax]), Math.max(q.a[ax], q.b[ax]));
          assert.ok(hi - lo <= 0.01, `${data.id} ${p.e.a}~${p.e.b} lies along ${q.e.a}~${q.e.b}`);
        }
      }
  }
});

// levelOrder puts an Exoddus level's endgame half at the tail of its column, so
// the break before it is one gap per column; a column that lost that property
// would draw the caption across the middle of its own rows
test("an ender half is set off at the tail of its column", () => {
  const found = games().map((data) =>
    graphLayout(worldGraph(data))
      .cols.filter((c) => c.sec)
      .map((c) => {
        const rows = c.nodes.map((n) => !!n.P.section);
        const first = rows.indexOf(true);
        assert.ok(
          rows.slice(first).every(Boolean),
          `${data.id} ${c.L.short}: the sectioned rows are not a tail`,
        );
        return `${c.L.short} ${c.sec.label} ${first}/${rows.length}`;
      }),
  );
  assert.deepEqual(found, [
    [],
    [
      "PV Mudomo Vault Ender 12/13",
      "SV Mudanchee Vault Ender 8/11",
      "FD FeeCo Depot Ender 8/10",
      "BA Barracks Ender 9/11",
      "BW Bonewerkz Ender 6/8",
    ],
  ]);
});

// the routes are one orthogonal polyline each, and the lanes are what keeps two
// of them off the same line: a collision would draw one edge as two
test("no route leaves the diagram, crosses a node box, or shares a line", () => {
  for (const data of games()) {
    const g = worldGraph(data);
    const L = graphLayout(g);
    const boxes = [...g.nodes.values()].map((n) => L.box(n));
    const runs = [];
    for (const { e, pts } of L.routes) {
      for (const [x, y] of pts)
        assert.ok(x >= 0 && y >= 0 && x <= L.w && y <= L.h, `${data.id} ${e.a}~${e.b} off diagram`);
      for (let i = 0; i + 1 < pts.length; i++) {
        const [[x1, y1], [x2, y2]] = [pts[i], pts[i + 1]];
        assert.ok(x1 === x2 || y1 === y2, `${data.id} ${e.a}~${e.b} segment is not orthogonal`);
        // both axes: a stub is meant to stay in its gutter and a band run above
        // every column, and neither is anything a reader could check by eye
        for (const b of boxes)
          assert.ok(
            Math.max(x1, x2) <= b.x ||
              Math.min(x1, x2) >= b.x + GRAPH.nodeW ||
              Math.max(y1, y2) <= b.y ||
              Math.min(y1, y2) >= b.y + GRAPH.nodeH,
            `${data.id} ${e.a}~${e.b} runs through a node box`,
          );
        if (x1 !== x2) continue;
        runs.push({ e, x: x1, lo: Math.min(y1, y2), hi: Math.max(y1, y2) });
      }
    }
    for (let i = 0; i < runs.length; i++)
      for (let j = i + 1; j < runs.length; j++) {
        const [p, q] = [runs[i], runs[j]];
        assert.ok(
          p.e === q.e || p.x !== q.x || p.lo >= q.hi || q.lo >= p.hi,
          `${data.id} ${p.e.a}~${p.e.b} and ${q.e.a}~${q.e.b} share a line`,
        );
      }
  }
});

// spreading a box's stubs is not enough on its own: dealt in the wrong order,
// a stub turning near the box climbs through the leg of one turning farther
// out, and only the fan's own stubs can tell
test("no stub crosses another leaving the same side of a box", () => {
  for (const data of games()) {
    const g = worldGraph(data);
    const L = graphLayout(g);
    const boxes = [...g.nodes.values()].map((n) => ({ n, b: L.box(n) }));
    const sideOf = ([x, y]) => {
      const hit = boxes.find(
        ({ b }) => y >= b.y && y <= b.y + GRAPH.nodeH && (x === b.x || x === b.x + GRAPH.nodeW),
      );
      return hit && `${hit.n.key} ${x === hit.b.x ? "l" : "r"}`;
    };
    const fans = new Map();
    for (const { e, pts } of L.routes) {
      const n = pts.length;
      // a stub is the leg out of the box, its turn, and the climb away from it
      for (const [edge, turn, next] of [
        [pts[0], pts[1], pts[2]],
        [pts[n - 1], pts[n - 2], pts[n - 3]],
      ]) {
        const key = sideOf(edge);
        assert.ok(key, `${data.id} ${e.a}~${e.b} does not leave from a box edge`);
        if (!fans.has(key)) fans.set(key, []);
        fans.get(key).push({ e, edge, turn, next });
      }
    }
    for (const [key, stubs] of fans)
      for (const a of stubs)
        for (const b of stubs) {
          if (a === b) continue;
          const [x1, x2] = [a.edge[0], a.turn[0]].sort((p, q) => p - q);
          const [y1, y2] = [b.turn[1], b.next[1]].sort((p, q) => p - q);
          const [bx, ay] = [b.turn[0], a.edge[1]];
          assert.ok(
            !(bx > x1 && bx < x2 && ay > y1 && ay < y2),
            `${data.id} ${key}: ${a.e.a}~${a.e.b} crosses ${b.e.a}~${b.e.b}`,
          );
        }
  }
});
