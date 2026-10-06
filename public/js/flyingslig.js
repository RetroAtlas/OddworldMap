import { nextLine, prevLine, raycast, tlvAt } from "./collide.js";
import { BRAINS, MOTIONS, SPAWN_FRAME, STARTS, TRACK, grid } from "./patrolkit.js";

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
