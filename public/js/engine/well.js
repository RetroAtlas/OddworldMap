import { raycastFixed } from "./collide.js";
import { BRAINS, STARTS, fpDiv } from "./patrolkit.js";

// ---- Well: a camera's wells roll one dice cursor between them, their leaves jitter off a second
const FP = 65536;
const CHANCE = 10; // the rolls that let a leaf go, of the dice's 256
const FALL = FP / 2;
const DRAG = 0xcccc; // four fifths of its speed kept
const JITTER = FP / 64;
const FLOORS = [0, 4];
const LEAF_RGB = [100, 100, 100];

// the PlayStation's fixed-point product, cut toward minus infinity
const mul = (a, b) => Math.floor((a * b) / FP);

STARTS.well = (st) => {
  st.leaves = [];
};

// a tick of a leaf in raw 16.16, and whether it lives on
function fly(q, p, roll) {
  q.vy += FALL;
  q.vx = mul(q.vx, DRAG) + mul(q.size, (roll() - 127) * JITTER);
  q.vy = mul(q.vy, DRAG) + mul(q.size, (roll() - 127) * JITTER);
  const x2 = q.x + q.vx,
    y2 = q.y + q.vy;
  const hit = raycastFixed(p.floors, q.x, q.y, x2, y2, FLOORS);
  const floor = hit ? p.floors[hit.line][4] : null;
  if (floor === 0 && q.scale !== 1) return false; // the background's leaf, on a foreground floor
  if (hit && !q.landed && floor === (q.scale === 1 ? 0 : 4)) {
    q.landed = true;
    q.vx = q.vy = 0;
    q.x = hit.x;
    q.y = hit.y;
  } else {
    q.x = x2;
    q.y = y2;
  }
  const [left, top, right, bottom] = p.win;
  const x = Math.trunc(q.x / FP),
    y = Math.trunc(q.y / FP);
  return x >= left && x <= right && y >= top && y <= bottom;
}

BRAINS.well = (st, now, rnd) => {
  const p = st.p;
  const roll = () => st.dice[st.seed2++ & 255];
  p.wells.forEach((w, k) => {
    if (rnd() >= CHANCE) return;
    st.seed2++;
    const size = w.scale * FP;
    const speed = (hundredths) => mul(fpDiv(hundredths * FP, 100 * FP), size);
    st.leaves.push({
      kind: "leaf",
      anim: "Well_Leaf",
      x: w.x * FP,
      y: w.y * FP,
      vx: speed(w.speed[0]),
      vy: speed(w.speed[1]),
      size,
      scale: w.scale,
      layer: w.layer,
      rgb: LEAF_RGB,
      landed: false,
      wait: p.hold,
      own: k === p.own,
      born: st.tick,
      win: p.win,
      cam: p.cam,
      lift: p.lift,
    });
  });
  for (const q of st.leaves) {
    if (q.wait) q.wait--;
    else q.dead = !fly(q, p, roll);
  }
  // the engine's list hands a dead object's place to its last
  for (let i = 0; i < st.leaves.length; i++) {
    if (!st.leaves[i].dead) continue;
    const last = st.leaves.pop();
    if (i < st.leaves.length) st.leaves[i--] = last;
  }
  st.fx = st.leaves.filter((q) => q.own);
};
