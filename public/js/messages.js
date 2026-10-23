// What a sign in the world actually says.
//
// The games keep their marquee and hint-swarm text in tables addressed by id,
// which the builder lifts off the discs into messages_{ao,ae}.json, a release
// carrying its own tables where they differ; an object carries the id and this
// module resolves the words. objectMessages() is the one place that knows how
// each type picks from its table, so no two surfaces can disagree about what a
// board says.
//
// No DOM/state imports, importable in bare Node for tests.

import { glyphRun } from "./lcd.js";

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

// a release whose code page the map cannot read yet shows this in place of its words
export const unreadNote = (language) => `In ${language}, which the map cannot read yet.`;

// the high half of the code pages a release's messages may read through, the
// low half being ASCII's
const CODE_PAGES = {
  cp437:
    "ÇüéâäàåçêëèïîìÄÅÉæÆôöòûùÿÖÜ¢£¥₧ƒáíóúñÑªº¿⌐¬½¼¡«»░▒▓│┤╡╢╖╕╣║╗╝╜╛┐└┴┬├─┼╞╟╚╔╩╦╠═╬╧╨╤╥╙╘╒╓╫╪┘┌█▄▌▐▀αßΓπΣσµτΦΘΩδ∞φε∩≡±≥≤⌠⌡÷≈°∙·√ⁿ²■\u00a0",
};

let MESSAGES = {};

export function setMessages(byGame) {
  MESSAGES = byGame || {};
}

// a dataset's tables: its game's, a release's own over them, and the entries
// the overlay a path loads says otherwise over those
const releaseTables = new WeakMap();
function tablesOf(G, P) {
  const base = MESSAGES[G.id];
  if (!base || !G.release) return base ?? null;
  let own = releaseTables.get(G);
  if (!own) releaseTables.set(G, (own = { ...base, ...G.release.messages }));
  const per = P?.release?.messages;
  if (!per) return own;
  const out = { ...own };
  for (const [name, entries] of Object.entries(per)) {
    out[name] = [...out[name]];
    for (const [i, msg] of Object.entries(entries)) out[name][+i] = msg;
  }
  return out;
}

export const lcdMessages = (G, P = null) => tablesOf(G, P)?.lcd ?? null;

// the engine spells a hint fly's message with the letter its code less this names
const HINT_FIRST = 0x41;

// a message of a release whose code page is its own as the characters it names:
// an LCD message's for the glyphs its font draws, a hint fly's for its letters
function ownText(raw, release, table) {
  const chars = release.chars?.[table] ?? [];
  if (table === "hintfly")
    return [...raw]
      .map((ch) => (ch === " " ? ch : (chars[ch.charCodeAt(0) - HINT_FIRST] ?? "\ufffd")))
      .join("");
  return glyphRun(release.font, raw)
    .map((g) => (g < 0 ? " " : (chars[g] ?? "\ufffd")))
    .join("");
}

// a stored message as words, read through its code page: button codes become
// the command they name
export function messageText(raw, page = "cp437") {
  const high = CODE_PAGES[page];
  let out = "";
  for (const ch of raw) {
    const code = ch.codePointAt(0);
    out +=
      code < 0x20 ? `[${BUTTONS[code] ?? "?"}]` : code >= 0x80 && high ? high[code - 0x80] : ch;
  }
  return out;
}

// every message an object can show, in the order it shows them, as
// { text, note } where a note qualifies a line the text alone cannot explain,
// and one line of no text whose note says so where the release's code page is
// none the map reads. `[]` is the positive claim that the board can only run
// dark; anything that leaves the question unanswered is null, so a caller never
// reports darkness it has not established.
export function objectMessages(G, t, P = null) {
  const reader = READERS[t.name];
  if (!reader) return null;
  const table = tablesOf(G, P)?.[reader.table];
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
  const page = G.release ? G.release.code_page : "cp437";
  const read = (raw) =>
    page === "own"
      ? messageText(ownText(raw, G.release, reader.table), null)
      : messageText(raw, page);
  const out = [];
  const seen = new Set();
  for (const [id, note] of picks) {
    const raw = table[id];
    if (!raw || seen.has(id)) continue;
    seen.add(id);
    out.push({ text: read(raw), note });
  }
  if (!page && out.length) return [{ text: null, note: unreadNote(G.release.language) }];
  // a pool that survives as one line is not a draw between anything
  const pool = out.filter((m) => m.note === "at random");
  if (pool.length === 1) pool[0].note = "";
  return out;
}
