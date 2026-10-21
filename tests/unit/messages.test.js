import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { DARK_NOTE, messageText, objectMessages, setMessages } from "../../public/js/messages.js";

const load = (name) =>
  JSON.parse(readFileSync(new URL(`../../public/${name}`, import.meta.url), "utf8"));
const AO = load("messages_ao.json");
const AE = load("messages_ae.json");
const SHIPPED = { AO, AE };

// the tables as the discs hold them: a length is the engine's own, so a rebuild
// that changes one is a finding rather than a detail
const LENGTHS = { AO: { lcd: 90, hintfly: 36 }, AE: { lcd: 101 } };

const eachTlv = function* (game) {
  for (const lv of load(`map_data_${game.toLowerCase()}.json`).levels)
    for (const p of lv.paths) for (const t of p.tlvs) yield { lv, p, t };
};

test("messages: shape is a table of strings, at the length the game carries", () => {
  for (const [game, tables] of Object.entries(SHIPPED)) {
    assert.deepEqual(Object.keys(tables).sort(), Object.keys(LENGTHS[game]).sort(), game);
    for (const [name, table] of Object.entries(tables)) {
      assert.equal(table.length, LENGTHS[game][name], `${game} ${name} length`);
      for (const msg of table) assert.equal(typeof msg, "string", `${game} ${name}`);
    }
  }
});

test("messages: the scroll-in lead is stripped, so no message opens or closes on space", () => {
  for (const [game, tables] of Object.entries(SHIPPED))
    for (const [name, table] of Object.entries(tables))
      for (const msg of table) assert.equal(msg, msg.trim(), `${game} ${name}: ${msg}`);
});

test("messages: every button code in a shipped message resolves a name", () => {
  for (const [game, tables] of Object.entries(SHIPPED))
    for (const [name, table] of Object.entries(tables))
      for (const msg of table)
        for (const ch of msg)
          if (ch.codePointAt(0) < 0x20)
            assert.doesNotMatch(
              messageText(ch),
              /\[\?\]/,
              `${game} ${name}: unnamed code ${ch.codePointAt(0).toString(16)}`,
            );
});

test("messages: every id the shipped data names is inside its table", () => {
  const KEYS = ["message_1_id", "message_2_id", "message_id"];
  for (const game of ["AO", "AE"])
    for (const { t } of eachTlv(game)) {
      const table = { LCDScreen: AO.lcd, LCD: AE.lcd, HintFly: AO.hintfly }[t.name];
      if (!table) continue;
      const ids = KEYS.filter((k) => k in t.fields).map((k) => t.fields[k]);
      if ("random_message_max_id" in t.fields)
        ids.push(t.fields.random_message_min_id, t.fields.random_message_max_id);
      for (const id of ids) assert.ok(id >= 0 && id < table.length, `${game} ${t.name} id ${id}`);
    }
});

test("messageText: a button code becomes the command it names", () => {
  assert.equal(messageText("press \x10 to hoist"), "press [Up] to hoist");
  assert.equal(messageText("hold \x08 and \x09"), "hold [Speak 1] and [Speak 2]");
  assert.equal(messageText("plain words"), "plain words");
  assert.equal(messageText("\x01"), "[?]"); // a code the table doesn't name
});

test("objectMessages: null for a type that reads no table, so silence is legible", () => {
  setMessages(SHIPPED);
  assert.equal(objectMessages({ id: "AO" }, { name: "Slig", fields: {} }), null);
  assert.deepEqual(
    objectMessages(
      { id: "AO" },
      {
        name: "LCDScreen",
        fields: { message_1_id: 0, random_message_min_id: 0, random_message_max_id: 0 },
      },
    ),
    [],
  );
});

test("objectMessages: a lone message carries no state note", () => {
  setMessages(SHIPPED);
  const said = objectMessages(
    { id: "AO" },
    {
      name: "LCDScreen",
      fields: { message_1_id: 1, random_message_min_id: 0, random_message_max_id: 0 },
    },
  );
  assert.deepEqual(said, [{ text: "The profits justify the means.", note: "" }]);
});

test("objectMessages: the two switch states are named, the random pool marked", () => {
  setMessages(SHIPPED);
  const said = objectMessages(
    { id: "AE" },
    {
      name: "LCD",
      fields: {
        message_1_id: 2,
        message_2_id: 3,
        random_message_min_id: 4,
        random_message_max_id: 5,
        toggle_message_switch_id: 66,
      },
    },
  );
  assert.deepEqual(
    said.map((m) => m.note),
    ["switch off", "switch on", "at random", "at random"],
  );
  assert.equal(said[0].text, "Work! Do it!");
});

test("objectMessages: a pool surviving as one line is not a draw between anything", () => {
  setMessages(SHIPPED);
  const said = objectMessages(
    { id: "AO" },
    {
      name: "LCDScreen",
      // ids 12-14 are blank, so the pool collapses to the single line id 11 gives
      fields: { message_1_id: 0, random_message_min_id: 11, random_message_max_id: 14 },
    },
  );
  assert.deepEqual(
    said.map((m) => m.note),
    [""],
  );
});

test("objectMessages: a pool of one is not random, and a blank id is dropped", () => {
  setMessages(SHIPPED);
  const said = objectMessages(
    { id: "AO" },
    {
      name: "LCDScreen",
      fields: { message_1_id: 0, random_message_min_id: 1, random_message_max_id: 1 },
    },
  );
  assert.deepEqual(said, [{ text: "The profits justify the means.", note: "" }]);
});

test("objectMessages: the range is inclusive, and a reversed pair reads as the engine sorts it", () => {
  setMessages(SHIPPED);
  const pool = (lo, hi) =>
    objectMessages(
      { id: "AO" },
      {
        name: "LCDScreen",
        fields: { message_1_id: 0, random_message_min_id: lo, random_message_max_id: hi },
      },
    ).map((m) => m.text);
  assert.equal(pool(1, 3).length, 3);
  assert.deepEqual(pool(3, 1), pool(1, 3));
});

test("objectMessages: an id named twice is said once", () => {
  setMessages(SHIPPED);
  const said = objectMessages(
    { id: "AE" },
    {
      name: "LCD",
      fields: {
        message_1_id: 2,
        message_2_id: 2,
        random_message_min_id: 0,
        random_message_max_id: 0,
      },
    },
  );
  assert.deepEqual(said, [{ text: "Work! Do it!", note: "" }]);
});

test("objectMessages: a table that never arrived says nothing, not that the board is dark", () => {
  // a sidecar that failed to load arrives as null
  setMessages(null);
  assert.equal(
    objectMessages({ id: "AO" }, { name: "LCDScreen", fields: { message_1_id: 1 } }),
    null,
  );
  setMessages({ AO: null, AE: null });
  assert.equal(
    objectMessages({ id: "AO" }, { name: "LCDScreen", fields: { message_1_id: 1 } }),
    null,
  );
  setMessages(SHIPPED);
  assert.match(DARK_NOTE, /^[A-Z].*\.$/);
});

test("objectMessages: a state note needs a switch that can actually flip", () => {
  setMessages(SHIPPED);
  const board = (toggle) =>
    objectMessages(
      { id: "AE" },
      {
        name: "LCD",
        fields: {
          message_1_id: 2,
          message_2_id: 3,
          random_message_min_id: 0,
          random_message_max_id: 0,
          toggle_message_switch_id: toggle,
        },
      },
    ).map((m) => m.note);
  // the engine hardwires 0 and 1 to never and always
  assert.deepEqual(board(0), ["", ""]);
  assert.deepEqual(board(1), ["", ""]);
  assert.deepEqual(board(66), ["switch off", "switch on"]);
});

test("objectMessages: a live switch keeps its note even when only one state speaks", () => {
  setMessages(SHIPPED);
  const said = objectMessages(
    { id: "AE" },
    {
      name: "LCD",
      fields: {
        message_1_id: 0, // blank: the board is dark until the switch flips
        message_2_id: 3,
        random_message_min_id: 0,
        random_message_max_id: 0,
        toggle_message_switch_id: 66,
      },
    },
  );
  assert.deepEqual(said, [{ text: "You break it, you bought it.", note: "switch on" }]);
});

test("messages: a board on a hardwired switch carries no switch note", () => {
  setMessages(SHIPPED);
  for (const { lv, p, t } of eachTlv("AE")) {
    if (t.name !== "LCD" || t.fields.toggle_message_switch_id > 1) continue;
    for (const { note } of objectMessages({ id: "AE" }, t))
      assert.ok(!note.startsWith("switch"), `${lv.short} P${p.id} labels a hardwired switch`);
  }
});

test("messages: shipped boards would carry a switch note but for the hardwired guard", () => {
  setMessages(SHIPPED);
  let guarded = 0;
  for (const { t } of eachTlv("AE")) {
    if (t.name !== "LCD" || t.fields.toggle_message_switch_id > 1) continue;
    const live = { ...t, fields: { ...t.fields, toggle_message_switch_id: 2 } };
    if (objectMessages({ id: "AE" }, live).some((m) => m.note.startsWith("switch"))) guarded++;
  }
  assert.equal(guarded, 26);
});

test("messages: Rupture Farms Return silences the boards its first visit taught with", () => {
  setMessages(SHIPPED);
  const boards = [...eachTlv("AO")].filter((r) => r.t.name === "LCDScreen");
  const dark = boards.filter((r) => objectMessages({ id: "AO" }, r.t).length === 0);
  assert.equal(dark.length, 20, "boards that can only run dark");
  assert.ok(
    dark.every((r) => r.lv.short === "R2"),
    "every dark board is a Return copy",
  );
  // the Return reuses its first visit's geography: each of its boards stands
  // where one of R1's did, P15's shifted a screen along
  const at = (short, pa) =>
    new Set(boards.filter((r) => r.lv.short === short && r.p.id === pa).map((r) => r.t.x1));
  const shifted = (xs, by) => new Set([...xs].map((x) => x + by));
  assert.deepEqual(at("R2", 15), shifted(at("R1", 15), -1024));
  for (const pa of [16, 18]) assert.ok([...at("R2", pa)].every((x) => at("R1", pa).has(x)));
});

test("objectMessages: a release's code page the map cannot read says which language it is in", () => {
  setMessages(SHIPPED);
  const overlay = load("release_ao_jp.json");
  const jp = { id: "AO", release: { ...overlay, paths: undefined } };
  const boards = [...eachTlv("AO")].filter((r) => r.t.name === "LCDScreen");
  const speaking = boards.find((r) => objectMessages({ id: "AO" }, r.t).length > 0);
  // one line of no text, never the release's bytes read as letters
  assert.deepEqual(objectMessages(jp, speaking.t), [
    { text: null, note: "In Japanese, which the map cannot read yet." },
  ]);
  // a board that can only run dark still says so
  const dark = boards.find((r) => objectMessages({ id: "AO" }, r.t).length === 0);
  assert.deepEqual(objectMessages(jp, dark.t), []);
});

test("objectMessages: a release reads its own tables, a path's overlay entries and its code page", () => {
  setMessages(SHIPPED);
  const board = { name: "LCDScreen", fields: { message_1_id: 2 } };
  const own = [...AO.lcd];
  own[2] = "caf\x82 \x10";
  const eu = { id: "AO", release: { code: "fr", code_page: "cp437", messages: { lcd: own } } };
  assert.deepEqual(objectMessages(eu, board), [{ text: "café [Up]", note: "" }]);
  const path = { release: { messages: { lcd: { 2: "gar\x87on" } } } };
  assert.deepEqual(objectMessages(eu, board, path), [{ text: "garçon", note: "" }]);
  // the base reads its own table, whatever a release holds
  assert.deepEqual(objectMessages({ id: "AO" }, board), [
    { text: messageText(AO.lcd[2]), note: "" },
  ]);
});
