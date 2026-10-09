import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { CAM_FILE_BYTES, SHEET_FILE_BYTES } from "../../public/js/config.js";
import { camFiles } from "../../public/js/model.js";

const read = (name) => readFileSync(new URL(`../../public/${name}`, import.meta.url), "utf8");
const load = (name) => JSON.parse(read(name));

const GAMES = [
  ["map_data_ao.json", 935, "sprites_ao.json"],
  ["map_data_ae.json", 1953, "sprites_ae.json"],
];
const sheets = (file) => load(file).sheets;
// a sheet is stored by the same worker rule as a cam, so it has to sit where that rule looks
const CAM_RULE = "/^\\/cams\\/.+\\.png$/";
for (const [, , file] of GAMES)
  test(`${file}: the sheets sit under the cams the worker caches`, () => {
    assert.ok(read("sw.js").includes(CAM_RULE), "the worker's cam rule is the one quoted here");
    for (const f of sheets(file))
      assert.match(f, /^cams\/[a-z]{2}\/sprites\/[0-9a-f]{12}\/\d+\.png$/);
  });

// the worker retires a game's other sheet sets by its own rule, so the sheets
// have to read to it as one set of their own game
for (const [, , file] of GAMES)
  test(`${file}: the worker reads the sheets as one set of their game`, () => {
    const rule = new RegExp(/^const SHEET_SET = \/(.+)\/;$/m.exec(read("sw.js"))[1]);
    const found = sheets(file).map((f) => rule.exec(`/${f}`));
    assert.ok(found.every(Boolean), "every sheet answers the worker's set rule");
    assert.equal(new Set(found.map(([, game, set]) => `${game}/${set}`)).size, 1);
    assert.equal(found[0][1], /^sprites_([a-z]{2})\.json$/.exec(file)[1]);
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
    assert.ok(list.some((f) => f.endsWith("_fg.png")));
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
test("the cap comment and the README quote the artwork as it ships", () => {
  const files = GAMES.map(([file, , sp]) => [camFiles(load(file)).length, sheets(sp).length]);
  const total = files.reduce((n, [c, s]) => n + c + s, 0);
  assert.equal(Number(/complete artwork \((\d+) files\)/.exec(read("sw.js"))[1]), total);
  const mb = files.map(([c, s]) => Math.round((c * CAM_FILE_BYTES + s * SHEET_FILE_BYTES) / 1e6));
  const readme = readFileSync(new URL("../../README.md", import.meta.url), "utf8");
  const quote = /~(\d+) MB for Oddysee, ~(\d+) MB for Exoddus/;
  assert.deepEqual(quote.exec(readme).slice(1).map(Number), mb);
});
