import { raycast, tlvAt } from "./collide.js";
import {
  BRAINS,
  STARTS,
  TRACK,
  follow,
  place,
  randomRange,
  scaleOf,
  switchGet,
} from "./patrolkit.js";

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
