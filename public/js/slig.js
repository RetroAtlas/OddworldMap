import {
  BRAINS,
  MOTIONS,
  SPAWN_FRAME,
  STARTS,
  enemyStopper,
  follow,
  grid,
  place,
  randomRange,
  scaleOf,
  standOn,
  wall,
} from "./patrolkit.js";

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
