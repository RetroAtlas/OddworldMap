import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  advance,
  brainAt,
  resetScene,
  resolveEffects,
  setChanted,
} from "../../public/js/engine/motion.js";
import { creature } from "./creatures.js";

const load = (name) =>
  JSON.parse(readFileSync(new URL(`../../public/${name}`, import.meta.url), "utf8"));

// the game's own dice and the flies' own animation, with the flies' cursor
// where the overlays start it, so a run is the PlayStation's own
const sprites = load("sprites_ao.json");
const set = { anims: { HintFly: sprites.anims.HintFly }, dice: sprites.dice };
const AT = [180, 120];
const AO = load("messages_ao.json");
// a release whose words are laid out and held by numbers of its own
const JP = load("release_ao_jp.json").messages;
const dotsOf = (tables, ch) =>
  tables.alphabet[ch.charCodeAt(0) - 0x41].match(/../g).map((dot) => parseInt(dot, 16));
const wordsOf = (tables, id) =>
  tables.hintfly[id].split(" ").map((word) => [...word].map((ch) => dotsOf(tables, ch)));
// a hint with a message's words, or none, at a point of the screen whose corner is given,
// its cursors from a seed, spelling by the tables it is given
const hint = (id = null, at = AT, screen = [0, 0], seed = 37, tables = AO) => ({
  ...creature(
    null,
    "hintfly",
    { screen, words: id === null ? [] : wordsOf(tables, id), spelling: tables.spelling },
    seed,
  ),
  x: at[0],
  y: at[1],
});
// each sprite's corner about the hint's point, in fly order
const corners = (r, tick) =>
  resolveEffects(r, set, tick)
    .map((f) => `${f.x - r.x},${f.y - r.y}`)
    .join(" ");

test("hintfly: twenty flies loop about the hint's point where the PlayStation puts them", () => {
  const r = hint();
  assert.equal(
    corners(r, 1),
    "1,5 -20,13 -12,-10 -11,8 7,-6 9,12 10,-5 19,13 0,2 -18,15 -4,6 -15,-3 17,10 -2,8 11,5 -2,8 -1,-4 -8,-14 4,12 -14,-10",
  );
  assert.equal(
    corners(r, 64),
    "0,-2 0,5 -16,-10 -25,2 18,-12 -19,8 -19,-5 15,13 2,4 -23,7 18,3 -11,-4 -7,4 -31,9 15,4 27,9 -10,2 -9,-12 9,23 -31,-12",
  );
  assert.equal(
    corners(r, 300),
    "1,-2 -8,4 -11,-9 -23,2 18,-11 -13,6 -16,-2 21,13 -1,1 -37,7 14,-3 -16,-3 0,2 -28,6 10,6 22,12 -11,2 -7,-15 1,22 -30,-12",
  );
});

test("hintfly: a fly past its screen's left or top edge is cut toward the screen's corner", () => {
  // the hint six across and four down from the corner of a screen far into its path
  const r = hint(null, [5126, 964], [5120, 960]);
  assert.equal(
    corners(r, 1),
    "1,5 -19,13 -11,-9 -11,8 7,-5 9,12 10,-4 19,13 0,2 -17,15 -4,6 -14,-3 17,10 -2,8 11,5 -2,8 -1,-4 -7,-13 4,12 -13,-9",
  );
  assert.equal(
    corners(r, 64),
    "0,-2 0,5 -16,-10 -24,2 18,-11 -18,8 -18,-4 15,13 2,4 -22,7 18,3 -11,-4 -6,4 -30,9 15,4 27,9 -9,2 -9,-12 9,23 -30,-11",
  );
  assert.equal(
    corners(r, 300),
    "1,-2 -7,4 -10,-8 -22,2 18,-10 -12,6 -15,-2 21,13 -1,1 -36,7 14,-3 -15,-3 0,2 -27,6 10,6 22,12 -10,2 -6,-14 1,22 -29,-11",
  );
});

test("hintfly: every fly is a bare sprite on the frame its hint's animation stands on", () => {
  const r = hint();
  const frames = { 1: 0, 2: 0, 3: 1, 12: 5, 14: 6, 24: 11, 25: 0 };
  for (const [tick, frame] of Object.entries(frames)) {
    const flies = resolveEffects(r, set, +tick);
    assert.equal(flies.length, 20);
    for (const f of flies)
      assert.deepEqual(
        [f.name, f.frame, f.bare, f.layer, f.blend, f.scale, f.rgb, f.cam],
        ["HintFly", frame, true, 39, 1, 1, [128, 128, 128], null],
        `tick ${tick}`,
      );
  }
});

// a run of the scene's clock with the chant coming on and going off at the
// steps given: the hint's states and fly counts by the ticks each lasts, the
// steps its words form on, a sum over every corner of every tick, another over
// the two dice cursors after every tick, where they end, and the corners at the
// ticks asked for
let clock = 0;
function run(r, ticks, flips, shots = []) {
  setChanted([]);
  resetScene();
  const out = { line: [], words: [], sum: 0, rolls: 0, shots: {} };
  let was = 1;
  for (let T = 1; T <= ticks; T++) {
    // a flip is heard from the step after its tick
    if (flips.includes(T)) setChanted(flips.indexOf(T) % 2 ? [] : [r]);
    assert.equal(advance(++clock * (1000 / 30) + 1), 1);
    const st = brainAt(r, set, T).state;
    const key = `${st.sub}:${st.count}`;
    if (out.line.at(-1)?.[0] === key) out.line.at(-1)[1]++;
    else out.line.push([key, 1]);
    if (st.sub === 4 && was === 2) out.words.push(T);
    was = st.sub;
    st.fx.forEach((f, i) => {
      const x = (f.x - r.x) & 0xffff,
        y = (f.y - r.y) & 0xffff;
      out.sum = (out.sum * 31 + x * 7 + y + i) % 2 ** 32;
    });
    out.rolls = (out.rolls * 31 + (st.seed2 & 255) * 256 + (st.seed & 255)) % 2 ** 32;
    if (shots.includes(T)) out.shots[T] = corners(r, T);
    if (T === ticks) Object.assign(out, { own: st.seed2 & 255, dice: st.seed & 255 });
  }
  out.line = out.line.map(([key, n]) => `${key}x${n}`).join(" ");
  return out;
}

test("hintfly: a chant spells the message a word at a time, as the PlayStation steps it", () => {
  // DROP IN: sixteen ticks of pause, the swarm grown eight flies a tick to the
  // word's and twelve more, the word held thirty-one, and so to the next
  const got = run(hint(10), 150, [10], [54, 120]);
  assert.equal(
    got.line,
    "1:20x9 3:20x16 2:20x1 2:28x1 2:36x1 2:44x1 2:52x1 2:60x1 2:68x1 2:76x1 2:84x1 2:92x1 2:100x1 4:105x31 3:105x16 2:105x1 2:97x1 2:89x1 2:81x1 2:73x1 2:65x1 2:57x1 4:54x31 5:54x21 5:46x1 5:38x1 5:30x1 5:22x1 1:20x1 3:20x3",
  );
  assert.deepEqual(got.words, [37, 91]);
  assert.equal(
    got.shots[54],
    "-32,-8 -32,-6 -33,-5 -32,-3 -32,-1 -32,0 -32,2 -32,3 -30,-8 -30,4 -29,-8 -29,3 -27,-8 -27,3 -25,-8 -25,3 -24,-8 -24,3 -22,-7 -22,3 -21,-5 -21,-4 -21,-2 -21,-1 -21,1 -16,-8 -16,-6 -16,-5 -16,-3 -16,-1 -16,0 -16,2 -16,4 -15,-2 -15,-9 -13,-2 -13,-7 -12,-2 -11,-8 -10,-2 -9,-8 -9,-2 -8,-8 -7,-3 -6,-2 -6,-7 -6,0 -5,-5 -5,-4 -5,2 -5,3 1,-5 0,-3 0,-1 0,0 1,-6 1,2 3,-8 3,3 5,-8 4,3 8,-8 7,3 8,-7 8,3 10,-6 10,2 11,-4 11,-3 11,-1 12,-1 16,-8 16,-6 16,-5 16,-3 16,-1 16,0 16,2 16,3 17,-2 18,-8 19,-2 19,-8 20,-2 21,-8 22,-2 23,-8 23,-2 24,-8 25,-3 25,-7 27,-5 27,-4 -5,12 -14,-2 5,-13 -18,15 22,13 1,-4 1,-3 -9,-18 -1,-13 -10,1 -8,6 1,8",
    "DROP stands on its dots",
  );
  assert.equal(
    got.shots[120],
    "-16,-8 -15,3 -13,-7 -14,3 -13,-8 -12,3 -11,-8 -10,-6 -10,-5 -10,-3 -10,-1 -10,0 -10,2 -10,3 -9,-8 -8,3 -8,-7 -7,4 -6,-8 -5,3 1,-8 1,-6 0,-4 1,-3 0,-1 1,1 0,3 0,4 3,-5 3,-4 5,-3 7,-1 8,1 9,2 11,-7 11,-6 10,-5 11,-3 10,-1 11,0 10,2 11,3 15,-4 -6,8 -16,2 -6,-1 26,-19 -27,-26 -23,-4 -27,-9 10,25 20,6 4,-8 0,4",
    "and IN",
  );
});

test("hintfly: a chant that has spelled its message lets go, and is heard again from the swarm at rest", () => {
  const two = run(hint(10), 400, [10]);
  assert.deepEqual(two.words, [37, 91, 175, 229, 313, 367], "DROP IN, three times round");
  assert.deepEqual([two.sum, two.rolls, two.own, two.dice], [2286931692, 644002028, 122, 10]);
  const eight = run(hint(14), 900, [5]);
  assert.deepEqual(
    eight.words,
    [27, 75, 127, 178, 235, 285, 340, 390, 482, 530, 582, 633, 690, 740, 795, 845],
    "YOU CAN HOIST WHERE YOU SEE FALLING DEBRIS, twice",
  );
  assert.deepEqual(
    [eight.sum, eight.rolls, eight.own, eight.dice],
    [503013414, 1577590175, 240, 24],
  );
});

test("hintfly: a chant that breaks sends the word's flies circling and the swarm home", () => {
  // SNEAK has formed at 39; the chant is last heard at 69
  const got = run(hint(5), 220, [10, 70], [60, 75, 110]);
  assert.equal(
    got.line,
    "1:20x9 3:20x16 2:20x1 2:28x1 2:36x1 2:44x1 2:52x1 2:60x1 2:68x1 2:76x1 2:84x1 2:92x1 2:100x1 2:108x1 2:116x1 4:121x31 5:121x21 5:113x1 5:105x1 5:97x1 5:89x1 5:81x1 5:73x1 5:65x1 5:57x1 5:49x1 5:41x1 5:33x1 5:25x1 1:20x118",
  );
  assert.equal(
    got.shots[60],
    "-39,-5 -39,-6 -39,-4 -38,2 -36,-8 -36,-2 -36,3 -35,-8 -36,-2 -35,4 -34,-2 -33,-9 -33,3 -32,-2 -32,-8 -32,3 -30,-1 -29,-6 -30,0 -30,2 -24,-8 -23,-6 -23,-5 -23,-3 -23,-1 -24,0 -24,2 -24,3 -21,-6 -20,-5 -21,-2 -17,-1 -16,1 -15,2 -14,-9 -13,-6 -14,-4 -13,-3 -14,-1 -13,0 -13,2 -14,3 -7,-7 -8,-6 -8,-5 -8,-3 -7,-1 -7,0 -8,3 -8,3 -6,-2 -5,-8 -6,3 -4,-2 -5,-8 -4,3 -4,-2 -2,-8 -2,4 -1,-3 -1,-8 -1,3 -1,-2 1,-7 0,3 1,-2 3,-8 2,3 8,3 8,2 9,0 11,-1 12,-3 12,0 11,-5 12,-6 13,0 14,-8 14,-6 14,0 16,-5 15,-3 15,0 17,-1 18,0 19,2 20,3 24,-8 24,-6 24,-5 25,-4 25,-1 24,0 24,2 25,3 27,-4 27,-1 27,-4 28,-1 28,-5 30,0 30,-5 31,1 32,-6 33,2 33,-7 34,3 36,-8 35,3 26,9 -6,-1 8,19 5,-6 14,9 -8,-13 -6,-6 -15,11 -6,4 -13,-9 -12,-5 1,12",
  );
  assert.equal(
    got.shots[75],
    "12,7 9,-1 8,-19 -16,-1 11,-11 -57,-5 -58,3 -14,-12 -52,-8 -37,-4 -12,-3 -56,-6 -50,-2 -54,-1 -34,1 -10,4 -47,5 -34,-15 -26,9 -52,1 -45,-6 -30,3 -46,-4 -43,-6 -31,-10 -40,-5 -3,-3 -35,11 -26,-15 -28,-13 3,-2 -37,4 4,5 -14,-7 -3,-1 -17,-14 -11,-13 -27,-10 -36,-3 -31,-5 -27,-5 9,3 -10,-16 -24,0 -21,2 -26,-7 -18,-9 -30,0 13,-1 -28,7 6,-9 9,-1 16,1 -26,1 -16,-1 10,-3 -6,-11 -6,-17 1,13 -13,4 12,0 -7,11 -14,-9 -19,-2 -15,-3 0,-11 -17,-4 -15,9 -10,9 21,-6 1,8 26,-7 32,-6 0,8 31,0 34,-8 31,6 25,0 30,1 8,-9 36,-6 9,6 11,-9 40,-2 30,-7 0,-3 36,9 22,1 4,-9 25,5 14,-11 13,-8 39,8 43,7 6,-1 45,1 19,7 23,5 50,0 13,-11 9,-3 48,0 43,-6 46,1 53,-2 25,1 41,11 45,-16 14,1 7,12 -34,-2 1,13 12,-9 4,19 18,-10 5,-1 -30,2 -2,8 13,-12 -38,-9 2,23",
    "the flies loop from where the word left them",
  );
  assert.equal(
    got.shots[110],
    "15,10 11,-3 35,-14 -16,-3 15,-19 -26,13 21,-12 37,11 -1,-9 15,12 -22,-20 37,15 23,-7 -36,-7 -9,15 -4,-15 -27,12 -3,11 -4,-9 -6,-15",
  );
  assert.deepEqual([got.sum, got.rolls, got.own, got.dice], [1236569267, 1880603292, 171, 210]);
});

test("hintfly: a chant that comes back is heard once the swarm has unwound to twenty", () => {
  const got = run(hint(5), 200, [10, 70, 95]);
  assert.equal(
    got.line,
    "1:20x9 3:20x16 2:20x1 2:28x1 2:36x1 2:44x1 2:52x1 2:60x1 2:68x1 2:76x1 2:84x1 2:92x1 2:100x1 2:108x1 2:116x1 4:121x31 5:121x21 5:113x1 5:105x1 5:97x1 5:89x1 5:81x1 5:73x1 5:65x1 5:57x1 5:49x1 5:41x1 5:33x1 5:25x1 5:20x1 1:20x1 3:20x16 2:20x1 2:28x1 2:36x1 2:44x1 2:52x1 2:60x1 2:68x1 2:76x1 2:84x1 2:92x1 2:100x1 2:108x1 2:116x1 4:121x31 3:121x16 2:121x1 2:113x1 2:105x1 2:97x1 2:89x1 2:81x1 2:73x1 2:65x1 2:57x1 4:54x11",
  );
  assert.deepEqual(
    [got.words, got.sum, got.rolls, got.own, got.dice],
    [[39, 134, 190], 3114638940, 1753730376, 209, 79],
  );
});

test("hintfly: a fly a whole pixel from its dot, across or down, has yet to arrive", () => {
  // RUN ELUM RUN sends flies that come to rest exactly a pixel short across
  const across = run(hint(29), 150, [10]);
  assert.deepEqual(
    [across.words, across.sum, across.rolls, across.own, across.dice],
    [[34, 83, 132], 2673651914, 3665449045, 12, 211],
  );
  // and ABE WAS HERE, from another cursor, one a pixel short down
  const down = run(hint(1, AT, [0, 0], 136), 200, [2]);
  assert.deepEqual(
    [down.words, down.sum, down.rolls, down.own, down.dice],
    [[27, 76, 128], 298840216, 2532699415, 198, 166],
  );
});

test("hintfly: a chant that breaks on the tick its message is spelled is a broken one, heard again as one", () => {
  // DROP IN's last hold is over at 122, the tick the chant goes; back at 130,
  // it waits out the swarm at twenty for a tick as any chant does
  const got = run(hint(10), 220, [10, 122, 130]);
  assert.deepEqual(
    [got.words, got.sum, got.rolls, got.own, got.dice],
    [[37, 91, 176], 4147548954, 2184228737, 155, 81],
  );
});

test("hintfly: a hint with no message hears no chant", () => {
  const got = run(hint(), 100, [10]);
  assert.equal(got.line, "1:20x100");
});

test("hintfly: a release's own numbers lay its words out and hold them, as its disc steps them", () => {
  // また あおう: dots a pixel apart, letters nineteen and half the odd word's
  // cells cut toward zero, each word held seventy-six ticks
  const got = run(hint(23, AT, [0, 0], 37, JP), 260, [10], [60, 155]);
  assert.equal(
    got.line,
    "1:20x9 3:20x16 2:20x1 2:28x1 2:36x1 2:44x1 2:52x1 2:60x1 4:64x76 3:64x16 2:64x1 2:72x1 2:80x1 4:82x76 5:82x21 5:74x1 5:66x1 5:58x1 5:50x1 5:42x1 5:34x1 5:26x1 1:20x1 3:20x16 2:20x1 2:28x1 2:36x1 2:44x1 2:52x1 2:60x1 4:64x7",
  );
  assert.deepEqual(got.words, [32, 127, 254]);
  assert.equal(
    got.shots[60],
    "-18,3 -17,-6 -16,-2 -16,1 -15,5 -14,-6 -15,-3 -15,1 -14,5 -13,-5 -13,-3 -12,0 -11,-8 -11,4 -10,-5 -11,-4 -10,-2 -11,1 -10,0 -8,-6 -9,-3 -8,1 -6,-6 -7,-2 -7,3 -6,6 -5,-6 -4,-3 2,-6 1,5 3,3 4,-8 4,-4 4,-3 4,-1 4,1 5,-5 6,3 7,-5 7,-2 8,4 9,-6 9,-4 10,5 10,-6 10,-4 12,-1 11,5 13,-6 12,-2 13,4 14,-6 1,-6 9,-27 26,-9 -30,-1 39,10 26,13 -13,12 -16,-4 26,-26 6,3 40,-16 -24,4",
    "また stands on its dots",
  );
  assert.equal(
    got.shots[155],
    "-27,-5 -26,1 -26,-1 -25,3 -25,-5 -23,-2 -23,4 -22,-6 -21,-7 -21,-4 -22,-2 -21,0 -22,1 -21,4 -20,-5 -19,-2 -19,2 -18,-5 -17,-1 -17,1 -18,4 -16,-5 -16,-1 -15,3 -14,-5 -14,2 -8,-6 -8,2 -7,4 -6,1 -5,-5 -5,5 -5,-1 -3,-5 -3,4 -3,-7 -3,-3 -2,-1 -2,0 -2,2 -2,-5 -1,-1 1,-5 0,-1 1,5 2,-7 3,0 4,5 5,-5 5,0 4,3 5,-4 11,-3 13,-8 13,-4 15,-7 16,-4 17,6 18,-7 18,-6 18,4 20,-7 19,-6 20,3 21,-7 22,-5 23,2 23,-4 24,0 25,-2 -8,-4 -27,-14 -19,8 30,-18 16,-25 7,-22 26,-1 33,2 39,-10 8,-5 -18,8 7,19",
    "and あおう",
  );
  assert.deepEqual([got.sum, got.rolls, got.own, got.dice], [3931033471, 2076000195, 172, 83]);
});

test("hintfly: a number a release leaves alone is the base's", () => {
  const got = run(hint(10, AT, [0, 0], 37, { ...AO, spelling: { hold: 75 } }), 200, [10]);
  assert.deepEqual(
    [got.words, got.sum, got.rolls, got.own, got.dice],
    [[37, 136], 2989585711, 915519745, 207, 216],
  );
});
