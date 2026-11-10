// The page's re-derivation of a TLV's navigation bucket against the builder's:
// every shipped object must come back exactly as tlv_extra_* wrote it, key order
// included, since the display renders extra in insertion order.

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { deriveExtra } from "../../public/js/model/extra.js";

const load = (f) => JSON.parse(readFileSync(new URL(`../../public/${f}`, import.meta.url), "utf8"));
const GAMES = ["AO", "AE"];
const data = Object.fromEntries(GAMES.map((g) => [g, load(`map_data_${g.toLowerCase()}.json`)]));
const levels = Object.fromEntries(
  GAMES.map((g) => [g, load(`relive_export_${g.toLowerCase()}.json`).level_short]),
);

// the types the builder decodes a bucket for, so the sweep cannot pass by
// deriving nothing for anything
const BUCKETED = {
  AO: [
    "BirdPortal",
    "ContinuePoint",
    "Door",
    "HandStone",
    "MovieStone",
    "PathTransition",
    "WellExpress",
    "WellLocal",
  ],
  AE: [
    "BirdPortal",
    "Door",
    "HandStone",
    "LevelLoader",
    "LocalWell",
    "PathTransition",
    "Teleporter",
    "WellExpress",
  ],
};

test("every shipped object's extra re-derives from its fields", () => {
  for (const g of GAMES) {
    const seen = new Set();
    for (const L of data[g].levels)
      for (const P of L.paths)
        for (const t of P.tlvs) {
          const got = deriveExtra(g, t, levels[g]);
          const at = `${g} ${L.short} P${P.id} ${t.name}@${t.x1},${t.y1}`;
          assert.deepEqual(got, t.extra, at);
          assert.equal(JSON.stringify(got), JSON.stringify(t.extra), `${at}: key order`);
          if (Object.keys(got).length) seen.add(t.name);
        }
    assert.deepEqual([...seen].sort(), BUCKETED[g], g);
  }
});

const door = (g, fields) => ({ t: 0, name: "Door", x1: 0, y1: 0, x2: 1, y2: 1, fields });
const AE_DOOR = {
  level: 1,
  path: 1,
  camera: 17,
  scale: 0,
  door_number: 1,
  switch_id: 0,
  target_door_id: 0,
};

test("a level short comes from the builder's whole map, an unknown id stays a number", () => {
  const short = (lv) =>
    deriveExtra("AE", door("AE", { ...AE_DOOR, level: lv }), levels.AE).to_level;
  assert.equal(short(7), "SV"); // an ender id the served level list does not keep
  assert.equal(short(0), "ST");
  assert.equal(short(99), 99);
  assert.equal(
    deriveExtra("AO", door("AO", { ...AE_DOOR, target_door_number: 2, level: 0 }), levels.AO)
      .to_level,
    "S1",
  );
});

test("a door number reads unsigned, as the builder masks it", () => {
  const e = deriveExtra("AE", door("AE", { ...AE_DOOR, door_number: -1 }), levels.AE);
  assert.equal(e["door#"], 0xffff);
});

test("a branch runs only when the record holds every word the builder's guard counts", () => {
  const tp = {
    teleporter_switch_id: 3,
    other_teleporter_switch_id: 4,
    camera: 5,
    path: 2,
    level: 1,
    switch_id: 0,
  };
  const at = (fields) => deriveExtra("AE", { name: "Teleporter", fields }, levels.AE);
  assert.deepEqual(at(tp), { "tp#": 3, "target_tp#": 4, to_level: "MI", to_path: 2, to_cam: 5 });
  const short = { ...tp };
  delete short.switch_id; // the guard word the branch never reads
  assert.deepEqual(at(short), {});
  assert.deepEqual(deriveExtra("AE", { name: "Slig", fields: { scale: 0 } }, levels.AE), {});
  assert.deepEqual(deriveExtra("AE", { name: "Door" }, levels.AE), {});
});

test("key presence follows the value: a portal, a hand stone and an express well", () => {
  const portal = (portal_type) =>
    deriveExtra(
      "AE",
      {
        name: "BirdPortal",
        fields: {
          enter_side: 1,
          birdportalexit_level: 2,
          birdportalexit_path: 2,
          birdportalexit_camera: 11,
          scale: 0,
          movie_id: 0,
          portal_type,
        },
      },
      levels.AE,
    );
  assert.deepEqual(portal(1), { portal: "rescue" });
  assert.deepEqual(portal(0), { portal: "travel", to_level: "NE", to_path: 2, to_cam: 11 });
  assert.deepEqual(portal(9), { portal: 9 });

  const stone = (camera_id_2, trigger_switch_id) =>
    deriveExtra(
      "AE",
      {
        name: "HandStone",
        fields: { scale: 0, camera_id_1: 50, camera_id_2, camera_id_3: 0, trigger_switch_id },
      },
      levels.AE,
    );
  assert.deepEqual(stone(53, 0), { view1_cam: 50, view2_cam: 53 });
  assert.deepEqual(stone(0, 7), { view1_cam: 50, switch_id: 7 });

  const well = (enabled_well_id) =>
    deriveExtra(
      "AE",
      {
        name: "WellExpress",
        fields: {
          scale: 0,
          switch_id: 0,
          other_well_id: 0,
          animation_id: 0,
          exit_x: 0,
          exit_y: 0,
          disabled_well_level: 1,
          disabled_well_path: 1,
          disabled_well_camera: 2,
          disabled_well_id: 0,
          enabled_well_level: 1,
          enabled_well_path: 1,
          enabled_well_camera: 2,
          enabled_well_id,
        },
      },
      levels.AE,
    );
  assert.deepEqual(well(0), {
    to_level: "MI",
    to_path: 1,
    to_cam: 2,
    "well#": 0,
    "target_well#": 0,
  });
  assert.deepEqual(Object.keys(well(3)), [
    "to_level",
    "to_path",
    "to_cam",
    "alt_level",
    "alt_path",
    "alt_cam",
    "well#",
    "target_well#",
    "alt_target_well#",
  ]);
});
