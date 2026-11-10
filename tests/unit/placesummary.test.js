import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { placeSummary } from "../../public/js/data/placesummary.js";
import { setAnnotations } from "../../public/js/model/annotations.js";
import { materializePath, setLevelShort } from "../../public/js/data/edits.js";

const load = (name) =>
  JSON.parse(readFileSync(new URL(`../../public/${name}`, import.meta.url), "utf8"));

const AO = { id: "AO", game: "Oddworld: Abe's Oddysee" };
const lvl = (short, name) => ({ short, name });
const path = (id, n, name = null) => ({ id, name, tlvs: Array.from({ length: n }, () => ({})) });

test("placeSummary names the game, the level, the path and its inventory", () => {
  setAnnotations({ AO: { paths: { R1: { 15: "Before Packaging" } } } });
  assert.equal(
    placeSummary(AO, lvl("R1", "Rupture Farms"), path(15, 283)),
    "Abe's Oddysee, Rupture Farms, path 15, Before Packaging, 283 objects",
  );
});

test("placeSummary falls back to the disc name, and drops the clause where there is neither", () => {
  setAnnotations({});
  assert.equal(
    placeSummary(AO, lvl("R2", "Rupture Farms Return"), path(1, 58, "Zulag 2")),
    "Abe's Oddysee, Rupture Farms Return, path 1, Zulag 2, 58 objects",
  );
  assert.equal(
    placeSummary(AO, lvl("C1", "Credits"), path(1, 1)),
    "Abe's Oddysee, Credits, path 1, 1 object",
  );
});

test("placeSummary says a path carries a note, which is the dot a reader cannot see", () => {
  setAnnotations({ AO: { paths: { S1: { 1: { note: "The title screen plays here." } } } } });
  assert.equal(
    placeSummary(AO, lvl("S1", "Menu"), path(1, 8)),
    "Abe's Oddysee, Menu, path 1, 8 objects, with a note",
  );
});

test("placeSummary says a path carries edits, which the marker's outline says to everyone else", () => {
  setAnnotations({});
  setLevelShort("AO", {});
  const P = {
    id: 1,
    tlvs: [
      { t: 3, name: "Hoist", x1: 0, y1: 0, x2: 10, y2: 10, extra: {}, fields: { hoist_type: 0 } },
    ],
  };
  const edited = materializePath("AO", P, {
    objects: { "Hoist@0,0": { fields: { hoist_type: 1 } } },
  });
  assert.equal(
    placeSummary(AO, lvl("C1", "Credits"), edited),
    "Abe's Oddysee, Credits, path 1, 1 object, edited on this device",
  );
  assert.equal(
    placeSummary(AO, lvl("C1", "Credits"), P),
    "Abe's Oddysee, Credits, path 1, 1 object",
  );
});

test("every shipped path announces as one distinct, well-formed sentence", () => {
  setAnnotations(load("annotations.json"));
  for (const g of ["ao", "ae"]) {
    const data = load(`map_data_${g}.json`);
    const seen = new Map();
    for (const L of data.levels)
      for (const P of L.paths) {
        const s = placeSummary(data, L, P);
        assert.match(
          s,
          /^[^,]+, [^,]+, path \d+(, [^,]+)?, \d+ objects?(, with a note)?(, edited on this device)?$/,
          `${L.short} P${P.id}: ${s}`,
        );
        // a region rewritten with the text it already held announces nothing, so
        // two paths reading the same would be a move that went unsaid
        assert.ok(!seen.has(s), `${L.short} P${P.id} reads as ${seen.get(s)} does: ${s}`);
        seen.set(s, `${L.short} P${P.id}`);
      }
  }
  setAnnotations(null);
});
