// The engine's 30 Hz tick, advanced only while it is set running, and the
// frame-advance rule an animation left alone follows. The painter reads the
// tick; this module never draws.
// No DOM at module top level, so it stays importable in bare Node.

import { LOGIC_FPS } from "./config.js";
import { BRAINS, MOTIONS, SPAWN_FRAME, STARTS } from "./brains.js";

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
  const variant = r.anim.includes("@") ? r.anim.slice(r.anim.indexOf("@")) : "";
  const gen = cy.patrol ? patrolGen : sceneGen;
  const cached = brainStates.get(r);
  const current = cached && cached.gen === gen ? cached : null;
  let st = current && current.tick <= want ? current : null;
  if (!st) {
    st = {
      gen,
      tick: 0,
      sub: 0,
      cur: r.anim.slice(0, r.anim.length - variant.length),
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
  }
  return {
    anim: (st.show ?? st.cur) + variant,
    at: tick - st.set + 1,
    flip: st.flip,
    state: st,
    dx: st.dx,
    dy: st.dy,
    hidden: !!st.hidden,
  };
}

// what a record shows at a tick: its animation, frame, place and facing, after
// the cycles the game runs without a player
export function resolveRecord(r, set, tick, patrolAt = tick) {
  const anims = set.anims;
  let anim = r.anim,
    x = r.x,
    y = r.y,
    flip = r.flip;
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
    } else if (cy.kind === "sway") {
      // a hanging fleech swings on its tongue, two angle steps a tick from a rolled start
      x = cy.cx + 4 * cos256(set.dice[cy.seed & 255] + 2 * tick);
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
  return { name: anim, anim: a, frame, x, y, flip };
}
