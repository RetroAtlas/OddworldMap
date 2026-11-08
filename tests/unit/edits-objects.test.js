import { test } from "node:test";
import assert from "node:assert/strict";
import { state } from "../../public/js/state.js";
import {
  addObject,
  applyFieldEdit,
  applyRectEdit,
  applyStoredEdits,
  canUndo,
  currentOf,
  duplicateObject,
  editNotes,
  editStore,
  editedFields,
  editedRect,
  freeSpot,
  gameEdits,
  ghostOf,
  isAdded,
  isEdited,
  isRemoved,
  pathEdited,
  pristineOf,
  redoEdit,
  removeObject,
  removedObjects,
  restoreEdits,
  restoreObject,
  revertObject,
  revertPath,
  sanitizeEdits,
  typeNames,
  typeTable,
  undoEdit,
  validAdded,
} from "../../public/js/edits.js";
import { DOOR, door, plain, stand, world } from "./aeworld.js";

test("a removed object leaves the standing path as a ghost carrying its deltas, and comes back as edited", () => {
  restoreEdits({});
  const G = world();
  const [L0] = G.levels,
    P1 = L0.paths[0],
    d = P1.tlvs[0];
  stand(G);
  const n = applyRectEdit(d, [20, 15, 44, 39]);
  state.sel = n;
  assert.equal(removeObject(n), null);
  assert.equal(state.path.tlvs.length, 2);
  assert.equal(
    state.path.tlvs.find((t) => pristineOf(t) === d),
    undefined,
  );
  assert.equal(state.path.tlvs[0], P1.tlvs[1]);
  assert.equal(state.path.tlvs[1], P1.tlvs[2]);
  const [g] = removedObjects(state.path);
  assert.equal(removedObjects(state.path).length, 1);
  assert.ok(isRemoved(g));
  assert.equal(isRemoved(d), false);
  assert.equal(pristineOf(g), d);
  assert.deepEqual([g.x1, g.y1, g.x2, g.y2], [20, 15, 44, 39]);
  assert.deepEqual(editNotes(g), ["moved"]);
  assert.equal(state.sel, g);
  assert.equal(currentOf(d), null);
  assert.equal(ghostOf(d, state.path), g);
  assert.ok(pathEdited(state.path));
  assert.deepEqual(editStore().AE["MI/1"].objects["Door@10,10"], {
    rect: [20, 15, 44, 39],
    removed: true,
  });
  assert.deepEqual(removedObjects(P1), []);
  // a ghost takes no edit but its restore, and removing it again is no step
  assert.throws(() => applyFieldEdit(g, "camera", 18), /removed/);
  assert.throws(() => applyRectEdit(g, [30, 15, 54, 39]), /removed/);
  assert.throws(() => revertObject(g), /removed/);
  const standing = state.path;
  assert.equal(removeObject(g), null);
  assert.equal(state.path, standing);
  // a handle taken before the removal is refused like the ghost, and removing it again is no step
  assert.throws(() => applyRectEdit(n, [60, 10, 84, 34]), /removed/);
  assert.throws(() => applyFieldEdit(n, "camera", 18), /removed/);
  assert.throws(() => revertObject(n), /removed/);
  assert.equal(removeObject(n), null);
  assert.equal(state.path, standing);
  assert.deepEqual(gameEdits("AE"), { objects: 1, paths: 1 });
  // another path's edit leaves this one standing as it is
  stand(G, 2);
  applyFieldEdit(state.path.tlvs[1], "camera", 19);
  assert.equal(state.lvl.paths[0], standing);
  stand(G);
  state.sel = ghostOf(d, state.path);
  // an edit on the path stands a fresh ghost, and the selection follows it
  applyFieldEdit(state.path.tlvs[0], "camera", 3);
  assert.notEqual(state.sel, g);
  assert.ok(isRemoved(state.sel));
  assert.equal(pristineOf(state.sel), d);
  // the restore stands the object back where its deltas left it
  const back = restoreObject(state.sel);
  assert.deepEqual([back.x1, back.y1], [20, 15]);
  assert.deepEqual(editNotes(back), ["moved"]);
  assert.equal(isRemoved(back), false);
  assert.equal(state.sel, back);
  assert.equal(state.path.tlvs[0], back);
  assert.deepEqual(removedObjects(state.path), []);
  assert.equal(restoreObject(back), back); // nothing to restore: no step
  // undo removes it again and the ghost is selected once more
  assert.ok(undoEdit("AE", "MI", 1));
  assert.ok(isRemoved(state.sel));
  assert.equal(state.sel, removedObjects(state.path)[0]);
  undoEdit("AE", "MI", 1); // the other door's camera
  undoEdit("AE", "MI", 1); // the removal
  assert.equal(state.path.tlvs[0].x1, 20);
  undoEdit("AE", "MI", 1); // the move
  assert.equal(state.path, P1);
  assert.equal(state.sel, d);
  // a ghost whose only delta is the removal comes back as the pristine path, its entry gone from the store
  removeObject(P1.tlvs[2]);
  assert.deepEqual(editStore().AE["MI/1"].objects["Hoist@50,50"], { removed: true });
  assert.equal(restoreObject(removedObjects(state.path)[0]), P1.tlvs[2]);
  assert.equal(state.path, P1);
  assert.equal(editStore().AE["MI/1"], undefined);
  // a field-less object removed and the path reverted
  removeObject(P1.tlvs[2]);
  const [h] = removedObjects(state.path);
  assert.equal("fields" in h, false);
  assert.deepEqual(editNotes(h), []);
  revertPath("AE", "MI", 1);
  assert.equal(state.path, P1);
  restoreEdits({});
});

test("a stored removal applies to an object that exists and is dropped with one that does not", () => {
  restoreEdits({
    AE: {
      "MI/1": {
        objects: {
          "Door@10,10": { removed: true, fields: { camera: 5 } },
          "Door@999,999": { removed: true },
        },
      },
    },
  });
  const G = world();
  assert.deepEqual(applyStoredEdits(G), { applied: 2, dropped: 1 });
  const P = G.levels[0].paths[0];
  assert.equal(P.tlvs.length, 2);
  const [g] = removedObjects(P);
  assert.equal(g.fields.camera, 5);
  assert.deepEqual(Object.keys(editStore().AE["MI/1"].objects), ["Door@10,10"]);
  restoreEdits({});
  const kept = {
    AE: {
      "MI/1": {
        objects: {
          "Door@10,10": { removed: true },
          "Hoist@50,50": { removed: true, rect: [60, 50, 70, 60] },
        },
      },
    },
  };
  assert.deepEqual(sanitizeEdits(JSON.stringify(kept)), kept);
  assert.deepEqual(
    sanitizeEdits(
      JSON.stringify({
        AE: {
          "MI/1": { objects: { "Door@10,10": { removed: 1 }, "Door@400,10": { removed: "yes" } } },
        },
      }),
    ),
    {},
  );
});

test("a free spot keeps the rect's screen and stands on nothing exactly", () => {
  const G = world();
  const geo = G.geometry;
  const on = (...tlvs) => ({ ...G.levels[0].paths[0], tlvs });
  const P = G.levels[0].paths[0];
  // the rect itself where nothing stands there, else to the right of what does
  assert.deepEqual(freeSpot(P, geo, [100, 100, 124, 124]), [100, 100, 124, 124]);
  assert.deepEqual(freeSpot(P, geo, [10, 10, 34, 34]), [35, 10, 59, 34]);
  assert.deepEqual(freeSpot(P, geo, [400, 10, 424, 34]), [425, 10, 449, 34]);
  // a right spot whose midpoint leaves the screen gives way to the left one, then below, then above
  assert.deepEqual(freeSpot(on(door(340, 10)), geo, [340, 10, 364, 34]), [315, 10, 339, 34]);
  assert.deepEqual(freeSpot(on(door(0, 10), door(25, 10)), geo, [0, 10, 24, 34]), [0, 35, 24, 59]);
  assert.deepEqual(
    freeSpot(on(door(340, 230), door(315, 230)), geo, [340, 230, 364, 254]),
    [340, 205, 364, 229],
  );
  // every spot beside taken: the ring one grid unit further out
  assert.deepEqual(
    freeSpot(
      on(door(100, 100), door(125, 100), door(75, 100), door(100, 125), door(100, 75)),
      geo,
      [100, 100, 124, 124],
    ),
    [150, 100, 174, 124],
  );
  // a zone no spot beside keeps on its screen lands over it, a grid unit on
  const zone = { ...plain("InvisibleZone", 10, 0), x2: 360, y2: 250 };
  assert.deepEqual(freeSpot(on(zone), geo, [10, 0, 360, 250]), [35, 0, 385, 250]);
  // one nothing shifts on its screen is the rect itself, fitted, and null past the grid
  const whole = { ...plain("InvisibleZone", 0, 0), x2: 749, y2: 519 };
  assert.deepEqual(freeSpot(on(whole), geo, [0, 0, 749, 519]), [0, 0, 749, 519]);
  assert.equal(freeSpot(P, geo, [0, 0, 1600, 10]), null);
});

test("an added object follows the shipped ones with its type's defaults, keyed past every number handed out", () => {
  restoreEdits({});
  const G = world();
  const P1 = G.levels[0].paths[0];
  stand(G);
  assert.deepEqual(typeNames(G), ["DemoSpawnPoint", "Door", "Hoist"]);
  assert.deepEqual(typeTable(G).Door.defaults, DOOR);
  assert.deepEqual(typeTable(G).Door.size, [24, 24]);
  assert.equal(typeTable(G).Hoist.fields, null);
  const n = addObject("Door", [100, 100, 124, 124]);
  assert.equal(state.path.tlvs.length, 4);
  assert.equal(state.path.tlvs[3], n);
  assert.equal(state.path.tlvs[0], P1.tlvs[0]);
  assert.deepEqual(
    { ...n, extra: undefined },
    {
      t: 5,
      name: "Door",
      x1: 100,
      y1: 100,
      x2: 124,
      y2: 124,
      fields: DOOR,
      extra: undefined,
    },
  );
  assert.equal(n.extra.to_cam, 17);
  assert.ok(isAdded(n));
  assert.ok(isEdited(n));
  assert.deepEqual(editNotes(n), ["added"]);
  assert.deepEqual(editedFields(n), {});
  assert.equal(editedRect(n), null);
  assert.equal(pristineOf(n), n);
  assert.equal(currentOf(n), n);
  assert.ok(pathEdited(state.path));
  assert.deepEqual(editStore().AE["MI/1"], {
    next: 2,
    objects: { "+1": { name: "Door", rect: [100, 100, 124, 124], fields: DOOR } },
  });
  assert.deepEqual(gameEdits("AE"), { objects: 1, paths: 1 });
  // its fields and rect edit like any object's, the entry staying whole
  const f = applyFieldEdit(n, "camera", 18);
  assert.notEqual(f, n);
  assert.equal(currentOf(n), f);
  assert.equal(f.fields.camera, 18);
  assert.equal(f.extra.to_cam, 18);
  assert.deepEqual(editedFields(f), {});
  assert.deepEqual(editNotes(f), ["added"]);
  const back = applyFieldEdit(f, "camera", 17);
  assert.equal(editStore().AE["MI/1"].objects["+1"].fields.camera, 17);
  assert.throws(() => applyFieldEdit(back, "door_type", 9), /not a value/);
  const m = applyRectEdit(back, [200, 100, 224, 124]);
  assert.deepEqual(editStore().AE["MI/1"].objects["+1"].rect, [200, 100, 224, 124]);
  assert.deepEqual(editNotes(m), ["added"]);
  assert.throws(() => applyRectEdit(m, [750, 0, 774, 24]), /grid/);
  // a second addition takes the next number, and a removal leaves no ghost and hands no number back
  const h = addObject("Hoist", [60, 60, 70, 70]);
  assert.equal("fields" in h, false);
  assert.deepEqual(h.extra, {});
  assert.equal(editStore().AE["MI/1"].next, 3);
  assert.equal(removeObject(currentOf(n)), null);
  assert.deepEqual(removedObjects(state.path), []);
  assert.deepEqual(Object.keys(editStore().AE["MI/1"].objects), ["+2"]);
  assert.equal(currentOf(n), null);
  const again = addObject("Door", [100, 100, 124, 124], { camera: 3 });
  assert.equal(editStore().AE["MI/1"].next, 4);
  assert.equal(again.fields.camera, 3);
  assert.deepEqual(Object.keys(editStore().AE["MI/1"].objects), ["+2", "+3"]);
  assert.equal(state.path.tlvs[3], currentOf(h));
  assert.equal(state.path.tlvs[4], again);
  assert.throws(() => addObject("Slig", [0, 0, 24, 24]), /not a type/);
  assert.throws(() => addObject("Door", [750, 0, 774, 24]), /grid/);
  assert.throws(() => addObject("Door", [0, 0, 24, 24], { camera: 1.5 }), /not a value/);
  // every addition and removal is a step
  undoEdit("AE", "MI", 1);
  assert.deepEqual(Object.keys(editStore().AE["MI/1"].objects), ["+2"]);
  undoEdit("AE", "MI", 1);
  assert.ok(currentOf(n));
  redoEdit("AE", "MI", 1);
  assert.equal(currentOf(n), null);
  revertPath("AE", "MI", 1);
  assert.equal(state.path, P1);
  // a number handed out this session never comes round again, though the entry went and came back
  addObject("Door", [100, 100, 124, 124]);
  assert.deepEqual(Object.keys(editStore().AE["MI/1"].objects), ["+4"]);
  assert.equal(editStore().AE["MI/1"].next, 5);
  restoreEdits({});
});

test("every stored shape applies at once, and a counter below the numbers present is raised past them", () => {
  restoreEdits({
    AE: {
      "MI/1": {
        next: 2,
        objects: {
          "Door@10,10": { fields: { camera: 5 }, rect: [20, 15, 44, 39] },
          "Door@400,10": { removed: true, fields: { camera: 7 } },
          "Hoist@50,50": { rect: [60, 50, 70, 60] },
          "+1": { name: "Door", rect: [100, 100, 124, 124] },
          "+4": { name: "Hoist", rect: [200, 100, 210, 110] },
        },
      },
    },
  });
  const G = world();
  assert.deepEqual(applyStoredEdits(G), { applied: 7, dropped: 0 });
  const P = G.levels[0].paths[0];
  assert.deepEqual(
    P.tlvs.map((t) => [t.name, t.x1]),
    [
      ["Door", 20],
      ["Hoist", 60],
      ["Door", 100],
      ["Hoist", 200],
    ],
  );
  assert.equal(P.tlvs[0].fields.camera, 5);
  assert.equal(P.tlvs[2].fields.camera, 17);
  const [g] = removedObjects(P);
  assert.equal(g.x1, 400);
  assert.equal(g.fields.camera, 7);
  assert.equal(editStore().AE["MI/1"].next, 5);
  assert.deepEqual(gameEdits("AE"), { objects: 5, paths: 1 });
  restoreEdits({});
});

test("the type table reads the pristine placements whatever stands", () => {
  restoreEdits({});
  const G = world();
  stand(G);
  const before = JSON.stringify(typeTable(G));
  removeObject(state.path.tlvs[2]);
  applyFieldEdit(state.path.tlvs[0], "camera", 3);
  applyRectEdit(state.path.tlvs[1], [500, 10, 524, 34]);
  addObject("Door", [100, 100, 124, 124], { camera: 3 });
  assert.equal(JSON.stringify(typeTable(G)), before);
  assert.deepEqual(typeNames(G), ["DemoSpawnPoint", "Door", "Hoist"]);
  const H = world();
  H.levels[0].paths[0].tlvs.splice(2, 1); // a game that never placed a Hoist
  assert.equal(typeTable(H).Hoist, undefined);
  restoreEdits({});
});

test("a stored addition applies as the game can hold it, and the counter runs past every number", () => {
  restoreEdits({
    AE: {
      "MI/1": {
        objects: {
          "+1": {
            name: "Door",
            rect: [100, 100, 124, 124],
            fields: { camera: 3, bogus: 1, door_type: 9 },
          },
          "+2": { name: "Slig", rect: [100, 100, 124, 124] },
          "+3": { name: "Door", rect: [750, 0, 774, 24] },
          "+5": { name: "Hoist", rect: [60, 60, 70, 70], fields: { camera: 1 } },
          "Door@10,10": { fields: { camera: 5 } },
        },
      },
    },
  });
  const G = world();
  assert.deepEqual(applyStoredEdits(G), { applied: 3, dropped: 2 });
  const P = G.levels[0].paths[0];
  assert.equal(P.tlvs.length, 5);
  assert.equal(P.tlvs[3].name, "Door");
  assert.deepEqual(P.tlvs[3].fields, { ...DOOR, camera: 3 });
  assert.equal(P.tlvs[4].name, "Hoist");
  assert.equal("fields" in P.tlvs[4], false);
  assert.deepEqual(editStore().AE["MI/1"], {
    next: 6,
    objects: {
      "+1": { name: "Door", rect: [100, 100, 124, 124], fields: { ...DOOR, camera: 3 } },
      "+5": { name: "Hoist", rect: [60, 60, 70, 70] },
      "Door@10,10": { fields: { camera: 5 } },
    },
  });
  assert.equal(validAdded(G, P, { name: "Nope", rect: [0, 0, 1, 1] }), null);
  restoreEdits({});
  const kept = {
    AE: {
      "MI/1": {
        next: 4,
        objects: {
          "+1": { name: "Door", rect: [1, 2, 3, 4], fields: { camera: 3 } },
          "+3": { name: "Hoist", rect: [1, 2, 3, 4] },
        },
      },
    },
  };
  assert.deepEqual(sanitizeEdits(JSON.stringify(kept)), kept);
  const noisy = {
    AE: {
      "MI/1": {
        next: "7",
        objects: {
          "+1": { name: "Door", rect: [1, 2, 3] },
          "+2": { name: "Door Two", rect: [1, 2, 3, 4] },
          "+3": { rect: [1, 2, 3, 4] },
          "+x": { name: "Door", rect: [1, 2, 3, 4] },
          "+4": { name: "Door", rect: [1, 2, 3, 4], fields: { camera: 1.5, scale: 1 } },
        },
      },
    },
  };
  assert.deepEqual(sanitizeEdits(JSON.stringify(noisy)), {
    AE: {
      "MI/1": { objects: { "+4": { name: "Door", rect: [1, 2, 3, 4], fields: { scale: 1 } } } },
    },
  });
});

test("a duplicate stands beside its original as an added copy of it, fields as they stand", () => {
  restoreEdits({});
  const G = world();
  const P1 = G.levels[0].paths[0],
    d = P1.tlvs[0];
  stand(G);
  const edited = applyFieldEdit(d, "camera", 18);
  const copy = duplicateObject(edited);
  assert.ok(isAdded(copy));
  assert.equal(copy.name, "Door");
  assert.deepEqual([copy.x1, copy.y1, copy.x2, copy.y2], [35, 10, 59, 34]);
  assert.deepEqual(copy.fields, { ...DOOR, camera: 18 });
  assert.equal(copy.extra.to_cam, 18);
  assert.equal(state.path.tlvs[3], copy);
  assert.deepEqual(editStore().AE["MI/1"].objects["+1"], {
    name: "Door",
    rect: [35, 10, 59, 34],
    fields: { ...DOOR, camera: 18 },
  });
  // a wide object's copy clears its original, and a copy of a copy numbers on
  const wide = applyRectEdit(P1.tlvs[1], [400, 10, 500, 34]);
  const wideCopy = duplicateObject(wide);
  assert.deepEqual([wideCopy.x1, wideCopy.x2], [501, 601]);
  const again = duplicateObject(copy);
  assert.equal(again.x1, 60);
  assert.deepEqual(
    Object.keys(editStore().AE["MI/1"].objects).filter((k) => k[0] === "+"),
    ["+1", "+2", "+3"],
  );
  // a copy keeps its original's screen: to the left where the right spot would leave it
  const edge = applyRectEdit(currentOf(wide), [340, 10, 364, 34]);
  const beside = duplicateObject(edge);
  assert.deepEqual([beside.x1, beside.y1, beside.x2, beside.y2], [315, 10, 339, 34]);
  // a field-less copy, a ghost refused, and every copy a step
  const h = duplicateObject(P1.tlvs[2]);
  assert.equal("fields" in h, false);
  removeObject(currentOf(d));
  assert.throws(() => duplicateObject(removedObjects(state.path)[0]), /removed/);
  assert.throws(() => duplicateObject(edited), /removed/); // a handle from before the removal
  for (let i = 0; i < 9; i++) assert.ok(undoEdit("AE", "MI", 1), `step ${i}`);
  assert.equal(canUndo("AE", "MI", 1), false);
  assert.equal(state.path, P1);
  restoreEdits({});
});
