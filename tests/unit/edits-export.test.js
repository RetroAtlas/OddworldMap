import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { state } from "../../public/js/state.js";
import { canonical, exportPath } from "../../public/js/reliveexport.js";
import {
  addObject,
  applyFieldEdit,
  applyRectEdit,
  fitRect,
  restoreEdits,
  revertPath,
  setLevelShort,
  undoEdit,
} from "../../public/js/edits.js";

const load = (f) => JSON.parse(readFileSync(new URL(`../../public/${f}`, import.meta.url), "utf8"));

test("on the shipped data an edited export carries the edit and the reverted one hashes to the fixture", () => {
  const G = load("map_data_ae.json"),
    side = load("relive_export_ae.json");
  const digests = JSON.parse(
    readFileSync(new URL("../fixtures/relive-digests.json", import.meta.url), "utf8"),
  );
  setLevelShort("AE", side.level_short);
  const L = G.levels.find((l) => l.short === "MI"),
    P = L.paths.find((p) => p.id === 1);
  state.games = [G];
  state.data = G;
  state.lvl = L;
  state.path = P;
  const d = P.tlvs.find((t) => t.name === "Door");
  const n = applyFieldEdit(d, "camera", d.fields.camera + 1);
  const at = (doc) =>
    doc.map.cameras
      .flatMap((c) => c.map_objects)
      .find(
        (o) =>
          o.object_structures_type === "Door" &&
          o.properties.xpos === d.x1 &&
          o.properties.ypos === d.y1,
      );
  const { doc } = exportPath("AE", G.geometry, state.lvl, state.path, side);
  assert.equal(at(doc).properties.Camera, d.fields.camera + 1);
  assert.equal(n.extra.to_cam, d.fields.camera + 1);
  revertPath("AE", "MI", 1);
  assert.equal(state.path, P);
  const { doc: back } = exportPath("AE", G.geometry, state.lvl, state.path, side);
  assert.equal(createHash("sha256").update(canonical(back)).digest("hex"), digests.AE["MI P1"]);
  // the revert was a step: one undo brings the edit back, and the trail then
  // steps it away again to the fixture
  assert.ok(undoEdit("AE", "MI", 1));
  const { doc: again } = exportPath("AE", G.geometry, state.lvl, state.path, side);
  assert.equal(at(again).properties.Camera, d.fields.camera + 1);
  assert.ok(undoEdit("AE", "MI", 1));
  assert.equal(state.path, P);
  const { doc: fixture } = exportPath("AE", G.geometry, state.lvl, state.path, side);
  assert.equal(createHash("sha256").update(canonical(fixture)).digest("hex"), digests.AE["MI P1"]);
});

test("a moved object exports where it now stands, listed under the camera its midpoint falls in", () => {
  restoreEdits({});
  const G = load("map_data_ae.json"),
    side = load("relive_export_ae.json");
  setLevelShort("AE", side.level_short);
  const L = G.levels.find((l) => l.short === "MI"),
    P = L.paths.find((p) => p.id === 1);
  state.games = [G];
  state.data = G;
  state.lvl = L;
  state.path = P;
  state.sel = null;
  const d = P.tlvs.find((t) => t.name === "Door");
  const { worldW } = G.geometry;
  const rect = fitRect(P, G.geometry, [d.x1 + worldW, d.y1, d.x2 + worldW, d.y2]);
  assert.notEqual(rect[0], d.x1);
  applyRectEdit(d, rect);
  const { doc, manifest } = exportPath("AE", G.geometry, state.lvl, state.path, side);
  assert.equal(manifest.missing.size, 0);
  const holds = (c) =>
    c.map_objects.some(
      (o) =>
        o.object_structures_type === "Door" &&
        o.properties.xpos === rect[0] &&
        o.properties.ypos === rect[1] &&
        o.properties.width === d.x2 - d.x1,
    );
  const cam = doc.map.cameras.find(holds);
  assert.ok(cam, "the moved door is in the document once");
  assert.equal(doc.map.cameras.filter(holds).length, 1);
  assert.equal(cam.x, Math.floor(Math.floor((rect[0] + rect[2]) / 2) / worldW));
  assert.equal(cam.y, Math.floor(Math.floor((rect[1] + rect[3]) / 2) / G.geometry.worldH));
  assert.equal(
    doc.map.cameras.some((c) =>
      c.map_objects.some((o) => o.properties.xpos === d.x1 && o.properties.ypos === d.y1),
    ),
    false,
    "nothing stands at the shipped spot",
  );
  revertPath("AE", "MI", 1);
  assert.equal(state.path, P);
  const digests = JSON.parse(
    readFileSync(new URL("../fixtures/relive-digests.json", import.meta.url), "utf8"),
  );
  const { doc: back } = exportPath("AE", G.geometry, state.lvl, state.path, side);
  assert.equal(createHash("sha256").update(canonical(back)).digest("hex"), digests.AE["MI P1"]);
});

for (const [g, lv, pa] of [
  ["AO", "R1", 15],
  ["AE", "MI", 1],
]) {
  test(`${g}: an added object exports with every property of its type, listed under its own camera`, () => {
    restoreEdits({});
    const G = load(`map_data_${g.toLowerCase()}.json`),
      side = load(`relive_export_${g.toLowerCase()}.json`);
    setLevelShort(g, side.level_short);
    const L = G.levels.find((l) => l.short === lv),
      P = L.paths.find((p) => p.id === pa);
    state.games = [G];
    state.data = G;
    state.lvl = L;
    state.path = P;
    state.sel = null;
    const door = addObject("Door", [400, 300, 424, 324]);
    const zone = addObject("InvisibleZone", [100, 100, 200, 150]);
    assert.equal("fields" in zone, false);
    const { doc, manifest } = exportPath(g, G.geometry, state.lvl, state.path, side);
    assert.equal(manifest.missing.size, 0);
    const find = (o) =>
      doc.map.cameras.find((c) =>
        c.map_objects.some(
          (m) =>
            m.properties.xpos === o.x1 &&
            m.properties.ypos === o.y1 &&
            m.object_structures_type === side.schema.structures[String(o.t)].name,
        ),
      );
    const dc = find(door),
      zc = find(zone);
    assert.ok(dc && zc);
    // Oddysee lists a rect by its corner, Exoddus by its midpoint
    const anchor = g === "AO" ? door.x1 : Math.floor((door.x1 + door.x2) / 2);
    assert.equal(dc.x, Math.floor(anchor / G.geometry.worldW));
    const exported = dc.map_objects.find(
      (m) => m.properties.xpos === door.x1 && m.properties.ypos === door.y1,
    );
    const props = side.schema.structures[String(door.t)].properties.map((p) => p.name);
    assert.ok(props.length > 10);
    for (const name of props) assert.ok(name in exported.properties, `${name} exported`);
    assert.deepEqual(
      Object.keys(zc.map_objects.find((m) => m.properties.xpos === zone.x1).properties),
      ["xpos", "ypos", "width", "height"],
    );
    revertPath(g, lv, pa);
    const digests = JSON.parse(
      readFileSync(new URL("../fixtures/relive-digests.json", import.meta.url), "utf8"),
    );
    const { doc: back } = exportPath(g, G.geometry, state.lvl, state.path, side);
    assert.equal(
      createHash("sha256").update(canonical(back)).digest("hex"),
      digests[g][`${lv} P${pa}`],
    );
  });
}
