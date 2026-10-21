import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  visibleFields,
  prettify,
  resolve,
  fieldType,
  valueMap,
  fieldEntries,
  fieldHelp,
  setFrameRate,
  unitNote,
  onBackgroundPlane,
  defaultVisible,
  setFieldTypes,
  setEnumLabels,
  GLOBAL_DEFAULT,
  DEFAULT_BY_TYPE,
  HIDE_WHEN_ZERO,
  LIVE_WHEN,
} from "../../public/js/fields.js";
import { setGlossary } from "../../public/js/glossary.js";

// prettify resolves a field's game type (field_types sidecar), then its label —
// a hand value-type transform, else the generated enum labels (enum_labels
// sidecar). Inject small stand-ins so the tests exercise that path. One game "G"
// suffices; the real per-game vocabulary is a data concern (field-types.test.js,
// enum-labels.test.js).
setFieldTypes({
  G: {
    Slig: { start_state: "Path_Slig::StartState", scale: "Scale_short" },
    SligSpawner: { start_state: "Path_Slig::StartState" }, // shares Slig's enum
    Slog: { asleep: "Choice_short" },
    Mudokon: {
      job: "Path_Mudokon::MudJobs",
      state: "Mud_State",
      emotion: "Mud_TLV_Emotion",
      deaf: "Choice_short",
    },
    Door: { start_state: "DoorStates", door_type: "DoorTypes" }, // start_state typed but no label below -> stays raw
    MeatSaw: { start_state: "Path_MeatSaw::StartState", type: "Path_MeatSaw::Type" },
    Edge: { can_grab: "Choice_short" },
    InvisibleSwitch: { scale: "InvisibleSwitchScale", set_off_alarm: "Choice_short" }, // scale, but not the plane enum (1 = full)
    DoorFlame: { scale: "Path_DoorFlame::Scale" },
  },
});
setEnumLabels({
  G: {
    "Path_Slig::StartState": { 0: "listening", 1: "patrol", 2: "sleeping" },
    "Path_Mudokon::MudJobs": { 0: "stand scrub", 1: "sit scrub", 2: "sit chant" },
    Mud_State: { 0: "chisle", 4: "health ring giver" },
    Mud_TLV_Emotion: { 2: "sad" },
    InvisibleSwitchScale: { 0: "half", 1: "full", 2: "any" }, // inverted vs the plain plane
    "Path_DoorFlame::Scale": { 0: "full", 1: "half", 2: "half (ignore)" },
    // DoorStates deliberately absent: a typed field with no label renders raw
  },
});

test("visibleFields: default is the type's default set, 'all' is everything", () => {
  assert.deepEqual(visibleFields("Slig", undefined), defaultVisible("Slig"));
  assert.deepEqual(visibleFields("Slig", { mode: "default" }), defaultVisible("Slig"));
  assert.equal(visibleFields("Slig", { mode: "all" }), "all");
});

test("defaultVisible: globals apply everywhere, type-scoped fields only for their type", () => {
  assert.ok(defaultVisible("Slig").has("start_state"));
  assert.ok(!defaultVisible("Door").has("switch_id"));
  assert.ok(!defaultVisible("Mudokon").has("rescue_switch_id"));
  // start_state is global — a door's lock state shows by default too (it still
  // renders as DoorStates, not Slig's text; that collision-safety is tested below)
  assert.ok(defaultVisible("Door").has("start_state"));
  assert.ok(defaultVisible("Door").has("door_type")); // a curated per-type addition
  assert.ok(defaultVisible("MeatSaw").has("speed") && defaultVisible("MeatSaw").has("start_state"));
  assert.ok(defaultVisible("Mudokon").has("state") && !defaultVisible("Slig").has("state"));
  assert.ok(defaultVisible("Edge").has("can_grab")); // a no-grab edge is the trap worth surfacing
  // DeathDrop's copy of action is a dead word
  assert.ok(defaultVisible("Switch").has("action") && !defaultVisible("DeathDrop").has("action"));
});

test("the defaults and zero-hiding tables name only shipped types and fields", () => {
  const load = (name) =>
    JSON.parse(readFileSync(new URL(`../../public/${name}`, import.meta.url), "utf8"));
  const typeFields = {};
  const fieldNames = new Set();
  for (const game of ["ao", "ae"])
    for (const lv of load(`map_data_${game}.json`).levels)
      for (const p of lv.paths)
        for (const t of p.tlvs)
          for (const k of Object.keys(t.fields || {})) {
            fieldNames.add(k);
            (typeFields[t.name] ??= new Set()).add(k);
          }
  for (const [type, fields] of Object.entries(DEFAULT_BY_TYPE)) {
    assert.ok(typeFields[type], `${type} is a shipped type with fields`);
    for (const f of fields) assert.ok(typeFields[type].has(f), `${type}.${f} is a shipped field`);
  }
  for (const k of GLOBAL_DEFAULT) assert.ok(fieldNames.has(k), `global default "${k}" is real`);
  for (const k of HIDE_WHEN_ZERO) assert.ok(fieldNames.has(k), `zero-hidden "${k}" is real`);
});

test("the defaults table is sorted: types within their group, fields within their type", () => {
  const src = readFileSync(new URL("../../public/js/fields.js", import.meta.url), "utf8");
  const body = src.split("export const DEFAULT_BY_TYPE = {")[1].split("\n};")[0];
  const groups = {};
  let group = "";
  for (const line of body.split("\n")) {
    const divider = /^\s*\/\/\s*(.+)$/.exec(line),
      key = /^\s*([A-Za-z0-9_]+):/.exec(line);
    if (divider) group = divider[1];
    else if (key) (groups[group] ??= []).push(key[1]);
  }
  assert.equal(
    Object.values(groups).flat().length,
    Object.keys(DEFAULT_BY_TYPE).length,
    "every key is read off the source",
  );
  for (const [name, types] of Object.entries(groups))
    assert.deepEqual(types, [...types].sort(), `${name} types are sorted`);
  for (const [type, fields] of Object.entries(DEFAULT_BY_TYPE))
    assert.deepEqual(fields, [...fields].sort(), `${type} fields are sorted`);
});

test("visibleFields: 'more' uses per-type picks, else the type defaults", () => {
  // no pick for this type yet -> the picker starts from the type's defaults
  assert.deepEqual(visibleFields("Slig", { mode: "more", byType: {} }), defaultVisible("Slig"));
  // a per-type pick -> exactly those keys (the picker's contract)
  const picked = visibleFields("Slig", { mode: "more", byType: { Slig: ["start_state"] } });
  assert.ok(picked instanceof Set && picked.has("start_state") && picked.size === 1);
  // an explicit empty pick means "show nothing", not "fall back to defaults"
  const none = visibleFields("Slig", { mode: "more", byType: { Slig: [] } });
  assert.ok(none instanceof Set && none.size === 0);
  // a pick for a different type doesn't apply -> that type keeps its defaults
  assert.deepEqual(
    visibleFields("Slog", { mode: "more", byType: { Slig: ["start_state"] } }),
    defaultVisible("Slog"),
  );
});

test("prettify: resolves a value by the field's game type, grouping and collision-safe", () => {
  // the enum resolves on its owning type's field
  assert.equal(prettify("G", "Mudokon", "job", 2), "sit chant");
  assert.equal(prettify("G", "Mudokon", "state", 4), "health ring giver");
  assert.equal(prettify("G", "Mudokon", "emotion", 2), "sad");
  assert.equal(prettify("G", "Slig", "start_state", 0), "listening");
  // grouping: SligSpawner shares Slig's start_state type, so one entry serves both
  assert.equal(prettify("G", "SligSpawner", "start_state", 1), "patrol");
  // collision-safety: a Door's start_state is its own type (DoorStates, with no
  // transform here) -> raw, never the Slig text
  assert.equal(prettify("G", "Door", "start_state", 0), 0);
  // value-type transforms (Choice/Scale) apply wherever that type is carried
  assert.equal(prettify("G", "Slog", "asleep", 1), true); // Choice -> boolean, not 1
  assert.equal(prettify("G", "Slog", "asleep", 0), false);
  assert.equal(prettify("G", "Slig", "scale", 1), "half");
  // no type in the table, out-of-range value, unknown game -> raw
  assert.equal(prettify("G", "Slig", "shoot_on_sight_delay", 0), 0);
  assert.equal(prettify("G", "Mudokon", "job", 9), 9);
  assert.equal(prettify("XX", "Slig", "start_state", 1), 1);
});

test("prettify: a bare int reads in the unit the glossary gives it", () => {
  setGlossary({
    units: {
      byField: { pause_time: "frames", noise_wake_up_distance: "grid" },
      byType: {
        "Slig.percent_say_what": "percent",
        "ColourfulMeter.mines_alarm_countdown": "seconds",
        "Slig.start_state": "frames", // a typed field: the label must still win
        "Slig.bogus_unit": "furlongs", // outside the closed set -> no formatter
      },
    },
  });
  // the number is bound to its unit word, so a pair never breaks across lines
  assert.equal(prettify("G", "Slig", "pause_time", 15), "15\u00a0frames ≈ 0.5s");
  assert.equal(prettify("G", "Slig", "pause_time", 300), "300\u00a0frames ≈ 10s"); // no trailing .0
  assert.equal(prettify("G", "Slig", "pause_time", 0), "0\u00a0frames"); // no "≈ 0s"
  assert.equal(prettify("G", "Slig", "pause_time", 1), "1\u00a0frame"); // singular, and rounds away
  // one shipped Alarm reads -536: a u16 duration taken as s16, so no reading is owed
  assert.equal(prettify("G", "Slig", "pause_time", -536), -536);
  assert.equal(prettify("G", "Slig", "noise_wake_up_distance", 6), "6\u00a0grid");
  assert.equal(prettify("G", "Slig", "percent_say_what", 100), "100%");
  assert.equal(prettify("G", "ColourfulMeter", "mines_alarm_countdown", 90), "90s");
  // the label layer wins: a unit can never relabel a field that resolves a value
  assert.equal(prettify("G", "Slig", "start_state", 1), "patrol");
  // an unformattable unit, and a field with none at all, leave the int alone
  assert.equal(prettify("G", "Slig", "bogus_unit", 7), 7);
  assert.equal(prettify("G", "Slig", "shoot_on_sight_delay", 8), 8);
  setGlossary(null);
});

test("fieldType / valueMap: the game type and the map its values read through", () => {
  assert.equal(fieldType("G", "Slig", "start_state"), "Path_Slig::StartState");
  assert.equal(fieldType("G", "Slig", "shoot_on_sight_delay"), undefined);
  assert.deepEqual(valueMap("G", "Slig", "start_state"), {
    0: "listening",
    1: "patrol",
    2: "sleeping",
  });
  assert.deepEqual(valueMap("G", "Slog", "asleep"), { 0: false, 1: true }); // the viewer's own transform wins
  assert.equal(valueMap("G", "Door", "start_state"), null); // typed, but nothing labels it
  assert.equal(valueMap("G", "Slig", "shoot_on_sight_delay"), null);
  assert.equal(valueMap("X", "Slig", "start_state"), null);
});

test("resolve: a lookup map, a function for open-ended ranges, and a miss", () => {
  assert.equal(resolve({ 0: "a", 1: "b" }, 1), "b");
  assert.equal(
    resolve((n) => `${n / 15}s`, 30),
    "2s",
  );
  assert.equal(resolve({ 0: "a" }, 9), undefined); // map miss -> undefined, so prettify falls to raw
  assert.equal(resolve(undefined, 5), undefined);
  assert.equal(resolve(null, 5), undefined);
});

test("fieldEntries: asleep shows both states; deaf/blind and the alarm flag only when set", () => {
  const asleepSlog = { name: "Slog", extra: {}, fields: { asleep: 1, anger_switch_id: 0 } };
  const awakeSlog = { name: "Slog", extra: {}, fields: { asleep: 0, anger_switch_id: 0 } };
  assert.equal(
    Object.fromEntries(fieldEntries(asleepSlog, { mode: "default", game: "G" })).asleep,
    true,
  );
  assert.equal(
    Object.fromEntries(fieldEntries(awakeSlog, { mode: "default", game: "G" })).asleep,
    false,
  );

  const deafMud = { name: "Mudokon", extra: {}, fields: { job: 2, deaf: 1 } };
  const hearingMud = { name: "Mudokon", extra: {}, fields: { job: 1, deaf: 0 } };
  assert.equal(
    Object.fromEntries(fieldEntries(deafMud, { mode: "default", game: "G" })).deaf,
    true,
  );
  assert.ok(
    !("deaf" in Object.fromEntries(fieldEntries(hearingMud, { mode: "default", game: "G" }))),
  ); // 0 hidden

  const loudSwitch = {
    name: "InvisibleSwitch",
    extra: {},
    fields: { action: 1, set_off_alarm: 1 },
  };
  const quietSwitch = {
    name: "InvisibleSwitch",
    extra: {},
    fields: { action: 1, set_off_alarm: 0 },
  };
  assert.equal(
    Object.fromEntries(fieldEntries(loudSwitch, { mode: "default", game: "G" })).set_off_alarm,
    true,
  );
  assert.ok(
    !(
      "set_off_alarm" in
      Object.fromEntries(fieldEntries(quietSwitch, { mode: "default", game: "G" }))
    ),
  );
});

test("fieldEntries: a portal's Shrykull count shows only where the power is granted", () => {
  const fields = { enter_side: 1, mudokon_amount_for_shrykull: 3 };
  const shrykull = { name: "BirdPortal", extra: { portal: "shrykull" }, fields };
  const travel = { name: "BirdPortal", extra: { portal: "travel", to_level: "R1" }, fields };
  assert.equal(
    Object.fromEntries(fieldEntries(shrykull, { mode: "default", game: "G" }))
      .mudokon_amount_for_shrykull,
    3,
  );
  // dead on a portal that grants nothing, so hidden even where everything shows
  const shown = Object.fromEntries(fieldEntries(travel, { mode: "all", game: "G" }));
  assert.ok(!("mudokon_amount_for_shrykull" in shown));
  assert.equal(shown.portal, "travel"); // the gate reads extra, never withholds it
});

test("fieldEntries: default surfaces notable fields, prettified; nav extra always shows", () => {
  const slig = {
    name: "Slig",
    extra: {},
    fields: {
      scale: 0,
      start_state: 1,
      shoot_on_sight_delay: 0,
      bullet_shoot_count: 3,
      pause_time: 10,
    },
  };
  const def = Object.fromEntries(fieldEntries(slig, { mode: "default", game: "G" }));
  assert.equal(def.start_state, "patrol");
  assert.equal(def.shoot_on_sight_delay, 0); // the gotcha: a meaningful zero, shown
  assert.ok(!("bullet_shoot_count" in def) && !("pause_time" in def) && !("scale" in def));

  const all = Object.fromEntries(fieldEntries(slig, { mode: "all", game: "G" }));
  assert.equal(all.pause_time, 10); // revealed
  assert.equal(all.bullet_shoot_count, 3);
  assert.equal(all.scale, "full"); // Scale_short prettified

  // a nav object's derived extra always shows, independent of field policy
  const door = { name: "Door", extra: { to_level: "R2", "door#": 4 }, fields: { x_offset: 3 } };
  const de = Object.fromEntries(fieldEntries(door, { mode: "default", game: "G" }));
  assert.equal(de.to_level, "R2");
  assert.equal(de["door#"], 4);
  assert.ok(!("x_offset" in de)); // a cosmetic Door field: not default-visible
});

test("fieldEntries: raw mode shows the underlying ints, not the prettified text", () => {
  const slig = { name: "Slig", extra: {}, fields: { start_state: 1, scale: 0 } };
  const raw = Object.fromEntries(fieldEntries(slig, { mode: "all", game: "G", raw: true }));
  assert.equal(raw.start_state, 1); // not "patrol"
  assert.equal(raw.scale, 0); // not "full"
  const pretty = Object.fromEntries(fieldEntries(slig, { mode: "all", game: "G" }));
  assert.equal(pretty.start_state, "patrol"); // raw:false / absent keeps prettifying
  assert.equal(pretty.scale, "full");

  // raw is a value-formatting choice, not a visibility one: zero-hiding still applies
  const slog = { name: "Slog", extra: {}, fields: { asleep: 1, anger_switch_id: 0 } };
  const rawSlog = Object.fromEntries(fieldEntries(slog, { mode: "default", game: "G", raw: true }));
  assert.equal(rawSlog.asleep, 1); // not true
  assert.ok(!("anger_switch_id" in rawSlog)); // still hidden at 0
});

test("fieldEntries: a shared field name is resolved by the owning type's game type", () => {
  const door = { name: "Door", extra: {}, fields: { start_state: 1 } };
  assert.equal(Object.fromEntries(fieldEntries(door, { mode: "all", game: "G" })).start_state, 1); // DoorStates: raw
  const slig = { name: "Slig", extra: {}, fields: { start_state: 1 } };
  assert.equal(
    Object.fromEntries(fieldEntries(slig, { mode: "all", game: "G" })).start_state,
    "patrol",
  );
});

test("fieldEntries: zero-valued switch ids are hidden, non-zero shown", () => {
  const mud = { name: "Mudokon", extra: {}, fields: { job: 2, rescue_switch_id: 0 } };
  const e0 = Object.fromEntries(fieldEntries(mud, { mode: "all", game: "G" }));
  assert.equal(e0.job, "sit chant");
  assert.ok(!("rescue_switch_id" in e0)); // 0 = no switch, hidden whatever the mode

  const mud2 = { name: "Mudokon", extra: {}, fields: { job: 1, rescue_switch_id: 70 } };
  assert.equal(
    Object.fromEntries(fieldEntries(mud2, { mode: "all", game: "G" })).rescue_switch_id,
    70,
  );
});

test("fieldEntries: action shows by default, switch_id only through the picker", () => {
  const sw = { name: "Switch", extra: {}, fields: { switch_id: 3, action: 0, scale: 0 } };
  const e = Object.fromEntries(fieldEntries(sw, { mode: "default", game: "G" }));
  assert.ok(!("switch_id" in e));
  assert.equal(e.action, 0); // action 0 is a real value, shown
  assert.ok(!("scale" in e)); // a fields-only key still governed by the picker

  const all = Object.fromEntries(fieldEntries(sw, { mode: "all", game: "G" }));
  assert.equal(all.switch_id, 3); // any field is still reachable
});

test("onBackgroundPlane: background is where the scale resolves to half, inversion respected", () => {
  // Scale_short: 1 = half = background, 0 = full
  assert.ok(onBackgroundPlane("G", { name: "Slig", fields: { scale: 1 } }));
  assert.ok(!onBackgroundPlane("G", { name: "Slig", fields: { scale: 0 } }));
  // InvisibleSwitch's enum inverts it (1 = full): the half (0) is background,
  // the full (1) is not — the reported bug both ways
  assert.ok(onBackgroundPlane("G", { name: "InvisibleSwitch", fields: { scale: 0 } }));
  assert.ok(!onBackgroundPlane("G", { name: "InvisibleSwitch", fields: { scale: 1 } }));
  // a value that spans the planes ("any", ShadowZone's "both") is not background
  assert.ok(!onBackgroundPlane("G", { name: "InvisibleSwitch", fields: { scale: 2 } }));
  // a qualified half is still half: DoorFlame's 1 and 2 both draw at half scale
  assert.ok(onBackgroundPlane("G", { name: "DoorFlame", fields: { scale: 1 } }));
  assert.ok(onBackgroundPlane("G", { name: "DoorFlame", fields: { scale: 2 } }));
  assert.ok(!onBackgroundPlane("G", { name: "DoorFlame", fields: { scale: 0 } }));
  // a bare-int scale (no enum, e.g. Teleporter) follows the plain convention
  assert.ok(onBackgroundPlane("G", { name: "Teleporter", fields: { scale: 1 } }));
  assert.ok(!onBackgroundPlane("G", { name: "Teleporter", fields: { scale: 0 } }));
  // no scale field at all is never background
  assert.ok(!onBackgroundPlane("G", { name: "MusicTrigger", fields: {} }));
});

// The curated default tables are hand-maintained field names; the coexistence
// design (a field a type doesn't carry is silently skipped) means a typo or an
// upstream rename orphans an entry with no error, no wrong render, no failing
// test — the field just vanishes from defaults. Pin every name against the
// shipped data.
const loadData = (name) =>
  JSON.parse(readFileSync(new URL(`../../public/${name}`, import.meta.url), "utf8"));
const realFields = (dataFile) => {
  const byType = {}; // type name -> Set of field keys seen on it in map_data
  for (const L of loadData(dataFile).levels)
    for (const P of L.paths)
      for (const t of P.tlvs)
        if (t.fields) for (const k of Object.keys(t.fields)) (byType[t.name] ??= new Set()).add(k);
  return byType;
};
const tlvsByType = (dataFile) => {
  const byType = {}; // type name -> every shipped placement of it
  for (const L of loadData(dataFile).levels)
    for (const P of L.paths) for (const t of P.tlvs) (byType[t.name] ??= []).push(t);
  return byType;
};
const AO_FIELDS = realFields("map_data_ao.json");
const AE_FIELDS = realFields("map_data_ae.json");
const AO_TLVS = tlvsByType("map_data_ao.json");
const AE_TLVS = tlvsByType("map_data_ae.json");
const carriedByType = (type, field) => AO_FIELDS[type]?.has(field) || AE_FIELDS[type]?.has(field);
const carriedSomewhere = (field) =>
  [AO_FIELDS, AE_FIELDS].some((g) => Object.values(g).some((s) => s.has(field)));

test("DEFAULT_BY_TYPE: every curated field is real on its type in at least one game", () => {
  for (const [type, fields] of Object.entries(DEFAULT_BY_TYPE))
    for (const f of fields)
      assert.ok(
        carriedByType(type, f),
        `${type}.${f} is a default but no shipped ${type} carries it (typo or upstream rename?)`,
      );
});

test("GLOBAL_DEFAULT / HIDE_WHEN_ZERO: every field name is carried by some shipped type", () => {
  for (const set of [GLOBAL_DEFAULT, HIDE_WHEN_ZERO])
    for (const f of set)
      assert.ok(carriedSomewhere(f), `${f} is in a default table but no shipped object carries it`);
});

// a gate that never opens hides its field everywhere, and a predicate naming a
// sibling the type doesn't carry reads exactly the same, so ask the data for both —
// per game, since one game's swing can't vouch for the other's builder emission
test("LIVE_WHEN: every gate names a shipped field and each game's data swings it both ways", () => {
  for (const [key, live] of Object.entries(LIVE_WHEN)) {
    const [type, field] = key.split(".");
    assert.ok(carriedByType(type, field), `${key} is a shipped field on its type`);
    for (const [game, tlvs] of [
      ["AO", AO_TLVS],
      ["AE", AE_TLVS],
    ]) {
      const placed = (tlvs[type] || []).filter((t) => field in (t.fields || {}));
      if (!placed.length) continue; // a game that doesn't place the field has nothing to swing
      assert.ok(
        placed.some((t) => live(t)),
        `${key} is live on some shipped ${game} ${type} (else the field never shows)`,
      );
      assert.ok(
        placed.some((t) => !live(t)),
        `${key} is dead on some shipped ${game} ${type} (else the gate hides nothing)`,
      );
    }
  }
});

// a global earns its place by being shared across unrelated types; one a single
// type or creature family carries reads as a global rule it isn't
test("GLOBAL_DEFAULT: every field is carried widely, not by one type or family", () => {
  for (const f of GLOBAL_DEFAULT) {
    const types = new Set(
      [AO_FIELDS, AE_FIELDS].flatMap((g) =>
        Object.entries(g)
          .filter(([, keys]) => keys.has(f))
          .map(([type]) => type),
      ),
    );
    assert.ok(
      types.size >= 5,
      `${f} is a global default but only ${types.size} shipped type(s) carry it — scope it in DEFAULT_BY_TYPE`,
    );
  }
});

test("fieldHelp: glossary prose plus the field's value list, null when uncurated", () => {
  setGlossary({
    byField: { scale: "which plane" },
    byGameType: { "Path_Slig::StartState": "slig ai state" },
    byType: {},
  });
  // group prose + the enum's full value list (keyed by the field's game type)
  assert.equal(
    fieldHelp("G", "Slig", "start_state"),
    "slig ai state\nValues: 0 = listening, 1 = patrol, 2 = sleeping",
  );
  assert.equal(
    fieldHelp("G", "SligSpawner", "start_state"),
    "slig ai state\nValues: 0 = listening, 1 = patrol, 2 = sleeping",
  ); // group shared
  // global prose + a Choice/Scale value list
  assert.equal(fieldHelp("G", "Slig", "scale"), "which plane\nValues: 0 = full, 1 = half");
  // no curated prose -> null (even though the field is typed)
  assert.equal(fieldHelp("G", "Door", "start_state"), null);
  assert.equal(fieldHelp("G", "Slog", "asleep"), null);
  setGlossary(null); // leave module state clean for any later importer
});

test("fieldHelp: a timer's help states the rate its seconds are derived at", () => {
  setGlossary({
    byField: { pause_time: "How long it waits, in frames.", patrol_range: "A leash." },
    units: { byField: { pause_time: "frames", patrol_range: "grid" } },
  });
  assert.equal(
    fieldHelp("G", "Slig", "pause_time"),
    "How long it waits, in frames.\nThe engine counts thirty frames to the second.",
  );
  // a stored unit needs no factor, so nothing is appended
  assert.equal(fieldHelp("G", "Fleech", "patrol_range"), "A leash.");
  // a surface showing every field at once opts out and states the rate itself
  assert.equal(
    fieldHelp("G", "Slig", "pause_time", { unitNote: false }),
    "How long it waits, in frames.",
  );
  assert.equal(
    unitNote("G", "Slig", "pause_time"),
    "The engine counts thirty frames to the second.",
  );
  assert.equal(unitNote("G", "Fleech", "patrol_range"), null);
  // a release on a PAL clock counts its frames at its own rate
  setFrameRate("G", 25);
  assert.equal(
    unitNote("G", "Slig", "pause_time"),
    "The engine counts twenty-five frames to the second.",
  );
  assert.equal(prettify("G", "Slig", "pause_time", 7200), "7200\u00a0frames ≈ 288s");
  setFrameRate("G", 30);
  assert.equal(prettify("G", "Slig", "pause_time", 7200), "7200\u00a0frames ≈ 240s");
  setGlossary(null);
});
