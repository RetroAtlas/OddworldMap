import { onEndOfLine, tlvAt } from "./collide.js";
import {
  BRAINS,
  MOTIONS,
  STARTS,
  enemyStopper,
  follow,
  fp16,
  grid,
  place,
  randomRange,
  scaleOf,
  slamDoorBlocks,
  standOn,
  wall,
} from "./patrolkit.js";

// ---- Scrab: walks or runs to its bound, turns, waits, and howls now and then
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
  if (slamDoorBlocks(st, st.x, st.y, st.x + ahead, st.y - grid(st))) return true;
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
