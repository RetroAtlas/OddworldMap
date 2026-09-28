import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  camCell,
  computeEntryPaths,
  destOf,
  destTrusted,
  drawBox,
  isLoopback,
  lineRuns,
  offScreen,
  screenRuns,
  pathImage,
  pathIn,
} from "../../public/js/model.js";
import { EXPORT_MAX_DIM, EXPORT_MAX_PX } from "../../public/js/config.js";
import {
  CELL_H,
  CELL_W,
  LAYOUT,
  cellOrigin,
  setGeometry,
  setSpacing,
} from "../../public/js/state.js";
import { isDemoPath } from "../../public/js/demo.js";
import { AO_GEOMETRY, AE_GEOMETRY, CROSS_LEVEL_FOLLOWS, pitches } from "./fixtures.js";

// Schema sanity over the shipped data: the invariants the viewer relies on.
// Referential integrity of to_/alt_ links and LINE_NAMES coverage of all line
// types are deliberately NOT asserted — the shipped data contains dangling and
// cross-format refs, and the viewer tolerates unknown values by design.

const load = (name) =>
  JSON.parse(readFileSync(new URL(`../../public/${name}`, import.meta.url), "utf8"));

for (const [file, id, geometry] of [
  ["map_data_ao.json", "AO", AO_GEOMETRY],
  ["map_data_ae.json", "AE", AE_GEOMETRY],
]) {
  test(`${file} matches the viewer's expectations`, () => {
    const data = load(file);
    assert.equal(data.id, id);
    assert.deepEqual(data.geometry, geometry);
    assert.ok(data.levels.length > 0);

    const shorts = data.levels.map((L) => L.short);
    assert.equal(new Set(shorts).size, shorts.length, "level shorts are unique");

    for (const L of data.levels) {
      assert.ok(L.paths.length > 0, `${L.short} has paths`);
      for (const P of L.paths) {
        assert.ok(Number.isInteger(P.id) && P.w > 0 && P.h > 0, `${L.short} P${P.id} dimensions`);
        for (const c of P.cams) {
          assert.ok(c.cell >= 0 && c.cell < P.w * P.h, `${L.short} P${P.id} cam cell in range`);
          assert.match(c.name, /C\d\d$/, "camCell resolves cameras by this suffix");
        }
        for (const t of P.tlvs) {
          assert.equal(typeof t.name, "string");
          assert.ok(t.x1 <= t.x2 && t.y1 <= t.y2, `${L.short} P${P.id} ${t.name} rect ordered`);
          assert.ok(
            t.x1 >= 0 &&
              t.y1 >= 0 &&
              Math.floor(t.x1 / geometry.worldW) < P.w &&
              Math.floor(t.y1 / geometry.worldH) < P.h,
            `${L.short} P${P.id} ${t.name} origin inside the grid (tlvCell must not alias)`,
          );
        }
        for (const line of P.lines) assert.equal(line.length, 5);
      }
    }

    assert.ok(Object.keys(computeEntryPaths(data)).length > 0, "entry paths found");
  });
}

// the paths the games arrive at from elsewhere, pinned whole: the set is only as
// good as the destinations behind it, and a link whose partner is absent used to
// badge paths the game never arrives at and paths that don't exist at all
test("entry paths in the shipped data are exactly the reachable ones", () => {
  const found = {};
  for (const file of ["map_data_ao.json", "map_data_ae.json"]) {
    const data = load(file);
    const entries = computeEntryPaths(data);
    found[data.id] = Object.fromEntries(
      Object.keys(entries)
        .sort()
        .map((k) => [k, [...entries[k]].sort((a, b) => a - b)]),
    );
  }
  assert.deepEqual(found, {
    AO: {
      D1: [1],
      D2: [1, 10],
      D7: [11],
      E1: [6],
      E2: [4],
      F1: [1],
      F2: [1, 8],
      F4: [9],
      L1: [1, 5],
      R1: [15, 20],
      R2: [11, 19],
      R6: [6],
      S1: [1],
    },
    AE: {
      BA: [1],
      BM: [1],
      BR: [16],
      BW: [1, 4],
      FD: [1, 2, 4],
      MI: [1, 2],
      NE: [2, 5],
      PV: [1],
      SV: [6],
    },
  });
});

// the paths only the attract-mode demos play, pinned whole: a DemoSpawnPoint is
// the viewer's whole rule for hiding one, so this set is the setting's subject.
// The games arrive at none of them, and no link the map believes leads into one.
test("demo paths in the shipped data are exactly the attract-mode copies", () => {
  const found = {};
  for (const file of ["map_data_ao.json", "map_data_ae.json"]) {
    const data = load(file);
    const entries = computeEntryPaths(data);
    const demo = [];
    for (const L of data.levels) {
      // hiding the class must never empty a level: in disc order, a level opens on this one
      assert.ok(!isDemoPath(L.paths[0]), `${data.id} ${L.short} opens on a gameplay path`);
      for (const P of L.paths) {
        if (isDemoPath(P)) {
          demo.push(`${L.short} P${P.id}`);
          assert.ok(
            !entries[L.short]?.has(P.id),
            `${data.id} ${L.short} P${P.id} is arrived at from another level`,
          );
          continue;
        }
        for (const t of P.tlvs) {
          const d = destOf(t, data, L, P);
          if (!d || !destTrusted(d, data, L)) continue;
          const dst = pathIn(data, d.lv, d.pa);
          assert.ok(
            !dst || !isDemoPath(dst),
            `${data.id} ${L.short} P${P.id} ${t.name} leads into demo path ${d.lv} P${d.pa}`,
          );
        }
      }
    }
    found[data.id] = demo;
  }
  assert.deepEqual(found, {
    AO: [],
    AE: [
      "MI P8",
      "MI P9",
      "MI P11",
      "MI P12",
      "NE P7",
      "PV P2",
      "PV P6",
      "SV P12",
      "SV P13",
      "SV P14",
      "FD P6",
      "FD P8",
      "FD P12",
      "FD P13",
      "BA P3",
      "BA P4",
      "BW P11",
      "BW P13",
      "BR P7",
      "BR P8",
      "BR P13",
      "BR P26",
      "BR P27",
      "BR P28",
      "BR P29",
    ],
  });
});

// the two sides of the destination check, on the objects that motivated it:
// the Mudanchee Vaults door whose unset level field reads as Necrum Mines,
// where no door answers to its number, and the transitions to the main-menu
// level, which name no partner and so are believed wherever they point
test("the shipped data's dead and genuine off-level links are told apart", () => {
  const ae = load("map_data_ae.json");
  const sv6 = pathIn(ae, "SV", 6);
  const door = sv6.tlvs.find((t) => t.name === "Door" && t.x1 === 825 && t.y1 === 600);
  const dead = destOf(door, ae, { short: "SV" }, sv6);
  assert.deepEqual(dead, {
    lv: "MI",
    pa: 6,
    ca: 24,
    target: { name: "Door", field: "door#", value: 2 },
  });
  assert.equal(destTrusted(dead, ae, { short: "SV" }), false);

  const ao = load("map_data_ao.json");
  const menu = [
    ["R1", 19],
    ["L1", 1],
  ].map(([short, id]) => {
    const P = pathIn(ao, short, id);
    const t = P.tlvs.find((x) => x.name === "PathTransition" && x.extra.to_level === "S1");
    return destTrusted(destOf(t, ao, { short }, P), ao, { short });
  });
  assert.deepEqual(menu, [true, true]);
});

// the follows that leave their level, pinned whole: what remains is the games'
// level graph, and links the designers never pointed anywhere used to crowd it
// with express wells riding to the Mines' opening screen from all over Exoddus
test("cross-level follows in the shipped data are exactly the level graph", () => {
  const found = {};
  for (const file of ["map_data_ao.json", "map_data_ae.json"]) {
    const data = load(file);
    const seen = new Set();
    for (const L of data.levels)
      for (const P of L.paths)
        for (const t of P.tlvs) {
          const d = destOf(t, data, L, P);
          if (d && d.lv !== L.short && destTrusted(d, data, L) && pathIn(data, d.lv, d.pa))
            seen.add(`${L.short} P${P.id} -> ${d.lv} P${d.pa}`);
        }
    found[data.id] = [...seen].sort();
  }
  assert.deepEqual(found, CROSS_LEVEL_FOLLOWS);
});

// the three express wells behind that rule: one with a live side to prefer, one
// with none, and a genuine ride to another level's first screen
test("the shipped data's express wells take the side the game uses", () => {
  const ae = load("map_data_ae.json");
  const ba2 = pathIn(ae, "BA", 2);
  const hub = ba2.tlvs.find((t) => t.x1 === 454 && t.y1 === 310);
  // the Barracks hub well: its unpointed side reads as the Mines' first screen,
  // its live side names well 1, four tiles away in the same room
  assert.deepEqual(destOf(hub, ae, { short: "BA" }, ba2), {
    lv: "BA",
    pa: 2,
    ca: 1,
    target: { field: "well#", value: 1 },
  });

  const ne3 = pathIn(ae, "NE", 3);
  const both = ne3.tlvs.find((t) => t.x1 === 518 && t.y1 === 850);
  const dead = destOf(both, ae, { short: "NE" }, ne3);
  assert.deepEqual(dead, { lv: "MI", pa: 1, ca: 1, target: { field: "well#", value: 0 } });
  assert.equal(destTrusted(dead, ae, { short: "NE" }), false);

  const ao = load("map_data_ao.json");
  const l1p6 = pathIn(ao, "L1", 6);
  const ride = l1p6.tlvs.find((t) => t.x1 === 2418 && t.y1 === 309);
  const far = destOf(ride, ao, { short: "L1" }, l1p6);
  assert.deepEqual(far, { lv: "F1", pa: 1, ca: 1, target: { field: "well#", value: 0 } });
  assert.equal(destTrusted(far, ao, { short: "L1" }), true);
});

// destinations may dangle, but their level fields must be decoded shorts —
// a raw numeric id means the builder's id map missed a level (the AE ender
// ids regressed this way once)
test("destination level fields are level shorts, never raw ids", () => {
  for (const file of ["map_data_ao.json", "map_data_ae.json"]) {
    const data = load(file);
    for (const L of data.levels)
      for (const P of L.paths)
        for (const t of P.tlvs)
          for (const k of ["to_level", "alt_level", "view1_level", "view2_level", "view3_level"]) {
            const v = t.extra && t.extra[k];
            if (v != null)
              assert.equal(
                typeof v,
                "string",
                `${data.id} ${L.short} P${P.id} ${t.name} ${k}=${v}`,
              );
          }
  }
});

// extra is the hand-decoded semantic bucket, fields the raw archive, and the
// display writes both — so a name in both prints its value twice. Where the
// archive reaches a word extra already names, extra gives it up
test("no object names the same key in both extra and fields", () => {
  for (const file of ["map_data_ao.json", "map_data_ae.json"]) {
    const data = load(file);
    for (const L of data.levels)
      for (const P of L.paths)
        for (const t of P.tlvs)
          for (const k of Object.keys(t.extra || {}))
            assert.ok(
              !(t.fields && k in t.fields),
              `${data.id} ${L.short} P${P.id} ${t.name}: ${k} is in both extra and fields`,
            );
  }
});

// the two labels game data defines, kept apart: a name is what the game calls
// the place (AO R2's zulag save-name table), a section is which half of the
// level a path belongs to (AE's ender-id destinations)
test("path names and sections in the shipped data are exactly the game-defined ones", () => {
  const expectedNames = {
    "AO R2": {
      15: "Zulag 1",
      16: "Zulag 1",
      18: "Zulag 1",
      19: "Zulag 1",
      20: "Zulag 1",
      1: "Zulag 2",
      2: "Zulag 2",
      3: "Zulag 2",
      10: "Zulag 2",
      5: "Zulag 3",
      7: "Zulag 3",
      9: "Zulag 3",
      12: "Zulag 3",
      13: "Zulag 3",
      4: "Zulag 4",
      8: "Zulag 4",
      11: "Zulag 4",
      14: "Zulag 4",
    },
  };
  const expectedSections = {
    "AE SV": {
      9: "Mudanchee Vault Ender",
      10: "Mudanchee Vault Ender",
      11: "Mudanchee Vault Ender",
      14: "Mudanchee Vault Ender",
    },
    "AE PV": { 13: "Mudomo Vault Ender" },
    "AE FD": { 11: "FeeCo Depot Ender", 13: "FeeCo Depot Ender", 14: "FeeCo Depot Ender" },
    "AE BA": { 11: "Barracks Ender", 16: "Barracks Ender" },
    "AE BW": { 12: "Bonewerkz Ender", 13: "Bonewerkz Ender", 14: "Bonewerkz Ender" },
  };
  const names = {},
    sections = {};
  for (const file of ["map_data_ao.json", "map_data_ae.json"]) {
    const data = load(file);
    for (const L of data.levels)
      for (const P of L.paths) {
        const at = `${data.id} ${L.short}`;
        if (P.name) (names[at] ??= {})[P.id] = P.name;
        if (P.section) (sections[at] ??= {})[P.id] = P.section;
        assert.ok(!(P.name && P.section), `${at} P${P.id}: a path is named or sectioned, not both`);
      }
  }
  assert.deepEqual(names, expectedNames);
  assert.deepEqual(sections, expectedSections);
});

// every shipped hand stone is decoded: at least one view, no raw fallback,
// and no transition fields (views must not create entry markers). Eight AE
// stones view cameras their shipped path no longer has — pinned so a rebuild
// changing that set is noticed (destOf offers those stones no follow); AO
// triples are resolved against the path they name.
test("hand stones in the shipped data carry decoded views", () => {
  const expectedDead = { AO: 0, AE: 8 };
  for (const file of ["map_data_ao.json", "map_data_ae.json"]) {
    const data = load(file);
    let count = 0,
      dead = 0;
    for (const L of data.levels)
      for (const P of L.paths)
        for (const t of P.tlvs)
          if (t.name === "HandStone") {
            count++;
            assert.ok(
              t.extra && t.extra.view1_cam != null,
              `${data.id} ${L.short} P${P.id} stone lacks view1_cam`,
            );
            assert.ok(
              !("raw" in t.extra) && !("to_level" in t.extra),
              `${data.id} ${L.short} P${P.id} stone has stray fields`,
            );
            const viewPath =
              t.extra.view1_level == null
                ? P
                : data.levels
                    .find((l) => l.short === t.extra.view1_level)
                    ?.paths.find((p) => p.id === t.extra.view1_path);
            if (!viewPath || camCell(viewPath, t.extra.view1_cam) == null) dead++;
          }
    assert.ok(count > 0, `${data.id}: no hand stones found`);
    assert.equal(dead, expectedDead[data.id], `${data.id}: stones with a dead first view`);
  }
});

// every well in the shipped data carries its pair id, and express wells name
// the arrival well of each destination they emit
test("wells in the shipped data carry decoded pair ids", () => {
  let express = 0,
    locals = 0;
  for (const file of ["map_data_ao.json", "map_data_ae.json"]) {
    const data = load(file);
    for (const L of data.levels)
      for (const P of L.paths)
        for (const t of P.tlvs) {
          const where = `${data.id} ${L.short} P${P.id} (${t.x1},${t.y1})`;
          if (t.name === "WellExpress") {
            express++;
            assert.ok(t.extra && t.extra["well#"] != null, `${where} express lacks well#`);
            if (t.extra.to_level != null)
              assert.ok(t.extra["target_well#"] != null, `${where} lacks target_well#`);
            if (t.extra.alt_level != null)
              assert.ok(t.extra["alt_target_well#"] != null, `${where} lacks alt_target_well#`);
          } else if (t.name === "WellLocal" || t.name === "LocalWell") {
            locals++;
            assert.ok(t.extra && t.extra["well#"] != null, `${where} local well lacks well#`);
          }
        }
  }
  assert.ok(express > 0 && locals > 0, "wells found in both roles");
});

// creatures carry the complete raw field archive (the viewer prettifies + picks
// what to show): every one has `fields`, no `raw` fallback, and the key state
// fields are decoded to their expected value ranges. Distributions are pinned
// as a regression guard on the schema-driven extraction.
test("creatures in the shipped data carry a raw field archive", () => {
  const found = { AO: {}, AE: {} };
  for (const [file, id] of [
    ["map_data_ao.json", "AO"],
    ["map_data_ae.json", "AE"],
  ]) {
    const data = load(file);
    const jobs = {},
      emotions = {};
    let creatures = 0;
    for (const L of data.levels)
      for (const P of L.paths)
        for (const t of P.tlvs)
          if (t.name === "Mudokon" || t.name === "Slig" || t.name === "Slog") {
            creatures++;
            const f = t.fields;
            const where = `${id} ${L.short} P${P.id} ${t.name} (${t.x1},${t.y1})`;
            assert.ok(f && typeof f === "object", `${where} lacks fields`);
            assert.ok(!("raw" in (t.extra || {})), `${where} still raw`);
            if (t.name === "Mudokon") {
              const s = id === "AO" ? f.job : f.state;
              assert.ok(s >= 0 && s <= 4, `${where} state ${s} out of range`);
              if (id === "AO") jobs[s] = (jobs[s] || 0) + 1;
              if (id === "AE") emotions[f.emotion] = (emotions[f.emotion] || 0) + 1;
            } else if (t.name === "Slig") {
              assert.ok(
                typeof f.shoot_on_sight_delay === "number",
                `${where} lacks shoot_on_sight_delay`,
              );
              assert.ok(f.start_state >= 0 && f.start_state <= 6, `${where} start_state range`);
            } else {
              assert.ok(f.asleep === 0 || f.asleep === 1, `${where} asleep ${f.asleep}`);
            }
          }
    found[id] = { creatures, jobs, emotions };
  }
  // ground-truth pins from the disc: AO's 11 sit-chant (job=2) Monsaic natives,
  // and the AE Mudokon emotion spread
  assert.equal(found.AO.jobs[2], 11, "AO sit-chant Mudokons");
  assert.deepEqual(found.AE.emotions, { 0: 270, 1: 33, 2: 42, 3: 8, 4: 26 });
  assert.ok(found.AO.creatures > 0 && found.AE.creatures > 0, "creatures found in both games");
});

// the gotcha the whole feature turned on: R2 P8's patrolling Slig shoots on
// sight (shoot_on_sight_delay 0, no FREEZE warning), three-round burst
test("AO R2 P8 has the shoot-on-sight Slig", () => {
  const data = load("map_data_ao.json");
  const P = data.levels.find((l) => l.short === "R2").paths.find((p) => p.id === 8);
  const slig = P.tlvs.find((t) => t.name === "Slig" && t.x1 === 3500 && t.y1 === 191);
  assert.ok(slig, "gotcha Slig present");
  assert.equal(slig.fields.shoot_on_sight_delay, 0);
  assert.equal(slig.fields.bullet_shoot_count, 3);
  assert.equal(slig.fields.start_state, 1); // patrol
});

// the extraction now covers gameplay objects broadly, and the schema parser
// spreads the decomp's union-named Door hub ids across their real words
test("gameplay objects carry the field archive; Door hubs are distinct words", () => {
  for (const [file, id] of [
    ["map_data_ao.json", "AO"],
    ["map_data_ae.json", "AE"],
  ]) {
    const data = load(file);
    const withFields = new Set();
    let doorHubsVary = false;
    for (const L of data.levels)
      for (const P of L.paths)
        for (const t of P.tlvs) {
          if (t.fields) withFields.add(t.name);
          if (t.name === "Door" && t.fields) {
            assert.ok("start_state" in t.fields, `${id} Door lock state`); // door_closed is AO-only
            const hubs = [1, 2, 3, 4, 5, 6, 7, 8].map((i) => t.fields[`hub_${i}_id`]);
            if (new Set(hubs).size > 1) doorHubsVary = true;
          }
        }
    assert.ok(
      doorHubsVary,
      `${id}: Door hub ids never vary — the schema parser's union fix regressed`,
    );
    assert.ok(withFields.size > 20, `${id}: only ${withFields.size} types carry fields`);
    for (const t of ["Door", "Mine"]) assert.ok(withFields.has(t), `${id} ${t} has fields`); // both games
  }
});

// every gameplay region type is decoded — nothing falls back to a raw= dump.
// ContinueZone is the pin for the below-base layout override (its zone_number is
// named field_10 but lives at payload word 0).
test("no TLV in the shipped data carries a raw fallback", () => {
  for (const [file, id] of [
    ["map_data_ao.json", "AO"],
    ["map_data_ae.json", "AE"],
  ]) {
    const data = load(file);
    let zones = 0;
    for (const L of data.levels)
      for (const P of L.paths)
        for (const t of P.tlvs) {
          assert.ok(
            !("raw" in (t.extra || {})),
            `${id} ${L.short} P${P.id} ${t.name} (${t.x1},${t.y1}) still raw`,
          );
          if (t.name === "ContinueZone") {
            zones++;
            assert.ok(
              Number.isInteger(t.fields?.zone_number),
              `${id} ContinueZone lacks zone_number`,
            );
          }
        }
    if (id === "AO") assert.ok(zones > 0, "AO ContinueZones present");
  }
});

// a worker/shrykull portal dies where it stands, so its destination words are
// dead data — and they are near-universally the unedited 1/1/1 default, which
// would otherwise read as "every rescue portal leads to Necrum Mines P1 C1"
test("only travel BirdPortals carry a destination", () => {
  for (const [file, id] of [
    ["map_data_ao.json", "AO"],
    ["map_data_ae.json", "AE"],
  ]) {
    const data = load(file);
    let travel = 0;
    for (const L of data.levels)
      for (const P of L.paths)
        for (const t of P.tlvs) {
          if (t.name !== "BirdPortal") continue;
          const where = `${id} ${L.short} P${P.id} (${t.x1},${t.y1})`;
          if (t.extra.portal === "travel") {
            travel++;
            assert.ok(t.extra.to_level != null, `${where}: travel portal lacks a destination`);
          } else {
            assert.equal(t.extra.to_level, undefined, `${where}: ${t.extra.portal} portal`);
          }
        }
    assert.ok(travel > 0, `${id}: no travel portals`);
  }
});

// the shipped data contains exactly three genuinely self-referencing paired
// objects. Dangling destinations (e.g. AE MI P11) must not be flagged, and
// neither must 0-target doors whose camera merely holds them (SV P6, BR P21
// carry numbers 7 and 1 — the engine's hunt for door 0 skips them), nor
// launcher wells whose every state exits within their own screen (destOf
// strips their pairing).
test("loopbacks in the shipped data are exactly the three known ones", () => {
  const found = [];
  for (const file of ["map_data_ao.json", "map_data_ae.json"]) {
    const data = load(file);
    for (const L of data.levels)
      for (const P of L.paths)
        for (const t of P.tlvs)
          if (isLoopback(t, data, L, P))
            found.push(`${data.id} ${L.short} P${P.id} ${t.name} (${t.x1},${t.y1})`);
  }
  assert.deepEqual(found, [
    "AO R1 P18 Door (8746,1232)",
    "AE SV P7 Door (1026,440)",
    "AE BW P7 Teleporter (199,439)",
  ]);
});

// The gap between camera windows is addressing slack the game never renders,
// and level authors parked objects in it. A marker reaching into it draws that
// part dotted; one standing wholly inside it covers no screen at all, which is
// what offScreen marks. AO leaves 656x240 units of slack per cell, enough to
// swallow an object whole; AE's 7x20 never does, so nothing there is offscreen.
test("the shipped data's offscreen objects are the known ones", () => {
  const counts = {};
  for (const [file, geometry] of [
    ["map_data_ao.json", AO_GEOMETRY],
    ["map_data_ae.json", AE_GEOMETRY],
  ]) {
    const data = load(file);
    counts[data.id] = data.levels
      .flatMap((L) => L.paths)
      .flatMap((P) => P.tlvs)
      .filter((t) => offScreen(t, geometry)).length;
  }
  assert.deepEqual(counts, { AO: 276, AE: 0 });
});

// A piece drawn for a collision line must run the way its line does and be no
// longer than it. The slack straddles a cell boundary in AO, so a piece framed
// end by end rather than as a whole comes back reversed, across most of a screen.
test("no collision-line piece is drawn backwards or overlong", () => {
  const bad = [];
  for (const [file, geometry] of [
    ["map_data_ao.json", AO_GEOMETRY],
    ["map_data_ae.json", AE_GEOMETRY],
  ]) {
    const data = load(file);
    for (const g of pitches(geometry))
      for (const L of data.levels)
        for (const P of L.paths)
          for (const [x1, y1, x2, y2] of P.lines) {
            const span = Math.hypot(x2 - x1, y2 - y1);
            for (const r of lineRuns(x1, y1, x2, y2, g)) {
              const [dx, dy] = [r.x2 - r.x1, r.y2 - r.y1];
              const where = `${data.id} ${L.short} P${P.id} (${x1},${y1})–(${x2},${y2})`;
              if (dx * (x2 - x1) + dy * (y2 - y1) < -1e-9) bad.push(`${where} reversed`);
              if (Math.hypot(dx, dy) > span + 1e-6) bad.push(`${where} longer than its line`);
            }
          }
  }
  assert.deepEqual(bad, []);
});

// The pieces of a collision line are one polyline, so each must start where
// the last one ended, at either pitch. A fold drawn where the packing folded
// it away has nowhere of its own to go: it paints over the neighbour it lands
// on and leaves the rest of the line restarting behind it.
test("collision-line pieces meet, packed or spaced", () => {
  const bad = [];
  for (const [file, geometry] of [
    ["map_data_ao.json", AO_GEOMETRY],
    ["map_data_ae.json", AE_GEOMETRY],
  ]) {
    const data = load(file);
    for (const g of pitches(geometry))
      for (const L of data.levels)
        for (const P of L.paths)
          for (const [x1, y1, x2, y2] of P.lines) {
            const rs = lineRuns(x1, y1, x2, y2, g);
            for (let i = 1; i < rs.length; i++)
              if (Math.hypot(rs[i].x1 - rs[i - 1].x2, rs[i].y1 - rs[i - 1].y2) > 1e-6)
                bad.push(`${data.id} ${L.short} P${P.id} (${x1},${y1})–(${x2},${y2})`);
          }
  }
  assert.deepEqual(bad, []);
});

// How much of each game runs through ground it never renders, which is what the
// dotting is there to say: a rule that quietly dots more than it should moves
// these numbers before it breaks anything visible.
test("the count of collision lines dotted somewhere", () => {
  const counts = {};
  for (const [file, geometry] of [
    ["map_data_ao.json", AO_GEOMETRY],
    ["map_data_ae.json", AE_GEOMETRY],
  ]) {
    const data = load(file);
    counts[data.id] = data.levels
      .flatMap((L) => L.paths)
      .flatMap((P) => P.lines)
      .filter(([x1, y1, x2, y2]) => lineRuns(x1, y1, x2, y2, geometry).some((r) => !r.on)).length;
  }
  assert.deepEqual(counts, { AO: 1740, AE: 812 });
});

// A marker's drawn box must contain every part of it that draws solid: a box
// framed by its own two ends walks away from the screen it covers when those
// ends fall in different cells, which inverts the dotting.
test("a marker's drawn box contains the screen it covers, packed or spaced", () => {
  const bad = [];
  for (const [file, geometry] of [
    ["map_data_ao.json", AO_GEOMETRY],
    ["map_data_ae.json", AE_GEOMETRY],
  ]) {
    const data = load(file);
    for (const g of pitches(geometry))
      for (const L of data.levels)
        for (const P of L.paths)
          for (const t of P.tlvs) {
            const where = `${data.id} ${L.short} P${P.id} ${t.name} (${t.x1},${t.y1})`;
            const box = drawBox(t, g),
              { xs, ys } = screenRuns(t, g);
            const axes = [
              [box.x, box.w, xs, "x"],
              [box.y, box.h, ys, "y"],
            ];
            for (const [start, len, runs, axis] of axes) {
              if (len < 0) bad.push(`${where} ${axis} span is inside out`);
              const end = start + Math.max(len, 10);
              for (const [lo, hi] of runs)
                if (lo < start - 1e-9 || hi > end + 1e-9)
                  bad.push(
                    `${where} ${axis} covers [${lo},${hi}] outside its box [${start},${end}]`,
                  );
            }
          }
  }
  assert.deepEqual(bad, []);
});

// A whole-path export paints into one canvas, so what it asks for has to be
// what a browser will allocate. Packed is the promise: every path in either
// game comes out at 1:1. AO's cells are nearly three times the screen they
// show, so spacing them is the only thing that puts a path past the budget,
// and past it every image lands on the cap rather than at its own size.
test("every path exports inside the canvas budget, packed at 1:1", () => {
  const bad = [];
  const scaled = {};
  const biggest = {};
  for (const [file, geometry] of [
    ["map_data_ao.json", AO_GEOMETRY],
    ["map_data_ae.json", AE_GEOMETRY],
  ]) {
    const data = load(file);
    pitches(geometry).forEach((g, i) => {
      const key = `${data.id} ${i ? "spaced" : "packed"}`;
      scaled[key] = 0;
      for (const L of data.levels)
        for (const P of L.paths) {
          const im = pathImage(P, g);
          const where = `${key} ${L.short} P${P.id} ${im.w}x${im.h}`;
          if (im.w > EXPORT_MAX_DIM || im.h > EXPORT_MAX_DIM) bad.push(`${where} outruns a side`);
          if (im.w * im.h > EXPORT_MAX_PX) bad.push(`${where} outruns the area`);
          if (im.scale < 1) scaled[key]++;
          if (i) continue;
          const [bw, bh] = (biggest[data.id] ?? "0x0").split("x");
          if (im.w * im.h > bw * bh) biggest[data.id] = `${im.w}x${im.h}`;
        }
    });
  }
  assert.deepEqual(bad, []);
  assert.deepEqual(scaled, { "AO packed": 0, "AE packed": 0, "AO spaced": 14, "AE spaced": 0 });
  assert.deepEqual(biggest, { AO: "3680x2400", AE: "4416x3360" });
});

// The export frames the path's cell grid, so what the packed layout draws out
// in the slack beyond the outermost screens lands outside the image. The frame
// is exact rather than mean: nothing that covers a screen is cropped, and the
// slack is where the spacing toggle hands out real canvas.
test("the export frame crops nothing the game renders", () => {
  const cropped = [];
  const beyond = {};
  for (const [file, geometry] of [
    ["map_data_ao.json", AO_GEOMETRY],
    ["map_data_ae.json", AE_GEOMETRY],
  ]) {
    const data = load(file);
    for (const spaced of [false, true]) {
      setGeometry(geometry);
      setSpacing(spaced);
      const key = `${data.id} ${spaced ? "spaced" : "packed"}`;
      const [ox, oy] = cellOrigin();
      const tally = (beyond[key] = { markers: 0, lines: 0 });
      for (const L of data.levels)
        for (const P of L.paths) {
          const x2 = ox + P.w * CELL_W,
            y2 = oy + P.h * CELL_H;
          const out = (a, b, lo, hi) => Math.min(a, b) < lo - 1e-6 || Math.max(a, b) > hi + 1e-6;
          const offX = (a, b) => out(a, b, ox, x2);
          const offY = (a, b) => out(a, b, oy, y2);
          const where = `${key} ${L.short} P${P.id}`;
          for (const t of P.tlvs) {
            const b = drawBox(t, LAYOUT);
            // measured at the minimum box size the render draws a marker at
            if (
              b.x + Math.max(b.w, 10) <= ox ||
              b.x >= x2 ||
              b.y + Math.max(b.h, 10) <= oy ||
              b.y >= y2
            )
              tally.markers++;
            const { xs, ys } = screenRuns(t, LAYOUT);
            if (xs.some(([a, c]) => offX(a, c)) || ys.some(([a, c]) => offY(a, c)))
              cropped.push(`${where} ${t.name} (${t.x1},${t.y1}) covers screen outside the frame`);
          }
          for (const [x1, y1, xa, ya] of P.lines)
            for (const r of lineRuns(x1, y1, xa, ya, LAYOUT)) {
              if (!offX(r.x1, r.x2) && !offY(r.y1, r.y2)) continue;
              if (r.on) cropped.push(`${where} (${x1},${y1})\u2013(${xa},${ya}) drawn outside it`);
              else tally.lines++;
            }
        }
    }
  }
  setSpacing(false);
  assert.deepEqual(cropped, []);
  assert.deepEqual(beyond, {
    "AO packed": { markers: 248, lines: 526 },
    "AE packed": { markers: 0, lines: 46 },
    "AO spaced": { markers: 0, lines: 2 },
    "AE spaced": { markers: 0, lines: 0 },
  });
});
