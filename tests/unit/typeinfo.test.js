import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { sanitizeTypeInfo, setTypeInfo, typeProse, typeSummary } from "../../public/js/typeinfo.js";
import { objectMessages, setMessages } from "../../public/js/messages.js";

const load = (name) =>
  JSON.parse(readFileSync(new URL(`../../public/${name}`, import.meta.url), "utf8"));

// an entry is prose: it opens capitalized and closes punctuated
const SENTENCE = /^[A-Z].*[.!?]$/;
const SUMMARY_MAX = 160; // the first sentence rides the hover tooltip alone

test("sanitizeTypeInfo: keeps only string entries of the types section", () => {
  assert.deepEqual(sanitizeTypeInfo({ types: { A: "ok", B: 3, C: "" }, junk: { D: "x" } }), {
    A: "ok",
  });
  assert.deepEqual(sanitizeTypeInfo(null), {});
  assert.deepEqual(sanitizeTypeInfo("nonsense"), {});
  assert.deepEqual(sanitizeTypeInfo({ types: "nonsense" }), {});
});

test("typeProse / typeSummary: paragraph, first sentence, null on miss", () => {
  setTypeInfo({ types: { X: "First bit. Second bit.", Y: "One sentence only." } });
  assert.equal(typeProse("X"), "First bit. Second bit.");
  assert.equal(typeSummary("X"), "First bit.");
  assert.equal(typeSummary("Y"), "One sentence only.");
  assert.equal(typeProse("Z"), null);
  assert.equal(typeSummary("Z"), null);
  setTypeInfo(null); // reset for other tests importing this module
});

test("glossary_types.json: every key names a shipped type, prose reads as prose", () => {
  const names = new Set();
  for (const game of ["ao", "ae"])
    for (const lv of load(`map_data_${game}.json`).levels)
      for (const p of lv.paths) for (const t of p.tlvs) names.add(t.name);
  const raw = load("glossary_types.json");
  const info = sanitizeTypeInfo(raw);
  assert.ok(Object.keys(info).length > 0, "glossary_types.json holds entries");
  assert.equal(Object.keys(info).length, Object.keys(raw.types).length, "sanitize dropped none");
  setTypeInfo(raw);
  for (const [k, v] of Object.entries(info)) {
    assert.ok(names.has(k), `"${k}" is a shipped type name`);
    assert.match(v, SENTENCE, `${k}: entry reads as prose`);
    const s = typeSummary(k);
    assert.match(s, /[.!?]$/, `${k}: first sentence closes punctuated`);
    assert.ok(s.length <= SUMMARY_MAX, `${k}: summary fits a tooltip line (${s.length})`);
  }
  // exact coverage: a rebuild that surfaces a new type fails here until the
  // encyclopedia covers it
  assert.deepEqual(Object.keys(info).sort(), [...names].sort(), "one entry per shipped type");
  setTypeInfo(null);
});

// ---- the counted claims -----------------------------------------------------
// Every count or placement an entry states, pinned to the shipped data at the
// scope the prose uses. Counts follow the map's counting rule — paths the demo
// setting hides are excluded ("listed") — so an entry agrees with the census
// count on its own card; a pin over the raw data uses `every`/`allOf` instead.

function gameRows(file) {
  const rows = [];
  for (const lv of load(file).levels)
    for (const p of lv.paths) {
      const demo = p.tlvs.some((t) => t.name === "DemoSpawnPoint");
      for (const t of p.tlvs) rows.push({ lv, p, t, demo });
    }
  return rows;
}
const AO = gameRows("map_data_ao.json");
const AE = gameRows("map_data_ae.json");
// a claim about what a board says needs the tables the viewer resolves through
setMessages({ AO: load("messages_ao.json"), AE: load("messages_ae.json") });
const allOf = (rows, name) => rows.filter((r) => r.t.name === name);
const listed = (rows, name) => allOf(rows, name).filter((r) => !r.demo);
const f = (r, k) => (r.t.fields || {})[k];
const n = (rows) => rows.length;
const levels = (rows) => new Set(rows.map((r) => r.lv.short));
const within = (rows, ...shorts) => [...levels(rows)].every((s) => shorts.includes(s));
const every = (rows, fn) => rows.every(fn);
const count = (rows, fn) => rows.filter(fn).length;

const CLAIMS = {
  BackgroundAnimation: () => {
    const snd = allOf(AO, "BackgroundAnimation").filter((r) => f(r, "sound_effect") === 1);
    return n(snd) === 9 && within(snd, "E1");
  },
  BeeSwarmHole: () => n(allOf(AO, "BeeSwarmHole")) === 1 && within(allOf(AO, "BeeSwarmHole"), "F2"),
  BellSongStone: () => count(allOf(AO, "BellSongStone"), (r) => f(r, "switch_id") <= 1) === 4,
  BirdPortalExit: () =>
    n(allOf(AO, "BirdPortalExit")) <
      count(allOf(AO, "BirdPortal"), (r) => f(r, "portal_type") === 0) &&
    n(listed(AE, "BirdPortalExit")) <
      count(listed(AE, "BirdPortal"), (r) => f(r, "portal_type") === 0),
  BoneBag: () =>
    n(listed(AE, "BoneBag")) === 15 &&
    count(listed(AE, "BoneBag"), (r) => f(r, "bone_amount") === 9) === 8,
  BoomMachine: () =>
    every(listed(AE, "BoomMachine"), (r) => f(r, "number_of_grenades") === 1) &&
    Math.min(...allOf(AO, "BoomMachine").map((r) => f(r, "number_of_grenades"))) === 1 &&
    Math.max(...allOf(AO, "BoomMachine").map((r) => f(r, "number_of_grenades"))) === 9,
  BrewMachine: () =>
    n(listed(AE, "BrewMachine")) === 11 &&
    count(listed(AE, "BrewMachine"), (r) => f(r, "brew_count") === 0) === 2,
  ChimeLock: () =>
    count(
      allOf(AO, "ChimeLock"),
      (r) => r.lv.short === "D2" && f(r, "password_switch_id") === 180,
    ) === 5,
  ContinuePoint: () => {
    const cp = listed(AE, "ContinuePoint");
    return n(cp) === 107 && count(cp, (r) => f(r, "scale") === 0) === 83;
  },
  ContinueZone: () => n(allOf(AO, "ContinueZone")) === 508,
  CrawlingSlig: () => {
    const cs = listed(AE, "CrawlingSlig");
    return (
      every(cs, (r) => f(r, "state") !== 2) &&
      count(cs, (r) => f(r, "panic_switch_id") === 1) * 2 === n(cs)
    );
  },
  CrawlingSligButton: () => n(listed(AE, "CrawlingSligButton")) === 1,
  DeathClock: () => n(allOf(AO, "DeathClock")) === 7 && within(allOf(AO, "DeathClock"), "R6"),
  DeathDrop: () =>
    every([...allOf(AO, "DeathDrop"), ...allOf(AE, "DeathDrop")], (r) =>
      Object.values(r.t.fields || {}).every((v) => v === 0),
    ),
  DoorBlocker: () => {
    const db = listed(AE, "DoorBlocker");
    const onTasksDoor = (r) =>
      r.p.tlvs.some(
        (d) =>
          d.name === "Door" &&
          d.fields?.switch_id === f(r, "switch_id") &&
          d.fields?.door_type === 3,
      );
    return n(db) === 25 && count(db, onTasksDoor) === 24;
  },
  DoorFlame: () =>
    within(allOf(AO, "DoorFlame"), "F2", "D2") && within(allOf(AE, "DoorFlame"), "NE", "PV", "SV"),
  Drill: () =>
    count(listed(AE, "Drill"), (r) => f(r, "speed") === 250 || f(r, "off_speed") === 250) === 15,
  ElectricWall: () =>
    every(
      [...allOf(AO, "ElectricWall"), ...allOf(AE, "ElectricWall")],
      (r) => f(r, "switch_id") >= 2,
    ),
  ElumPathTrans: () =>
    n(allOf(AO, "ElumPathTrans")) === 28 && within(allOf(AO, "ElumPathTrans"), "F1", "D1"),
  ElumStart: () => {
    const es = allOf(AO, "ElumStart");
    const cell = (t) => `${Math.floor(t.x1 / 1024)},${Math.floor(t.y1 / 480)}`;
    return (
      n(es) === 2 &&
      every(es, (r) => r.p.tlvs.some((t) => t.name === "BellHammer" && cell(t) === cell(r.t)))
    );
  },
  ElumWall: () =>
    n(allOf(AO, "ElumWall")) === 23 && within(allOf(AO, "ElumWall"), "F1", "D1", "L1"),
  EnemyStopper: () =>
    every(allOf(AO, "EnemyStopper"), (r) => f(r, "switch_id") !== 1) &&
    every(allOf(AE, "EnemyStopper"), (r) => f(r, "switch_id") !== 0),
  ExplosionSet: () => {
    const es = listed(AE, "ExplosionSet");
    return n(es) === 15 && new Set(es.map((r) => JSON.stringify(r.t.fields))).size === 1;
  },
  FlintLockFire: () =>
    n(allOf(AO, "FlintLockFire")) === 15 && within(allOf(AO, "FlintLockFire"), "L1", "F2", "D2"),
  GasCountdown: () => {
    const gc = listed(AE, "GasCountdown");
    const t = (r) => f(r, "gas_countdown_time");
    return (
      every(gc, (r) => f(r, "stop_timer_switch_id") === 0) &&
      every(gc, (r) => r.lv.short !== "BM" || t(r) === 7200) &&
      gc.some((r) => r.lv.short === "FD" && t(r) === 60) &&
      Math.min(...gc.map(t)) === 60 &&
      Math.max(...gc.map(t)) === 7200
    );
  },
  GasEmitter: () => every(listed(AE, "GasEmitter"), (r) => f(r, "colour") === 0),
  Glukkon: () =>
    n(allOf(AO, "Glukkon")) === 6 &&
    within(allOf(AO, "Glukkon"), "R6") &&
    count(listed(AE, "Glukkon"), (r) => [1, 2, 3].includes(f(r, "glukkon_type"))) === 3,
  GlukkonSwitch: () => every(allOf(AE, "GlukkonSwitch"), (r) => f(r, "fail_switch_id") === 0),
  HandStone: () => {
    const crossesPath = (r) =>
      [1, 2, 3].some((i) => {
        const lvl = f(r, `camera_${i}_level`);
        return (
          lvl != null &&
          lvl !== 14 &&
          lvl !== 15 &&
          (f(r, `camera_${i}_path`) !== r.p.id || lvl !== r.lv.id)
        );
      });
    return (
      count(listed(AE, "HandStone"), (r) => f(r, "trigger_switch_id") > 1) === 10 &&
      count(allOf(AO, "HandStone"), crossesPath) === 0
    );
  },
  HintFly: () => {
    const placed = new Set(allOf(AO, "HintFly").map((r) => f(r, "message_id")));
    const table = load("messages_ao.json").hintfly;
    const unplaced = table.filter((_, id) => !placed.has(id));
    return (
      unplaced.length === 11 && unplaced.includes("ABE WAS HERE") && unplaced.includes("TEST THREE")
    );
  },
  Honey: () => {
    const h = allOf(AO, "Honey");
    const sackLevels = levels(allOf(AO, "HoneySack"));
    return n(h) === 2 && count(h, (r) => !sackLevels.has(r.lv.short)) === 1;
  },
  HoneyDripTarget: () => {
    const hd = allOf(AO, "HoneyDripTarget");
    return n(hd) === 1 && within(hd, "F1") && !levels(allOf(AO, "HoneyDripTarget")).has("F2");
  },
  IdSplitter: () =>
    n(allOf(AO, "IdSplitter")) === 12 &&
    count(allOf(AO, "IdSplitter"), (r) => f(r, "trigger_interval") === 0) === 11,
  KillUnsavedMuds: () =>
    n(allOf(AO, "KillUnsavedMuds")) === 1 && within(allOf(AO, "KillUnsavedMuds"), "E1"),
  LaughingGas: () => every(allOf(AE, "LaughingGas"), (r) => f(r, "is_laughing_gas") === 1),
  LCD: () => {
    const boards = listed(AE, "LCD").filter((r) => f(r, "toggle_message_switch_id") === 110);
    const says = (r, note, re) =>
      objectMessages({ id: "AE" }, r.t).some((m) => m.note === note && re.test(m.text));
    return (
      n(boards) === 7 &&
      within(boards, "MI") &&
      count(
        boards,
        (r) => says(r, "switch off", /turn all the wheels/i) && says(r, "switch on", /vacation/i),
      ) === 1
    );
  },
  LCDScreen: () => {
    const r2 = allOf(AO, "LCDScreen").filter((r) => r.lv.short === "R2");
    return n(r2) === 22 && count(r2, (r) => objectMessages({ id: "AO" }, r.t).length > 0) === 2;
  },
  LCDStatusBoard: () => {
    const sb = listed(AE, "LCDStatusBoard");
    return n(sb) === 159 && count(sb, (r) => f(r, "hide_board") === 1) === 80;
  },
  LevelLoader: () => {
    const ll = listed(AE, "LevelLoader");
    if (n(ll) !== 1 || !within(ll, "MI") || ll[0].p.id !== 1) return false;
    const { p, t } = ll[0];
    const sync = p.tlvs.find(
      (o) => o.name === "WheelSyncer" && o.fields.output_switch_id === t.fields.switch_id,
    );
    if (!sync || sync.fields.output_requirement !== 0) return false;
    const inputs = [1, 2, 3, 4, 5, 6].map((i) => sync.fields[`input_switch_id_${i}`]);
    const wheels = p.tlvs.filter(
      (o) => o.name === "WorkWheel" && inputs.includes(o.fields.switch_id),
    );
    return (
      new Set(inputs).size === 6 &&
      n(wheels) === 6 &&
      wheels.every((o) => o.fields.turn_off_when_stopped === 1) && // what makes it all at once
      t.extra.to_path === 2 &&
      f(ll[0], "movie_id") === 2631 // BREW.STR then BREWCAMT.STR in the Mines' movie table
    );
  },
  LightEffect: () => {
    const stars = allOf(AO, "LightEffect").filter((r) => f(r, "type") === 0);
    return n(stars) === 31 && within(stars, "E1", "E2");
  },
  LiftMudokon: () =>
    n(allOf(AO, "LiftMudokon")) === 1 &&
    every(allOf(AO, "LiftMudokon"), (r) => f(r, "give_password") === 0),
  MainMenuController: () => n(allOf(AE, "MainMenuController")) === 6,
  MeatSack: () => {
    const ms = [...allOf(AO, "MeatSack"), ...listed(AE, "MeatSack")];
    return n(ms) === 11 && within(ms, "F2", "F4", "PV");
  },
  MenuController: () => n(allOf(AO, "MenuController")) === 5,
  Mine: () => {
    const hazards = [
      "Mine",
      "UXB",
      "TimedMine",
      "ElectricWall",
      "TrapDoor",
      "Drill",
      "MeatSaw",
      "MovingBomb",
      "FallingItem",
      "DeathDrop",
    ];
    return hazards.every(
      (h) => n(allOf(AO, "Mine")) >= n(allOf(AO, h)) && n(allOf(AE, "Mine")) >= n(allOf(AE, h)),
    );
  },
  MineCar: () => {
    const mc = listed(AE, "MineCar");
    return (
      n(mc) === 3 &&
      count(mc, (r) => r.lv.short === "MI") === 2 &&
      count(mc, (r) => r.lv.short === "BW") === 1
    );
  },
  MotionDetector: () => count(allOf(AO, "MotionDetector"), (r) => f(r, "draw_flare") === 0) === 2,
  MovieStone: () => n(allOf(AO, "MovieStone")) === 1 && within(allOf(AO, "MovieStone"), "R2"),
  MovingBomb: () =>
    count(allOf(AO, "MovingBomb"), (r) => f(r, "switch_id") === 1) * 2 >
      n(allOf(AO, "MovingBomb")) &&
    count(listed(AE, "MovingBomb"), (r) => f(r, "start_moving_switch_id") === 1) * 2 >
      n(listed(AE, "MovingBomb")),
  MovingBombStopper: () => n(allOf(AE, "MovingBombStopper")) === 0,
  MudokonPathTrans: () =>
    n(allOf(AO, "MudokonPathTrans")) === 1 && within(allOf(AO, "MudokonPathTrans"), "R1"),
  MusicTrigger: () =>
    every(
      listed(AE, "MusicTrigger"),
      (r) => f(r, "music_type") === 2 && f(r, "triggered_by") === 1,
    ) && count(allOf(AO, "MusicTrigger"), (r) => f(r, "switch_id") === 1) === 3,
  Null: () => {
    const nulls = allOf(AE, "Null");
    const cell = (t) => `${Math.floor(t.x1 / 375)},${Math.floor(t.y1 / 260)}`;
    return (
      n(nulls) === 3 &&
      every(nulls, (r) =>
        r.p.tlvs.some((t) => t.name === "MainMenuController" && cell(t) === cell(r.t)),
      ) &&
      every(nulls, (r) => f(r, "padding1") === 1)
    );
  },
  ParamiteWebLine: () =>
    n(listed(AE, "ParamiteWebLine")) === 25 && within(listed(AE, "ParamiteWebLine"), "PV"),
  PathTransition: () =>
    n(allOf(AO, "PathTransition")) === 56 && n(listed(AE, "PathTransition")) === 9,
  Preloader: () => n(allOf(AO, "Preloader")) === 85,
  ResetPath: () =>
    n(allOf(AO, "ResetPath")) === 14 &&
    every(
      allOf(AO, "ResetPath"),
      (r) => (r.lv.short === "F2" && r.p.id === 8) || (r.lv.short === "D2" && r.p.id === 10),
    ),
  ResetSwitchRange: () => {
    const rs = listed(AE, "ResetSwitchRange");
    return (
      n(rs) === 12 &&
      every(rs, (r) => f(r, "enabled") === 0) &&
      count(rs, (r) => f(r, "reset_switches") === 0) === 6
    );
  },
  RingCancel: () => {
    const rc = allOf(AO, "RingCancel");
    const paths = new Set(rc.map((r) => `${r.lv.short} P${r.p.id}`));
    return n(rc) === 10 && paths.has("F2 P6") && paths.has("D1 P4");
  },
  RingMudokon: () => {
    const rm = allOf(AO, "RingMudokon");
    const timed = rm.filter((r) => f(r, "ring_and_angry_mudokon_timeout") > 0);
    return (
      n(rm) === 11 &&
      count(rm, (r) => f(r, "action") === 0) === 3 &&
      n(timed) === 1 &&
      f(timed[0], "ring_and_angry_mudokon_timeout") === 800
    );
  },
  RollingBall: () => n(allOf(AO, "RollingBall")) === 2 && within(allOf(AO, "RollingBall"), "F2"),
  RollingBallStopper: () => n(allOf(AO, "RollingBallStopper")) === 1,
  ScrabLeftBound: () => {
    const sb = listed(AE, "ScrabLeftBound");
    const scrabLevels = levels(listed(AE, "Scrab"));
    return n(sb) === 56 && count(sb, (r) => !scrabLevels.has(r.lv.short)) === 23;
  },
  ScrabSpawner: () =>
    n(listed(AE, "ScrabSpawner")) === 1 && within(listed(AE, "ScrabSpawner"), "SV"),
  SecurityClaw: () => {
    const sc = allOf(AO, "SecurityClaw");
    return (
      within(sc, "R1", "R2", "E2") &&
      count(sc, (r) => r.lv.short !== "E2") > n(sc) * 0.8 &&
      n(allOf(AE, "SecurityClaw")) === 2
    );
  },
  ShadowZone: () => {
    const ao = listed(AO, "ShadowZone");
    const ae = listed(AE, "ShadowZone");
    // ShadowZoneScale: 0 both, 1 half, 2 full
    return (
      count(ao, (r) => f(r, "scale") === 0) * 2 > n(ao) &&
      count(ae, (r) => f(r, "scale") === 2) * 2 > n(ae)
    );
  },
  SligBoundRight: () =>
    n(listed(AO, "SligBoundRight")) < n(listed(AO, "SligBoundLeft")) &&
    n(listed(AE, "SligBoundRight")) < n(listed(AE, "SligBoundLeft")),
  SligGetWings: () => n(listed(AE, "SligGetWings")) === 1,
  SligPersist: () => n(listed(AE, "SligPersist")) > n(listed(AE, "Slig")),
  SligSpawner: () => {
    const ss = listed(AE, "SligSpawner");
    return (
      count(ss, (r) => f(r, "unlimited_spawns") === 1) === 30 &&
      n(ss) === 32 &&
      count(allOf(AO, "Slig"), (r) => f(r, "start_state") === 3) === 0 &&
      count(allOf(AO, "SligSpawner"), (r) => f(r, "start_state") === 3) * 2 >
        n(allOf(AO, "SligSpawner")) &&
      count(ss, (r) => f(r, "start_state") === 3) * 2 > n(ss) &&
      count(listed(AE, "Slig"), (r) => f(r, "start_state") === 3) * 10 < n(listed(AE, "Slig"))
    );
  },
  SlingMudokon: () =>
    n(allOf(AO, "SlingMudokon")) === 4 &&
    every(allOf(AO, "SlingMudokon"), (r) => f(r, "dont_whistle_password") === 0),
  SlogHut: () => {
    const spawnerIds = new Set(allOf(AO, "SlogSpawner").map((r) => f(r, "spawner_switch_id")));
    return every(allOf(AO, "SlogHut"), (r) => spawnerIds.has(f(r, "switch_id")));
  },
  Slurg: () => count(listed(AE, "Slurg"), (r) => f(r, "switch_id") > 1) === 11,
  SoftLanding: () => count(listed(AE, "SoftLanding"), (r) => f(r, "switch_id") === 0) === 1,
  StatusLight: () => {
    const wheels = listed(AE, "WorkWheel").filter(
      (r) => r.lv.short === "MI" && f(r, "switch_id") > 1,
    );
    const cell = (t) => `${Math.floor(t.x1 / 375)},${Math.floor(t.y1 / 260)}`;
    const lit = (r) =>
      r.p.tlvs.some(
        (t) =>
          t.name === "StatusLight" &&
          t.fields?.switch_id === f(r, "switch_id") &&
          cell(t) === cell(r.t),
      );
    return n(wheels) === 26 && count(wheels, lit) === 25;
  },
  TimedMine: () => n(allOf(AO, "TimedMine")) === 10 && n(allOf(AE, "TimedMine")) === 0,
  TimerTrigger: () => {
    const tt = listed(AE, "TimerTrigger");
    const zeros = count(tt, (r) => f(r, "trigger_interval") === 0);
    return zeros * 2 >= n(tt) - 4 && zeros * 2 <= n(tt) + 4;
  },
  TorturedMudokon: () => every(allOf(AE, "TorturedMudokon"), (r) => f(r, "kill_switch_id") === 0),
  TrapDoor: () => every(allOf(AE, "TrapDoor"), (r) => f(r, "dest_level") === 1),
  UXB: () => {
    // truncated to one digit: effective length clamps to 1 under a multi-digit pattern
    const uxbs = listed(AE, "UXB");
    const single = count(uxbs, (r) => {
      const l = f(r, "pattern_length");
      return (l < 1 || l > 4 ? 1 : l) === 1 && String(f(r, "pattern") || 11111).length > 1;
    });
    return single * 2 > n(uxbs);
  },
  Water: () => {
    const w = listed(AE, "Water");
    const angeredBy = (r) =>
      r.p.tlvs.some((t) => t.name === "Mudokon" && t.fields.angry_switch_id === f(r, "switch_id"));
    return n(w) === 2 && levels(w).has("MI") && levels(w).has("BR") && every(w, angeredBy);
  },
  WheelSyncer: () => {
    const ws = listed(AE, "WheelSyncer");
    return n(ws) === 18 && count(ws, (r) => f(r, "output_requirement") === 0) === 15;
  },
  WorkWheel: () => {
    const ww = listed(AE, "WorkWheel");
    return (
      n(ww) === 100 &&
      count(ww, (r) => f(r, "off_time") > 0) === 2 &&
      count(ww, (r) => f(r, "turn_off_when_stopped") === 1) === 17 &&
      count(allOf(AE, "WorkWheel"), (r) => f(r, "switch_id") === 100 && r.lv.short === "BM") === 1
    );
  },
  ZBall: () => n(allOf(AO, "ZBall")) === 6 && within(allOf(AO, "ZBall"), "F2"),
};

test("every counted claim in the encyclopedia reproduces from the shipped data", () => {
  const info = sanitizeTypeInfo(load("glossary_types.json"));
  for (const [name, holds] of Object.entries(CLAIMS)) {
    assert.ok(name in info, `CLAIMS pins a real entry: ${name}`);
    assert.ok(holds(), `${name}: the entry's counted claim holds`);
  }
});
