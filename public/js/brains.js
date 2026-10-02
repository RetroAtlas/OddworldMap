// The brains the game runs without a player, ported from the decomp: each a
// sub-state machine over the engine's frame counter, rolling the game's own
// dice (its 256-byte table, walked from a seed), and the motions that chain one
// animation into the next at its last frame. A step is one engine tick: the
// brain, then the motion of whatever it left current, with the last-frame flag
// the previous tick's animation step left behind; the clock steps them.
// No DOM, so it stays importable in bare Node.

import {
  camVoidX,
  camVoidY,
  gridSize,
  moveOnLine,
  nextLine,
  onEndOfLine,
  prevLine,
  raycast,
  tlvAt,
  wallHit,
} from "./collide.js";

// the engine's frame counter stands far past any timer a brain sets as an
// absolute frame by the time a screen has loaded
export const SPAWN_FRAME = 1000;

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
export const STARTS = {
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

export const BRAINS = {
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
export const MOTIONS = {
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

// ---- the creatures on patrol -------------------------------------------------
// A patrol brain owns a position on the path's collision lines and walks it
// with PathLine::MoveOnLine, handing over to the linked line; its world is the
// path's lines, their links and its objects, and nobody is ever in sight.

const TRACK = [8];
const floorOf = (half) => (half ? [4] : [0]);

// the line under a spawn, as the constructor's downward raycast found it
function standOn(st, x, y, reach) {
  const hit = raycast(st.w.lines, x, y, x, y + reach, floorOf(st.w.half));
  st.line = hit ? hit.line : null;
  st.x = x;
  st.y = hit ? hit.y : y;
  st.x0 = st.x;
  st.y0 = st.y;
  st.velx = 0;
}

// a step along the held line; a chain that ends leaves the creature standing
// at its edge, where the game would have it fall. In Oddysee a step that lands
// in the void between screens is carried into the next, onto the line a probe
// finds there, as the engine carries Abe and its moving bombs
function follow(st, types = floorOf(st.w.half), yVelAgainstX = false) {
  if (st.line === null || st.velx === 0) return;
  const ox = st.x,
    oy = st.y;
  const r = moveOnLine(st.w.lines, st.w.links, st.line, st.x, st.y, st.velx, st.w.game === "AO");
  if (!r) {
    st.line = null;
    st.velx = 0;
    return;
  }
  st.line = r.line;
  st.x = r.x;
  st.y = r.y;
  if (st.w.game !== "AO") return;
  const sx = camVoidX(ox, st.x - ox, 12);
  if (sx !== null) {
    st.x = sx;
    const hit = raycast(st.w.lines, sx, st.y - 20, sx, st.y + 20, types);
    if (hit) {
      st.y = hit.y;
      st.line = hit.line;
    }
  }
  const sy = camVoidY(oy, yVelAgainstX ? st.y - ox : st.y - oy, 12);
  if (sy !== null) {
    st.y = sy;
    const hit = raycast(st.w.lines, st.x - 20, st.y, st.x + 20, st.y, types);
    if (hit) {
      st.x = hit.x;
      st.line = hit.line;
    }
  }
}

const place = (st) => {
  st.dx = st.x - st.x0;
  st.dy = st.y - st.y0;
};

const scaleOf = (st) => (st.w.half ? 0.5 : 1);
const grid = (st) => gridSize(st.w.half);
const wall = (st, offY, offX) => wallHit(st.w.lines, st.x, st.y, offY, offX, st.w.half);

// HandleEnemyStopper: a stopper set to stop this way; Exoddus heeds one whose
// switch is on, Oddysee one whose switch is off
function stopperBlocks(st, t, left) {
  if (!t) return false;
  const f = t.fields || {};
  const dir = f.stop_direction;
  if (!(dir === 2 || (dir === 0 && left) || (dir === 1 && !left))) return false;
  const on = switchGet(st, f.switch_id) !== 0;
  return st.w.game === "AE" ? on : !on;
}
function enemyStopper(st, grids, left, aboveGrid) {
  const g = grid(st) * grids;
  const y2 = st.y - (aboveGrid ? grid(st) : 0);
  return stopperBlocks(
    st,
    tlvAt(st.w.tlvs, st.x, st.y, st.x + (left ? -g : g), y2, "EnemyStopper"),
    left,
  );
}

// ---- Slig: a walk to the zone's edge, a pause, a turn, and back
const sligFacingLeft = (st) =>
  st.cur === "Slig_TurnAroundStanding" && st.m.frame > 4 ? !st.flip : st.flip;

function sligToStand(st, now, rnd) {
  st.velx = 0;
  st.cur = "Slig_Idle";
  st.reloadT = randomRange(st, rnd, 0, 60) + now + 120;
}

function sligMainMovement(st, now, rnd) {
  if (st.next === "Slig_TurnAroundStanding") {
    st.cur = st.next;
    st.next = null;
    return 1;
  }
  if (st.next === "Slig_Walking") {
    const g = grid(st);
    if (wall(st, (st.w.game === "AO" ? 35 : 45) * scaleOf(st), st.flip ? -g : g)) return 0;
    st.velx = (st.flip ? -g : g) / 9;
    st.cur = "Slig_StandToWalk";
    st.next = null;
    return 1;
  }
  sligToStand(st, now, rnd);
  return 0;
}

function sligPause(st, now, rnd) {
  const p = st.p;
  if (st.flip) {
    st.timer = now + p.leftMin;
    if (p.leftMax > p.leftMin) st.timer += rnd() % (p.leftMax - p.leftMin);
  } else {
    st.timer = now + p.rightMin;
    if (p.rightMax > p.rightMin) st.timer += rnd() % (p.rightMax - p.rightMin);
  }
  st.next = "Slig_Idle";
  st.sub = 2;
}

function sligWalking(st, now, rnd) {
  const g2 = 2 * grid(st);
  if (st.velx > 0 && st.x + g2 >= st.zone.w) return sligPause(st, now, rnd);
  if (st.velx < 0 && st.x - g2 <= st.zone.x) return sligPause(st, now, rnd);
  if (st.velx === 0 && st.cur === "Slig_Idle" && st.next !== "Slig_Walking")
    return sligPause(st, now, rnd);
  if (enemyStopper(st, 2, sligFacingLeft(st), st.w.game === "AE")) return sligPause(st, now, rnd);
  rnd(); // the roll against percent_beat_mud, spent whether or not a Mudokon is near
}

function sligWaitOrWalk(st, now, rnd) {
  st.next = "Slig_Walking";
  st.sub = 1;
  const g2 = 2 * grid(st);
  const left = sligFacingLeft(st);
  if (!left && st.x + g2 >= st.zone.w) sligPause(st, now, rnd);
  else if (left && st.x - g2 <= st.zone.x) sligPause(st, now, rnd);
  else sligWalking(st, now, rnd);
}

STARTS.slig = (st) => {
  standOn(st, st.w.spawn.x, st.w.spawn.y, 24);
  st.zone = st.p.zone;
  st.timer = SPAWN_FRAME + st.p.pauseTime;
  st.reloadT = 0;
};

BRAINS.slig = (st, now, rnd) => {
  if (st.line === null) return;
  switch (st.sub) {
    case 0:
      if (st.timer > now) return;
      sligWaitOrWalk(st, now, rnd);
      return;
    case 1:
      sligWalking(st, now, rnd);
      return;
    case 2:
      if (st.cur === "Slig_Idle" && st.timer <= now) {
        st.next = "Slig_TurnAroundStanding";
        st.sub = 3;
      }
      return;
    case 3:
      if (
        (st.cur === "Slig_TurnAroundStanding" && st.m.last) ||
        (st.w.game === "AE" && st.cur === "Slig_Idle" && st.next === null)
      )
        sligWaitOrWalk(st, now, rnd);
  }
};

const sligMove = (st) => {
  follow(st);
  place(st);
};

Object.assign(MOTIONS, {
  Slig_Idle(st, last, frame, rnd, now) {
    if (st.line === null) return;
    if (sligMainMovement(st, now, rnd) === 0 && now >= st.reloadT) st.cur = "Slig_ReloadGun";
  },
  Slig_StandToWalk(st, last) {
    sligMove(st);
    if (last) st.cur = "Slig_Walking";
  },
  Slig_Walking(st, last, frame, rnd, now) {
    const ao = st.w.game === "AO";
    const g = grid(st);
    if (!ao) st.velx = (st.flip ? -g : g) / 9;
    if (wall(st, (ao ? 35 : 45) * scaleOf(st), st.velx * 2)) {
      if (!ao || last) sligToStand(st, now, rnd);
      return;
    }
    sligMove(st);
    if (st.line === null) {
      sligToStand(st, now, rnd);
      return;
    }
    if (frame === 11) {
      if (wall(st, (ao ? 35 : 45) * scaleOf(st), (st.flip ? -g : g) * 2.5))
        st.cur = "Slig_WalkToStand";
      else if (st.next !== null) st.cur = "Slig_WalkToStand";
    }
  },
  Slig_WalkToStand(st, last, frame, rnd, now) {
    sligMove(st);
    if (last) sligMainMovement(st, now, rnd);
  },
  Slig_TurnAroundStanding(st, last, frame, rnd, now) {
    if (last) {
      st.flip = !st.flip;
      sligToStand(st, now, rnd);
    }
  },
  Slig_ReloadGun(st, last, frame, rnd, now) {
    if (last) sligToStand(st, now, rnd);
  },
});

// ---- Scrab: walks or runs to its bound, turns, waits, and howls now and then
// its stride tables are the engine's 16.16 fixed-point values, one per frame
const fp16 = (raw) => raw.map((v) => v / 65536);
const SCRAB_WALK = fp16([
  102930, 103419, 99987, 102573, 104637, 242098, 259357, 260279, 216749, 172338, 142077, 132519,
  118230, 105285, 173137, 176018, 175184, 176362, 91533, 90242, 90225, 141864,
]);
const SCRAB_RUN = fp16([
  622509, 637911, 628107, 599066, 596319, 627575, 611255, 567207, 346759, 280505, 225862, 222655,
  249941, 337964,
]);
const SCRAB_RUN_TO_STAND = fp16([
  490908, 453112, 254902, 155230, 49871, 42004, 46393, 50715, 47541, 0,
]);
const SCRAB_STAND_TO_WALK = [1.1195, 2.3692, 3.2077];
const SCRAB_WALK_TO_STAND = [1.0415, 3.2936, 2.8589];
const SCRAB_STAND_TO_RUN = [2.2977, 2.6964, 3.8795];
const SCRAB_STOPS = new Set(["Scrab_Idle", "Scrab_Turn", "Scrab_HowlBegin", "Scrab_Shriek"]);
// the chance a patrol type runs rather than walks, as a roll to beat
const SCRAB_RUN_CHANCE = { 0: 256, 1: 192, 2: 128, 3: 64, 4: 0, 5: 0 };

const scrabVel = (st, table, frame) => {
  const v = (table[frame] ?? 0) * scaleOf(st);
  st.velx = st.flip ? -v : v;
};

function scrabToStand(st) {
  st.velx = 0;
  st.cur = "Scrab_Idle";
}

function scrabToNextMotion(st) {
  const ao = st.w.game === "AO";
  const g = grid(st);
  const probe = (ao ? 30 : 45) * scaleOf(st);
  switch (st.next) {
    case "Scrab_Turn":
    case "Scrab_HowlBegin":
    case "Scrab_Shriek":
      st.cur = st.next;
      st.next = null;
      return 1;
    case "Scrab_Run":
      if (wall(st, probe, st.flip ? -g : g)) return 0;
      st.velx = (st.flip ? -g : g) / 3.5;
      st.cur = "Scrab_StandToRun";
      st.next = null;
      return 1;
    case "Scrab_Walk":
      if (wall(st, probe, st.flip ? -g : g)) return 0;
      st.velx = (st.flip ? -g : g) / 7;
      st.cur = "Scrab_StandToWalk";
      st.next = null;
      return 1;
    case "Scrab_Idle":
      scrabToStand(st);
      return 1;
  }
  return 0;
}

const scrabTryMoveOrStand = (st) => {
  if (!scrabToNextMotion(st)) scrabToStand(st);
};

// Exoddus's bound probe: a wall, a stopper or the bound of the facing side,
// one grid ahead or two at a run
function scrabAtBound(st) {
  const g = grid(st) * (Math.abs(st.velx) > 5 ? 2 : 1);
  const ahead = st.flip ? -g : g;
  if (wall(st, 45 * scaleOf(st), ahead)) return true;
  if (enemyStopper(st, Math.abs(st.velx) > 5 ? 2 : 1, st.flip, true)) return true;
  return (
    tlvAt(
      st.w.tlvs,
      st.x,
      st.y,
      st.x + ahead,
      st.y - grid(st),
      st.flip ? "ScrabLeftBound" : "ScrabRightBound",
    ) !== null
  );
}

const scrabEdge = (st) =>
  onEndOfLine(
    st.w.game,
    st.w.lines,
    st.x,
    st.y,
    st.w.half,
    st.flip,
    st.cur === "Scrab_Run" ? 3 : 1,
  );

STARTS.scrab = (st) => {
  standOn(st, st.w.spawn.x, st.w.spawn.y, 30);
  st.moveT = 0;
};

const scrabPatrolMotion = (st, rnd) => {
  const { chance } = st.p;
  // Oddysee rolls for its three mixed types alone
  if (st.w.game === "AO" && !(chance >= 1 && chance <= 3))
    return chance === 4 ? "Scrab_Run" : "Scrab_Walk";
  return rnd() >= (SCRAB_RUN_CHANCE[chance] ?? 256) ? "Scrab_Run" : "Scrab_Walk";
};

BRAINS.scrab = (st, now, rnd) => {
  if (st.line === null) return;
  if (st.w.game === "AO") return scrabAO(st, now, rnd);
  switch (st.sub) {
    case 0:
      if (scrabEdge(st) || scrabAtBound(st)) {
        st.next = "Scrab_Turn";
        st.sub = 2;
        return;
      }
      st.next = scrabPatrolMotion(st, rnd);
      st.sub = 1;
      return;
    case 1:
      if (scrabEdge(st) || scrabAtBound(st)) {
        st.next = "Scrab_Turn";
        st.sub = 2;
        return;
      }
      if (rnd() < 3 && now - st.moveT > 150) {
        st.next = "Scrab_Shriek";
        st.moveT = now;
        st.sub = 5;
      }
      return;
    case 2:
      if (st.cur === "Scrab_Turn" && st.m.last) {
        st.next = "Scrab_Idle";
        st.timer =
          now +
          (st.flip
            ? randomRange(st, rnd, st.p.leftMin, st.p.leftMax)
            : randomRange(st, rnd, st.p.rightMin, st.p.rightMax));
        st.sub = 3;
      }
      return;
    case 3:
      if (now <= st.timer) return;
      if (rnd() >= 30 || now - st.moveT <= 150) st.sub = 0;
      else {
        st.next = "Scrab_HowlBegin";
        st.moveT = now;
        st.sub = 4;
      }
      return;
    case 4:
      if (st.cur === "Scrab_HowlBegin" && st.m.last) {
        st.next = "Scrab_Idle";
        st.sub = 0;
      }
      return;
    case 5:
      if (st.cur === "Scrab_Shriek" && st.m.last) {
        st.next = "Scrab_Idle";
        st.sub = 0;
      }
  }
};

// Oddysee's patrol: the bound is met at the creature's own point a grid on
function scrabAO(st, now, rnd) {
  const g = grid(st);
  const left = st.flip;
  switch (st.sub) {
    case 0:
      if (enemyStopper(st, 0, left, false)) return;
      st.next = scrabPatrolMotion(st, rnd);
      if (left) {
        if (tlvAt(st.w.tlvs, st.x, st.y, st.x, st.y, "ScrabLeftBound")) {
          st.next = "Scrab_Turn";
          st.sub = 2;
        } else st.sub = 1;
      } else if (tlvAt(st.w.tlvs, st.x, st.y, st.x, st.y, "ScrabRightBound")) {
        st.next = "Scrab_Turn";
        st.sub = 5;
      } else st.sub = 4;
      return;
    case 1:
      if (tlvAt(st.w.tlvs, st.x - g, st.y, st.x - g, st.y, "ScrabLeftBound")) {
        st.next = "Scrab_Turn";
        st.sub = 2;
      }
      return;
    case 4:
      if (tlvAt(st.w.tlvs, st.x + g, st.y, st.x + g, st.y, "ScrabRightBound")) {
        st.next = "Scrab_Turn";
        st.sub = 5;
      }
      return;
    case 2:
    case 5:
      if (st.cur === "Scrab_Turn" && st.m.last) {
        st.next = "Scrab_Idle";
        st.timer =
          now +
          (st.sub === 2
            ? randomRange(st, rnd, st.p.leftMin, st.p.leftMax)
            : randomRange(st, rnd, st.p.rightMin, st.p.rightMax));
        st.sub = st.sub === 2 ? 3 : 6;
      }
      return;
    case 3:
    case 6:
      if (st.timer > now) return;
      if (rnd() < 30) {
        st.next = "Scrab_HowlBegin";
        st.timer = now + 30;
        st.sub = 7;
      } else {
        st.next = scrabPatrolMotion(st, rnd);
        st.sub = st.sub === 3 ? 4 : 1;
      }
      return;
    case 7:
      if (st.timer > now) return;
      st.next = scrabPatrolMotion(st, rnd);
      st.sub = st.flip ? 1 : 4;
  }
}

const scrabMove = (st) => {
  follow(st);
  place(st);
  if (st.line === null) {
    scrabToStand(st);
    st.next = null;
  }
};

Object.assign(MOTIONS, {
  Scrab_Idle(st) {
    scrabToNextMotion(st);
  },
  Scrab_StandToWalk(st, last, frame) {
    scrabVel(st, SCRAB_STAND_TO_WALK, frame & 3);
    if (st.w.game === "AO" && wall(st, 30 * scaleOf(st), st.velx)) return scrabToStand(st);
    scrabMove(st);
    if (last && st.cur === "Scrab_StandToWalk") st.cur = "Scrab_Walk";
  },
  Scrab_Walk(st, last, frame) {
    const ao = st.w.game === "AO";
    scrabVel(st, SCRAB_WALK, frame);
    // Oddysee probes the wall before its stride, Exoddus after it and knocks back,
    // which the map draws as a stand since no knockback art ships
    if (ao && wall(st, 30 * scaleOf(st), st.velx * 1.5)) return scrabToStand(st);
    scrabMove(st);
    if (st.cur !== "Scrab_Walk") return;
    if (!ao && wall(st, 45 * scaleOf(st), (st.flip ? -0.5 : 0.5) * grid(st)))
      return scrabToStand(st);
    if (frame === 5 || frame === 15) {
      const g = grid(st);
      if (!ao && wall(st, 45 * scaleOf(st), st.flip ? -g : g)) st.cur = "Scrab_WalkToStand";
      else if (SCRAB_STOPS.has(st.next)) st.cur = "Scrab_WalkToStand";
    }
  },
  Scrab_WalkToStand(st, last, frame) {
    scrabVel(st, SCRAB_WALK_TO_STAND, frame & 3);
    if (st.w.game === "AO" && wall(st, 30 * scaleOf(st), st.velx)) return scrabToStand(st);
    scrabMove(st);
    if (last && st.cur === "Scrab_WalkToStand") scrabTryMoveOrStand(st);
  },
  Scrab_StandToRun(st, last, frame) {
    scrabVel(st, SCRAB_STAND_TO_RUN, frame & 3);
    if (wall(st, (st.w.game === "AO" ? 30 : 45) * scaleOf(st), st.velx)) return scrabToStand(st);
    scrabMove(st);
    if (last && st.cur === "Scrab_StandToRun") st.cur = "Scrab_Run";
  },
  Scrab_Run(st, last, frame) {
    const ao = st.w.game === "AO";
    scrabVel(st, SCRAB_RUN, frame);
    if (wall(st, (ao ? 30 : 45) * scaleOf(st), ao ? st.velx : (st.flip ? -0.5 : 0.5) * grid(st)))
      return scrabToStand(st);
    scrabMove(st);
    if (st.cur !== "Scrab_Run") return;
    if ((frame === 3 || frame === 10) && SCRAB_STOPS.has(st.next)) st.cur = "Scrab_RunToStand";
  },
  Scrab_RunToStand(st, last, frame) {
    scrabVel(st, SCRAB_RUN_TO_STAND, frame);
    if (wall(st, (st.w.game === "AO" ? 30 : 45) * scaleOf(st), st.velx)) return scrabToStand(st);
    scrabMove(st);
    if (last && st.cur === "Scrab_RunToStand") scrabTryMoveOrStand(st);
  },
  Scrab_Turn(st, last) {
    if (last) {
      st.flip = !st.flip;
      scrabTryMoveOrStand(st);
    }
  },
  Scrab_HowlBegin(st, last) {
    if (!last) return;
    if (st.next === null) {
      if (st.w.game === "AE") scrabToStand(st);
    } else st.cur = "Scrab_HowlEnd";
  },
  Scrab_HowlEnd(st, last) {
    if (last) scrabTryMoveOrStand(st);
  },
  Scrab_Shriek(st, last) {
    if (last) scrabTryMoveOrStand(st);
  },
});

// ---- Fleech: an awake one on the ground turns, cries and crawls about its perch
const FLEECH_CRAWL = [3.8364, 3.3688, 4.6883, 4.9884, 2.5774, 3.3114, 2.2292];

function fleechToIdle(st) {
  st.velx = 0;
  st.cur = "Fleech_Idle";
  st.next = null;
  st.dice[st.seed2++ & 255];
}

STARTS.fleech = (st) => {
  standOn(st, st.w.spawn.x, st.w.spawn.y, 24);
  st.anger = 2 + Math.trunc((st.p.increaser - 2) / 2);
  st.target = null;
  st.centre = st.x;
  st.rndCrawl = 0;
};

BRAINS.fleech = (st, now) => {
  if (st.line === null) return;
  const own = () => st.dice[st.seed2++ & 255];
  const p = st.p;
  switch (st.sub) {
    case 0:
      st.rndCrawl = own() & 0x3f;
      st.centre = st.x;
      st.sub = st.anger > 2 || !p.goesToSleep ? 4 : 3;
      return;
    case 4: {
      if (now % 32 === 0 && st.anger > 0) st.anger--;
      if (own() % 32 === 0 && st.cur === "Fleech_Idle") {
        st.cur = "Fleech_Knockback";
        return;
      }
      if (
        st.cur === "Fleech_Crawl" &&
        st.target !== null &&
        (st.velx > 0 ? st.x >= st.target : st.x <= st.target)
      )
        st.next = "Fleech_StopMidCrawlCycle";
      if (st.cur === "Fleech_Idle" && p.range > 0 && --st.rndCrawl <= 0) {
        st.target = st.flip
          ? st.x - (own() * (st.x + p.range - st.centre)) / 255
          : st.x + (own() * (p.range + st.centre - st.x)) / 255;
        st.rndCrawl = own() & 0x3f;
        st.next = "Fleech_Crawl";
      }
      if (!p.goesToSleep || st.anger >= 2) {
        if (own() % 64 === 0 && st.cur === "Fleech_Idle") st.cur = "Fleech_PatrolCry";
      } else {
        st.anger = 0;
        st.next = "Fleech_Sleeping";
        st.sub = 1;
      }
      return;
    }
  }
};

Object.assign(MOTIONS, {
  Fleech_Idle(st) {
    if (st.next === "Fleech_Knockback") {
      st.cur = st.next;
      st.next = null;
    } else if (st.next === "Fleech_Crawl") {
      const g = grid(st);
      st.velx = (st.flip ? -g : g) / 7;
      // the fleech asks at one point: a grid ahead facing right, its own x facing left
      const px = st.x + (st.flip ? -g : g);
      const sx = st.flip ? st.x : px;
      if (
        wall(st, st.w.half ? 5 : 10, st.flip ? -g : g) ||
        stopperBlocks(st, tlvAt(st.w.tlvs, sx, st.y, sx, st.y, "EnemyStopper"), st.flip)
      )
        fleechToIdle(st);
      else st.cur = "Fleech_Crawl";
      st.next = null;
    } else if (st.next !== null) {
      st.cur = st.next;
      st.next = null;
    }
  },
  Fleech_Crawl(st, last, frame) {
    const f = frame % 7;
    const v = FLEECH_CRAWL[f] * scaleOf(st);
    st.velx = st.flip ? -v : v;
    const g = grid(st);
    if (wall(st, st.w.half ? 5 : 10, st.flip ? -g : g)) return fleechToIdle(st);
    const before = { line: st.line, x: st.x, y: st.y };
    follow(st);
    if (st.line === null) {
      Object.assign(st, before);
      fleechToIdle(st);
    } else if (!floorOf(st.w.half).includes(st.w.lines[st.line][4])) {
      // a line the fleech cannot crawl: the step is taken back and it turns
      Object.assign(st, before);
      st.cur = "Fleech_Knockback";
    }
    place(st);
    if (st.cur !== "Fleech_Crawl" || f !== 6) return;
    if (st.next === "Fleech_Idle") st.cur = "Fleech_StopMidCrawlCycle";
    else if (st.next !== null) {
      st.cur = st.next;
      st.next = null;
    }
  },
  Fleech_StopMidCrawlCycle(st, last) {
    const g = grid(st);
    if (last || wall(st, st.w.half ? 5 : 10, st.flip ? -g : g)) fleechToIdle(st);
  },
  Fleech_PatrolCry(st, last) {
    if (last) fleechToIdle(st);
  },
  Fleech_Knockback(st, last) {
    if (last) {
      st.flip = !st.flip;
      fleechToIdle(st);
    }
  },
});

// ---- Moving bomb: along its track line, stopped a rolled while at each stopper
STARTS.bomb = (st) => {
  const s = st.w.spawn;
  const hit = raycast(st.w.lines, s.x, s.y, s.x + 24, s.y + 24, TRACK);
  st.line = hit ? hit.line : null;
  st.x = hit ? hit.x : s.x;
  st.y = hit ? hit.y : s.y;
  st.x0 = st.x;
  st.y0 = st.y;
  st.velx = st.p.startSpeed;
  st.sub = 0;
};

const bombStopper = (st) => {
  const x = Math.trunc(st.x),
    y = Math.trunc(st.y);
  return tlvAt(st.w.tlvs, x, y, x, y, "MovingBombStopper");
};

BRAINS.bomb = (st, now, rnd) => {
  const p = st.p;
  const accel = scaleOf(st) * 0.5;
  const ride = () => follow(st, TRACK, true);
  switch (st.sub) {
    case 0:
      if (switchGet(st, p.switchId)) st.sub = 2;
      return;
    case 2: {
      if (st.velx < p.speed) st.velx += accel;
      ride();
      const stop = bombStopper(st);
      if (stop) {
        const f = stop.fields || {};
        st.stopMin = f.min ?? f.min_delay ?? 0;
        st.stopMax = f.max ?? f.max_delay ?? 0;
        st.sub = 3;
      }
      break;
    }
    case 3:
      st.velx -= accel;
      if (st.velx < 0) {
        st.sub = 4;
        st.timer = now + randomRange(st, rnd, st.stopMin, st.stopMax);
      }
      ride();
      break;
    case 4:
      if (st.timer <= now) st.sub = 5;
      return;
    case 5:
      if (st.velx < p.speed) st.velx += accel;
      ride();
      if (!bombStopper(st)) st.sub = 2;
  }
  place(st);
};

// ---- Slurg: half a unit a tick, a pause now and then, back at a bound or an edge
STARTS.slurg = (st) => {
  standOn(st, st.w.spawn.x, st.w.spawn.y, 24);
  st.left = st.p.right; // Bit1: set means moving toward -x, and the field's names run the other way
  st.timer = st.p.delay;
  st.state = "moving";
  st.odd = false;
};

function slurgTurn(st, left) {
  st.flip = left;
  st.left = left;
  st.state = "stopped";
  st.cur = "Slurg_Turn_Around";
}

BRAINS.slurg = (st, now, rnd) => {
  if (st.line === null) return;
  const s = scaleOf(st);
  if (st.timer === 0) {
    st.timer = randomRange(st, rnd, st.p.delay, st.p.delay + 20);
    st.state = "stopped";
    st.cur = "Slurg_Turn_Around";
  }
  let moved = false;
  if (st.state === "moving") {
    st.velx = st.left ? -1 : 1;
    st.timer--;
    st.odd = !st.odd;
    if (st.odd) {
      st.x += st.velx;
      moved = true;
    }
  } else {
    st.velx = 0;
    if (st.m.last) {
      st.state = "moving";
      st.cur = "Slurg_Move";
    }
  }
  if (moved) {
    const at = (name) => tlvAt(st.w.tlvs, st.x, st.y, st.x, st.y, name);
    if (st.left && at("ScrabLeftBound")) slurgTurn(st, false);
    else if (!st.left && at("ScrabRightBound")) slurgTurn(st, true);
    else if (st.left) {
      if (
        wall(st, 8 * s, -6 * s) ||
        onEndOfLine(st.w.game, st.w.lines, st.x, st.y, st.w.half, true, 1)
      )
        slurgTurn(st, false);
    } else if (
      wall(st, 8 * s, 6 * s) ||
      onEndOfLine(st.w.game, st.w.lines, st.x, st.y, st.w.half, false, 1)
    )
      slurgTurn(st, true);
  }
  place(st);
};

// ---- Greeter: rolls its beat at three units a tick, turns at bounds, stopper,
// walls and edges, stops to speak, and sweeps its laser across its path. The
// body, the flare and the laser are three records running one brain.
const GREETER_SWEEP = 75;

STARTS.greeter = (st, r) => {
  standOn(st, st.w.spawn.x, st.w.spawn.y, 24);
  st.part = st.p.part;
  st.own = r.anim;
  st.cur = "Greeter_Moving";
  st.body = "Greeter_Moving";
  st.state = "patrol";
  st.speakT = SPAWN_FRAME + randomRange(st, () => st.dice[st.seed++ & 255], 70, 210);
  st.laserX = st.x;
  st.sweep = "right";
  st.sweepT = 0;
};

function greeterTurn(st) {
  st.state = "turn";
  st.velx = 0;
  st.body = "Greeter_Turn";
}

BRAINS.greeter = (st, now, rnd) => {
  if (st.line === null) return;
  const s = scaleOf(st);
  if (st.state === "patrol") {
    st.velx = st.flip ? 3 * s : -3 * s;
    st.body = "Greeter_Moving";
    if (now > st.speakT) {
      st.state = "speak";
      st.velx = 0;
      st.body = "Greeter_Speak";
    }
  } else if (st.state === "speak") {
    if (st.m.last) {
      st.state = "patrol";
      st.body = "Greeter_Moving";
      st.speakT = now + randomRange(st, rnd, 160, 200);
    }
  } else if (st.m.last) {
    st.state = "patrol";
    st.body = "Greeter_Moving";
    st.flip = !st.flip;
  }
  if (st.velx !== 0) {
    const px = st.x + 4 * st.velx;
    const at = (name) => tlvAt(st.w.tlvs, px, st.y, px, st.y, name);
    if (
      (!st.flip && at("ScrabLeftBound")) ||
      (st.flip && at("ScrabRightBound")) ||
      at("EnemyStopper")
    )
      greeterTurn(st);
    else if (
      (st.flip && onEndOfLine(st.w.game, st.w.lines, st.x, st.y, st.w.half, false, 1)) ||
      wall(st, 40 * s, st.velx * 3) ||
      (!st.flip && onEndOfLine(st.w.game, st.w.lines, st.x, st.y, st.w.half, true, 1))
    )
      greeterTurn(st);
    st.x += st.velx;
  }
  // the laser rides along and sweeps two units a tick between the ends of
  // its reach, waiting fifteen ticks at each
  st.laserX += st.velx;
  const x1 = st.x - GREETER_SWEEP * s,
    x2 = st.x + GREETER_SWEEP * s;
  switch (st.sweep) {
    case "right":
      if (st.laserX >= x2) {
        st.sweep = "waitLeft";
        st.sweepT = now + 15;
      } else st.laserX += 2;
      break;
    case "waitLeft":
      if (now > st.sweepT) st.sweep = "left";
      break;
    case "left":
      if (st.laserX <= x1) {
        st.sweep = "waitRight";
        st.sweepT = now + 15;
      } else st.laserX -= 2;
      break;
    case "waitRight":
      if (now > st.sweepT) st.sweep = "right";
  }
  st.cur = st.body;
  if (st.part !== "body") {
    st.show = st.own;
    st.hidden = st.state === "speak";
  }
  st.dx = (st.part === "laser" ? st.laserX : st.x) - st.x0;
};

// ---- Bat: hangs its while, takes off and flies its line to the chain's end,
// where the game removes it; the map returns it to its perch, as a fresh screen would
STARTS.bat = (st) => {
  const s = st.w.spawn;
  const hit = raycast(st.w.lines, s.x1, s.y1, s.x2, s.y2, TRACK);
  st.line = hit ? hit.line : null;
  const [ax, ay] = hit ? st.w.lines[hit.line] : [s.x1, s.y1];
  st.x = st.x0 = ax;
  st.y = st.y0 = ay;
  st.velx = 0;
  st.state = "wait";
  st.timer = null;
};

BRAINS.bat = (st, now, rnd) => {
  if (st.line === null) return;
  const speed = st.p.speed;
  const fly = () => {
    st.velx = Math.min(st.velx + 1.8, speed);
    const r = moveOnLine(st.w.lines, st.w.links, st.line, st.x, st.y, st.velx, true);
    if (!r) return false;
    st.line = r.line;
    st.x = r.x;
    st.y = r.y;
    return true;
  };
  switch (st.state) {
    case "wait":
      if (st.timer === null) st.timer = now + st.p.wait;
      else if (now > st.timer) {
        st.state = "takeoff";
        st.velx = 0;
        st.cur = "Bat_Unknown";
      }
      break;
    case "takeoff":
      fly();
      if (st.m.last) {
        st.state = "flying";
        st.cur = "Bat_Flying";
        randomRange(st, rnd, 0, 90);
      }
      break;
    case "flying":
      if (!fly()) {
        const perch = raycast(
          st.w.lines,
          st.w.spawn.x1,
          st.w.spawn.y1,
          st.w.spawn.x2,
          st.w.spawn.y2,
          TRACK,
        );
        st.line = perch.line;
        st.x = st.x0;
        st.y = st.y0;
        st.velx = 0;
        st.state = "wait";
        st.timer = null;
        st.cur = "Bat";
      }
  }
  place(st);
};

// ---- Exoddus's Glukkon: one that checks for walls paces between its bounds
// with rolled pauses and a word now and then; one that ignores them stands,
// turning or speaking on a low roll
const GLUKKON_WALK = fp16([
  0, 138412, 257097, 138412, 53543, 326763, 394395, 191561, 138412, 257097, 138412, 53543, 326763,
  394395, 191561, 138412, 257097, 138412,
]);
const glukAnim = (st, name) => `Glukkon_${st.p.type}_${name}`;
const GLUKKON_STOPS = ["Idle", "Turn", "Speak1", "LongLaugh"];

function glukkonBlocked(st) {
  const g = grid(st);
  const ahead = st.flip ? -g : g;
  if (wall(st, 50 * scaleOf(st), ahead)) return true;
  if (enemyStopper(st, 1, st.flip, true)) return true;
  return (
    tlvAt(
      st.w.tlvs,
      st.x,
      st.y,
      st.x + ahead,
      st.y - g,
      st.flip ? "ScrabLeftBound" : "ScrabRightBound",
    ) !== null
  );
}
const glukkonEdge = (st) => onEndOfLine(st.w.game, st.w.lines, st.x, st.y, st.w.half, st.flip, 1);

function glukkonSpeak(st, now) {
  st.next = glukAnim(st, now & 1 ? "Speak1" : "LongLaugh");
}

STARTS.glukkon = (st) => {
  standOn(st, st.w.spawn.x, st.w.spawn.y, 79);
  st.speakT = 0;
  st.turnT = 0;
};

BRAINS.glukkon = (st, now, rnd) => {
  if (st.line === null) return;
  const idle = glukAnim(st, "Idle");
  const check = st.p.checkWalls;
  switch (st.sub) {
    case 0:
      if (st.cur !== idle) return;
      if (check) {
        if (glukkonEdge(st) || glukkonBlocked(st)) {
          st.next = glukAnim(st, "Turn");
          st.sub = 2;
        } else {
          st.next = glukAnim(st, "BeginWalk");
          st.sub = 1;
        }
      } else {
        st.next = idle;
        st.sub = 1;
      }
      return;
    case 1:
      if (check && (glukkonEdge(st) || glukkonBlocked(st))) {
        if (now <= st.speakT) {
          st.next = idle;
          st.timer = now + randomRange(st, rnd, 30, 120);
          st.sub = 4;
        } else {
          st.speakT = now + 120;
          glukkonSpeak(st, now);
          st.sub = 3;
        }
        return;
      }
      if (!check && rnd() < 5 && now > st.turnT) {
        st.turnT = now + 120;
        st.next = glukAnim(st, "Turn");
        st.sub = 2;
        return;
      }
      if (rnd() < 5 && now > st.speakT) {
        st.speakT = now + 120;
        glukkonSpeak(st, now);
        st.sub = 6;
      }
      return;
    case 2:
      if (st.cur === idle) st.sub = 0;
      return;
    case 3:
      if (st.cur === idle && st.next === null) {
        st.timer = now + randomRange(st, rnd, 30, 120);
        st.sub = 4;
      }
      return;
    case 4:
      if (now > st.timer) {
        st.next = glukAnim(st, "Turn");
        st.sub = 2;
      }
      return;
    case 5:
      if (now > st.timer) st.sub = 0;
      return;
    case 6:
      if (st.cur === idle) {
        st.timer = now + randomRange(st, rnd, 30, 120);
        st.sub = 5;
      }
  }
};

function glukkonInput(st) {
  const idle = glukAnim(st, "Idle");
  if (st.next === null) {
    st.cur = idle;
    return;
  }
  if (st.next === glukAnim(st, "BeginWalk")) {
    const g = grid(st);
    if (!wall(st, 50 * scaleOf(st), st.flip ? -g : g)) {
      st.cur = st.next;
      st.next = null;
    } else st.cur = idle;
    return;
  }
  st.cur = st.next;
  st.next = null;
}

function glukkonMove(st, frame, table) {
  const v = (table ? (table[frame] ?? 0) : 0) * scaleOf(st);
  st.velx = st.flip ? -v : v;
  follow(st);
  place(st);
}

// every Glukkon art set runs the same motions
for (const type of ["Normal", "Aslik", "Dripik", "Phleg"]) {
  const n = (name) => `Glukkon_${type}_${name}`;
  Object.assign(MOTIONS, {
    [n("Idle")](st) {
      glukkonInput(st);
    },
    [n("BeginWalk")](st, last, frame) {
      glukkonMove(st, frame, null);
      if (last) st.cur = n("Walk");
    },
    [n("Walk")](st, last, frame) {
      glukkonMove(st, frame, GLUKKON_WALK);
      if (st.line === null) {
        st.cur = n("Idle");
        return;
      }
      if ((frame === 8 || frame === 17) && GLUKKON_STOPS.some((m) => st.next === n(m)))
        st.cur = frame === 8 ? n("EndSingleStep") : n("EndWalk");
    },
    [n("EndSingleStep")](st, last, frame) {
      glukkonMove(st, frame, null);
      if (last) glukkonInput(st);
    },
    [n("EndWalk")](st, last, frame) {
      glukkonMove(st, frame, null);
      if (last) glukkonInput(st);
    },
    [n("Turn")](st, last) {
      if (last) {
        st.flip = !st.flip;
        st.velx = 0;
        st.cur = n("Idle");
      }
    },
    [n("Speak1")](st, last) {
      if (last) glukkonInput(st);
    },
    [n("LongLaugh")](st, last) {
      if (last) glukkonInput(st);
    },
  });
}

// ---- Oddysee's background Glukkon: a word every dozen-odd ticks, the line
// picked by a roll, with every fifth roll holding its tongue a tick longer
BRAINS.glukkonAO = (st, now, rnd) => {
  switch (st.sub) {
    case 0:
      st.sub = 1;
      return;
    case 1:
      st.timer = now + randomRange(st, rnd, 12, 20);
      st.sub = 2;
      return;
    case 2: {
      if (now <= st.timer) return;
      randomRange(st, rnd, 110, 127);
      rnd();
      const line = rnd() % 5;
      if (line === 4) return;
      st.cur =
        line === 0 || line === 2 ? "Background_Glukkon_KillHim1" : "Background_Glukkon_KillHim2";
      st.sub = 3;
      return;
    }
    case 3:
      if (st.m.last) {
        st.cur = "Background_Glukkon_Idle";
        st.sub = 1;
      }
  }
};

// ---- Flying Slig: patrols its track line at up to its top speed, braking
// for the chain's end or a bound, pausing, and flying back; its animation
// follows where the track leads and which way it faces, and it bobs on
// tables of its own
const FLY_ACCEL = 0.4;
const FLY_BOB = {
  idle: [1.141, 1.298, 1.22, 0.905, 0.354, -0.527, -1.258, -1.501, -1.258, -0.527, 0],
  horizontal: [-2.5, -3.75, -4.375, -5, -4.375, -3.75, -2.5, -1],
  turning: [0.589, 1.296, 1.296, 0.589, -2.854, -5.261, -2.717, 1.069, 1.527, 0.584],
};
const F = (name) => `FlyingSlig_${name}`;

const lineLen = (l) => Math.hypot(l[2] - l[0], l[3] - l[1]);

STARTS.flyslig = (st) => {
  const s = st.w.spawn;
  const hit = raycast(st.w.lines, s.x1, s.y1, s.x2, s.y2, TRACK);
  st.line = hit ? hit.line : null;
  const l = st.line !== null ? st.w.lines[st.line] : [s.x1, s.y1, s.x1, s.y1];
  st.x = st.x0 = l[0];
  st.y = st.y0 = l[1];
  st.dist = 0;
  st.speed = 0;
  st.forward = st.p.left; // Bit4: travel toward the line's end
  st.xSpeed = 0;
  st.ySpeed = 0;
  st.timer = SPAWN_FRAME + (st.p.delayed ? st.p.delay : 1);
  st.bobTable = null;
  st.bobI = 0;
  st.bob = 0;
};

// a bound at a line end stops travel that would cross it
function flyBoundBlocks(st, end, forward) {
  const g = grid(st);
  const [x, y] = end;
  const bound =
    tlvAt(st.w.tlvs, x - g, y - g, x + g, y + g, "SligBoundLeft") ??
    tlvAt(st.w.tlvs, x - g, y - g, x + g, y + g, "SligBoundRight");
  if (!bound) return false;
  const l = st.w.lines[st.line];
  const width = (l[2] - l[0]) * (forward ? 1 : -1);
  if (bound.name === "SligBoundLeft" && width > 0) return false;
  if (bound.name === "SligBoundRight" && width < 0) return false;
  return true;
}

function flyDelay(st, rnd) {
  st.timer = st.now + st.p.pauseMin;
  if (st.p.pauseMin > st.p.pauseMax) st.timer += rnd() % (st.p.pauseMin - st.p.pauseMax);
  st.sub = 5;
}

BRAINS.flyslig = (st, now, rnd) => {
  if (st.line === null) return;
  st.now = now;
  const lines = st.w.lines,
    links = st.w.links;
  const ao = false;
  let acc = 0;
  if (st.sub === 0 || st.sub === 5) {
    if (now >= st.timer) st.sub = 2;
  }
  if (st.sub === 2) {
    const l = lines[st.line];
    const len = lineLen(l);
    const neighbour = st.forward
      ? nextLine(lines, links, st.line, ao)
      : prevLine(lines, links, st.line, ao);
    const end = st.forward ? [l[2], l[3]] : [l[0], l[1]];
    const blocked = flyBoundBlocks(st, end, st.forward);
    if (neighbour !== null && !blocked) acc = st.forward ? 1 : -1;
    else {
      const rem = st.forward ? len - st.dist : st.dist;
      if (rem < st.p.maxSpeed && st.speed === 0) {
        st.forward = !st.forward;
        flyDelay(st, rnd);
      } else if ((st.speed * st.speed) / (2 * FLY_ACCEL) < rem) acc = st.forward ? 1 : -1;
    }
  }
  // the speed answers the push, or decays toward rest
  if (acc !== 0)
    st.speed = Math.max(-st.p.maxSpeed, Math.min(st.p.maxSpeed, st.speed + acc * FLY_ACCEL));
  else if (st.speed > 0) st.speed = Math.max(0, st.speed - FLY_ACCEL);
  else if (st.speed < 0) st.speed = Math.min(0, st.speed + FLY_ACCEL);
  if (st.speed !== 0) {
    st.dist += st.speed;
    let l = lines[st.line];
    let len = lineLen(l);
    while (st.dist > len) {
      const n = nextLine(lines, links, st.line, ao);
      if (n === null) {
        st.dist = len;
        break;
      }
      st.dist -= len;
      st.line = n;
      l = lines[n];
      len = lineLen(l);
    }
    while (st.dist < 0) {
      const p = prevLine(lines, links, st.line, ao);
      if (p === null) {
        st.dist = 0;
        break;
      }
      st.line = p;
      l = lines[p];
      len = lineLen(l);
      st.dist += len;
    }
    const t = len ? st.dist / len : 0;
    st.x = l[0] + (l[2] - l[0]) * t;
    st.y = l[1] + (l[3] - l[1]) * t;
  }
  // the heading is the push's, so a braking slig reads as going nowhere
  const heading = acc !== 0 ? lines[st.line] : null;
  st.xSpeed = heading ? Math.sign(heading[2] - heading[0]) * acc : 0;
  st.ySpeed = heading ? Math.sign(heading[3] - heading[1]) * acc : 0;
  // the bob: a table plays out once armed, then the lift decays a unit a tick
  if (st.bobTable) {
    const table = FLY_BOB[st.bobTable];
    if (st.bobI < table.length) st.bob = table[st.bobI++];
    else {
      st.bob = 0;
      st.bobTable = null;
    }
  } else if (st.bob > 0) st.bob = Math.max(0, st.bob - 1);
  else if (st.bob < 0) st.bob = Math.min(0, st.bob + 1);
  st.dx = st.x - st.x0;
  st.dy = st.y - st.y0 + st.bob;
};

const flyFacing = (st) => (st.xSpeed > 0 && !st.flip) || (st.xSpeed < 0 && st.flip);
const flyArm = (st, table) => {
  st.bobTable = table;
  st.bobI = 0;
};
// the motion a horizontal flight picks next
function flyPick(st) {
  if (st.ySpeed < 0) return F("HorizontalToUpMovement");
  if (st.ySpeed > 0) return F("MoveHorizontalToDown");
  if (st.xSpeed === 0) return F("MoveHorizontalEnd");
  return flyFacing(st) ? F("MoveHorizontal") : F("TurnQuick");
}

Object.assign(MOTIONS, {
  [F("Idle")](st) {
    if (!st.bobTable) flyArm(st, "idle");
    if (st.xSpeed !== 0) {
      st.cur = flyFacing(st) ? F("IdleToHorizontal") : F("IdleTurnAround");
      if (st.cur === F("IdleToHorizontal")) flyArm(st, "horizontal");
    } else if (st.ySpeed > 0) st.cur = F("BeginDownMovement");
  },
  [F("IdleTurnAround")](st, last) {
    if (last) {
      st.flip = !st.flip;
      st.cur = st.xSpeed === 0 ? (st.ySpeed > 0 ? F("BeginDownMovement") : F("Idle")) : flyPick(st);
    }
  },
  [F("IdleToHorizontal")](st, last) {
    if (last) st.cur = flyPick(st);
  },
  [F("TurnQuick")](st, last) {
    if (last) {
      st.flip = !st.flip;
      st.cur = flyPick(st);
    }
  },
  [F("MoveHorizontal")](st) {
    const next = flyPick(st);
    if (next !== F("MoveHorizontal")) {
      st.cur = next;
      if (next === F("TurnQuick")) flyArm(st, "turning");
    }
  },
  [F("MoveHorizontalEnd")](st, last) {
    if (last) st.cur = F("Idle");
  },
  [F("BeginDownMovement")](st, last) {
    if (last) st.cur = F("MoveDown");
  },
  [F("MoveDown")](st) {
    if (st.ySpeed > 0) return;
    if (st.ySpeed < 0) st.cur = F("MoveDownTurnAround");
    else st.cur = st.xSpeed !== 0 ? F("MoveDownToHorizontal") : F("EndDownMovement");
  },
  [F("EndDownMovement")](st, last) {
    if (last) st.cur = F("Idle");
  },
  [F("MoveDownToHorizontal")](st, last) {
    if (last) st.cur = flyPick(st);
  },
  [F("MoveDownTurnAround")](st, last) {
    if (last) st.cur = F("MoveUp");
  },
  [F("MoveUp")](st) {
    if (st.ySpeed < 0) return;
    if (st.ySpeed > 0) st.cur = F("MoveUpTurnAround");
    else st.cur = st.xSpeed !== 0 ? F("MoveUpToHorizontal") : F("EndUpMovement");
  },
  [F("EndUpMovement")](st, last) {
    if (last) st.cur = F("Idle");
  },
  [F("MoveUpToHorizontal")](st, last) {
    if (last) st.cur = flyPick(st);
  },
  [F("MoveUpTurnAround")](st, last) {
    if (last) st.cur = F("MoveDown");
  },
  [F("MoveHorizontalToDown")](st, last) {
    if (last) st.cur = F("MoveDown");
  },
  [F("HorizontalToUpMovement")](st, last) {
    if (last) st.cur = F("MoveUp");
  },
});
