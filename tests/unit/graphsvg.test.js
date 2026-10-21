import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { INK, graphName, graphSvg, marker, wirePath } from "../../public/js/graphsvg.js";
import { graphLayout, worldGraph } from "../../public/js/worldgraph.js";
import { computeEntryPaths } from "../../public/js/model.js";
import { setAnnotations } from "../../public/js/annotations.js";
import { getSettings } from "../../public/js/settings.js";
import { dataset, level, path, tlv } from "./fixtures.js";
import { materializePath, setLevelShort } from "../../public/js/edits.js";

const load = (name) =>
  JSON.parse(readFileSync(new URL(`../../public/${name}`, import.meta.url), "utf8"));

const games = () => {
  setAnnotations(load("annotations.json"));
  return [load("map_data_ao.json"), load("map_data_ae.json")];
};

const count = (s, re) => (s.match(re) || []).length;

// localStorage is absent in bare Node, so getSettings() hands back the defaults
// object itself and a test can drive the setting through it
const withDemoPaths = (on, run) => {
  const s = getSettings();
  const was = s.showDemoPaths;
  s.showDemoPaths = on;
  try {
    run();
  } finally {
    s.showDemoPaths = was;
  }
};

test("the shipped diagrams serialize whole, at the layout's own size", () => {
  const found = games().map((data) => {
    const g = worldGraph(data);
    const laid = graphLayout(g);
    const kinds = new Set(g.edges.map((e) => e.kind)).size;
    const { svg, w, h, demo } = graphSvg(data);
    assert.ok(svg.includes(`<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}"`));
    assert.ok(svg.includes(`viewBox="0 0 ${w} ${h}"`));
    // every wire is drawn from the layout the file was asked for, dimmed the
    // way the stylesheet dims the screen's
    assert.ok(svg.includes(wirePath(laid.routes[0], ' opacity="0.8"')));
    assert.equal(count(svg, /<path opacity=/g), laid.routes.length);
    // the scale reaches only the root, so an intrinsic-size rasterizer is crisp
    const twice = graphSvg(data, { scale: 2 }).svg;
    assert.ok(twice.includes(`width="${w * 2}" height="${h * 2}" viewBox="0 0 ${w} ${h}"`));
    assert.equal(count(svg, /<path/g), laid.routes.length + kinds);
    assert.equal(count(svg, /rx="4"/g), g.nodes.size);
    assert.equal(count(svg, /font-weight="700"/g), g.cols.length);
    assert.equal(count(svg, /marker-start/g), 0);
    for (const c of laid.cols)
      if (c.sec) assert.ok(svg.includes(`>${c.sec.label.toUpperCase()}</text>`));
    return {
      id: data.id,
      demo,
      size: [w, h],
      heads: count(svg, /marker-end/g),
      secs: count(svg, /letter-spacing/g),
    };
  });
  assert.deepEqual(found, [
    { id: "AO", demo: false, size: [3491, 853], heads: 13, secs: 0 },
    { id: "AE", demo: false, size: [2799, 940], heads: 28, secs: 5 },
  ]);
});

test("a diagram listing demo copies says so, and one without them never does", () => {
  withDemoPaths(true, () => {
    const [ao, ae] = games();
    const grown = graphSvg(ae);
    assert.equal(count(grown.svg, /rx="4"/g), 117);
    assert.equal(grown.demo, true);
    assert.ok(grown.svg.includes("117 paths, 120 links, with demo paths"));
    // the marker is read off the built nodes: Oddysee has no demo copies to list
    const same = graphSvg(ao);
    assert.equal(same.demo, false);
    assert.ok(!same.svg.includes("with demo paths"));
  });
});

test("a diagram holding an edited path says so in its name, its title and on the box", () => {
  const hoist = {
    t: 3,
    name: "Hoist",
    x1: 0,
    y1: 0,
    x2: 10,
    y2: 10,
    extra: {},
    fields: { hoist_type: 0 },
  };
  const P = path(1, [hoist]);
  const data = dataset([level("L", P, path(2, []))]);
  const plain = graphSvg(data);
  assert.equal(plain.edited, false);
  assert.ok(!plain.svg.includes("◆") && !plain.svg.includes("with edits"));
  setLevelShort("XX", {});
  data.levels[0].paths[0] = materializePath("XX", P, {
    objects: { "Hoist@0,0": { fields: { hoist_type: 1 } } },
  });
  const marked = graphSvg(data);
  assert.equal(marked.edited, true);
  assert.equal(count(marked.svg, /◆/g), 1);
  assert.ok(marked.svg.includes("2 paths, 0 links, with edits made on this device"));
  assert.equal(
    graphName(data.id, plain.demo, marked.edited, "svg"),
    "oddworld-xx-graph-edited.svg",
  );
});

test("entry marks are computeEntryPaths', node for node", () => {
  for (const data of games()) {
    const g = worldGraph(data);
    const entry = computeEntryPaths(data);
    const expected = [...g.nodes.values()].filter((n) => entry[n.lv]?.has(n.pa)).length;
    assert.ok(expected > 0, `${data.id}: no entry paths to mark`);
    assert.equal(count(graphSvg(data).svg, /▸/g), expected);
  }
});

// the file has to render wherever it lands, so nothing in it may reach for the
// page: no classes, no stylesheet, no var(), no reference past its own defs
test("the file is self-contained", () => {
  for (const data of games()) {
    const { svg } = graphSvg(data);
    assert.ok(svg.startsWith(`<?xml version="1.0" encoding="UTF-8"?>`));
    assert.ok(svg.includes("<title>"));
    assert.ok(!svg.includes("var("));
    assert.ok(!svg.includes("<style"));
    assert.ok(!svg.includes(" class="));
    assert.ok(!svg.includes("href"));
    assert.ok(!svg.includes("<image"));
    assert.ok(!svg.includes("<foreignObject"));
    assert.ok(!/url\((?!#)/.test(svg));
  }
});

test("what the data names is escaped on its way into the file, at every site", () => {
  const hostile = `A&B "x" <y>`;
  const escaped = `A&amp;B &quot;x&quot; &lt;y&gt;`;
  // one hostile string through every serialized text: the level head, a path's
  // own name, a section caption and the strip's title
  const data = dataset([
    level(hostile, { ...path(1, []), name: hostile }, { ...path(2, []), section: hostile }),
  ]);
  data.game = hostile;
  const { svg } = graphSvg(data);
  assert.equal((svg.match(/A&amp;B &quot;[xX]&quot; &lt;[yY]&gt;/g) || []).length, 6);
  assert.ok(svg.includes(escaped));
  assert.ok(!svg.includes("<y>") && !svg.includes("<Y>"));
});

// the serializer's palette is main.css's :root by hand, which is exactly the
// drift a second renderer invites — the stylesheet is the authority
test("the inlined palette matches the stylesheet", () => {
  const css = readFileSync(new URL("../../public/css/main.css", import.meta.url), "utf8");
  const decl = (name) => css.match(new RegExp(`  ${name}: ([^;]+);`))[1];
  for (const [key, token] of [
    ["bg", "--bg"],
    ["panel", "--panel"],
    ["text", "--text"],
    ["dim", "--dim"],
    ["line", "--line"],
  ])
    assert.equal(INK[key], decl(token));
  const accent = decl("--accent-rgb")
    .split(",")
    .map((v) => (+v).toString(16).padStart(2, "0"));
  assert.equal(INK.accent, `#${accent.join("")}`);
  const editRgb = decl("--edit-rgb")
    .split(",")
    .map((v) => (+v).toString(16).padStart(2, "0"));
  assert.equal(INK.edit, `#${editRgb.join("")}`);
  const wire = css.match(/\.gv-wire \{[^}]*\}/)[0];
  const sw = wire.match(/stroke-width: ([\d.]+);/)[1];
  const op = wire.match(/(?<!-)opacity: ([\d.]+);/)[1];
  const linked = dataset([
    level("L", path(1, [tlv("PathTransition", { to_level: "L", to_path: 2 })]), path(2, [])),
  ]);
  const { svg } = graphSvg(linked);
  assert.ok(svg.includes(`<g fill="none" stroke-width="${sw}">`));
  assert.ok(svg.includes(`<path opacity="${op}" d="`));
  // the other half of the drift pin: the screen's own rules still paint with
  // the tokens INK mirrors, or a retheme diverges the file with the suite green
  for (const [sel, decl] of [
    ["#graphView", "background: var(--bg)"],
    [".gv-node", "background: var(--panel)"],
    [".gv-node", "border: 1px solid var(--line)"],
    [".gv-node", "color: var(--text)"],
    [".gv-pa", "color: var(--dim)"],
    [".gv-sec", "color: var(--dim)"],
    [".gv-head", "color: var(--accent)"],
  ]) {
    const block = css.match(new RegExp(`${sel.replace(/[.#]/g, "\\$&")} \\{[^}]*\\}`))[0];
    assert.ok(block.includes(`${decl};`), `${sel} ${decl}`);
  }
});

test("the export names the game and the diagram it holds", () => {
  assert.equal(graphName("AO", false, false, "svg"), "oddworld-ao-graph.svg");
  assert.equal(graphName("AE", true, false, "png"), "oddworld-ae-graph-demos.png");
  assert.equal(graphName("AE", false, true, "svg"), "oddworld-ae-graph-edited.svg");
  assert.equal(graphName("AE", true, true, "png"), "oddworld-ae-graph-demos-edited.png");
  assert.equal(graphName("AO", false, false, "svg", "jp"), "oddworld-ao-jp-graph.svg");
});

test("a head sits on the travel end, whichever way the route was drawn", () => {
  const pts = [
    [0, 0],
    [8, 0],
  ];
  assert.ok(marker("Door").includes(`orient="auto"`));
  assert.ok(marker("Door").includes("#ffd23e"));
  const fwd = wirePath({ e: { fwd: 1, rev: 0, kind: "Door" }, pts });
  assert.ok(fwd.includes(`d="M0 0 L8 0"`) && fwd.includes("marker-end"));
  const rev = wirePath({ e: { fwd: 0, rev: 1, kind: "Door" }, pts });
  assert.ok(rev.includes(`d="M8 0 L0 0"`) && rev.includes("marker-end"));
  const both = wirePath({ e: { fwd: 2, rev: 1, kind: "Door" }, pts });
  assert.ok(both.includes(`d="M0 0 L8 0"`) && !both.includes("marker-end"));
  const classed = wirePath({ e: { fwd: 1, rev: 0, kind: "Door" }, pts }, ' class="x"');
  assert.ok(classed.startsWith(`<path class="x" d="M0 0 L8 0"`));
});
