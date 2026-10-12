// The edit model: a delta never touches a fetched object, a path with deltas
// stands as a new object over the pristine one, a path whose deltas are gone
// stands as the pristine object itself, and every swap re-points the selection.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";

import { state } from "../../public/js/state.js";
import { setFieldTypes, setEnumLabels } from "../../public/js/fields.js";
import { pathVisible, revealPath } from "../../public/js/pathvisible.js";
import { deriveExtra } from "../../public/js/extra.js";
import { exportPath, canonical } from "../../public/js/reliveexport.js";
import {
  applyFieldEdit,
  applyRectEdit,
  applyStoredEdits,
  canRedo,
  canUndo,
  currentOf,
  editNotes,
  editedFields,
  editedRect,
  fitRect,
  forgetAll,
  gameEdits,
  hasStoredEdits,
  isEdited,
  materializePath,
  objectKeys,
  pathEdited,
  pristineOf,
  redoEdit,
  editStore,
  restoreEdits,
  revertPath,
  sanitizeEdits,
  undoEdit,
  setEnabled,
  setLevelShort,
  snapRect,
  takeReport,
  validDelta,
  validRect,
} from "../../public/js/edits.js";
import { AE_GEOMETRY } from "./fixtures.js";

const load = (f) => JSON.parse(readFileSync(new URL(`../../public/${f}`, import.meta.url), "utf8"));

const SHORT = { 0: "ST", 1: "MI", 2: "NE" };
setLevelShort("AE", SHORT);
// one typed field, so the label guard has something to refuse
setFieldTypes({ AE: { Door: { door_type: "DoorTypes" } } });
setEnumLabels({ AE: { DoorTypes: { 0: "normal", 1: "hub" } } });

const DOOR = {
  level: 1,
  path: 1,
  camera: 17,
  scale: 0,
  door_number: 1,
  switch_id: 0,
  target_door_id: 0,
  door_type: 0,
};
const door = (x1, y1, f = {}) => {
  const t = { t: 5, name: "Door", x1, y1, x2: x1 + 24, y2: y1 + 24, fields: { ...DOOR, ...f } };
  return { ...t, extra: deriveExtra("AE", t, SHORT) };
};
const plain = (name, x1, y1) => ({ t: 1, name, x1, y1, x2: x1 + 10, y2: y1 + 10, extra: {} });

// a two-path Exoddus level shaped like the map data, the second path a demo copy
function world() {
  const p1 = {
    id: 1,
    w: 2,
    h: 1,
    cams: [],
    tlvs: [door(10, 10), door(400, 10, { door_number: 2 }), plain("Hoist", 50, 50)],
    lines: [],
  };
  const p2 = {
    id: 2,
    w: 1,
    h: 1,
    cams: [],
    tlvs: [plain("DemoSpawnPoint", 0, 0), door(20, 20)],
    lines: [],
  };
  return {
    id: "AE",
    game: "Abe's Exoddus",
    geometry: AE_GEOMETRY,
    levels: [{ id: 1, short: "MI", name: "Mines", paths: [p1, p2] }],
  };
}
function stand(G, pa = 1) {
  state.games = [G];
  state.data = G;
  state.lvl = G.levels[0];
  state.path = G.levels[0].paths.find((P) => P.id === pa);
  state.sel = null;
}

test("a path without deltas materializes as itself", () => {
  const P = world().levels[0].paths[0];
  assert.equal(materializePath("AE", P, undefined), P);
  assert.equal(materializePath("AE", P, { objects: { "Door@10,10": { fields: {} } } }), P);
  assert.equal(pathEdited(P), false);
});

test("an edit stands as a new path whose other objects keep their identity", () => {
  const G = world();
  const [L0] = G.levels,
    P1 = L0.paths[0],
    d = P1.tlvs[0];
  stand(G);
  const n = applyFieldEdit(d, "camera", 18);
  assert.notEqual(n, d);
  assert.equal(n.fields.camera, 18);
  assert.equal(n.extra.to_cam, 18); // the bucket follows the archive
  assert.equal(d.fields.camera, 17); // the fetched object is untouched
  assert.notEqual(state.path, P1);
  assert.equal(state.path.tlvs[0], n);
  assert.equal(state.path.tlvs[1], P1.tlvs[1]);
  assert.equal(state.path.tlvs[2], P1.tlvs[2]);
  assert.notEqual(state.lvl, L0);
  assert.equal(G.levels[0], state.lvl);
  assert.equal(state.lvl.paths[1], L0.paths[1]); // the untouched path by identity too
  assert.deepEqual(editedFields(n), { camera: 18 });
  assert.deepEqual(editedFields(d), {});
  assert.equal(pristineOf(n), d);
  assert.equal(currentOf(d), n);
  assert.ok(pathEdited(state.path));
  assert.deepEqual(gameEdits("AE"), { objects: 1, paths: 1 });
  for (const k of Object.keys(n.extra)) assert.ok(!(k in n.fields), k);
  // a second edit to the same object stands the path anew, its fields following
  const after = state.path;
  const n2 = applyFieldEdit(n, "door_number", 2);
  assert.notEqual(state.path, after);
  assert.equal(n2.fields.door_number, 2);
  assert.equal(n2.fields.camera, 18);
  assert.deepEqual(editedFields(n2), { camera: 18, door_number: 2 });
  assert.equal(applyFieldEdit(n2, "door_number", 1).fields.camera, 18);
  // the shipped value takes the delta away and the pristine objects come back
  assert.equal(applyFieldEdit(n, "camera", 17), d);
  assert.equal(state.path, P1);
  assert.equal(state.lvl, L0);
  assert.equal(G.levels[0], L0);
  assert.deepEqual(gameEdits("AE"), { objects: 0, paths: 0 });
});

test("a second edit on another path keeps the first path standing as it is", () => {
  const G = world();
  const [L0] = G.levels;
  stand(G);
  applyFieldEdit(state.path.tlvs[0], "camera", 18);
  const edited1 = state.path;
  stand(G, 2);
  applyFieldEdit(state.path.tlvs[1], "camera", 19);
  assert.equal(state.lvl.paths[0], edited1);
  assert.equal(state.lvl.paths[1].tlvs[1].fields.camera, 19);
  forgetAll();
  assert.deepEqual(gameEdits("AE"), { objects: 0, paths: 0 });
  assert.equal(G.levels[0], L0);
  assert.equal(pathEdited(L0.paths[0]), false);
});

test("every swap re-points the selection, and a revert swaps the pristine objects back", () => {
  const G = world();
  const [L0] = G.levels,
    P1 = L0.paths[0],
    d = P1.tlvs[0];
  stand(G);
  state.sel = d;
  const n = applyFieldEdit(d, "camera", 18);
  assert.equal(state.sel, n);
  revertPath("AE", "MI", 1);
  assert.equal(state.sel, d);
  assert.equal(state.path, P1);
  assert.equal(G.levels[0], L0);
  assert.equal(pathEdited(state.path), false);
});

test("a demo path's reveal survives the swap in both directions", () => {
  const G = world();
  const P2 = G.levels[0].paths[1];
  assert.equal(pathVisible(P2), false);
  revealPath(P2);
  stand(G, 2);
  applyFieldEdit(state.path.tlvs[1], "camera", 3);
  assert.notEqual(state.path, P2);
  assert.ok(pathVisible(state.path));
  revertPath("AE", "MI", 2);
  assert.equal(state.path, P2);
  assert.ok(pathVisible(P2));
});

test("one guard decides a delta: the field, the word's range and the labels", () => {
  const d = world().levels[0].paths[0].tlvs[0];
  assert.ok(validDelta("AE", d, "camera", 5));
  assert.ok(validDelta("AE", d, "camera", -32768));
  assert.ok(validDelta("AE", d, "door_type", 1));
  assert.equal(validDelta("AE", d, "camera", 40000), false);
  assert.equal(validDelta("AE", d, "camera", 1.5), false);
  assert.equal(validDelta("AE", d, "camera", "5"), false);
  assert.equal(validDelta("AE", d, "no_such_field", 1), false);
  assert.equal(validDelta("AE", d, "door_type", 9), false); // typed, and nothing labels 9
  assert.equal(validDelta("AE", plain("Hoist", 0, 0), "camera", 1), false); // no archive at all
  // the value that shipped passes whatever the labels say: the way back is never refused
  const unlabelled = door(10, 10, { door_type: 9 });
  assert.ok(validDelta("AE", unlabelled, "door_type", 9));
  assert.equal(validDelta("AE", unlabelled, "door_type", 8), false);
  const G = world();
  stand(G);
  assert.throws(() => applyFieldEdit(G.levels[0].paths[0].tlvs[0], "door_type", 9), /not a value/);
  assert.throws(
    () => applyFieldEdit(G.levels[0].paths[0].tlvs[0], "camera", 1, { game: "AO" }),
    /level map/,
  );
  assert.equal(G.levels[0], state.lvl); // nothing swapped
});

test("a rect delta moves or resizes the object and keeps the rest of the path by identity", () => {
  restoreEdits({});
  const G = world();
  const [L0] = G.levels,
    P1 = L0.paths[0],
    d = P1.tlvs[0];
  stand(G);
  const n = applyRectEdit(d, [20, 15, 44, 39]);
  assert.deepEqual([n.x1, n.y1, n.x2, n.y2], [20, 15, 44, 39]);
  assert.deepEqual([d.x1, d.y1, d.x2, d.y2], [10, 10, 34, 34]); // the fetched object is untouched
  assert.equal(n.fields, d.fields); // nothing of the archive changed
  assert.deepEqual(n.extra, d.extra);
  assert.equal(state.path.tlvs[1], P1.tlvs[1]);
  assert.equal(state.path.tlvs[2], P1.tlvs[2]);
  assert.deepEqual(editedRect(n), [10, 10, 34, 34]);
  assert.deepEqual(editNotes(n), ["moved"]);
  assert.ok(isEdited(n));
  assert.deepEqual(editedFields(n), {});
  assert.equal(pristineOf(n), d);
  assert.equal(currentOf(d), n);
  assert.ok(pathEdited(state.path));
  assert.deepEqual(editStore().AE["MI/1"].objects["Door@10,10"], { rect: [20, 15, 44, 39] });
  // a resize keeps the corner and says so; a field edit joins the notes, names first
  const r = applyRectEdit(n, [20, 15, 60, 39]);
  assert.deepEqual(editNotes(r), ["moved", "resized"]);
  const f = applyFieldEdit(r, "camera", 18);
  assert.deepEqual(editNotes(f), ["camera", "moved", "resized"]);
  assert.equal(f.extra.to_cam, 18);
  assert.deepEqual([f.x1, f.y1, f.x2, f.y2], [20, 15, 60, 39]);
  // the shipped rect takes the delta away; the field delta stands alone
  const back = applyRectEdit(f, [10, 10, 34, 34]);
  assert.deepEqual(editNotes(back), ["camera"]);
  assert.equal(editedRect(back), null);
  assert.deepEqual(editStore().AE["MI/1"].objects["Door@10,10"], { fields: { camera: 18 } });
  assert.equal(applyFieldEdit(back, "camera", 17), d);
  assert.equal(state.path, P1);
  // the rect already standing is no step and no swap
  const again = applyRectEdit(d, [20, 15, 44, 39]);
  const before = state.path;
  assert.equal(applyRectEdit(again, [20, 15, 44, 39]), again);
  assert.equal(state.path, before);
});

test("a rect delta on an object that archives no fields leaves it without the key", () => {
  restoreEdits({});
  const G = world();
  const h = G.levels[0].paths[0].tlvs[2];
  stand(G);
  const n = applyRectEdit(h, [60, 50, 70, 60]);
  assert.equal("fields" in n, false);
  assert.deepEqual(n.extra, {});
  assert.deepEqual(editNotes(n), ["moved"]);
  assert.equal(validDelta("AE", n, "camera", 1), false);
});

test("a rect is a place on the grid by column and row, and the shipped one passes whatever it is", () => {
  const P = world().levels[0].paths[0]; // two cells across, one down: 750 by 260
  const geo = AE_GEOMETRY;
  assert.ok(validRect(P, geo, [0, 0, 24, 24]));
  assert.ok(validRect(P, geo, [700, 200, 724, 224]));
  assert.ok(validRect(P, geo, [10, 10, 10, 10])); // the data ships zero sizes
  assert.equal(validRect(P, geo, [750, 0, 774, 24]), false); // the corner a column past the edge
  assert.equal(validRect(P, geo, [740, 0, 764, 24]), false); // the midpoint past it
  assert.equal(validRect(P, geo, [700, 250, 724, 274]), false); // the midpoint a row down
  assert.equal(validRect(P, geo, [-1, 0, 24, 24]), false);
  assert.equal(validRect(P, geo, [0, -1, 24, 24]), false);
  assert.equal(validRect(P, geo, [10, 10, 5, 34]), false); // inside out
  assert.equal(validRect(P, geo, [10, 10, 34.5, 34]), false);
  assert.equal(validRect(P, geo, [10, 10, 34]), false);
  assert.equal(validRect(P, geo, [10, 10, 40000, 34]), false);
  assert.ok(validRect(P, geo, [800, 10, 824, 34], [800, 10, 824, 34])); // the way back
  // on a path of two rows a column past the edge folds into the next row's first cell, and is refused all the same
  const P2 = { id: 3, w: 2, h: 2, cams: [], tlvs: [], lines: [] };
  assert.equal(validRect(P2, geo, [750, 0, 774, 24]), false);
  assert.equal(validRect(P2, geo, [740, 0, 764, 24]), false);
  assert.ok(validRect(P2, geo, [0, 260, 24, 284]));
  assert.ok(validRect(P2, geo, [740, 260, 749, 284]));
  assert.deepEqual(fitRect(P2, geo, [750, 0, 774, 24]), [737, 0, 761, 24]);
  assert.deepEqual(fitRect(P, geo, [750, 0, 774, 24]), [737, 0, 761, 24]);
  assert.deepEqual(fitRect(P, geo, [-5, -5, 19, 19]), [0, 0, 24, 24]);
  assert.deepEqual(fitRect(P, geo, [100, 100, 124, 124]), [100, 100, 124, 124]);
  assert.deepEqual(fitRect(P, geo, [700, 250, 724, 274]), [700, 247, 724, 271]);
  assert.equal(fitRect(P, geo, [0, 0, 1500, 24]), null);
  for (const r of [
    [750, 0, 774, 24],
    [-5, -5, 19, 19],
    [700, 250, 724, 274],
  ])
    assert.ok(validRect(P, geo, fitRect(P, geo, r)));
  const G = world();
  stand(G);
  assert.throws(() => applyRectEdit(G.levels[0].paths[0].tlvs[0], [750, 0, 774, 24]), /grid/);
  assert.equal(G.levels[0], state.lvl); // nothing swapped
});

test("a run of nudges is one step, which a drag, another edit, an undo or a redo ends", () => {
  restoreEdits({});
  const G = world();
  const P1 = G.levels[0].paths[0],
    d = P1.tlvs[0];
  stand(G);
  const nudge = (t, dx) => applyRectEdit(t, [t.x1 + dx, t.y1, t.x2 + dx, t.y2], { merge: true });
  let n = nudge(d, 1);
  n = nudge(n, 1);
  n = nudge(n, 1);
  assert.equal(n.x1, 13);
  assert.ok(undoEdit("AE", "MI", 1));
  assert.equal(state.path, P1); // three nudges, one step
  assert.equal(canUndo("AE", "MI", 1), false);
  // a drag's step stands apart from the nudges after it
  n = applyRectEdit(d, [30, 10, 54, 34]);
  n = nudge(n, 1);
  nudge(n, 1);
  undoEdit("AE", "MI", 1);
  assert.equal(state.path.tlvs[0].x1, 30);
  undoEdit("AE", "MI", 1);
  assert.equal(state.path, P1);
  // a step of another kind ends a run, and undoing it does not reopen the run
  n = nudge(d, 1);
  n = nudge(n, 1);
  applyFieldEdit(n, "camera", 18);
  undoEdit("AE", "MI", 1);
  assert.equal(state.path.tlvs[0].fields.camera, 17);
  assert.equal(state.path.tlvs[0].x1, 12);
  nudge(state.path.tlvs[0], 1);
  assert.equal(canRedo("AE", "MI", 1), false);
  undoEdit("AE", "MI", 1);
  assert.equal(state.path.tlvs[0].x1, 12); // the nudge after the undo was its own step
  undoEdit("AE", "MI", 1);
  assert.equal(state.path, P1);
  // a redo ends a run too
  nudge(d, 1);
  undoEdit("AE", "MI", 1);
  redoEdit("AE", "MI", 1);
  assert.equal(state.path.tlvs[0].x1, 11);
  nudge(state.path.tlvs[0], 1);
  undoEdit("AE", "MI", 1);
  assert.equal(state.path.tlvs[0].x1, 11);
});

test("a stored rect applies where it is a place on the grid and differs from the shipped one", () => {
  restoreEdits({
    AE: {
      "MI/1": {
        objects: {
          "Door@10,10": { rect: [20, 15, 44, 39] },
          "Door@400,10": { rect: [400, 10, 424, 34], fields: { camera: 3 } }, // the rect as shipped
          "Hoist@50,50": { rect: [750, 50, 760, 60] }, // off the grid
        },
      },
    },
  });
  const G = world();
  assert.deepEqual(applyStoredEdits(G), { applied: 2, dropped: 2 });
  const P = G.levels[0].paths[0];
  assert.equal(P.tlvs[0].x1, 20);
  assert.equal(P.tlvs[1].fields.camera, 3);
  assert.equal(P.tlvs[1].x1, 400);
  assert.equal(P.tlvs[2].x1, 50);
  assert.deepEqual(editStore().AE["MI/1"].objects, {
    "Door@10,10": { rect: [20, 15, 44, 39] },
    "Door@400,10": { fields: { camera: 3 } },
  });
  restoreEdits({});
});

test("objects with one origin are told apart by their order", () => {
  const P = { id: 1, tlvs: [door(10, 10), door(400, 10), door(10, 10, { door_number: 7 })] };
  assert.deepEqual([...objectKeys(P).values()], ["Door@10,10#1", "Door@400,10", "Door@10,10#2"]);
});

test("stored deltas apply where they still answer to an object and are dropped where they do not", () => {
  restoreEdits({
    AE: {
      "MI/1": {
        objects: {
          "Door@10,10": { fields: { camera: 20, no_such: 1, door_type: 9 } },
          "Door@400,10": { fields: { camera: 17 } }, // what the disc now ships
          "Door@999,999": { fields: { camera: 1 } },
        },
      },
    },
  });
  assert.ok(hasStoredEdits("AE"));
  setEnabled(false);
  assert.equal(hasStoredEdits("AE"), false);
  setEnabled(true);
  const G = world();
  const P1 = G.levels[0].paths[0];
  assert.deepEqual(applyStoredEdits(G), { applied: 1, dropped: 4 });
  assert.deepEqual(takeReport("AE"), { applied: 1, dropped: 4, unapplied: 0 });
  assert.equal(editStore().AE["MI/1"].objects["Door@400,10"], undefined);
  assert.equal(takeReport("AE"), null);
  assert.notEqual(G.levels[0].paths[0], P1);
  assert.equal(G.levels[0].paths[0].tlvs[0].fields.camera, 20);
  assert.equal(P1.tlvs[0].fields.camera, 17);
  assert.deepEqual(gameEdits("AE"), { objects: 1, paths: 1 });
  restoreEdits({});
  assert.equal(hasStoredEdits("AE"), false);
});

test("the stored shape is read by shape alone, and anything else in it is dropped", () => {
  assert.deepEqual(sanitizeEdits(null), {});
  assert.deepEqual(sanitizeEdits("{not json"), {});
  assert.deepEqual(sanitizeEdits('"a string"'), {});
  assert.deepEqual(sanitizeEdits("[]"), {});
  const kept = {
    AE: { "MI/1": { objects: { "Door@10,10#2": { fields: { camera: 20, scale: -1 } } } } },
  };
  assert.deepEqual(sanitizeEdits(JSON.stringify(kept)), kept);
  const noisy = {
    AE: {
      "MI/1": {
        objects: {
          "Door@10,10": { fields: { camera: 20, bad: 1.5, big: 40000, word: "x" } },
          "not a key": { fields: { camera: 1 } },
          "Zone@0,0": { fields: {} },
        },
      },
      "mi/x": { objects: { "Door@1,1": { fields: { camera: 1 } } } },
      "NE/2": "junk",
    },
    ao: { "R1/1": { objects: { "Door@1,1": { fields: { camera: 1 } } } } },
    AO: null,
  };
  assert.deepEqual(sanitizeEdits(JSON.stringify(noisy)), {
    AE: { "MI/1": { objects: { "Door@10,10": { fields: { camera: 20 } } } } },
  });
  const rects = {
    AE: {
      "MI/1": {
        objects: {
          "Door@10,10": { rect: [20, 15, 44, 39] },
          "Door@400,10": { fields: { camera: 3 }, rect: [1, 2, 3] },
          "Hoist@50,50": { rect: [10, 10, 5, 34] },
          "Hoist@1,1": { rect: [0, 0, 1.5, 2] },
          "Hoist@2,2": { rect: [0, 0, 40000, 2] },
          "Zone@0,0": {},
          "Zone@1,1": "junk",
        },
      },
    },
  };
  assert.deepEqual(sanitizeEdits(JSON.stringify(rects)), {
    AE: {
      "MI/1": {
        objects: {
          "Door@10,10": { rect: [20, 15, 44, 39] },
          "Door@400,10": { fields: { camera: 3 } },
        },
      },
    },
  });
});

test("a step undoes to the pristine path itself and redoes to the edit, a new step clearing the redo", () => {
  restoreEdits({});
  const G = world();
  const [L0] = G.levels,
    P1 = L0.paths[0],
    d = P1.tlvs[0];
  stand(G);
  const n = applyFieldEdit(d, "camera", 18);
  assert.ok(canUndo("AE", "MI", 1));
  assert.equal(canRedo("AE", "MI", 1), false);
  assert.ok(undoEdit("AE", "MI", 1));
  assert.equal(state.path, P1);
  assert.equal(state.lvl, L0);
  assert.equal(pathEdited(P1), false);
  assert.equal(canUndo("AE", "MI", 1), false);
  assert.ok(canRedo("AE", "MI", 1));
  assert.ok(redoEdit("AE", "MI", 1));
  assert.notEqual(state.path, P1);
  assert.equal(state.path.tlvs[0].fields.camera, 18);
  assert.equal(state.path.tlvs[0].extra.to_cam, 18);
  assert.equal(pristineOf(state.path.tlvs[0]), pristineOf(n));
  undoEdit("AE", "MI", 1);
  applyFieldEdit(d, "camera", 19); // a new step after an undo
  assert.equal(canRedo("AE", "MI", 1), false);
  assert.equal(state.path.tlvs[0].fields.camera, 19);
  // an edit to the value already standing is no step and no swap
  const before = state.path;
  applyFieldEdit(state.path.tlvs[0], "camera", 19);
  assert.equal(state.path, before);
  undoEdit("AE", "MI", 1);
  assert.equal(state.path, P1);
  assert.equal(undoEdit("AE", "MI", 1), false);
  assert.equal(state.path, P1);
});

test("a snapshot is the entry as it stood: the step after it cannot reach back", () => {
  restoreEdits({});
  const G = world();
  const P1 = G.levels[0].paths[0];
  stand(G);
  applyFieldEdit(P1.tlvs[0], "camera", 18);
  const first = state.path;
  applyFieldEdit(P1.tlvs[0], "door_number", 5); // writes into the same live delta
  assert.notEqual(state.path, first); // a second edit to the object stands the path anew
  assert.deepEqual(editedFields(state.path.tlvs[0]), { camera: 18, door_number: 5 });
  assert.equal(state.path.tlvs[0].fields.door_number, 5);
  assert.equal(state.path.tlvs[0].fields.camera, 18);
  assert.deepEqual(editedFields(first.tlvs[0]), { camera: 18 }); // the earlier materialization keeps its own
  undoEdit("AE", "MI", 1);
  assert.deepEqual(editedFields(state.path.tlvs[0]), { camera: 18 });
  assert.equal(state.path.tlvs[0].fields.door_number, 1);
  undoEdit("AE", "MI", 1);
  assert.equal(state.path, P1);
});

test("a revert is one step: an undo brings every delta back, a redo reverts again", () => {
  restoreEdits({});
  const G = world();
  const P1 = G.levels[0].paths[0];
  stand(G);
  applyFieldEdit(P1.tlvs[0], "camera", 18);
  applyFieldEdit(P1.tlvs[1], "camera", 3);
  revertPath("AE", "MI", 1);
  assert.equal(state.path, P1);
  assert.ok(undoEdit("AE", "MI", 1));
  assert.equal(state.path.tlvs[0].fields.camera, 18);
  assert.equal(state.path.tlvs[1].fields.camera, 3);
  assert.ok(redoEdit("AE", "MI", 1));
  assert.equal(state.path, P1);
  revertPath("AE", "MI", 1); // a revert of nothing is not a step
  assert.equal(canUndo("AE", "MI", 1), true);
  assert.equal(canRedo("AE", "MI", 1), false);
});

test("each path keeps its own trail, and forgetting all empties every one", () => {
  restoreEdits({});
  const G = world();
  const [L0] = G.levels;
  stand(G);
  applyFieldEdit(L0.paths[0].tlvs[0], "camera", 18);
  stand(G, 2);
  applyFieldEdit(state.path.tlvs[1], "camera", 3);
  assert.equal(undoEdit("AE", "MI", 1), true);
  assert.equal(state.lvl.paths[0], L0.paths[0]);
  assert.equal(state.lvl.paths[1].tlvs[1].fields.camera, 3);
  assert.equal(undoEdit("AE", "NE", 9), false); // no trail, no swap
  assert.ok(canUndo("AE", "MI", 2));
  forgetAll();
  assert.equal(canUndo("AE", "MI", 1) || canRedo("AE", "MI", 1) || canUndo("AE", "MI", 2), false);
  assert.equal(G.levels[0], L0);
});

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

test("a snapped rect puts its midpoint where the engine's grid stands a sprite, by scale and camera", () => {
  const ao = { worldW: 1024, worldH: 480 };
  const full = { name: "Slig", fields: { scale: 0 } },
    half = { name: "Slig", fields: { scale: 1 } };
  assert.deepEqual(snapRect("AE", AE_GEOMETRY, full, [100, 50, 124, 74]), [100, 50, 124, 74]);
  assert.deepEqual(snapRect("AE", AE_GEOMETRY, full, [105, 50, 129, 74]), [100, 50, 124, 74]);
  assert.deepEqual(snapRect("AE", AE_GEOMETRY, full, [115, 50, 139, 74]), [125, 50, 149, 74]);
  assert.deepEqual(snapRect("AE", AE_GEOMETRY, half, [105, 50, 129, 74]), [111, 50, 135, 74]);
  assert.deepEqual(snapRect("AO", ao, full, [1324, 50, 1348, 74]), [1327, 50, 1351, 74]);
  assert.deepEqual(snapRect("AO", ao, full, [300, 50, 324, 74]), [303, 50, 327, 74]);
  assert.deepEqual(
    snapRect("AE", AE_GEOMETRY, { name: "Hoist" }, [105, 50, 129, 74]),
    [100, 50, 124, 74],
  );
});
