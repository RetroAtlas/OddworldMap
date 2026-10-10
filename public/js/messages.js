// What a sign in the world actually says.
//
// The games keep their marquee and hint-swarm text in tables addressed by id,
// which the builder lifts off the discs into messages_{ao,ae}.json; an object
// carries the id and this module resolves the words. objectMessages() is the
// one place that knows how each type picks from its table, so no two surfaces
// can disagree about what a board says.
//
// Leaf module: no DOM/state imports, importable in bare Node for tests.

// The font's button-command code points, as the messages carry them. A code
// outside this set fails the build, so the fallback is for a stale cache
// rather than for missing curation.
const BUTTONS = {
  0x08: "Speak 1",
  0x09: "Speak 2",
  0x0a: "Run",
  0x0b: "Sneak",
  0x0c: "Jump/Hello",
  0x0d: "Action",
  0x0e: "Throw",
  0x0f: "Crouch",
  0x10: "Up",
  0x11: "Down",
  0x12: "Left",
  0x13: "Right",
};

// which table a type reads, and how it picks from it
const READERS = {
  LCDScreen: { table: "lcd", fixed: ["message_1_id"] },
  LCD: {
    table: "lcd",
    fixed: ["message_1_id", "message_2_id"],
    states: ["switch off", "switch on"],
  },
  HintFly: { table: "hintfly", fixed: ["message_id"] },
};

// what an empty result means, for the surfaces that report it
export const DARK_NOTE =
  "Runs dark: every message this board names is blank, so it scrolls nothing.";

let MESSAGES = {};

export function setMessages(byGame) {
  MESSAGES = byGame || {};
}

export const lcdMessages = (game) => MESSAGES[game]?.lcd ?? null;

// a stored message as words: button codes become the command they name
export function messageText(raw) {
  let out = "";
  for (const ch of raw) {
    const code = ch.codePointAt(0);
    out += code < 0x20 ? `[${BUTTONS[code] ?? "?"}]` : ch;
  }
  return out;
}

// every message an object can show, in the order it shows them, as
// { text, note } where a note qualifies a line the text alone cannot explain.
// `[]` is the positive claim that the board can only run dark; anything that
// leaves the question unanswered is null, so a caller never reports darkness
// it has not established.
export function objectMessages(game, t) {
  const reader = READERS[t.name];
  if (!reader) return null;
  const table = MESSAGES[game]?.[reader.table];
  if (!table) return null;
  const f = t.fields || {};
  const picks = [];
  // the engine hardwires switch ids 0 and 1 to never and always, so a board on
  // one of those has no second state for its line to be told apart from
  const toggles = (f.toggle_message_switch_id ?? 0) > 1;
  for (const [i, key] of reader.fixed.entries())
    if (key in f) picks.push([f[key], toggles ? (reader.states?.[i] ?? "") : ""]);
  // the range is inclusive of both ends and the engine sorts a reversed pair
  const lo = f.random_message_min_id,
    hi = f.random_message_max_id;
  if (lo != null && hi != null) {
    const [from, to] = lo <= hi ? [lo, hi] : [hi, lo];
    const note = to > from ? "at random" : "";
    for (let id = from; id <= to; id++) picks.push([id, note]);
  }
  const out = [];
  const seen = new Set();
  for (const [id, note] of picks) {
    const raw = table[id];
    if (!raw || seen.has(id)) continue;
    seen.add(id);
    out.push({ text: messageText(raw), note });
  }
  // a pool that survives as one line is not a draw between anything
  const pool = out.filter((m) => m.note === "at random");
  if (pool.length === 1) pool[0].note = "";
  return out;
}
