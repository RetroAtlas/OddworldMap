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
  if (slamDoorBlocks(st, st.x, st.y, st.x + ahead, st.y - g)) return true;
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
