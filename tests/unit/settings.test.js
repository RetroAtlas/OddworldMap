import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  SETTINGS_DEFAULTS,
  SHOW_KEYS,
  displayLabel,
  offDefault,
  sanitizeChosen,
  sanitizeLocationHash,
  sanitizeSettings,
  sanitizeView,
} from "../../public/js/data/settings.js";
import { CATS } from "../../public/js/config.js";

// sanitizeSettings adds fieldPrefs (a non-boolean) on top of the boolean defaults
const DEFAULTS = { ...SETTINGS_DEFAULTS, fieldPrefs: { mode: "default", byType: {} } };

// the store over a device and a system of the test's own: an instance apart, the
// settings and the system's query being kept on the first ask, what the device
// holds, and the system's answer with a way to change it
async function storeOn(instance, { settings, reduce }) {
  const stored = new Map(settings ? [["owm:settings", JSON.stringify(settings)]] : []);
  const heard = [];
  const query = { matches: reduce, addEventListener: (type, f) => heard.push(f) };
  Object.defineProperty(globalThis, "localStorage", {
    configurable: true,
    value: { getItem: (k) => stored.get(k) ?? null, setItem: (k, v) => stored.set(k, v) },
  });
  Object.defineProperty(globalThis, "matchMedia", { configurable: true, value: () => query });
  return {
    ...(await import(new URL(`../../public/js/data/settings.js?${instance}`, import.meta.url))),
    kept: () => JSON.parse(stored.get("owm:settings")),
    systemAsks(to) {
      query.matches = to;
      for (const f of heard) f();
    },
    done() {
      delete globalThis.localStorage;
      delete globalThis.matchMedia;
    },
  };
}

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

test("sanitizeChosen: the stored booleans of known keys, one at its default included", () => {
  assert.deepEqual(sanitizeChosen(null), {});
  assert.deepEqual(sanitizeChosen("{not json"), {});
  assert.deepEqual(sanitizeChosen("42"), {});
  assert.deepEqual(
    sanitizeChosen('{"fullNames":true,"showDemoPaths":true,"animate":"yes","bogus":false}'),
    { fullNames: true, showDemoPaths: true },
  );
});

test("chooseSetting: records what the visitor has set, which persistSettings writes with the field picks", async () => {
  // an instance of its own, the settings being memoised on the first ask
  const { chooseSetting, getSettings, persistSettings } = await import(
    new URL("../../public/js/data/settings.js?fresh", import.meta.url)
  );
  const stored = new Map([
    ["owm:settings", JSON.stringify({ fullNames: true, showDemoPaths: true, animate: "yes" })],
  ]);
  Object.defineProperty(globalThis, "localStorage", {
    configurable: true,
    value: { getItem: (k) => stored.get(k) ?? null, setItem: (k, v) => stored.set(k, v) },
  });
  const kept = () => JSON.parse(stored.get("owm:settings"));
  try {
    const s = getSettings();
    assert.equal(s.animate, true); // a value not of its setting's kind is left behind
    persistSettings();
    assert.deepEqual(kept(), { fullNames: true, showDemoPaths: true }); // saved at its default, fullNames counts as set
    chooseSetting("fullNames", false);
    assert.equal(s.fullNames, false);
    assert.deepEqual(kept(), { fullNames: false, showDemoPaths: true });
    chooseSetting("fullNames", true); // set back to its default, it leaves the kept set
    assert.deepEqual(kept(), { showDemoPaths: true });
    chooseSetting("showDemoPaths", false);
    assert.deepEqual(kept(), {});
    s.fieldPrefs.mode = "more";
    persistSettings();
    assert.deepEqual(kept(), { fieldPrefs: { mode: "more", byType: {} } });
    s.fieldPrefs.mode = "default";
    s.fieldPrefs.byType.AO = { Slig: ["start_state"] };
    persistSettings();
    assert.deepEqual(kept(), {
      fieldPrefs: { mode: "default", byType: { AO: { Slig: ["start_state"] } } },
    });
    s.fieldPrefs.byType.AO = {};
    persistSettings();
    assert.deepEqual(kept(), {});
  } finally {
    delete globalThis.localStorage;
  }
});

test("sanitizeSettings: reduceMotion is the stored choice, and what the system asks where none of its kind is stored", async () => {
  const on = await storeOn("asked", { reduce: true });
  try {
    assert.equal(on.sanitizeSettings(null).reduceMotion, true);
    assert.equal(on.sanitizeSettings('{"fullNames":false}').reduceMotion, true);
    assert.equal(on.sanitizeSettings('{"reduceMotion":false}').reduceMotion, false);
    assert.equal(on.sanitizeSettings('{"reduceMotion":"allow"}').reduceMotion, true);
    assert.equal(on.sanitizeSettings('{"reduceMotion":null}').reduceMotion, true);
    assert.deepEqual(on.sanitizeChosen('{"reduceMotion":false}'), { reduceMotion: false });
    assert.deepEqual(on.sanitizeChosen('{"reduceMotion":0}'), {});
    on.systemAsks(false);
    assert.equal(on.sanitizeSettings(null).reduceMotion, false);
    assert.equal(on.sanitizeSettings('{"reduceMotion":true}').reduceMotion, true);
    assert.equal(on.sanitizeSettings('{"reduceMotion":1}').reduceMotion, false);
  } finally {
    on.done();
  }
});

test("reduceMotion: unset it follows the system as it changes, set it stands over it either way, and set back to what the system asks it follows again", async () => {
  // stored settings that predate the key
  const on = await storeOn("motion", { settings: { fullNames: false }, reduce: false });
  try {
    const s = on.getSettings();
    assert.equal(s.reduceMotion, false);
    assert.equal(on.motionChoice(), null);
    on.systemAsks(true);
    assert.equal(s.reduceMotion, true);
    assert.equal(on.motionChoice(), null);
    // allowed on a system that asks to reduce
    on.chooseSetting("reduceMotion", false);
    assert.equal(s.reduceMotion, false);
    assert.equal(on.motionChoice(), "allow");
    assert.deepEqual(on.kept(), { fullNames: false, reduceMotion: false });
    on.systemAsks(false); // the choice stands though the system now asks the same
    assert.equal(s.reduceMotion, false);
    assert.equal(on.motionChoice(), "allow");
    on.systemAsks(true);
    assert.equal(s.reduceMotion, false);
    // set back to what the system asks, it leaves the kept set
    on.chooseSetting("reduceMotion", true);
    assert.equal(s.reduceMotion, true);
    assert.equal(on.motionChoice(), null);
    assert.deepEqual(on.kept(), { fullNames: false });
    on.systemAsks(false);
    assert.equal(s.reduceMotion, false);
    // reduced on a system that allows motion
    on.chooseSetting("reduceMotion", true);
    assert.equal(s.reduceMotion, true);
    assert.equal(on.motionChoice(), "reduce");
    assert.deepEqual(on.kept(), { fullNames: false, reduceMotion: true });
    on.systemAsks(true);
    on.systemAsks(false);
    assert.equal(s.reduceMotion, true);
    assert.equal(on.motionChoice(), "reduce");
  } finally {
    on.done();
  }
});

test("reduceMotion: a stored choice stands from the first read, and a watcher hears the system change", async () => {
  const on = await storeOn("returning", { settings: { reduceMotion: true }, reduce: false });
  try {
    assert.equal(on.getSettings().reduceMotion, true);
    assert.equal(on.motionChoice(), "reduce");
    let heard = 0;
    on.watchSystemMotion(() => heard++);
    on.systemAsks(true);
    assert.equal(heard, 1);
  } finally {
    on.done();
  }
});

test("reduceMotion: a stored choice the system agrees with at the first read is a choice still, and stands when the system changes", async () => {
  for (const reduce of [false, true]) {
    // set against a system that has since come round to it
    const on = await storeOn(`agreed-${reduce}`, { settings: { reduceMotion: reduce }, reduce });
    try {
      const s = on.getSettings();
      assert.equal(s.reduceMotion, reduce);
      assert.equal(on.motionChoice(), reduce ? "reduce" : "allow");
      on.systemAsks(!reduce);
      assert.equal(s.reduceMotion, reduce);
      assert.equal(on.motionChoice(), reduce ? "reduce" : "allow");
      on.persistSettings();
      assert.deepEqual(on.kept(), { reduceMotion: reduce });
    } finally {
      on.done();
    }
  }
});

test("offDefault: a setting away from its default names where the default stands, and one at it says nothing", async () => {
  assert.equal(offDefault(true, true), "");
  assert.equal(offDefault(false, false), "");
  assert.equal(offDefault(false, true), "on by default");
  assert.equal(offDefault(true, false), "off by default");
  // the motion setting's default is what the system asks now
  const on = await storeOn("mark", { reduce: true });
  try {
    const s = on.getSettings();
    const mark = () =>
      on.offDefault(s.reduceMotion, on.SETTINGS_DEFAULTS.reduceMotion, "in your system");
    assert.equal(mark(), "");
    on.chooseSetting("reduceMotion", false);
    assert.equal(mark(), "on in your system");
    on.systemAsks(false); // the choice overrides nothing while the system asks the same
    assert.equal(mark(), "");
    on.systemAsks(true);
    assert.equal(mark(), "on in your system");
    on.chooseSetting("reduceMotion", true);
    on.systemAsks(false);
    on.chooseSetting("reduceMotion", true);
    assert.equal(mark(), "off in your system");
  } finally {
    on.done();
  }
});

test("getViewSnapshot: the stored snapshot seeds the kept set, which viewChanged writes back", async () => {
  // an instance of its own, the view being memoised on the first ask
  const { getViewSnapshot, viewChanged } = await import(
    new URL("../../public/js/data/settings.js?view", import.meta.url)
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
  const src = readFileSync(new URL("../../public/js/chrome/sidebar.js", import.meta.url), "utf8");
  const body = src.split("Object.entries({")[1].split("})")[0];
  const toggles = [...body.matchAll(/(\w+): "t\w+"/g)].map((m) => m[1]);
  assert.ok(toggles.length > 0, "the toggle map is read off the source");
  assert.deepEqual(
    [...SHOW_KEYS].sort(),
    toggles.filter((k) => k !== "ruler" && k !== "route").sort(),
  );
});

test("SETTINGS_DEFAULTS: a Settings row carries checked exactly when its default is on", () => {
  const src = readFileSync(
    new URL("../../public/js/chrome/settingsdialog.js", import.meta.url),
    "utf8",
  );
  const bound = [...src.matchAll(/bind\("(\w+)", "(\w+)"/g)].map(([, id, key]) => [id, key]);
  assert.deepEqual(
    bound.map(([, key]) => key).sort(),
    Object.keys(SETTINGS_DEFAULTS).sort(),
    "every boolean setting is bound to a row",
  );
  const html = readFileSync(new URL("../../public/index.html", import.meta.url), "utf8");
  const checked = new Map(
    [...html.matchAll(/<input\b([^>]*)>/g)].map(([, attrs]) => [
      attrs.match(/\bid="(\w+)"/)?.[1],
      /\bchecked\b/.test(attrs),
    ]),
  );
  for (const [id, key] of bound) {
    assert.ok(checked.has(id), `${id} is in the markup`);
    assert.equal(checked.get(id), SETTINGS_DEFAULTS[key], `${id} is checked as ${key} defaults`);
  }
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
