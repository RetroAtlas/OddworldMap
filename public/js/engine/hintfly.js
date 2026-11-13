// Oddysee's hint flies as the PlayStation overlays run them: a swarm of bare
// sprites about the hint's point, each on a loop of its own, kept in the
// engine's 16.16 and stepped off its sine.
// No DOM, so it stays importable in bare Node.

import { BRAINS, STARTS, cosine16, sine16 } from "./patrolkit.js";

const FP = 65536;
const SWARM = 20; // the flies of a hint at rest
const RAW_RGB = [128, 128, 128];

// a fly enters in the box about the hint's point, at a rolled angle and turn,
// off the flies' own cursor into the dice
function initFly(st, p) {
  const own = () => st.dice[st.seed2++ & 255];
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
  for (const p of st.fx) {
    p.x = ox + Math.trunc(p.rx / FP - ox);
    p.y = oy + Math.trunc(p.ry / FP - oy);
  }
}

STARTS.hintfly = (st) => {
  for (let i = 0; i < SWARM; i++) {
    const p = { kind: "fly", anim: "HintFly", layer: 39, scale: 1, blend: 1, rgb: RAW_RGB };
    initFly(st, p);
    st.fx.push(p);
  }
};

BRAINS.hintfly = (st) => {
  for (const p of st.fx) {
    p.angle = (p.angle + p.speed) & 255;
    p.rx += 5 * cosine16(p.angle);
    p.ry -= 2 * sine16(p.angle);
  }
  show(st);
};
