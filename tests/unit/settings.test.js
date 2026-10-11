import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  SETTINGS_DEFAULTS,
  SHOW_KEYS,
  displayLabel,
  sanitizeLocationHash,
  sanitizeSettings,
  sanitizeView,
} from "../../public/js/settings.js";
import { CATS } from "../../public/js/config.js";

// sanitizeSettings adds fieldPrefs (a non-boolean) on top of the boolean defaults
const DEFAULTS = { ...SETTINGS_DEFAULTS, fieldPrefs: { mode: "default", byType: {} } };

test("sanitizeSettings: absent or unreadable storage yields the defaults", () => {
  assert.deepEqual(sanitizeSettings(null), DEFAULTS);
  assert.deepEqual(sanitizeSettings("{not json"), DEFAULTS);
  assert.deepEqual(sanitizeSettings('"a string"'), DEFAULTS);
  assert.deepEqual(sanitizeSettings("null"), DEFAULTS);
});

test("sanitizeSettings: known boolean keys apply, everything else is dropped", () => {
  const s = sanitizeSettings('{"rememberView":false,"bogus":true}');
  assert.equal(s.rememberView, false);
  assert.deepEqual(Object.keys(s).sort(), Object.keys(DEFAULTS).sort());
});

test("sanitizeSettings: fieldPrefs validates mode and per-game type key lists", () => {
  const good = sanitizeSettings(
    '{"fieldPrefs":{"mode":"more","byType":{"AO":{"Slig":["start_state","pause_time"]}}}}',
  );
  assert.deepEqual(good.fieldPrefs, {
    mode: "more",
    byType: { AO: { Slig: ["start_state", "pause_time"] } },
  });
  // garbage mode falls back cleanly; non-string keys are filtered out; a flat
  // (pre-per-game) pick is not a game bucket and is orphaned whole
  const bad = sanitizeSettings(
    '{"fieldPrefs":{"mode":"bogus","byType":{"AO":{"Slig":[1,"ok",null]},"Slog":["flat"]}}}',
  );
  assert.deepEqual(bad.fieldPrefs, { mode: "default", byType: { AO: { Slig: ["ok"] } } });
  // a fresh byType each time: mutating one result must not leak into the next
  good.fieldPrefs.byType.AO.Slig.push("leaked");
  assert.deepEqual(sanitizeSettings(null).fieldPrefs, { mode: "default", byType: {} });
});

test("sanitizeSettings: a wrong-typed value keeps its default", () => {
  assert.equal(sanitizeSettings('{"rememberView":"yes"}').rememberView, true);
  assert.equal(sanitizeSettings('{"rememberView":0}').rememberView, true);
});

test("sanitizeSettings: showRawValues defaults off and round-trips", () => {
  assert.equal(sanitizeSettings(null).showRawValues, false);
  assert.equal(sanitizeSettings('{"showRawValues":true}').showRawValues, true);
});

test("sanitizeSettings: editObjects defaults off and round-trips", () => {
  assert.equal(sanitizeSettings(null).editObjects, false);
  assert.equal(sanitizeSettings('{"editObjects":true}').editObjects, true);
});

test("sanitizeView: absent or unreadable snapshot yields null", () => {
  assert.equal(sanitizeView(null), null);
  assert.equal(sanitizeView("{not json"), null);
  assert.equal(sanitizeView("42"), null);
});

test("sanitizeView: a full snapshot round-trips", () => {
  const show = Object.fromEntries(SHOW_KEYS.map((k, i) => [k, i % 2 === 0]));
  const cats = Object.fromEntries(CATS.map((c, i) => [c.key, i % 2 === 1]));
  assert.deepEqual(sanitizeView(JSON.stringify({ show, cats })), { show, cats });
});

test("sanitizeView: unknown keys and wrong-typed values are dropped", () => {
  const v = sanitizeView(
    JSON.stringify({
      show: { grid: false, bogus: true, coll: "yes", ruler: true, route: true }, // ruler/route are never remembered
      cats: { mud: false, gone: true, door: 1 },
    }),
  );
  assert.deepEqual(v, { show: { grid: false }, cats: { mud: false } });
});

test("getViewSnapshot: the stored snapshot seeds the kept set, which viewChanged writes back", async () => {
  // an instance of its own, the view being memoised on the first ask
  const { getViewSnapshot, viewChanged } = await import(
    new URL("../../public/js/settings.js?view", import.meta.url)
  );
  const stored = new Map([
    ["owm:view", JSON.stringify({ show: { grid: false, coll: "yes" }, cats: { nav: true } })],
  ]);
  Object.defineProperty(globalThis, "localStorage", {
    configurable: true,
    value: { getItem: (k) => stored.get(k) ?? null, setItem: (k, v) => stored.set(k, v) },
  });
  try {
    const view = getViewSnapshot();
    assert.deepEqual(view, { show: { grid: false }, cats: { nav: true } }); // a value not of its switch's kind is left behind
    assert.equal(getViewSnapshot(), view); // one live object, recorded into rather than rebuilt
    view.show.coll = true;
    delete view.cats.nav;
    viewChanged();
    assert.deepEqual(JSON.parse(stored.get("owm:view")), {
      show: { grid: false, coll: true },
      cats: {},
    });
  } finally {
    delete globalThis.localStorage;
  }
});

test("SHOW_KEYS: every sidebar Display toggle is remembered, ruler and route excepted", () => {
  const src = readFileSync(new URL("../../public/js/sidebar.js", import.meta.url), "utf8");
  const body = src.split("Object.entries({")[1].split("})")[0];
  const toggles = [...body.matchAll(/(\w+): "t\w+"/g)].map((m) => m[1]);
  assert.ok(toggles.length > 0, "the toggle map is read off the source");
  assert.deepEqual(
    [...SHOW_KEYS].sort(),
    toggles.filter((k) => k !== "ruler" && k !== "route").sort(),
  );
});

test("displayLabel: code alone by default, code — name in full-names mode", () => {
  assert.equal(displayLabel("MI", "Necrum Mines", false), "MI");
  assert.equal(displayLabel("MI", "Necrum Mines", true), "MI — Necrum Mines");
  assert.equal(displayLabel("AO", "Oddworld: Abe's Oddysee", true), "AO — Abe's Oddysee");
  assert.equal(displayLabel("P1", "", true), "P1"); // most paths carry no name
  assert.equal(displayLabel("P1", undefined, true), "P1");
});

test("sanitizeLocationHash: keeps a permalink-shaped string, rejects the rest", () => {
  const h = "#AO/R1/15/-100/-1139/0.16";
  assert.equal(sanitizeLocationHash(h), h);
  assert.equal(sanitizeLocationHash(""), null);
  assert.equal(sanitizeLocationHash("#"), null);
  assert.equal(sanitizeLocationHash("AO/R1/15"), null); // no leading #
  assert.equal(sanitizeLocationHash(null), null);
  assert.equal(sanitizeLocationHash(42), null);
});
