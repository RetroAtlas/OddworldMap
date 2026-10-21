// A release over the base: every overlay the site carries stands up over the
// shipped base without touching it, each path carrying the overlay's values and
// every other path the base's own.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { deriveExtra } from "../../public/js/extra.js";
import { glyphRun } from "../../public/js/lcd.js";
import {
  baseObject,
  isRegional,
  materializeRelease,
  pathRelease,
  releaseAdded,
  releaseChanges,
  releaseSprites,
} from "../../public/js/release.js";
import { AE_GEOMETRY } from "./fixtures.js";

const load = (f) => JSON.parse(readFileSync(new URL(`../../public/${f}`, import.meta.url), "utf8"));
const rectOf = (t) => [t.x1, t.y1, t.x2, t.y2];

const index = load("releases.json");
for (const [game, { releases }] of Object.entries(index))
  for (const { code } of releases)
    test(`${game} ${code} stands over the base and leaves it as it shipped`, () => {
      const base = load(`map_data_${game.toLowerCase()}.json`);
      const overlay = load(`release_${game.toLowerCase()}_${code}.json`);
      const shorts = load(`relive_export_${game.toLowerCase()}.json`).level_short;
      const before = JSON.stringify(base);
      const levels = [...base.levels];
      const R = materializeRelease(base, overlay, shorts);
      assert.equal(JSON.stringify(base), before);
      base.levels.forEach((L, j) => assert.equal(L, levels[j]));
      assert.equal(R.id, game);
      assert.equal(R.game, overlay.title);
      assert.equal(R.release.code, code);
      assert.equal(R.release.hz, overlay.hz);
      assert.equal(R.geometry, base.geometry);
      base.levels.forEach((L, j) =>
        L.paths.forEach((P, i) => {
          const RP = R.levels[j].paths[i];
          const e = overlay.paths[`${L.short}/${P.id}`];
          if (!e) {
            assert.equal(RP, P, `${L.short}/${P.id}`);
            return;
          }
          const where = `${L.short}/${P.id}`;
          const objects = Object.entries(e.objects ?? {});
          const removed = objects.filter(([, d]) => d.removed).length;
          const added = objects.filter(([k]) => k.startsWith("+")).length;
          assert.equal(RP.tlvs.length, P.tlvs.length - removed + added, where);
          assert.equal(pathRelease(RP).removed.length, removed, where);
          for (const t of RP.tlvs) {
            const b = baseObject(t);
            if (releaseAdded(t)) assert.equal(b, null);
            else assert.ok(P.tlvs.includes(b), where);
            if (b && b !== t) {
              const c = releaseChanges(t);
              for (const [f, from, to] of c.fields) {
                assert.equal(b.fields[f], from);
                assert.equal(t.fields[f], to);
              }
            }
          }
          for (const [k, d] of objects)
            if (k.startsWith("+")) {
              const o = RP.tlvs.find(
                (t) => releaseAdded(t) && t.x1 === d.rect[0] && t.y1 === d.rect[1],
              );
              assert.ok(o, `${where} ${k}`);
              assert.deepEqual(rectOf(o), d.rect);
              assert.equal(o.name, d.name);
            }
          if (e.lines) assert.equal(RP.lines, e.lines);
          for (const [name, c] of Object.entries(e.cams ?? {})) {
            const cam = RP.cams.find((x) => x.name === name);
            if (c === null) assert.equal(cam, undefined, `${where} ${name}`);
            else {
              // a camera the base holds keeps its screen unless the release ships one whole
              const shipped = P.cams.find((x) => x.name === name);
              assert.equal(cam.png, c.png ?? shipped.png, `${where} ${name}`);
              assert.ok(cam.png, `${where} ${name} has a screen`);
              assert.equal(cam.patches, c.patches);
              assert.equal(cam.masks, c.masks);
              assert.ok(isRegional(cam));
            }
          }
          for (const cam of RP.cams)
            if (!e.cams?.[cam.name]) assert.ok(P.cams.includes(cam), `${where} ${cam.name}`);
        }),
      );
    });

const door = (x1, f = {}) => {
  const t = {
    t: 5,
    name: "Door",
    x1,
    y1: 10,
    x2: x1 + 24,
    y2: 34,
    fields: {
      level: 1,
      path: 1,
      camera: 1,
      scale: 0,
      door_number: 1,
      switch_id: 0,
      target_door_id: 0,
      door_type: 0,
      ...f,
    },
  };
  return { ...t, extra: deriveExtra("AE", t, { 1: "MI" }) };
};
const world = () => ({
  id: "AE",
  game: "Abe's Exoddus",
  geometry: AE_GEOMETRY,
  levels: [
    {
      id: 1,
      short: "MI",
      name: "Mines",
      paths: [
        {
          id: 1,
          w: 2,
          h: 1,
          cams: [],
          lines: [[0, 100, 300, 100, 0]],
          tlvs: [door(10), door(100), door(200)],
        },
      ],
    },
  ],
});

test("a patched screen keeps the base's picture under the release's patches and masks", () => {
  const base = world();
  base.levels[0].paths[0].cams = [
    {
      cell: 0,
      name: "MIP01C01",
      png: "cams/ae/MI/MIP01C01.png",
      masks: [[4, "cams/ae/MI/MIP01C01_fg4.png"]],
    },
    { cell: 1, name: "MIP01C02", png: "cams/ae/MI/MIP01C02.png" },
  ];
  const patches = [[16, 32, "cams/ae/jp/MI/MIP01C01_16_32.0123456789ab.png"]];
  const R = materializeRelease(
    base,
    {
      game: "AE",
      code: "jp",
      name: "Japan",
      title: "Abe '99",
      hz: 30,
      paths: {
        "MI/1": {
          cams: {
            MIP01C01: { cell: 0, patches },
            MIP01C02: { cell: 1, png: "cams/ae/jp/MI/MIP01C02.0123456789ab.png" },
          },
        },
      },
    },
    { 1: "MI" },
  );
  const [patched, whole] = R.levels[0].paths[0].cams;
  assert.equal(patched.png, "cams/ae/MI/MIP01C01.png");
  assert.equal(patched.patches, patches);
  assert.equal(patched.masks, undefined);
  assert.equal(whole.png, "cams/ae/jp/MI/MIP01C02.0123456789ab.png");
  assert.equal(whole.patches, undefined);
  assert.ok(isRegional(patched) && isRegional(whole));
  assert.ok(!base.levels[0].paths[0].cams.some(isRegional));
});

test("additions follow the object the release lists them after, and a change carries both values", () => {
  const base = world();
  const R = materializeRelease(
    base,
    {
      game: "AE",
      code: "jp",
      title: "Abe '99",
      hz: 30,
      paths: {
        "MI/1": {
          objects: {
            "Door@10,10": { removed: true },
            "Door@100,10": { fields: { camera: 2 }, rect: [110, 10, 134, 34] },
            "+1": {
              name: "Door",
              rect: [50, 10, 74, 34],
              after: null,
              fields: base.levels[0].paths[0].tlvs[0].fields,
            },
            "+2": {
              name: "Door",
              rect: [60, 10, 84, 34],
              after: "+1",
              fields: base.levels[0].paths[0].tlvs[0].fields,
            },
            "+3": {
              name: "Door",
              rect: [300, 10, 324, 34],
              after: "Door@200,10",
              fields: base.levels[0].paths[0].tlvs[0].fields,
            },
          },
          lines: [
            [0, 100, 300, 100, 0],
            [0, 120, 300, 120, 0],
          ],
          links: [
            [-1, -1],
            [-1, -1],
          ],
        },
      },
    },
    { 1: "MI" },
  );
  const P = R.levels[0].paths[0];
  assert.deepEqual(
    P.tlvs.map((t) => t.x1),
    [50, 60, 110, 200, 300],
  );
  assert.deepEqual(releaseChanges(P.tlvs[2]), {
    fields: [["camera", 1, 2]],
    moved: true,
    resized: false,
  });
  assert.equal(P.tlvs[2].extra.to_cam, 2);
  assert.equal(baseObject(P.tlvs[3]), base.levels[0].paths[0].tlvs[2]);
  assert.equal(releaseChanges(P.tlvs[3]), null);
  assert.deepEqual(releaseChanges(P.tlvs[0]), { added: true });
  assert.deepEqual(pathRelease(P).removed, [base.levels[0].paths[0].tlvs[0]]);
  assert.deepEqual([...pathRelease(P).lines], [1]);
  assert.deepEqual(pathRelease(P).gone, []);
  assert.equal(pathRelease(base.levels[0].paths[0]), null);
});

for (const [game, { releases }] of Object.entries(index))
  for (const { code } of releases)
    test(`${game} ${code}: every code its messages use reaches a glyph its font draws`, () => {
      const g = game.toLowerCase();
      const overlay = load(`release_${g}_${code}.json`);
      const sprites = load(`sprites_${g}.json`);
      const font = overlay.font ?? sprites.font;
      const tables = { ...load(`messages_${g}.json`), ...overlay.messages };
      // each glyph the run draws beside the byte it was read from, an escape
      // byte and its second byte reading as one; only a space may draw none
      for (const [name, table] of Object.entries(tables))
        for (const msg of table) {
          const run = glyphRun(font, msg);
          const from = [];
          for (let i = 0; i < msg.length; i++) {
            from.push(msg[i]);
            if (font.escapes?.[msg.charCodeAt(i)] && i + 1 < msg.length) i++;
          }
          assert.equal(run.length, from.length);
          run.forEach((g, i) => {
            const where = `${name}: ${JSON.stringify(msg)} at ${i}`;
            assert.ok(g < font.glyphs.length, `${where} reaches past the glyph table`);
            if (g < 0) assert.equal(from[i], " ", `${where} has no glyph`);
          });
        }
    });

test("a release's sprite sidecar is the base's with the release's own parts over it", () => {
  const base = load("map_data_ao.json");
  const sprites = load("sprites_ao.json");
  const shorts = load("relive_export_ao.json").level_short;
  const jp = materializeRelease(base, load("release_ao_jp.json"), shorts);
  const set = releaseSprites(sprites, jp);
  assert.equal(set.sheets.Font, jp.release.sheets.Font);
  assert.equal(set.font.sheet, sprites.font.sheet);
  assert.equal(set.font.codes, jp.release.font.codes);
  assert.equal(set.anims["bg:5002"], jp.release.sprites.anims["bg:5002"]);
  assert.equal(set.anims.Slig_Idle, sprites.anims.Slig_Idle);
  assert.equal(set.links.D1, sprites.links.D1);
  const eu = materializeRelease(load("map_data_ao.json"), load("release_ao_eu.json"), shorts);
  const euSet = releaseSprites(sprites, eu);
  const overlay = load("release_ao_eu.json");
  for (const [key, e] of Object.entries(overlay.paths))
    if (e.links) {
      const [lv, pa] = key.split("/");
      assert.deepEqual(euSet.links[lv][pa], e.links, key);
    }
  assert.equal(euSet.font, sprites.font);
  // Exoddus's lines carry more words than the sprites read
  const aeSprites = load("sprites_ae.json");
  const aeOverlay = load("release_ae_jp.json");
  const ae = materializeRelease(
    load("map_data_ae.json"),
    aeOverlay,
    load("relive_export_ae.json").level_short,
  );
  const aeSet = releaseSprites(aeSprites, ae);
  for (const [key, e] of Object.entries(aeOverlay.paths))
    if (e.links) {
      const [lv, pa] = key.split("/");
      assert.deepEqual(
        aeSet.links[lv][pa],
        e.links.map((row) => row.slice(0, 2)),
        key,
      );
    }
});
