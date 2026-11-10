import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { emitFiles, htmlUnder } from "../../tools/levelpages.js";
import { parseHash } from "../../public/js/model/model.js";
import { isDemoPath } from "../../public/js/model/demo.js";

const pub = (rel) => new URL(`../../public/${rel}`, import.meta.url);
const load = (name) => JSON.parse(readFileSync(pub(name), "utf8"));

const games = { AO: load("map_data_ao.json"), AE: load("map_data_ae.json") };
const files = emitFiles();
const pages = [...files.keys()].filter((k) => k.endsWith(".html"));

test("the committed pages and sitemap are a fresh emit", () => {
  for (const [rel, text] of files)
    assert.equal(
      readFileSync(pub(rel), "utf8"),
      text,
      `${rel} differs from a fresh emit — rerun \`node tools/levelpages.js\` or fix the emitter`,
    );
  assert.deepEqual(
    [...htmlUnder(pub("levels/"), "levels/")].sort(),
    pages.sort(),
    "public/levels/ holds a page a fresh emit does not — rerun `node tools/levelpages.js`",
  );
});

test("one page per level per game, plus the index", () => {
  const expected = Object.values(games).reduce((n, G) => n + G.levels.length, 1);
  assert.equal(pages.length, expected);
});

test("every deep link names a level and path the shipped data holds", () => {
  for (const rel of pages)
    for (const [, hash] of files.get(rel).matchAll(/href="\/(#[^"]+)"/g)) {
      const p = parseHash(hash);
      assert.ok(p, `${rel}: unparseable link ${hash}`);
      const G = games[p.game];
      assert.ok(G, `${rel}: unknown game in ${hash}`);
      const L = G.levels.find((l) => l.short === p.level);
      assert.ok(L, `${rel}: unknown level in ${hash}`);
      assert.ok(
        L.paths.some((P) => P.id === p.path),
        `${rel}: ${hash} names a path ${p.level} does not have`,
      );
    }
});

test("every page's image names a file the repo ships", () => {
  for (const rel of pages)
    for (const [, src] of files.get(rel).matchAll(/src="([^"]+)"/g)) {
      assert.match(src, /^\//, `${rel}: image ${src} is not root-absolute`);
      assert.ok(existsSync(pub(src.slice(1))), `${rel}: missing image ${src}`);
    }
});

test("no demo path is linked and no page says [Demo]", () => {
  const demoHrefs = new Set();
  for (const [id, G] of Object.entries(games))
    for (const L of G.levels)
      for (const P of L.paths)
        if (isDemoPath(P)) demoHrefs.add(`href="/#${id}/${L.short}/${P.id}"`);
  for (const rel of pages) {
    const text = files.get(rel);
    assert.ok(!text.includes("[Demo]"), `${rel} names a demo copy`);
    for (const href of demoHrefs) assert.ok(!text.includes(href), `${rel} links a demo path`);
  }
});

test("the sitemap lists the root, the index and every page, in emit order", () => {
  const locs = [...files.get("sitemap.xml").matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1]);
  assert.deepEqual(locs, [
    "https://oddworldmap.com/",
    "https://oddworldmap.com/levels/",
    ...[...files.keys()]
      .filter((k) => k.endsWith(".html") && k !== "levels/index.html")
      .map((k) => `https://oddworldmap.com/${k}`),
  ]);
});

test("every page carries its own canonical address", () => {
  for (const rel of pages) {
    const url = rel === "levels/index.html" ? "levels/" : rel;
    assert.ok(
      files.get(rel).includes(`<link rel="canonical" href="https://oddworldmap.com/${url}" />`),
      `${rel}: canonical missing or wrong`,
    );
  }
});

// the shipped strings carry no escapable character, so the byte-compare can
// never see esc doing anything; a hostile fixture is what pins it
test("what the data names is escaped on its way into the page, at every site", () => {
  const evil = `<i>&"</i>`;
  const escaped = "&lt;i&gt;&amp;&quot;&lt;/i&gt;";
  const cam = { cell: 0, name: "X1P01C01", png: "cams/ao/X1/X1P01C01.png" };
  const game = {
    id: "AO",
    game: `Oddworld: Game ${evil}`,
    geometry: games.AO.geometry,
    levels: [
      {
        id: 1,
        short: "X1",
        name: `Level ${evil}`,
        paths: [{ id: 1, w: 1, h: 1, cams: [cam], tlvs: [], lines: [], section: `Ender ${evil}` }],
      },
    ],
  };
  const annotations = {
    AO: {
      paths: {
        X1: { 1: { name: `Name ${evil}`, note: `Note ${evil}.`, nickname: `Nick ${evil}` } },
      },
    },
  };
  for (const [rel, text] of emitFiles({ games: [game], annotations, pins: {} }))
    if (rel.endsWith(".html")) {
      assert.ok(!text.includes(evil), `${rel} carries an unescaped string`);
      assert.ok(text.includes(escaped), `${rel} dropped the string instead of escaping it`);
    }
});
