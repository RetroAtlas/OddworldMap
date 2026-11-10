import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { TRANSFORM } from "../../public/js/model/fields.js";

const load = (name) =>
  JSON.parse(readFileSync(new URL(`../../public/${name}`, import.meta.url), "utf8"));
const AO = load("enum_labels_ao.json");
const AE = load("enum_labels_ae.json");

test("enum labels: shape is type -> { integer value: non-empty label }", () => {
  for (const [game, el] of [
    ["AO", AO],
    ["AE", AE],
  ])
    for (const [type, vals] of Object.entries(el)) {
      assert.ok(vals && typeof vals === "object", `${game} ${type}`);
      for (const [v, label] of Object.entries(vals)) {
        assert.match(v, /^-?\d+$/, `${game} ${type} value key`);
        assert.ok(typeof label === "string" && label.length, `${game} ${type}.${v}`);
      }
    }
});

test("enum labels: the same type can carry different values per game", () => {
  assert.equal(AO["Path_Slig::StartState"]["5"], "falling to chase");
  assert.equal(AE["Path_Slig::StartState"]["5"], "unused"); // the decomp's own per-game truth
  assert.equal(AE["Path_Slig::StartState"]["6"], "listening to glukkon");
});

test("enum labels: the viewer-owned value-types are not generated", () => {
  for (const el of [AO, AE])
    for (const t of Object.keys(TRANSFORM))
      assert.ok(!(t in el), `${t} must be left to the viewer, not generated`);
});

test("enum labels: direction enums are generated, not viewer-owned", () => {
  for (const el of [AO, AE]) assert.deepEqual(el["XDirection_short"], { 0: "left", 1: "right" });
});

test("enum labels: labels are lowercased to match the viewer's style", () => {
  assert.equal(AO["Path_Slig::StartState"]["1"], "patrol");
  assert.equal(AE["Mud_State"]["2"], "angry worker");
});

test("enum labels: only types some field is declared as are shipped", () => {
  for (const [game, el, ftFile] of [
    ["AO", AO, "field_types_ao.json"],
    ["AE", AE, "field_types_ae.json"],
  ]) {
    const used = new Set();
    for (const obj of Object.values(load(ftFile))) for (const t of Object.values(obj)) used.add(t);
    for (const t of Object.keys(el))
      assert.ok(used.has(t), `${game}: ${t} has labels but no field is typed as it`);
  }
});

test("enum labels: the formerly hand-authored enums are covered, plus new ones", () => {
  assert.ok(AO["Path_Slig::StartState"] && AO["Path_Mudokon::MudJobs"]);
  assert.ok(AE["Mud_State"] && AE["Mud_TLV_Emotion"]);
  assert.equal(AO["DoorStates"]["0"], "open"); // a type we never hand-authored, now readable
  // definitions the include graph never reaches (SwitchOp is only forward-declared
  // where fields use it) come from the directory sweep
  for (const el of [AO, AE]) assert.equal(el["SwitchOp"]["2"], "toggle");
  assert.equal(AO["LevelIds"]["1"], "rupture farms");
  assert.equal(AE["ScreenChangeEffects"]["2"], "left to right");
});

test("enum labels: comments never fabricate enumerators", () => {
  // a trailing "..., breaks lvl exporting if removed" comment once minted a
  // phantom value 3 ("breaks") on this enum; the decomp defines exactly 0-2
  assert.deepEqual(AO["Path_Slig::ShootPossessedSligs"], { 0: "no", 1: "yes", 2: "yes" });
});

// the invariant users see: every typed field resolves to readable text, either
// through the viewer's own value-type transforms or the generated labels
test("enum labels: every field type resolves through TRANSFORM or the labels", () => {
  for (const [game, el, ftFile] of [
    ["AO", AO, "field_types_ao.json"],
    ["AE", AE, "field_types_ae.json"],
  ]) {
    const used = new Set();
    for (const obj of Object.values(load(ftFile))) for (const t of Object.values(obj)) used.add(t);
    for (const t of used)
      assert.ok(t in TRANSFORM || t in el, `${game}: field type ${t} resolves to nothing`);
  }
});

// the background-plane cue reads an object's plane off its scale label, and the
// labels carry the decomp's own enumerator names — an upstream rename would flip
// the cue with nothing to catch it. Pin the word the cue looks for.
test("enum labels: every enum a scale field carries names its half plane", () => {
  for (const [game, el, ftFile] of [
    ["AO", AO, "field_types_ao.json"],
    ["AE", AE, "field_types_ae.json"],
  ]) {
    const scaleTypes = new Set();
    for (const obj of Object.values(load(ftFile)))
      for (const [field, t] of Object.entries(obj))
        if (field === "scale" && !(t in TRANSFORM)) scaleTypes.add(t);
    assert.ok(scaleTypes.size, `${game}: no per-object scale enum found at all`);
    for (const t of scaleTypes)
      assert.ok(
        Object.values(el[t]).some((label) => /^half\b/.test(label)),
        `${game}: ${t} labels no half plane`,
      );
  }
});
