import { boundingRect, raycast, rectsMeet } from "./collide.js";
import { emitBurst, emitSprite } from "./effects.js";
import { BRAINS, STARTS, fpMul, switchGet } from "./patrolkit.js";

// ---- FallingItem: once its switch reads on it rumbles its interval, falls to
// the floor of its plane, smashes there and starts over from where it waited,
// retiring once a count it was given is spent or where the foot of its rect
// lies off the screen that built it; its height and speed in raw 16.16

const FP = 65536;
const GAIN = Math.trunc(1.8 * FP);
const TOP = 20 * FP;

STARTS.fallingItem = (st) => {
  st.state = "switch";
  st.y = st.p.y * FP;
  st.vy = 0;
  st.left = st.p.max;
};

function smash(st, rnd, now, s) {
  const p = st.p;
  const at = { x: p.x * FP, y: st.y, scale: s, win: p.win, cam: p.cam };
  for (const b of p.debris) emitBurst(st, rnd, now, { ...at, ...b });
  if (p.blast)
    emitSprite(
      st,
      "AirExplosion",
      p.x,
      (st.y - fpMul(15 * FP, s)) / FP,
      27,
      fpMul(s, 0.75 * FP) / FP,
      p.cam,
    );
}

// DamageHitItems: a stopper of its scale whose rect meets the item's own, each
// as the item sees it in this tick's update, stops the fall where it is
function meetsStopper(st) {
  if (!st.p.stoppers.length) return false;
  const a = st.anims[st.cur];
  const own = boundingRect(a.frames[st.m.frame], st.p.x, st.y / FP, st.r.scale, false);
  return st.p.stoppers.some(({ rec, first }) => {
    const o = st.peer(rec, st.tick, first);
    return o.frame && rectsMeet(own, boundingRect(o.frame, o.x, o.y, o.scale, o.flip));
  });
}

BRAINS.fallingItem = (st, now, rnd) => {
  const p = st.p;
  const s = st.r.scale * FP;
  switch (st.state) {
    case "switch":
      if (!p.switchId || !switchGet(st, p.switchId)) break;
      st.state = "delay";
      st.vy = 0;
      st.cur = p.waiting;
      st.timer = now + p.interval;
      break;
    case "delay":
      if (now >= st.timer) st.state = "falling";
      break;
    case "falling": {
      const stopped = meetsStopper(st);
      if (st.vy < TOP) st.vy += fpMul(s, GAIN);
      const hit = raycast(p.lines, p.x, st.y / FP, p.x, (st.y + st.vy) / FP, p.floor);
      if (!hit && !stopped) {
        st.y += st.vy;
        break;
      }
      if (!stopped) st.y = Math.round(hit.y * FP);
      st.state = "smashed";
      smash(st, rnd, now, s);
      break;
    }
    case "smashed":
      if (p.switchId && p.reset) st.sw[p.switchId] = 0;
      st.left--;
      if ((p.max !== 0 && st.left <= 0) || !p.stays) st.state = "gone";
      else {
        st.cur = p.art;
        st.vy = 0;
        st.y = p.y * FP;
        st.state = "switch";
      }
      st.hidden = st.state === "gone";
  }
  st.dy = (st.y - p.y * FP) / FP;
};
