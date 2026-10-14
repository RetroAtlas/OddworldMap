import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { CAM_FILE_BYTES, MASK_FILE_BYTES, SHEET_FILE_BYTES } from "../../public/js/config.js";
import { camFiles } from "../../public/js/model.js";

const read = (name) => readFileSync(new URL(`../../public/${name}`, import.meta.url), "utf8");
const load = (name) => JSON.parse(read(name));

const GAMES = [
  ["map_data_ao.json", 1006, "sprites_ao.json"],
  ["map_data_ae.json", 2185, "sprites_ae.json"],
];
const sheets = (file) => Object.values(load(file).sheets);
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
test("both games' artwork fits the worker's cache cap", () => {
  const cap = Number(/^const MAX_ENTRIES = (\d+);/m.exec(read("sw.js"))[1]);
  const total = GAMES.reduce(
    (n, [file, , sp]) => n + camFiles(load(file)).length + sheets(sp).length,
    0,
  );
  assert.ok(total <= cap, `${total} files vs a ${cap}-entry cap`);
});

// the figures are hand-written where they are quoted, so a rebuild that adds
// artwork has to move them
test("the cap comment and the viewer doc quote the artwork as it ships", () => {
  const files = GAMES.map(([file, , sp]) => [camFiles(load(file)).length, sheets(sp).length]);
  const total = files.reduce((n, [c, s]) => n + c + s, 0);
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
