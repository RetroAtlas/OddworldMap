import { test } from "node:test";
import assert from "node:assert/strict";
import { census } from "../../public/js/data/census.js";
import { AO_GEOMETRY, dataset, level, path, tlv } from "./fixtures.js";

// an object with its corner in cell, off world units into its visible window
const obj = (name, cell, off = 50) => ({
  ...tlv(name),
  x1: cell * 1024 + 256 + off,
  y1: 120 + off,
  x2: cell * 1024 + 256 + off + 10,
  y2: 120 + off + 10,
});

// current path spans two cells; a sibling path, and a demo path in another
// level (a DemoSpawnPoint is what makes one, and the setting defaults off)
const P1 = path(1, [obj("Slig", 0), obj("Door", 0, 80), obj("Slig", 1)], [], 2, 1);
const P2 = path(2, [obj("Slig", 0)]);
const P3 = path(3, [obj("Slig", 0), obj("DemoSpawnPoint", 0, 80)]);
const L1 = level("L1", P1, P2);
const DATA = dataset([L1, level("L2", P3)], AO_GEOMETRY);

test("census: one row per name, tiers nested, demo paths tallied apart", () => {
  const { rows, demo } = census(["Slig", "Door"], DATA, L1, P1, 0);
  assert.deepEqual(rows, [
    { name: "Slig", screen: 1, path: 2, level: 3, game: 3 },
    { name: "Door", screen: 1, path: 1, level: 1, game: 1 },
  ]);
  assert.equal(demo, 1); // the hidden path's Slig, out of every tier's sum
});

test("census: no cell means no screen tier", () => {
  const { rows } = census(["Door"], DATA, L1, P1, null);
  assert.deepEqual(rows, [{ name: "Door", screen: null, path: 1, level: 1, game: 1 }]);
});

test("census: an object buckets by its corner's cell, not where the packing draws it", () => {
  // its corner in cell 0's trailing slack (window 256..624), drawn over cell 1
  const slack = { ...tlv("Slig"), x1: 634, y1: 170, x2: 644, y2: 180 };
  // its corner in cell 1's slack, drawn centre outside the grid entirely
  const edge = { ...tlv("Door"), x1: 1724, y1: 170, x2: 1734, y2: 180 };
  const P = path(1, [slack, edge], [], 2, 1);
  const L = level("L1", P);
  const D = dataset([L], AO_GEOMETRY);
  const at = (cell) => census(["Slig", "Door"], D, L, P, cell).rows.map((r) => r.screen);
  assert.deepEqual(at(0), [1, 0]);
  assert.deepEqual(at(1), [0, 1]);
});
