// The engine's 30 Hz tick, advanced only while it is set running, and the
// frame-advance rule an animation left alone follows. The painter reads the
// tick; this module never draws.
// No DOM at module top level, so it stays importable in bare Node.

import { LOGIC_FPS } from "./config.js";
import { BRAINS, MOTIONS, SPAWN_FRAME, STARTS, stepEffects } from "./brains.js";

// an animation holds each frame `fps` ticks: at construction frame 0 stands
// with its counter at 1, so the first tick decodes frame 0 again and loads the
// counter from fps, and frame k shows from tick 1 + k·fps. Past the last
// frame a looping animation returns to loop_start; one that does not parks
// on its last; `start` offsets the frame index
export function frameAt(anim, tick, start = 0) {
  const n = anim.frames.length;
  if (n <= 1) return 0;
  const k = start + (tick <= 0 ? 0 : Math.floor((tick - 1) / anim.fps));
  if (k < n) return k;
  if (!anim.loop) return n - 1;
  const span = n - anim.loop_start;
  return anim.loop_start + ((k - anim.loop_start) % span);
}

let tick = 0;
let running = false;
let last = 0;
let carry = 0;
let onTick = null;
let frame = 0;
const TICK_MS = 1000 / LOGIC_FPS;

export const motionTick = () => tick;

// one rAF loop, the display rate quantised to engine ticks: a frame that
// arrives late advances the tick as many times as its lateness holds whole
// ticks, so the clock keeps engine time rather than frame count
export function advance(now) {
  carry += now - last;
  last = now;
  let advanced = 0;
  while (carry >= TICK_MS) {
    carry -= TICK_MS;
    tick += 1;
    advanced += 1;
  }
  return advanced;
}
function step(now) {
  if (!running) return;
  if (advance(now)) onTick?.();
  frame = requestAnimationFrame(step);
}

export function setMotionRunning(on, repaint) {
  onTick = repaint;
  if (on === running) return;
  running = on;
  if (on) {
    last = performance.now();
    carry = 0;
    frame = requestAnimationFrame(step);
  } else cancelAnimationFrame(frame);
}

export const motionRunning = () => running;

// the scene's ticks count from when the path on screen was set up, as the
// game constructs a camera's objects the moment it loads, so every object
// starts from its spawn frame on arrival; the Objects toggle coming on starts
// it over
let sceneEpoch = 0,
  sceneGen = 0;
export const sceneTick = () => tick - sceneEpoch;
export function resetScene() {
  sceneEpoch = tick;
  patrolEpoch = 0;
  sceneGen++;
  patrolGen++;
}

// the patrols count from the scene tick their toggle last came on
let patrolEpoch = 0,
  patrolGen = 0;
let patrolsOn = false;
export function setPatrolsRunning(on) {
  if (on && !patrolsOn) {
    patrolEpoch = sceneTick();
    patrolGen++;
  }
  patrolsOn = on;
}
export const patrolTick = () => (patrolsOn ? sceneTick() - patrolEpoch : null);

// the engine's 256-step angle tables
const sin256 = (a) => Math.sin(((a & 255) * Math.PI) / 128);
const cos256 = (a) => Math.cos(((a & 255) * Math.PI) / 128);

// a UXB blinks its pattern: every cycle is twelve ticks, two of the flash and
// ten of the tick light, and each digit spells so many red cycles before a
// green one, the cycle after the green loading the next digit red
function uxbState(digits, tick) {
  const period = digits.reduce((n, d) => n + d + 1, 0);
  let k = Math.floor(tick / 12) % period;
  for (const d of digits) {
    if (k <= d) return { flash: tick % 12 < 2, green: k === d - 1 };
    k -= d + 1;
  }
  return { flash: tick % 12 < 2, green: false };
}

const brainStates = new WeakMap();

// a brain's state at a tick, stepped on from where it last stood. A state
// belongs to the clock generation it was built in: one from an earlier
// generation is replaced, while one ahead of the ask within the same generation
// is kept and the ask answered from a throwaway, so only that ask replays
export function brainAt(r, set, tick) {
  const cy = r.cycle;
  const want = Math.max(tick, 1);
  const variant = r.anim?.includes("@") ? r.anim.slice(r.anim.indexOf("@")) : "";
  const gen = cy.patrol ? patrolGen : sceneGen;
  const cached = brainStates.get(r);
  const current = cached && cached.gen === gen ? cached : null;
  let st = current && current.tick <= want ? current : null;
  if (!st) {
    st = {
      gen,
      tick: 0,
      sub: 0,
      cur: r.anim ? r.anim.slice(0, r.anim.length - variant.length) : null,
      next: null,
      timer: 0,
      turn: 0,
      set: 1,
      flip: r.flip,
      dx: 0,
      dy: 0,
      m: null,
      emo: !!cy.emo,
      p: cy.p ?? null,
      w: cy.world ?? null,
      game: cy.game ?? null,
      r,
      ax: r.x,
      ay: r.y,
      anims: set.anims,
      fx: [],
      seed: cy.seed,
      seed2: cy.seed,
      dice: set.dice,
      sw: {},
    };
    STARTS[cy.brain]?.(st, r);
    if (!current) brainStates.set(r, st);
  }
  const rnd = () => st.dice[st.seed++ & 255];
  while (st.tick < want) {
    const T = ++st.tick;
    const was = st.cur;
    const a = was && set.anims[was + variant];
    const frame = a ? frameAt(a, T - st.set) : 0;
    const last = !!a && frame === a.frames.length - 1;
    st.m = { last, frame };
    const now = SPAWN_FRAME + T;
    BRAINS[cy.brain](st, now, rnd);
    MOTIONS[st.cur]?.(st, last, frame, rnd, now);
    if (st.cur !== was) st.set = T;
    if (st.fx.length) stepEffects(st, now, rnd);
  }
  return {
    anim: (st.show ?? st.cur) + variant,
    at: tick - st.set + 1,
    flip: st.flip,
    state: st,
    dx: st.dx,
    dy: st.dy,
    hidden: !!st.hidden,
    rgb: st.rgb ?? null,
  };
}

// the door lights share one timer: at rest between windows and, in each,
// brightening and dimming on a half sine over the window, the rest and the
// window rolled from the dice. The engine's quarter-sine table, 16.16 fixed
const SINE = [
  0, 1633, 3266, 4897, 6525, 8148, 9767, 11380, 12985, 14582, 16171, 17749, 19316, 20872, 22414,
  23942, 25456, 26953, 28434, 29897, 31342, 32767, 34172, 35555, 36917, 38255, 39570, 40860, 42125,
  43363, 44575, 45758, 46914, 48040, 49136, 50202, 51237, 52240, 53210, 54147, 55051, 55920, 56754,
  57554, 58317, 59044, 59735, 60388, 61004, 61582, 62122, 62623, 63085, 63508, 63891, 64235, 64539,
  64803, 65026, 65209, 65351, 65453, 65514, 65535,
];
const halfSine = (a) => (a < 64 ? SINE[a] : a < 128 ? SINE[127 - a] : 0) / 65536;
const LIGHT_REST = 32;
const pulses = new WeakMap();
export function lightLevel(set, tick) {
  let p = pulses.get(set);
  if (!p) {
    p = { seed: 0, windows: [{ next: 0, end: 0 }] };
    p.windows[0].end = roll(p, set.dice, 30, 45);
    pulses.set(set, p);
  }
  const w = p.windows;
  while (w[w.length - 1].end < tick) {
    const next = w[w.length - 1].end + 1 + roll(p, set.dice, 6, 20);
    w.push({ next, end: next + roll(p, set.dice, 30, 45) });
  }
  if (tick <= 0) return LIGHT_REST;
  let lo = 0,
    hi = w.length - 1;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (w[mid].end < tick) lo = mid + 1;
    else hi = mid;
  }
  const { next, end } = w[lo];
  if (tick < next) return LIGHT_REST;
  const angle = Math.trunc((128 * (tick - next)) / (end - next)) & 255;
  return Math.min(255, Math.trunc(255 * halfSine(angle)) + LIGHT_REST);
}
const roll = (p, dice, min, max) => min + (dice[p.seed++ & 255] % (max - min + 1));

// what a record shows at a tick, after the cycles the game runs
// without a player
export function resolveRecord(r, set, tick, patrolAt = tick) {
  const anims = set.anims;
  let anim = r.anim,
    x = r.x,
    y = r.y,
    flip = r.flip,
    moved = false,
    bright = 1,
    rgb = r.rgb;
  const cy = r.cycle;
  let at = tick; // the tick the shown animation counts from
  if (cy) {
    if (cy.kind === "brain" && (patrolAt !== null || !cy.patrol)) {
      const w = brainAt(r, set, cy.patrol ? patrolAt : tick);
      if (w.hidden) return null;
      anim = w.anim;
      at = w.at;
      x += w.dx;
      y += w.dy;
      flip = w.flip;
      moved = !!cy.patrol;
      if (w.rgb) rgb = w.rgb;
    } else if (cy.kind === "uxb") {
      const st = uxbState(cy.digits, tick);
      if (st.flash) anim = "Bomb_Flash";
      else anim = st.green ? "Bomb_RedGreenTick@GreenFlash" : "Bomb_RedGreenTick";
      at = st.flash ? tick % 12 : (tick % 12) - 2;
    } else if (cy.kind === "laser") {
      // out to the far edge, fifteen ticks there, back, fifteen ticks here
      const span = cy.x2 - cy.x1;
      const n = Math.ceil(span / cy.speed);
      const period = 2 * n + 30;
      const p = tick % period;
      const start = cy.left ? cy.x2 : cy.x1;
      const dir = cy.left ? -1 : 1;
      let d;
      if (p < n) d = p * cy.speed;
      else if (p < n + 15) d = n * cy.speed;
      else if (p < 2 * n + 15) d = n * cy.speed - (p - n - 15) * cy.speed;
      else d = 0;
      x = start + dir * d;
    } else if (cy.kind === "pulse") {
      bright = lightLevel(set, tick) / 255;
    } else if (cy.kind === "flip8") {
      if (Math.floor(tick / 8) % 2) flip = !flip;
    } else if (cy.kind === "chime") {
      x = cy.x + 5 * cos256(4 * tick);
      y = cy.y + 3 * cos256(3 * tick);
    } else if (cy.kind === "orbit") {
      const a = cy.phase + 4 * tick;
      let rx = cy.rx;
      if (cy.abe) {
        // the width walks between 30 and 0 one unit a tick, turning at each end
        const t = cy.abe.dir < 0 ? 60 - cy.abe.width + tick : cy.abe.width + tick;
        const w = 30 - Math.abs((t % 60) - 30);
        rx = w * (cy.rx / 30);
      }
      x = cy.cx + sin256(a) * rx;
      y = cy.cy + cos256(a) * cy.ry;
    }
  }
  const a = anims[anim];
  if (!a) return null;
  const frame = r.frozen ? r.frame : frameAt(a, at, r.frame);
  return { name: anim, anim: a, frame, x, y, flip, moved, bright, rgb };
}

// what a record's brain has given off at a tick: sprites with their frame,
// the Z shapes, the spark lines, each with its place and layer
export function resolveEffects(r, set, tick, patrolAt = tick) {
  const cy = r.cycle;
  if (!cy || cy.kind !== "brain" || (cy.patrol && patrolAt === null)) return [];
  const at = cy.patrol ? patrolAt : tick;
  const st = brainAt(r, set, at).state;
  const out = [];
  for (const p of st.fx) {
    if (p.kind === "sprite" || p.kind === "fly") {
      const a = set.anims[p.anim];
      if (!a || (p.born !== undefined && p.born > at)) continue;
      const frame = p.kind === "fly" ? 0 : frameAt(a, at - p.born + 1);
      out.push({
        kind: "sprite",
        anim: a,
        name: p.anim,
        frame,
        x: p.x,
        y: p.y,
        scale: p.scale,
        layer: p.layer,
        blend: p.blend,
        rgb: p.rgb,
      });
    } else if (p.kind === "z") {
      if (p.born > at) continue;
      out.push({
        kind: "z",
        x: p.x,
        y: p.y,
        scale: p.scale,
        rgb: p.rgb,
        burst: p.state === "burst",
        layer: p.layer,
      });
    } else if (p.kind === "spark") {
      if (p.born >= at) continue; // drawn from the tick after it is struck
      out.push({ kind: "lines", x: p.x, y: p.y, scale: p.scale, segs: p.segs, layer: p.layer });
    }
  }
  return out;
}
