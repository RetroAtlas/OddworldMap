import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  AE_MUDOKONS_IN_LEVEL,
  LCD_FLICKER,
  LCD_PALETTES,
  STATS_PALETTE,
  TALLY_ROW,
  advanceOf,
  glyphOf,
  glyphRect,
  lcdIds,
  measureOf,
} from "../../public/js/lcd.js";
import { resolveEffects, resolveRecord } from "../../public/js/motion.js";
import { spriteDraws } from "../../public/js/sprites.js";
import { lcdMessages, objectMessages, setMessages } from "../../public/js/messages.js";
import { armFieldData } from "../../public/js/fields.js";

const pub = (f) => JSON.parse(readFileSync(new URL(`../../public/${f}`, import.meta.url), "utf8"));

// a font on the PS1's own measures: seven-wide letters, a three-pixel gap, a
// ten-pixel space, and buttons eighteen wide
const FONT = (() => {
  const glyphs = Array.from({ length: 157 }, () => [0, 0, 6, 14]);
  glyphs[0] = [0, 0, 3, 0];
  glyphs[1] = [0, 0, 10, 0];
  for (let k = 0; k < 26; k++) {
    glyphs[34 + k] = [9 * (k % 12), 9 + 14 * Math.floor(k / 12), 7, 14];
    glyphs[66 + k] = glyphs[34 + k];
  }
  for (let c = 0x08; c <= 0x13; c++) glyphs[c + 137] = [18 * (c % 6), 72, 18, 14];
  return { sheet: 0, w: 112, h: 109, glyphs };
})();
const TABLE = ["", "AB", "", "C"];
const params = (over = {}) => ({
  x1: 100,
  x2: 300,
  y: 50,
  font: FONT,
  table: TABLE,
  fixed1: 1,
  fixed2: null,
  sw: 0,
  pool: [3, 3],
  ...over,
});
const screen = (game, p, seed = 0) => ({
  anim: null,
  x: p.x1,
  y: p.y + 7,
  scale: 1,
  flip: false,
  flipY: false,
  layer: game === "AO" ? 22 : 24,
  rgb: [127, 127, 127],
  semi: true,
  blend: 0,
  frame: 0,
  frozen: false,
  swap: false,
  cycle: { kind: "brain", brain: "lcd", game, seed, emo: false, p },
  tile: null,
  camAt: null,
});
const set = (dice) => ({ anims: {}, dice, font: FONT });
const flat = (v) => set(new Array(256).fill(v));
const textAt = (r, s, tick) => {
  const fx = resolveEffects(r, s, tick);
  assert.equal(fx.length, 1, `one text effect at ${tick}`);
  assert.equal(fx[0].kind, "text");
  return fx[0];
};

test("lcd: a code's glyph follows the engine's rule, lowercase drawing as capitals", () => {
  assert.deepEqual([0x21, 65, 97, 0xaf].map(glyphOf), [2, 34, 66, 144]);
  assert.deepEqual([0x07, 0x08, 0x13, 0x1f].map(glyphOf), [144, 145, 156, 168]);
  assert.deepEqual([0, 0x06, 0x20, 0xb0, 0xff].map(glyphOf), [-1, -1, -1, -1, -1]);
  assert.deepEqual(glyphRect(FONT, glyphOf(97)), glyphRect(FONT, glyphOf(65)));
  assert.deepEqual(glyphRect(FONT, 168), [0, 0, 0, 0], "past the table draws nothing");
});

test("lcd: the pen moves a glyph's width and the gap, or the space width for what has no glyph", () => {
  assert.equal(advanceOf(FONT, 65), 10);
  assert.equal(advanceOf(FONT, 0x08), 21);
  assert.equal(advanceOf(FONT, 0x20), 10);
  assert.equal(advanceOf(FONT, 0), 10, "the terminator measures as a space");
  assert.equal(advanceOf(FONT, 0x1f), 3, "a code past the table is a gap alone");
});

test("lcd: a board reaches its fixed message, the second under a switch that reads on, and its whole range", () => {
  assert.deepEqual(lcdIds(params({ fixed1: 5, fixed2: 7, sw: 1, pool: [9, 8] })), [7, 8, 9]);
  assert.deepEqual(lcdIds(params({ fixed1: 5, fixed2: 7, sw: 44, pool: [9, 9] })), [5, 9]);
  assert.deepEqual(lcdIds(params({ fixed1: 5, fixed2: null, sw: 1, pool: [0, 0] })), [5, 0]);
});

test("lcd: the message scrolls in on its lead at the game's step, Exoddus three pixels a tick and Oddysee two", () => {
  const ae = screen("AE", params());
  const s = flat(0);
  assert.deepEqual(textAt(ae, s, 1).run, [], "the lead is blank");
  assert.deepEqual(textAt(ae, s, 36).run, []);
  // 31 spaces are 310 pixels: the first letter enters the right edge once the pen has travelled 110
  const [a] = textAt(ae, s, 37).run;
  assert.deepEqual([a.g, a.x], [34, 299]);
  assert.equal(textAt(ae, s, 38).run[0].x, 296);
  const ao = screen("AO", params());
  assert.deepEqual(textAt(ao, s, 55).run, []);
  assert.deepEqual(
    textAt(ao, s, 56).run.map((g) => [g.g, g.x]),
    [[34, 298]],
  );
});

test("lcd: a character is spent once the step has carried it off, so the run stays seamless", () => {
  const r = screen("AE", params());
  const s = flat(0);
  // the A's own 10 pixels follow the lead: the pointer passes it when the pen has travelled 320
  assert.deepEqual(
    textAt(r, s, 106).run.map((g) => [g.g, g.x]),
    [
      [34, 92],
      [35, 102],
    ],
  );
  assert.deepEqual(
    textAt(r, s, 107).run.map((g) => [g.g, g.x]),
    [[35, 99]],
    "B drawn from the pointer, 1 past the edge",
  );
  for (let t = 1; t < 400; t++) {
    const run = textAt(r, s, t).run;
    for (let i = 1; i < run.length; i++) assert.equal(run[i].x - run[i - 1].x, 10, `pitch at ${t}`);
    for (const g of run) assert.ok(g.x < 300 && g.x >= 100 - 10, `inside the panel at ${t}`);
  }
});

test("lcd: at a message's end the random pick follows in the other palette, then the fixed message in the first", () => {
  const r = screen("AE", params());
  const s = flat(0);
  const [green, red] = LCD_PALETTES.AE;
  assert.equal(textAt(r, s, 110).palette, green);
  const e = textAt(r, s, 111);
  assert.equal(e.palette, red, "the end read on the character just stepped onto");
  assert.deepEqual(e.run, [], "the pick opens on its own lead");
  assert.deepEqual(
    textAt(r, s, 111 + 37).run.map((g) => g.g),
    [36],
    "C enters where A did",
  );
  assert.equal(textAt(r, s, 216).palette, red);
  assert.equal(textAt(r, s, 217).palette, green);
  assert.deepEqual(
    textAt(r, s, 217 + 37).run.map((g) => g.g),
    [34],
  );
});

test("lcd: a blank message is spent in one space width and the palettes still alternate", () => {
  const r = screen("AE", params({ fixed1: 0 }));
  const s = flat(0);
  const [green, red] = LCD_PALETTES.AE;
  assert.equal(textAt(r, s, 3).palette, green);
  assert.equal(textAt(r, s, 4).palette, red, "the pick after the blank fixed message");
  assert.equal(textAt(r, s, 111).palette, green, "the blank message again");
  assert.equal(textAt(r, s, 114).palette, red);
});

test("lcd: every glyph's colour is 127 a channel rolled by the flicker, three dice a glyph in order", () => {
  const r = screen("AE", params());
  const low = textAt(r, flat(0), 60).run;
  assert.ok(low.length >= 2);
  for (const g of low)
    assert.deepEqual(g.rgb, [127 - LCD_FLICKER, 127 - LCD_FLICKER, 127 - LCD_FLICKER]);
  const high = textAt(screen("AE", params()), flat(100), 60).run;
  for (const g of high) assert.deepEqual(g.rgb, [177, 177, 177]);
  const counted = textAt(
    screen("AE", params()),
    set(Array.from({ length: 256 }, (_, i) => i)),
    37,
  ).run;
  // the dice are walked from the seed: a tick's first glyph takes the next three
  assert.equal(counted[0].rgb.length, 3);
  assert.equal(counted[0].rgb[1], counted[0].rgb[0] + 1);
  assert.equal(counted[0].rgb[2], counted[0].rgb[0] + 2);
  const twice = screen("AE", params());
  assert.deepEqual(
    textAt(twice, flat(7), 90),
    textAt(screen("AE", params()), flat(7), 90),
    "deterministic",
  );
});

test("lcd: the text effect names the panel and the record resolves no sprite of its own", () => {
  const p = params();
  const r = screen("AE", p);
  const e = textAt(r, flat(0), 5);
  assert.deepEqual([e.x, e.y, e.clip, e.layer], [100, 50, [100, 300], 24]);
  assert.equal(resolveRecord(r, flat(0), 5), null);
});

// the shipped boards
const GAMES = ["AO", "AE"];
const data = {},
  sheets = {};
for (const g of GAMES) {
  const lg = g.toLowerCase();
  armFieldData(g, pub(`field_types_${lg}.json`), pub(`enum_labels_${lg}.json`));
  data[g] = pub(`map_data_${lg}.json`);
  sheets[g] = pub(`sprites_${lg}.json`);
}
setMessages({ AO: pub("messages_ao.json"), AE: pub("messages_ae.json") });
const boards = function* (g) {
  for (const lvl of data[g].levels)
    for (const path of lvl.paths)
      for (const t of path.tlvs)
        if (t.name === "LCDScreen" || t.name === "LCD") yield { lvl, path, t };
};

test("lcd: a shipped board draws one text record on the engine's layer, or nothing when it runs dark", () => {
  for (const g of GAMES) {
    let drawn = 0,
      dark = 0;
    for (const { lvl, path, t } of boards(g)) {
      const recs = spriteDraws(data[g], lvl, path, t, sheets[g]);
      if (recs.length === 0) {
        dark++;
        if (g === "AO") assert.deepEqual(objectMessages(g, t), [], `${g} ${t.x1},${t.y1} dark`);
        continue;
      }
      drawn++;
      assert.equal(recs.length, 1);
      const r = recs[0];
      assert.equal(r.anim, null);
      assert.equal(r.layer, g === "AO" ? 22 : 24);
      assert.equal(r.cycle.brain, "lcd");
      assert.deepEqual([r.cycle.p.x1, r.cycle.p.x2], [t.x1, t.x2]);
      assert.equal(r.cycle.p.y, Math.trunc((t.y1 + t.y2) / 2) - 7);
      if (g === "AO") assert.ok(objectMessages(g, t).length > 0);
      const e = textAt(r, sheets[g], 600);
      assert.ok(LCD_PALETTES[g].includes(e.palette));
      for (const gl of e.run) assert.ok(gl.x < t.x2 && gl.x >= t.x1 - 21, `${g} glyph inside`);
    }
    assert.ok(drawn > 0, `${g} draws boards`);
    // four Mines boards carry text on their second message alone, behind a switch
    // that reads off at a fresh start
    assert.equal(dark, g === "AO" ? 20 : 4, `${g} dark boards`);
  }
});

test("lcd: the Mines board's first letter reaches its right edge on tick 36", () => {
  const mi = data.AE.levels.find((l) => l.short === "MI");
  const p1 = mi.paths.find((p) => p.id === 1);
  const t = p1.tlvs.find((o) => o.name === "LCD" && o.x1 === 1159);
  const [r] = spriteDraws(data.AE, mi, p1, t, sheets.AE);
  assert.equal(lcdMessages("AE")[t.fields.message_1_id][0], "T");
  assert.deepEqual(textAt(r, sheets.AE, 35).run, []);
  const [first] = textAt(r, sheets.AE, 36).run;
  assert.deepEqual([first.g, first.x], [glyphOf(84), 1361]);
});

test("lcd: the raw table is on hand for the painter and null before it lands", () => {
  assert.equal(lcdMessages("AO").length, 90);
  assert.equal(lcdMessages("AE").length, 101);
  assert.equal(lcdMessages("XX"), null);
});

// ---- the tally boards ------------------------------------------------------

const board = (game, p, seed = 0) => ({
  ...screen(game, { ...p, y: p.y1 - 7 }, seed),
  layer: 22,
  cycle: { kind: "brain", brain: "tally", game, seed, emo: false, p },
});
const tally = (over = {}) => ({
  x1: 100,
  y1: 50,
  font: FONT,
  lines: ["99", "00", "00"],
  edge: 22,
  ...over,
});
const GAP = FONT.glyphs[0][2];

test("tally: a string measures every glyph and its gap, a space its own width", () => {
  assert.equal(measureOf(FONT, "AB"), 20);
  assert.equal(measureOf(FONT, " A"), 20);
  assert.equal(measureOf(FONT, ""), 0);
  assert.equal(measureOf(FONT, "\x08"), 21);
});

test("tally: the rows stand right-aligned to the board's edge, one row pitch apart, unclipped", () => {
  const r = board("AO", tally());
  const e = textAt(r, flat(0), 5);
  assert.equal(e.clip, null);
  assert.equal(e.palette, STATS_PALETTE);
  assert.equal(e.run.length, 6);
  // the synthetic digits are 6 wide: "99" measures 18, so the row starts at x1 - 18 + 22
  assert.deepEqual(
    e.run.map((g) => [g.x, g.dy]),
    [
      [104, 0],
      [113, 0],
      [104, TALLY_ROW],
      [113, TALLY_ROW],
      [104, 2 * TALLY_ROW],
      [113, 2 * TALLY_ROW],
    ],
  );
  // the last glyph's right edge is the board's edge less the gap the measure counts after it
  assert.equal(e.run[1].x + glyphRect(FONT, e.run[1].g)[2], 100 + 22 - GAP);
  assert.deepEqual(e.box, [104, 50, 122, 50 + 2 * TALLY_ROW + 14]);
  assert.deepEqual([e.x, e.y], [100, 50]);
  assert.equal(resolveRecord(r, flat(0), 5), null);
});

test("tally: Exoddus pads to three places, a space advancing the pen without a glyph", () => {
  const e = textAt(
    board("AE", tally({ lines: ["  5", " 31", "  0", "  0"], edge: 33 })),
    flat(0),
    1,
  );
  assert.equal(e.run.length, 1 + 2 + 1 + 1);
  for (const g of e.run) assert.equal(g.x + glyphRect(FONT, g.g)[2] <= 100 + 33 - GAP, true);
  assert.equal(e.run[0].x + glyphRect(FONT, e.run[0].g)[2], 100 + 33 - GAP);
  assert.deepEqual(
    e.run.map((g) => g.dy),
    [0, TALLY_ROW, TALLY_ROW, 2 * TALLY_ROW, 3 * TALLY_ROW],
  );
});

test("tally: the flicker rolls three dice a glyph, rows in draw order, afresh each tick", () => {
  const counted = textAt(
    board("AO", tally()),
    set(Array.from({ length: 256 }, (_, i) => i)),
    1,
  ).run;
  assert.deepEqual(counted[0].rgb, [77, 78, 79]);
  assert.deepEqual(counted[1].rgb, [80, 81, 82]);
  const r = board("AO", tally());
  const a = textAt(r, flat(0), 1),
    b = textAt(r, flat(0), 2);
  assert.deepEqual(
    a.run.map((g) => [g.g, g.x, g.dy]),
    b.run.map((g) => [g.g, g.x, g.dy]),
    "the rows stand still",
  );
  for (const g of textAt(board("AO", tally()), flat(100), 1).run)
    assert.deepEqual(g.rgb, [177, 177, 177]);
});

test("tally: the Exoddus level table is the one the relive export carries", () => {
  assert.deepEqual(AE_MUDOKONS_IN_LEVEL, pub("relive_export_ae.json").muds_in_level);
  // the base levels' counts are the game's 300 Mudokons, and an ender id repeats its base's
  const base = [1, 2, 3, 4, 5, 6, 8, 9];
  assert.equal(
    base.reduce((n, id) => n + AE_MUDOKONS_IN_LEVEL[id], 0),
    300,
  );
  assert.deepEqual(
    [7, 10, 11, 12, 13, 14].map((id) => AE_MUDOKONS_IN_LEVEL[id]),
    [4, 9, 3, 5, 6, 8].map((id) => AE_MUDOKONS_IN_LEVEL[id]),
  );
});

const tallies = function* (g) {
  for (const lvl of data[g].levels)
    for (const path of lvl.paths)
      for (const t of path.tlvs) if (t.name === "LCDStatusBoard") yield { lvl, path, t };
};

test("tally: every Oddysee board counts 99 and nothing killed or rescued, but the Stockyards entrance's, where the game kills the unsaved as the screen loads", () => {
  let n = 0;
  for (const { lvl, path, t } of tallies("AO")) {
    const recs = spriteDraws(data.AO, lvl, path, t, sheets.AO);
    assert.equal(recs.length, 1, `${lvl.short} P${path.id} ${t.x1},${t.y1}`);
    const [r] = recs;
    assert.equal(r.layer, 22);
    assert.equal(r.cycle.brain, "tally");
    const exit = lvl.short === "E1" && path.id === 6;
    assert.deepEqual(
      r.cycle.p.lines,
      exit ? ["71", "28", "00"] : ["99", "00", "00"],
      `${lvl.short} P${path.id}`,
    );
    assert.equal(r.cycle.p.edge, 22);
    const e = textAt(r, sheets.AO, 1);
    assert.equal(e.run.length, 6);
    // the shipped digits: a 9 is 7 wide, so the right edge sits 3 short of x1 + 22
    assert.equal(e.run[1].x + sheets.AO.font.glyphs[e.run[1].g][2], t.x1 + 22 - 3);
    assert.deepEqual([e.x, e.y], [t.x1, t.y1]);
    n++;
  }
  assert.equal(n, 29);
});

test("tally: an Exoddus board counts its level's Mudokons and its own area's, and a hidden one draws nothing", () => {
  let drawn = 0,
    hidden = 0,
    demo = 0;
  for (const { lvl, path, t } of tallies("AE")) {
    const recs = spriteDraws(data.AE, lvl, path, t, sheets.AE);
    const onDemo = path.tlvs.some((o) => o.name === "DemoSpawnPoint");
    if (t.fields.hide_board) {
      assert.deepEqual(recs, [], `${lvl.short} P${path.id} hidden`);
      if (!onDemo) hidden++;
      continue;
    }
    if (onDemo) demo++;
    else drawn++;
    const [r] = recs;
    assert.equal(r.layer, 22);
    assert.deepEqual(
      r.cycle.p.lines,
      [AE_MUDOKONS_IN_LEVEL[lvl.id], t.fields.number_of_mudokons, 0, 0].map((v) =>
        String(v).padStart(3, " "),
      ),
    );
    assert.equal(r.cycle.p.edge, 33);
  }
  assert.deepEqual([drawn, hidden], [79, 80]);
  assert.ok(demo > 0);
  const mi = data.AE.levels.find((l) => l.short === "MI");
  const p1 = mi.paths.find((p) => p.id === 1);
  const shown = p1.tlvs.find((o) => o.name === "LCDStatusBoard" && o.x1 === 1283);
  const [r] = spriteDraws(data.AE, mi, p1, shown, sheets.AE);
  assert.deepEqual(r.cycle.p.lines, [" 75", " 31", "  0", "  0"]);
  const e = textAt(r, sheets.AE, 1);
  assert.equal(e.run.length, 2 + 2 + 1 + 1);
  assert.equal(e.run[1].x + sheets.AE.font.glyphs[e.run[1].g][2], 1283 + 33 - 3);
  const anchor = p1.tlvs.find((o) => o.name === "LCDStatusBoard" && o.x1 === 991 && o.y1 === 1445);
  assert.deepEqual(spriteDraws(data.AE, mi, p1, anchor, sheets.AE), []);
});
