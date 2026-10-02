// The engine's 30 Hz tick, advanced only while it is set running, and the
// frame-advance rule an animation left alone follows. The painter reads the
// tick; this module never draws.
// No DOM at module top level, so it stays importable in bare Node.

import { LOGIC_FPS } from "./config.js";

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

// ---- the working Mudokons ---------------------------------------------------
// Each brain is the decomp's sub-state machine over the engine's frame counter,
// rolling the game's own dice (its 256-byte table, walked from a seed), and the
// motions chain one animation into the next at its last frame. A step is one
// engine tick: the brain, then the motion of whatever it left current, with
// the last-frame flag the previous tick's animation step left behind.

// the engine's frame counter stands far past any timer a brain sets as an
// absolute frame by the time a screen has loaded
const SPAWN_FRAME = 1000;

// a sad or angry worker downs tools for good and stands
function standUp(st, now) {
  st.sub = 3;
  st.timer = now + 10;
}

// Math_RandomRange: equal ends roll nothing, a range past a byte rolls twice
function randomRange(st, rnd, min, max) {
  if (min > max) [min, max] = [max, min];
  const range = max - min;
  if (range === 0) return max;
  if (range < 256) return min + (rnd() % (range + 1));
  const b = rnd();
  st.seed++;
  return min + ((257 * b) % (range + 1));
}

// a fresh game's switches: id 1 reads on, nothing else does until a device
// writes it, and id 0 reads off whatever was written
const switchGet = (st, id) => (id === 1 ? 1 : id === 0 ? 0 : (st.sw[id] ?? 0));

const DIRECTION_DOWN = 0,
  DIRECTION_LEFT = 2;
const drillAnim = (st, on) =>
  `Drill_${st.p.direction === DIRECTION_DOWN ? "Vertical" : "Horizontal"}_${on ? "On" : "Off"}`;

// what a brain sets up at construction, before its first tick
const STARTS = {
  // the saw rests at the top of its rise, or at the bottom rising first
  meatsaw(st) {
    const p = st.p;
    st.state = "idle";
    st.travel = 0;
    st.idleT = 0;
    st.speed2 = p.speed;
    st.auto = false;
    const trigger = switchGet(st, p.switchId);
    st.f0 = p.start === 0 ? (trigger === 0 ? 1 : 0) : p.switchId !== 0 ? trigger : 0;
    if (p.initial && p.speed) {
      st.state = "up";
      st.travel = p.maxRise + p.speed - (p.maxRise % p.speed);
    }
    st.dy = st.travel;
  },
  // the drill rests at the far end of its travel, or at the near end
  drill(st) {
    const p = st.p;
    st.state = "restart";
    st.off = p.startBottom ? 0 : p.width;
    st.offT = 0;
    st.speed2 = 0;
    st.changed = false;
    drillPlace(st);
  },
};

function drillPlace(st) {
  const d = st.p.direction;
  st.dx = d === DIRECTION_DOWN ? 0 : d === DIRECTION_LEFT ? -st.off : st.off;
  st.dy = d === DIRECTION_DOWN ? -st.off : 0;
}

const BRAINS = {
  // Oddysee's standing scrubber: scrub, pause, scrub again
  standscrub(st, now, rnd) {
    switch (st.sub) {
      case 0:
        st.cur = "Mudokon_StandScrubLoop";
        st.next = null;
        st.timer = (rnd() % 64) + now + 35;
        st.sub = 1;
        return;
      case 1:
        if (now > st.timer && st.cur === "Mudokon_StandScrubLoop")
          st.next = "Mudokon_StandScrubLoopToPause";
        if (st.cur === "Mudokon_StandScrubPause") {
          st.timer = (rnd() % 64) + now + 35;
          st.sub = 2;
        }
        return;
      case 2:
        if (now > st.timer) {
          st.next = "Mudokon_StandScrubPauseToLoop";
          st.timer = (rnd() % 64) + now + 35;
          st.sub = 1;
        }
    }
  },
  // Oddysee's crouched scrubber: its first timers are absolute frames, long
  // past, so the first scrub stands alone and the first break opens with a turn
  crouchscrub(st, now, rnd) {
    switch (st.sub) {
      case 0:
        st.cur = "Mudokon_CrouchScrub";
        st.next = null;
        st.timer = (rnd() % 64) + 15;
        st.turn = (rnd() % 64) + 240;
        st.sub = 2;
        return;
      case 1:
        if (st.cur === "Mudokon_CrouchIdle" && now > st.turn) {
          st.next = "Mudokon_CrouchTurn";
          st.turn = (rnd() % 64) + now + 240;
        }
        if (st.cur === "Mudokon_CrouchIdle" && now > st.timer) {
          st.next = "Mudokon_CrouchScrub";
          st.timer = (rnd() % 64) + now + 35;
        }
        if (st.cur === "Mudokon_CrouchScrub") st.sub = 2;
        return;
      case 2:
        if (st.cur !== "Mudokon_CrouchIdle") return;
        if (now > st.timer) {
          st.timer = (rnd() % 64) + now + 15;
          st.sub = 1;
        } else st.cur = "Mudokon_CrouchScrub";
    }
  },
  // Exoddus's scrubber: bursts of scrubbing, a break, a turn now and then
  scrub(st, now, rnd) {
    switch (st.sub) {
      case 0:
        st.cur = "Mudokon_CrouchScrub";
        st.next = null;
        st.timer = (rnd() % 64) + now + 15;
        st.turn = (rnd() % 64) + now + 240;
        st.sub = 2;
        return;
      case 1:
        if (st.cur === "Mudokon_CrouchIdle" && now > st.turn) {
          st.turn = (rnd() % 64) + now + 240;
          st.next = "Mudokon_CrouchTurn";
        }
        if (st.cur !== "Mudokon_CrouchIdle" || now <= st.timer) {
          if (st.cur === "Mudokon_CrouchScrub") st.sub = 2;
          return;
        }
        if (st.emo && rnd() < 120) return standUp(st, now);
        st.timer = (rnd() % 64) + now + 35;
        st.next = "Mudokon_CrouchScrub";
        return;
      case 2:
        if (st.cur !== "Mudokon_CrouchIdle") return;
        if (now > st.timer) {
          st.timer = (rnd() % 64) + now + 15;
          st.sub = 1;
        } else st.cur = "Mudokon_CrouchScrub";
        return;
      case 3:
        if (now > st.timer && st.cur === "Mudokon_CrouchIdle") st.next = "Mudokon_CrouchToStand";
    }
  },
  // an awake slog: a woof, a growl and a scratch on their own timers, which
  // its first tick finds long past, from its own walk of the dice as well
  slog(st, now, rnd) {
    if (st.sub === 0) {
      st.sub = 4;
      st.growlT = 0;
      st.scratchT = 0;
      return;
    }
    const own = st.dice[st.seed2++ & 255];
    if (own % 64 === 0 && st.cur === "Slog_Idle") {
      st.cur = "Slog_MoveHeadUpwards";
      return;
    }
    if (now > st.growlT && st.cur === "Slog_Idle") {
      st.growlT = (rnd() % 32) + now + 60;
      st.cur = "Slog_Growl";
      st.next = "Slog_Idle";
    }
    if (now > st.scratchT && st.cur === "Slog_Idle") {
      st.scratchT = (rnd() % 32) + now + 120;
      st.cur = "Slog_Scratch";
      st.next = "Slog_Idle";
    }
  },
  // a patrolling paramite with nobody about: a wait, then a turn, now and
  // then a hiss drawn back
  paramite(st, now, rnd) {
    switch (st.sub) {
      case 0:
        st.next = "Paramite_Idle";
        st.sub = 1;
        return;
      case 1:
        st.timer = now + randomRange(st, rnd, 45, 135);
        st.sub = 2;
        return;
      case 2:
        if (st.timer > now) return;
        if (rnd() >= 6) {
          st.next = "Paramite_Turn";
          st.sub = 3;
        } else {
          st.next = "Paramite_GameSpeakBegin";
          st.sub = 4;
        }
        return;
      case 3:
        if (st.cur === "Paramite_Turn" && st.m.last) {
          st.timer = now + randomRange(st, rnd, 45, 135);
          st.sub = 2;
        }
        return;
      case 4:
        if (st.cur === "Paramite_PreHiss" && st.m.last) {
          st.next = "Paramite_Idle";
          st.timer = now + randomRange(st, rnd, 45, 135);
          st.sub = 2;
        }
    }
  },
  // Oddysee's meat saw: a stroke down and back, a pause rolled between the
  // TLV's two ends, by its type and start state against a fresh game's switches
  meatsaw(st, now, rnd) {
    const p = st.p;
    const resetOffscreen = p.type === 1 || p.type === 2;
    const switched = p.type === 2;
    switch (st.state) {
      case "idle":
        if (
          (st.idleT <= now || switched) &&
          (!resetOffscreen || switchGet(st, p.switchId) === st.f0)
        ) {
          st.state = "down";
          st.cur = "MeatSaw_Moving";
          st.auto = false;
          st.speed2 = p.speed;
        } else if (resetOffscreen && !switched && p.offSpeed !== 0 && st.idleT <= now) {
          st.state = "down";
          st.cur = "MeatSaw_Moving";
          st.auto = true;
          st.speed2 = p.offSpeed;
        }
        break;
      case "down":
        st.travel += st.speed2;
        if (st.travel >= p.maxRise) st.state = "up";
        break;
      case "up":
        st.travel -= st.speed2;
        if (st.travel <= 0) {
          st.state = "idle";
          st.idleT =
            now +
            (st.auto
              ? randomRange(st, rnd, p.autoMin, p.autoMax)
              : randomRange(st, rnd, p.switchMin, p.switchMax));
          st.cur = "MeatSaw_Idle";
          if (switched) st.sw[p.switchId] = st.f0 === 0 ? 1 : 0;
        }
    }
    st.dy = st.travel;
  },
  // Exoddus's drill: a stroke out and back along its direction, a pause
  // rolled between the TLV's ends, by its behaviour against a fresh game's switches
  drill(st, now, rnd) {
    const p = st.p;
    const startOff = !p.startOn;
    const useId = p.behavior === 1 || p.behavior === 2;
    const toggle = p.behavior === 2;
    switch (st.state) {
      case "restart":
        if (
          (now > st.offT || toggle) &&
          (!useId || (switchGet(st, p.switchId) !== 0) === startOff)
        ) {
          st.state = "down";
          st.cur = drillAnim(st, true);
          st.changed = false;
          st.speed2 = p.speed;
        } else if (useId && !toggle && Math.trunc(p.offSpeed) > 0 && now > st.offT) {
          st.state = "down";
          st.cur = drillAnim(st, true);
          st.changed = true;
          st.speed2 = p.offSpeed;
        }
        break;
      case "down":
        st.off -= st.speed2;
        if (st.off <= 0) st.state = "up";
        break;
      case "up":
        st.off += st.speed2;
        if (st.off >= p.width) {
          st.state = "restart";
          st.offT =
            now +
            (st.changed
              ? randomRange(st, rnd, p.minOffChange, p.maxOffChange)
              : randomRange(st, rnd, p.minOff, p.maxOff));
          st.cur = drillAnim(st, false);
          if (toggle) st.sw[p.switchId] = startOff ? 0 : 1;
        }
    }
    drillPlace(st);
  },
  // Exoddus's chiseller: chisel, a break, chisel again
  chisel(st, now, rnd) {
    switch (st.sub) {
      case 0:
        st.cur = "Mudokon_Chisel";
        st.next = null;
        st.timer = (rnd() % 64) + now + 35;
        st.sub = 1;
        return;
      case 1:
        if (now > st.timer && st.cur === "Mudokon_Chisel") st.next = "Mudokon_CrouchIdle";
        if (st.cur !== "Mudokon_CrouchIdle") return;
        if (st.emo && rnd() < 120) {
          standUp(st, now);
          st.next = "Mudokon_Idle";
          return;
        }
        st.timer = (rnd() % 64) + now + 35;
        st.sub = 2;
        return;
      case 2:
        if (now <= st.timer) return;
        st.timer = (rnd() % 64) + now + 35;
        st.next = "Mudokon_Chisel";
        st.sub = 1;
    }
  },
};

// the motion a tick ends in, given the one it began in and whether that one's
// animation had reached its last frame
const MOTIONS = {
  Mudokon_StandScrubLoop(st, last) {
    if (st.next && last) {
      st.cur = st.next;
      st.next = null;
    }
  },
  Mudokon_StandScrubLoopToPause(st, last) {
    if (last) st.cur = "Mudokon_StandScrubPause";
  },
  Mudokon_StandScrubPause(st, last) {
    if (st.next && last) {
      st.cur = "Mudokon_StandScrubPauseToLoop";
      st.next = null;
    }
  },
  Mudokon_StandScrubPauseToLoop(st, last) {
    if (last) st.cur = "Mudokon_StandScrubLoop";
  },
  Mudokon_CrouchScrub(st, last) {
    if (last) st.cur = "Mudokon_CrouchIdle";
  },
  Mudokon_CrouchIdle(st) {
    if (!st.next) return;
    if (st.next === "Mudokon_Idle") st.cur = "Mudokon_CrouchToStand";
    else if (st.next === "Mudokon_Chisel") st.cur = "Mudokon_StartChisel";
    else st.cur = st.next;
    st.next = null;
  },
  Mudokon_CrouchTurn(st, last) {
    if (last) {
      st.cur = "Mudokon_CrouchIdle";
      st.flip = !st.flip;
    }
  },
  Mudokon_CrouchToStand(st, last) {
    if (last) st.cur = "Mudokon_Idle";
  },
  Mudokon_Chisel(st, last) {
    if (!last || !st.next) return;
    if (st.next === "Mudokon_Idle") st.cur = "Mudokon_StopChisel";
    else {
      st.cur = st.next === "Mudokon_CrouchIdle" ? "Mudokon_StopChisel" : st.next;
      st.next = null;
    }
  },
  Mudokon_StartChisel(st, last) {
    if (last) st.cur = "Mudokon_Chisel";
  },
  Mudokon_StopChisel(st, last) {
    if (last) st.cur = "Mudokon_CrouchIdle";
  },
  Slog_MoveHeadUpwards(st, last, frame, rnd) {
    if (frame === 0) st.woof = true;
    if (last) {
      randomRange(st, rnd, 0, 100);
      st.cur = "Slog_Idle";
      st.next = null;
    }
  },
  Slog_Scratch(st, last) {
    if (st.next && last) {
      st.cur = st.next;
      st.next = null;
    }
  },
  // a growl after a woof holds its third frame a dozen ticks, and leaves the
  // growl timer behind it, so a second growl follows
  Slog_Growl(st, last, frame, rnd, now) {
    if (frame === 3 && st.woof) {
      st.woof = false;
      st.frozen = true;
      st.growlT = now + 12;
    }
    if (st.frozen) {
      if (now > st.growlT) st.frozen = false;
      else st.set += 1;
    }
    if (st.next && last) {
      st.cur = st.next;
      st.next = null;
    }
  },
  Paramite_Idle(st) {
    if (st.next === "Paramite_Turn" || st.next === "Paramite_GameSpeakBegin") st.cur = st.next;
    st.next = null;
  },
  Paramite_Turn(st, last) {
    if (last) {
      st.flip = !st.flip;
      st.cur = "Paramite_Idle";
    }
  },
  Paramite_GameSpeakBegin(st, last) {
    if (last) st.cur = "Paramite_PreHiss";
  },
  Paramite_PreHiss(st) {
    if (st.next) st.cur = "Paramite_GameSpeakEnd";
  },
  Paramite_GameSpeakEnd(st, last) {
    if (last) {
      st.cur = "Paramite_Idle";
      st.next = null;
    }
  },
};

const brainStates = new WeakMap();

// a brain's state at a tick, stepped on from where it last stood; a tick
// behind it starts the brain over from its first
function brainAt(r, set, tick) {
  const cy = r.cycle;
  const want = Math.max(tick, 1);
  const variant = r.anim.includes("@") ? r.anim.slice(r.anim.indexOf("@")) : "";
  // the cache keeps the later state, so asking for an earlier tick costs no
  // replay to the present
  const cached = brainStates.get(r);
  let st = cached && cached.tick <= want ? cached : null;
  if (!st) {
    st = {
      tick: 0,
      sub: 0,
      cur: r.anim.slice(0, r.anim.length - variant.length),
      next: null,
      timer: 0,
      turn: 0,
      set: 1,
      flip: false,
      dx: 0,
      dy: 0,
      m: null,
      emo: !!cy.emo,
      p: cy.p ?? null,
      seed: cy.seed,
      seed2: cy.seed,
      dice: set.dice,
      sw: {},
    };
    STARTS[cy.brain]?.(st);
    if (!cached) brainStates.set(r, st);
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
  return { anim: st.cur + variant, at: tick - st.set + 1, flip: st.flip, dx: st.dx, dy: st.dy };
}

// what a record shows at a tick: its animation, frame, place and facing, after
// the cycles the game runs without a player
export function resolveRecord(r, set, tick) {
  const anims = set.anims;
  let anim = r.anim,
    x = r.x,
    y = r.y,
    flip = r.flip;
  const cy = r.cycle;
  let at = tick; // the tick the shown animation counts from
  if (cy) {
    if (cy.kind === "brain") {
      const w = brainAt(r, set, tick);
      anim = w.anim;
      at = w.at;
      x += w.dx;
      y += w.dy;
      if (w.flip) flip = !flip;
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
