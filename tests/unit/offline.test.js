import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { CAM_FILE_BYTES, MASK_FILE_BYTES, SHEET_FILE_BYTES } from "../../public/js/config.js";
import { camFiles } from "../../public/js/model.js";
import { materializeRelease } from "../../public/js/release.js";

const read = (name) => readFileSync(new URL(`../../public/${name}`, import.meta.url), "utf8");
const load = (name) => JSON.parse(read(name));

const GAMES = [
  ["map_data_ao.json", 1006, "sprites_ao.json"],
  ["map_data_ae.json", 2185, "sprites_ae.json"],
];
const sheets = (file) => Object.values(load(file).sheets);
// every file a release the site carries draws instead of the base's, or beside them
const releases = Object.entries(load("releases.json")).flatMap(([game, e]) =>
  e.releases.map(({ code }) => [game.toLowerCase(), code]),
);
const releaseFiles = (game, code) => {
  const o = load(`release_${game}_${code}.json`);
  const cams = Object.values(o.paths).flatMap((p) => Object.values(p.cams ?? {}).filter(Boolean));
  return [
    ...cams.flatMap((c) =>
      [
        c.png,
        ...(c.patches ?? []).map(([, , f]) => f),
        ...(c.masks ?? []).map(([, m]) => m),
      ].filter(Boolean),
    ),
    ...Object.values(o.sheets ?? {}),
  ];
};
const allReleaseFiles = () => releases.flatMap(([g, c]) => releaseFiles(g, c));
// a sheet is stored by the same worker rule as a cam, so it has to sit where that rule looks
const CAM_RULE = "/^\\/cams\\/.+\\.png$/";
for (const [, , file] of GAMES)
  test(`${file}: the sheets sit under the cams the worker caches`, () => {
    assert.ok(read("sw.js").includes(CAM_RULE), "the worker's cam rule is the one quoted here");
    for (const f of sheets(file))
      assert.match(f, /^cams\/[a-z]{2}\/sprites\/[A-Z][A-Za-z0-9]*\.[0-9a-f]{12}\.png$/);
  });

// the worker retires a family's other sheets by its own rule, so each sheet has
// to read to it as its family's, of its own game
for (const [, , file] of GAMES)
  test(`${file}: the worker reads each sheet as its family's, of its game`, () => {
    const rule = new RegExp(/^const SHEET = \/(.+)\/;$/m.exec(read("sw.js"))[1]);
    const game = /^sprites_([a-z]{2})\.json$/.exec(file)[1];
    for (const [family, f] of Object.entries(load(file).sheets)) {
      const found = rule.exec(`/${f}`);
      assert.ok(found, `${f} answers the worker's sheet rule`);
      assert.deepEqual(found.slice(1, 3), [game, family]);
    }
  });

for (const [file, files] of GAMES)
  test(`${file}: camFiles lists every artwork file once`, () => {
    const list = camFiles(load(file));
    assert.equal(list.length, files);
    assert.equal(new Set(list).size, list.length, "no file is listed twice");
    assert.ok(
      list.every((f) => /^cams\/[a-z]{2}\/[^/]+\/[^/]+\.png$/.test(f)),
      "every entry is a cam png path",
    );
    // the foreground layers are half the download and easy to leave out
    assert.ok(list.some((f) => /_fg\d+\.png$/.test(f)));
  });

// the download stores a whole game at once, so a cap below the complete set
// would silently evict the head of what it just fetched
test("both games' artwork and every release's fits the worker's cache cap", () => {
  const cap = Number(/^const MAX_ENTRIES = (\d+);/m.exec(read("sw.js"))[1]);
  const total = GAMES.reduce(
    (n, [file, , sp]) => n + camFiles(load(file)).length + sheets(sp).length,
    allReleaseFiles().length,
  );
  assert.ok(total <= cap, `${total} files vs a ${cap}-entry cap`);
});

// the worker retires a release file's earlier copies by its own rule, so each
// has to read to it as its release's, under a name no other file of it shares
test("the worker reads each release file as its release's, and no sheet rule takes one", () => {
  const src = read("sw.js");
  const rule = new RegExp(/^const RELEASE_ART = \/(.+)\/;$/m.exec(src)[1]);
  const sheet = new RegExp(/^const SHEET = \/(.+)\/;$/m.exec(src)[1]);
  const sprites = new RegExp(/^const SPRITES = \/(.+)\/;$/m.exec(src)[1]);
  for (const [game, code] of releases) {
    const stems = new Set();
    for (const f of releaseFiles(game, code)) {
      const found = rule.exec(`/${f}`);
      assert.ok(found, `${f} answers the worker's release rule`);
      assert.deepEqual(found.slice(1, 3), [game, code]);
      assert.ok(!stems.has(found[3]), `${f} shares its name with another file`);
      stems.add(found[3]);
      assert.equal(sheet.exec(`/${f}`), null, f);
      assert.equal(sprites.exec(`/${f}`), null, f);
    }
  }
  // and no base file is a release's
  for (const [file, , sp] of GAMES)
    for (const f of [...camFiles(load(file)), ...sheets(sp)])
      assert.equal(rule.exec(`/${f}`), null, f);
});

// a release's row stores what its screens are drawn from: its patches with the
// base's screens under them, its whole screens and masks, and the base's own
// files wherever the release leaves a camera alone
for (const [game, code] of releases)
  test(`${game} ${code}: camFiles lists the release's art and the base screens under its patches`, () => {
    const base = load(`map_data_${game}.json`);
    const R = materializeRelease(
      base,
      load(`release_${game}_${code}.json`),
      load(`relive_export_${game}.json`).level_short,
    );
    const listed = new Set(camFiles(R));
    const own = releaseFiles(game, code).filter((f) => !f.includes("/sprites/"));
    for (const f of own) assert.ok(listed.has(f), `${f} is listed`);
    const patched = R.levels
      .flatMap((L) => L.paths)
      .flatMap((P) => P.cams)
      .filter((c) => c.patches);
    for (const c of patched) assert.ok(listed.has(c.png), `${c.name}'s screen is listed`);
    const shipped = new Set(camFiles(base));
    for (const f of listed)
      assert.ok(shipped.has(f) || own.includes(f), `${f} is the base's or the release's`);
  });

// the figures are hand-written where they are quoted, so a rebuild that adds
// artwork has to move them
test("the cap comment and the viewer doc quote the artwork as it ships", () => {
  const files = GAMES.map(([file, , sp]) => [camFiles(load(file)).length, sheets(sp).length]);
  const total = files.reduce((n, [c, s]) => n + c + s, allReleaseFiles().length);
  assert.equal(Number(/complete artwork \((\d+) files\)/.exec(read("sw.js"))[1]), total);
  const masks = GAMES.map(
    ([file]) => camFiles(load(file)).filter((f) => /_fg\d+\.png$/.test(f)).length,
  );
  const mb = files.map(([c, s], i) =>
    Math.round(
      ((c - masks[i]) * CAM_FILE_BYTES + masks[i] * MASK_FILE_BYTES + s * SHEET_FILE_BYTES) / 1e6,
    ),
  );
  const doc = readFileSync(new URL("../../docs/viewer.md", import.meta.url), "utf8");
  const quote = /~(\d+) MB for Oddysee, ~(\d+) MB for Exoddus/;
  assert.deepEqual(quote.exec(doc).slice(1).map(Number), mb);
});
