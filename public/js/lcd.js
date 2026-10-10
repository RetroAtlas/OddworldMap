// The LCD screens and the Mudokon tally boards: what the game writes in the
// font off the disc. A port of the LCDScreen and LCDStatusBoard update and
// render as the PS1 overlays run them rather than as the decomp has them, its
// numbers being the PC build's: a screen's pen steps a fixed count of pixels a
// tick, a character is spent once the step has carried it off and the
// message's end hands over to the next; a board writes its counts right-aligned
// a row at a time; and the render rolls every glyph's colour afresh each frame.
// No DOM, so it stays importable in bare Node.

import { BRAINS, STARTS, randomRange, switchGet } from "./patrolkit.js";

// every message opens on this many spaces, which the sidecar leaves out
export const LCD_LEAD = 31;
// pixels a tick
export const LCD_SPEED = { AO: 2, AE: 3 };
// a glyph's colour is 127 a channel, each rolled this far either way every frame
export const LCD_FLICKER = 50;
// the two palettes a screen alternates at every message's end, RGB555 with index
// 0 clear: the first draws the letters green, the second red
export const LCD_PALETTES = {
  AO: [
    [
      0x0000, 0x8001, 0x8401, 0x8420, 0x8021, 0x8420, 0x8421, 0xce65, 0xe739, 0xb18c, 0x8e60,
      0xce64, 0xce65, 0x98d7, 0xa114, 0xd818,
    ],
    [
      0x0000, 0x8001, 0x8401, 0x8420, 0x8021, 0x8420, 0x8421, 0x8405, 0xe739, 0xb18c, 0x9413,
      0xce64, 0xce65, 0x98d7, 0xa114, 0xd818,
    ],
  ],
  AE: [
    [
      0x0000, 0x8001, 0x8401, 0x8420, 0x8021, 0x8420, 0x8421, 0xce65, 0x8c65, 0xb18c, 0x8e60,
      0xce64, 0xce65, 0x98d7, 0xa114, 0xd818,
    ],
    [
      0x0000, 0x8001, 0x8401, 0x8420, 0x8021, 0x8420, 0x8421, 0x8405, 0x8c65, 0xb18c, 0x9413,
      0xce64, 0xce65, 0x98d7, 0xa114, 0xd818,
    ],
  ],
};
// the tally boards' palette, one for both games, its letters red
export const STATS_PALETTE = [
  0x0000, 0x8001, 0x8401, 0x8420, 0x8021, 0x8420, 0x8421, 0xce65, 0x8c65, 0xb18c, 0x9413, 0xce64,
  0xce65, 0x98d7, 0xa114, 0xd818,
];
// what a board counts down from: Oddysee's one total, the literal its render
// subtracts the counters from, and Exoddus's Mudokons per level by level id,
// the table every overlay that links the board carries, an ender id holding
// its base level's count
export const AO_MUDOKONS = 99;
export const AE_MUDOKONS_IN_LEVEL = [0, 75, 10, 5, 14, 26, 49, 14, 31, 90, 90, 5, 26, 49, 31];
// a board's rows sit this far apart and end this far right of its corner
export const TALLY_ROW = 16;
export const TALLY_EDGE = { AO: 22, AE: 33 };
const NO_GLYPH = [0, 0, 0, 0];

// a code point's glyph: a printable counts from 31 below it, a button code from
// 137 above; anything else has none
export function glyphOf(code) {
  if (code >= 0x21 && code <= 0xaf) return code - 31;
  if (code >= 0x07 && code <= 0x1f) return code + 137;
  return -1;
}
// a glyph's [x, y, w, h] on the font's texture; one past the table draws nothing
export const glyphRect = (font, g) => font.glyphs[g] ?? NO_GLYPH;
// how far the pen moves past a code: the glyph's width and the gap, or the space
export function advanceOf(font, code) {
  const g = glyphOf(code);
  return g < 0 ? font.glyphs[1][2] : glyphRect(font, g)[2] + font.glyphs[0][2];
}
// a string's width as the engine measures one, the gap after every glyph counted
export function measureOf(font, text) {
  let w = 0;
  for (let i = 0; i < text.length; i++) w += advanceOf(font, text.charCodeAt(i));
  return w;
}
const fontTall = (font) => Math.max(...font.glyphs.map((g) => g[3]));

const flicker = (st, rnd) =>
  [0, 0, 0].map(() => 127 + randomRange(st, rnd, -LCD_FLICKER, LCD_FLICKER));

const fixedId = (p, st) => (p.fixed2 !== null && switchGet(st, p.sw) ? p.fixed2 : p.fixed1);

// every message id a board reaches at a fresh start
export function lcdIds(p) {
  const ids = [fixedId(p, { sw: {} })];
  const [a, b] = p.pool;
  for (let id = Math.min(a, b); id <= Math.max(a, b); id++) ids.push(id);
  return ids;
}

function show(st, id) {
  const raw = st.p.table[id] ?? "";
  st.msg = raw ? " ".repeat(LCD_LEAD) + raw : "";
  st.pos = 0;
  st.cw = advanceOf(st.p.font, st.msg.charCodeAt(0) || 0);
}

STARTS.lcd = (st) => {
  st.xo = 0;
  st.n = 0;
  st.pal = 0;
  show(st, fixedId(st.p, st));
};

BRAINS.lcd = (st, now, rnd) => {
  const p = st.p;
  st.xo += LCD_SPEED[st.game];
  if (st.xo > st.cw) {
    st.xo -= st.cw;
    st.pos++;
    if (st.pos >= st.msg.length) {
      st.n++;
      let id;
      if (st.n === 1) id = randomRange(st, rnd, p.pool[0], p.pool[1]);
      else {
        st.n = 0;
        id = fixedId(p, st);
      }
      show(st, id);
      st.pal ^= 1;
    } else st.cw = advanceOf(p.font, st.msg.charCodeAt(st.pos));
  }
  const run = [];
  let x = p.x1 - st.xo;
  for (let i = st.pos; i < st.msg.length && x < p.x2; i++) {
    const g = glyphOf(st.msg.charCodeAt(i));
    if (g < 0) {
      x += p.font.glyphs[1][2];
      continue;
    }
    run.push({ g, x, dy: 0, rgb: flicker(st, rnd) });
    x += glyphRect(p.font, g)[2] + p.font.glyphs[0][2];
  }
  st.text = {
    kind: "text",
    x: p.x1,
    y: p.y,
    clip: [p.x1, p.x2],
    box: [p.x1, p.y, p.x2 + 1, p.y + fontTall(p.font)],
    palette: LCD_PALETTES[st.game][st.pal],
    run,
  };
};

STARTS.tally = (st) => {
  const { x1, y1, font, lines, edge } = st.p;
  st.rows = [];
  let left = x1 + edge;
  lines.forEach((text, row) => {
    let x = x1 - measureOf(font, text) + edge;
    left = Math.min(left, x);
    for (let i = 0; i < text.length; i++) {
      const g = glyphOf(text.charCodeAt(i));
      if (g >= 0) st.rows.push({ g, x, dy: row * TALLY_ROW });
      x += advanceOf(font, text.charCodeAt(i));
    }
  });
  st.box = [left, y1, x1 + edge, y1 + (lines.length - 1) * TALLY_ROW + fontTall(font)];
};

BRAINS.tally = (st, now, rnd) => {
  const p = st.p;
  st.text = {
    kind: "text",
    x: p.x1,
    y: p.y1,
    clip: null,
    box: st.box,
    palette: STATS_PALETTE,
    run: st.rows.map((r) => ({ ...r, rgb: flicker(st, rnd) })),
  };
};
