import { moveOnLine, raycast } from "./collide.js";
import { BRAINS, STARTS, TRACK, place, randomRange } from "./patrolkit.js";

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
