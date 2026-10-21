// What object fields to show, and how to render them.
//
// The builder ships every field of a gameplay object raw in `t.fields`; this
// module owns which ones show, maps enum ints to text and gives a bare int the
// unit it is measured in. The one indirection — visibleFields() — is what
// "default", "show more", and the picker all resolve through, so callers never
// change.
//
// Leaf module: no DOM/state imports, importable in bare Node for tests.

import { LOGIC_FPS } from "./config.js";
import { fieldUnit, glossaryProse } from "./glossary.js";

// shown by default for any type that carries it: a signal dozens of unrelated
// types across every group share. A field only one type or one creature
// family carries belongs in DEFAULT_BY_TYPE instead.
export const GLOBAL_DEFAULT = new Set([
  "start_state", // AI state / door lock / hazard on-off — resolved per owning type
]);

// per-type notable fields on top of the globals: what distinguishes one
// placement of the type from the next. Keyed by type name; a field the game's
// copy of the type doesn't carry is simply skipped, so AO-only and AE-only
// fields coexist here (a Mudokon has job in AO, state in AE).
export const DEFAULT_BY_TYPE = {
  // creatures / enemies
  Bat: ["speed"],
  BeeSwarmHole: ["movement_type"],
  Bees: ["swarm_size"],
  CrawlingSlig: ["respawn_on_death", "state"],
  Fleech: ["asleep", "hanging"],
  Glukkon: ["glukkon_type"],
  Greeter: ["start_direction"],
  Mudokon: ["blind", "deaf", "emotion", "job", "state"],
  Paramite: ["enter_from_web", "entrance_type"],
  Scrab: ["patrol_type", "patrol_type_run_or_walk_chance"],
  Slig: ["chase_abe_when_spotted", "shoot_on_sight_delay"],
  SligBoundLeft: ["slig_bound_persist_id", "slig_id"],
  SligBoundRight: ["slig_bound_persist_id", "slig_id"],
  SligGetPants: ["chase_abe_when_spotted", "shoot_on_sight_delay"],
  SligPersist: ["slig_bound_persist_id", "slig_id"],
  SligSpawner: ["chase_abe_when_spotted", "shoot_on_sight_delay"],
  Slog: ["asleep"],
  SlogSpawner: ["max_slogs", "max_slogs_at_a_time"],
  SlurgSpawner: ["max_slurgs"],
  // doors & travel
  BirdPortal: ["enter_side", "mudokon_amount_for_shrykull"],
  BirdPortalExit: ["exit_direction"],
  Door: ["door_closed", "door_type"],
  ElumPathTrans: ["level", "path"],
  PathTransition: ["camera"],
  SlamDoor: ["delete", "start_shut"],
  TrapDoor: ["self_closing"],
  // hazards
  Drill: ["behavior", "speed", "start_direction"],
  FallingItem: ["fall_interval"],
  GasCountdown: ["gas_countdown_time"],
  GasEmitter: ["colour"],
  MeatSaw: ["speed", "type"],
  MovingBomb: ["speed"],
  MovingBombStopper: ["max_delay", "min_delay"],
  RollingBall: ["roll_direction"],
  RollingBallStopper: ["direction"],
  TimedMine: ["ticks_before_explosion"],
  UXB: ["pattern", "pattern_length"],
  // switches & logic
  EnemyStopper: ["stop_direction"],
  FootSwitch: ["action", "triggered_by"],
  InvisibleSwitch: ["action", "delay", "scale", "set_off_alarm"],
  Lever: ["action"],
  MovieHandStone: ["movie_number"],
  MultiSwitchController: ["action", "on_off_delay"],
  PullRingRope: ["action"],
  ResetPath: ["from", "path", "to"],
  ResetSwitchRange: ["end_switch_id", "reset_switches", "start_switch_id"],
  Switch: ["action"],
  TimerTrigger: ["trigger_interval"],
  WheelSyncer: ["output_requirement"],
  WorkWheel: ["activation_time", "turn_off_when_stopped"],
  // lifts & mechanisms
  Edge: ["can_grab", "grab_direction"],
  Hoist: ["hoist_type"],
  LiftMover: ["move_direction", "target_lift_point_id"],
  LiftMudokon: ["lift_switch_id"],
  LiftPoint: ["lift_point_id", "lift_point_stop_type", "start_point"],
  ZBall: ["start_position"],
  // mudokons & temple
  BellSongStone: ["code_1", "code_2", "type"],
  ChimeLock: ["code_1", "code_2"],
  ContinuePoint: ["elum_restarts"],
  RingMudokon: ["action", "code_1", "code_2", "give_password"],
  SecurityDoor: ["code_1", "code_2"],
  SlingMudokon: ["code_1", "code_2"],
  // info & scenery
  Alarm: ["duration"],
  BackgroundAnimation: ["animation_id"],
  CrawlingSligButton: ["action"],
  Dove: ["dove_count"],
  HintFly: ["message_id"],
  LCDStatusBoard: ["hide_board", "number_of_mudokons", "zulag_number"],
  LightEffect: ["type"],
  MusicTrigger: ["music_type", "triggered_by"],
  ShadowZone: ["b", "g", "r", "scale"],
  SlapLock: ["give_invisibility_power_up", "has_ghost"],
  // machines & sacks
  BoneBag: ["bone_amount"],
  BoomMachine: ["number_of_grenades"],
  BrewMachine: ["brew_count"],
  ColourfulMeter: ["number_of_meter_bars", "start_filled"],
  MeatSack: ["amount_of_meat"],
  RockSack: ["rock_amount"],
};

export function defaultVisible(typeName) {
  const scoped = DEFAULT_BY_TYPE[typeName];
  return scoped ? new Set([...GLOBAL_DEFAULT, ...scoped]) : GLOBAL_DEFAULT;
}

// fields whose 0 means "absent" (no switch wired, flag not set) — hide it. But
// never hide a meaningful 0: shoot_on_sight_delay=0 (shoots on sight) and
// asleep=0 (awake) are real state.
export const HIDE_WHEN_ZERO = new Set([
  "switch_id",
  "rescue_switch_id",
  "angry_switch_id",
  "anger_switch_id",
  "slig_spawner_switch_id",
  "deaf",
  "blind",
  "alarm_switch_id",
  "id_1",
  "id_2",
  "id_3",
  "id_4",
  "id_5",
  "lift_point_id",
  "output_switch_id_1",
  "output_switch_id_2",
  "output_switch_id_3",
  "output_switch_id_4",
  "panic_switch_id",
  "set_off_alarm",
  "spawn_switch_id",
  "surprise_web_switch_id",
  "toggle_message_switch_id",
  "toggle_switch_id",
  "trigger_switch_id",
]);

// fields the engine reads only when a sibling says so: the type carries the word
// for every placement, so the value alone can't say whether anything reads it.
// Keyed "Type.field", asked of the whole TLV — false hides it as dead data.
export const LIVE_WHEN = {
  "BirdPortal.mudokon_amount_for_shrykull": (t) => t.extra?.portal === "shrykull",
  "ResetSwitchRange.end_switch_id": (t) => t.fields?.reset_switches === 1,
  "ResetSwitchRange.skip_switch_id": (t) => t.fields?.reset_switches === 1,
  "ResetSwitchRange.start_switch_id": (t) => t.fields?.reset_switches === 1,
};

// value-type transforms the viewer owns (semantic, not decomp labels), keyed by
// the field's game type; a hand entry here wins over the generated enum labels.
const CHOICE = { 0: false, 1: true };
const SCALE = { 0: "full", 1: "half" };
export const TRANSFORM = {
  Choice_short: CHOICE,
  Choice_int: CHOICE,
  Scale_short: SCALE,
  Scale_int: SCALE,
};

// how a bare-int value reads once the glossary says what it measures. The
// vocabulary is closed: a unit with no entry here leaves the value raw.
// A number is bound to its unit word with a non-breaking space, since the
// surfaces lay field pairs out as flowing text and a value broken across lines
// reads as a second field. The derived reading stays breakable, being long
// enough that forcing it onto one line would overflow the sidebar instead.
export const UNITS = {
  frames: (n, hz = LOGIC_FPS) => {
    // a frame count cannot run backwards, so a negative one is the payload being
    // read at the wrong signedness and the value is not ours to build a reading on
    if (!(n >= 0)) return n;
    // a stored frame count keeps its exact value and gains the reading; the
    // second is dropped where it rounds away, rather than saying "0s"
    const s = Math.round((n / hz) * 10) / 10;
    return `${n}\u00a0${Math.abs(n) === 1 ? "frame" : "frames"}${s ? ` ≈ ${s}s` : ""}`;
  },
  grid: (n) => `${n}\u00a0grid`,
  percent: (n) => `${n}%`,
  seconds: (n) => `${n}s`,
};

// per game, the clock its dataset in hand runs at, a release's own where it is one
const FRAME_RATE = {};
export const setFrameRate = (game, hz) => {
  FRAME_RATE[game] = hz;
};
const frameRate = (game) => FRAME_RATE[game] ?? LOGIC_FPS;
const RATE_WORDS = { 25: "twenty-five", 30: "thirty" };

// the one unit whose reading is derived rather than stored, so the one that
// owes the reader its factor
export const unitNote = (game, type, key) =>
  fieldUnit(type, key, fieldType(game, type, key)) === "frames"
    ? `The engine counts ${RATE_WORDS[frameRate(game)] ?? frameRate(game)} frames to the second.`
    : null;

// object -> field -> game type, and the generated enum labels (type -> value ->
// text), both per game; the boot loads the sidecars and hands them over. Empty
// until then, so prettify degrades to raw (bare tests).
let FIELD_TYPES = {};
let ENUM_LABELS = {};
export function setFieldTypes(byGame) {
  FIELD_TYPES = byGame || {};
}
export function setEnumLabels(byGame) {
  ENUM_LABELS = byGame || {};
}
// one game's tables ahead of the full set: a stored delta is validated when its
// dataset lands, which can precede the boot's own fetch of the pair
export function armFieldData(game, fieldTypes, enumLabels) {
  FIELD_TYPES[game] = fieldTypes || {};
  ENUM_LABELS[game] = enumLabels || {};
}

// a field's decomp game type, or undefined for a bare int
export const fieldType = (game, type, key) => FIELD_TYPES[game]?.[type]?.[key];

// the map a field's values read through: the viewer's own transform for a value
// type, else the generated enum labels; null for a bare int or a type no label covers
export const valueMap = (game, type, key) => {
  const t = fieldType(game, type, key);
  return (t && (TRANSFORM[t] ?? ENUM_LABELS[game]?.[t])) || null;
};

// a transform entry against a value: a lookup map, or a function for open-ended
// ranges. A miss (no entry, or value the map omits) yields undefined, so prettify
// falls back to the raw value.
export const resolve = (entry, value) =>
  entry == null ? undefined : typeof entry === "function" ? entry(value) : entry[value];

// a value's text: its label where the field's game type carries one, else its
// unit where the glossary names one, else the raw int
export const prettify = (game, type, key, value) => {
  const label = resolve(valueMap(game, type, key), value);
  if (label != null) return label;
  const unit = fieldUnit(type, key, fieldType(game, type, key));
  return (
    (unit === "frames" ? UNITS.frames(value, frameRate(game)) : resolve(UNITS[unit], value)) ??
    value
  );
};

// a "what is this field" for the tooltip: the curated glossary prose plus the
// field's full value list where it's an enum/Choice/Scale, or the frame rate
// where it's a timer. null when no prose is curated — the display affordance
// means "there's an explanation here".
export const fieldHelp = (game, type, key, { unitNote: withNote = true } = {}) => {
  const prose = glossaryProse(type, key, fieldType(game, type, key));
  if (!prose) return null;
  const map = valueMap(game, type, key);
  if (map && typeof map === "object") {
    const vals = Object.entries(map)
      .sort((a, b) => a[0] - b[0])
      .map(([v, label]) => `${v} = ${label}`)
      .join(", ");
    if (vals) return `${prose}\nValues: ${vals}`;
  }
  const note = withNote && unitNote(game, type, key);
  return note ? `${prose}\n${note}` : prose;
};

// whether an object sits on the half-scale background plane. scale's raw value
// doesn't mean one plane across types: most read 0 = full / 1 = half, but the
// per-object scale enums differ and some invert it (InvisibleSwitch/GlukkonSwitch
// read 1 = full), so resolve it through the field's game type; a bare-int scale
// the schema left untyped follows the plain 1 = half.
export function onBackgroundPlane(game, t) {
  const scale = t.fields?.scale;
  if (scale == null) return false;
  const label = resolve(valueMap(game, t.name, "scale"), scale);
  return label ? /^half\b/.test(label) : scale === 1;
}

// the field keys to display for a type, given the user's prefs — the "all"
// sentinel or a Set. The one indirection point for the display policy:
//   "all"   -> every field
//   "more"  -> the per-type picks, or the defaults until this type is picked
//              (an explicit empty pick means "show nothing")
//   default -> the type's default set
export function visibleFields(typeName, prefs) {
  const mode = prefs && prefs.mode;
  if (mode === "all") return "all";
  if (mode === "more") {
    const picks = prefs.byType && prefs.byType[typeName];
    return picks ? new Set(picks) : defaultVisible(typeName);
  }
  return defaultVisible(typeName);
}

// [key, displayValue] pairs for a TLV: the semantic nav fields (extra) always,
// then the raw fields the policy admits — prettified, or left as ints when
// prefs.raw is set (a formatting choice; zero-hiding still applies).
export function fieldEntries(t, prefs) {
  const out = [];
  for (const [k, v] of Object.entries(t.extra || {})) if (v !== null && v !== "") out.push([k, v]);
  const show = visibleFields(t.name, prefs);
  if (t.fields)
    for (const [k, v] of Object.entries(t.fields).sort(([a], [b]) => a.localeCompare(b))) {
      if (show !== "all" && !show.has(k)) continue;
      if (v === 0 && HIDE_WHEN_ZERO.has(k)) continue;
      const live = LIVE_WHEN[`${t.name}.${k}`];
      if (live && !live(t)) continue;
      out.push([k, prefs && prefs.raw ? v : prettify(prefs && prefs.game, t.name, k, v)]);
    }
  return out;
}
