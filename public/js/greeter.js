import { onEndOfLine, tlvAt } from "./collide.js";
import { BRAINS, SPAWN_FRAME, STARTS, randomRange, scaleOf, standOn, wall } from "./patrolkit.js";

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
