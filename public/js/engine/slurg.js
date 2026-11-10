import { onEndOfLine, tlvAt } from "./collide.js";
import { BRAINS, STARTS, place, randomRange, scaleOf, standOn, wall } from "./patrolkit.js";

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
