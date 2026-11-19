// Oddysee's hint flies as the PlayStation overlays run them: a swarm of bare
// sprites about the hint's point, each on a loop of its own, which spells the
// hint's message a word at a time while Abe chants, each fly sent to a dot of
// a letter. Kept in the engine's 16.16 and stepped off its sine.
// No DOM, so it stays importable in bare Node.

import { BRAINS, STARTS, cosine16, randomRange, sine16 } from "./patrolkit.js";

const FP = 65536;
const SWARM = 20; // the flies of a hint at rest
const SPARE = 12; // the flies left circling beside a word
const LETTER = 16; // a letter's cell, and its grid's side
const DOT = 0xcccc; // one step of that grid, in 16.16
const RAW_RGB = [128, 128, 128];

// what a fly is doing
const TO_DOT = 1,
  ON_DOT = 2,
  LOOPING = 3;
// the hint's states
const IDLE = 1,
  RESIZE = 2,
  PAUSE = 3,
  HOLD = 4,
  UNWIND = 5;

const flyAt = (st, i) =>
  (st.flies[i] ??= { kind: "fly", anim: "HintFly", layer: 39, scale: 1, blend: 1, rgb: RAW_RGB });

// a fly enters in the box about the hint's point, at a rolled angle and turn,
// off the flies' own cursor into the dice
function initFly(st, p) {
  const own = () => st.dice[st.seed2++ & 255];
  p.mode = LOOPING;
  p.rx = (st.ax + (own() & 31) - 16) * FP;
  p.ry = (st.ay + (own() & 31) - 16) * FP;
  p.angle = own();
  p.speed = 12 + (own() & 3);
  if (own() & 1) p.speed = -p.speed;
}

// the flies out, each sprite's corner its fly's point cut to whole pixels of
// the hint's screen, toward the screen's own corner
function show(st) {
  const [ox, oy] = st.p.screen;
  st.fx = st.flies.slice(0, st.count);
  for (const p of st.fx) {
    p.x = ox + Math.trunc(p.rx / FP - ox);
    p.y = oy + Math.trunc(p.ry / FP - oy);
  }
}

const fliesOf = (word) => word.reduce((n, dots) => n + dots.length, 0);

// the next word's letters laid a cell apart and centred on the point, a fly
// sent to each dot in a sixteenth of the way a tick; the rest keep circling
function formWord(st, rnd) {
  const word = st.p.words[st.word++];
  let x = (st.ax - (LETTER / 2) * word.length) * FP;
  const y = (st.ay - LETTER / 2) * FP;
  let n = 0;
  for (const dots of word) {
    for (const dot of dots) {
      const p = st.flies[n++];
      p.tx = x + DOT * (dot >> 4);
      p.ty = y + DOT * (dot & 15);
      p.vx = (p.tx - p.rx) >> 4;
      p.vy = (p.ty - p.ry) >> 4;
      p.mode = TO_DOT;
      randomRange(st, rnd, -127, 127); // the pitch of its sound
    }
    x += LETTER * FP;
  }
}

// a word's flies go back to circling where they stand
function scatter(st) {
  for (let i = 0; i < st.count; i++) st.flies[i].mode = LOOPING;
}
function unwind(st) {
  scatter(st);
  st.idx = 0;
  st.sub = UNWIND;
}

// one tick of every fly out: on its way to a dot, jittering on it or looping.
// The swarm's sound is its first fly's to roll for: whether, then how loud,
// and its pitch where the fly gives it none, which the engine's player rolls
function stepFlies(st, rnd) {
  const own = () => st.dice[st.seed2++ & 255];
  const hum = (i, odds, volume, pitched = true) => {
    if (i !== 0 || randomRange(st, rnd, 0, 100) >= odds) return;
    randomRange(st, rnd, volume, volume + 6);
    if (!pitched) randomRange(st, rnd, -127, 127);
  };
  for (let i = 0; i < st.count; i++) {
    const p = st.flies[i];
    if (p.mode === TO_DOT) {
      if (Math.abs(p.tx - p.rx) < FP && Math.abs(p.ty - p.ry) < FP) p.mode = ON_DOT;
      else {
        p.rx += p.vx;
        p.ry += p.vy;
      }
      hum(i, 40, 24);
    } else if (p.mode === ON_DOT) {
      if (!(own() & 3)) p.rx = p.tx + (own() & 1) * FP;
      hum(i, 40, 24);
    } else {
      p.angle = (p.angle + p.speed) & 255;
      p.rx += 5 * cosine16(p.angle);
      p.ry -= 2 * sine16(p.angle);
      hum(i, 20, 18, false);
    }
  }
}

STARTS.hintfly = (st) => {
  st.flies = [];
  st.count = SWARM;
  for (let i = 0; i < SWARM; i++) initFly(st, flyAt(st, i));
  st.sub = IDLE;
  st.word = st.idx = st.want = 0;
  st.spelled = false;
};

// The game spells a message once a chant and then forms empty words until the
// chant ends. Here a chant that has spelled its message lets go by itself and
// is heard again once the swarm is back at rest, so the message comes round
BRAINS.hintfly = (st, now, rnd) => {
  const { words } = st.p;
  const chant = st.chant && words.length > 0 && !st.spelled;
  if (st.sub === IDLE) {
    stepFlies(st, rnd);
    if (chant) {
      st.word = 0;
      st.sub = PAUSE;
      st.timer = now + 15;
    }
  } else if (st.sub === PAUSE) {
    stepFlies(st, rnd);
    if (!chant) unwind(st);
    else if (st.timer < now) {
      st.want = fliesOf(words[st.word]) + SPARE;
      st.idx = 0;
      st.sub = RESIZE;
    }
  } else if (st.sub === RESIZE) {
    // eight flies a tick: new ones enter in the box, and a shrinking swarm
    // sends one home for each it drops
    for (let i = 0; st.count !== st.want && i < 8; i++) {
      if (st.count < st.want) initFly(st, flyAt(st, st.count++));
      else if (st.idx < --st.count) initFly(st, st.flies[st.idx++]);
    }
    stepFlies(st, rnd);
    if (!chant) unwind(st);
    else if (st.count === st.want) {
      formWord(st, rnd);
      st.sub = HOLD;
      st.timer = now + 30;
    }
  } else if (st.sub === HOLD) {
    stepFlies(st, rnd);
    const over = st.timer < now;
    if (chant && over && st.word >= words.length) st.spelled = true;
    if (!chant || st.spelled) unwind(st);
    else if (over) {
      scatter(st);
      st.sub = PAUSE;
      st.timer = now + 15;
    }
  } else {
    // the first twenty go home one a tick, then the rest leave eight a tick
    if (st.count === SWARM && chant) st.sub = IDLE;
    stepFlies(st, rnd);
    if (st.idx < SWARM) initFly(st, st.flies[st.idx++]);
    else st.count = Math.max(SWARM, st.count - 8);
    if (st.count === SWARM && !chant) {
      st.sub = IDLE;
      st.spelled = false;
    }
  }
  show(st);
};
