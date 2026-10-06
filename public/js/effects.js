import { BRAINS, STARTS, randomRange, scaleOf, switchGet } from "./patrolkit.js";

// ---- the effects a brain gives off -----------------------------------------
// Short-lived things drawn beside the object: a sprite that plays once, the
// engine's vector sparks, a sleeper's rising Z, a hint fly's hover. Each is
// stepped with its brain and read back by the painter.

const PARTICLE_RGB = [128, 128, 128];

// a Particle: an animation played once at a point, additive, and gone the
// tick after its last frame
function emitSprite(st, anim, x, y, layer, scale = scaleOf(st)) {
  st.fx.push({
    kind: "sprite",
    anim,
    x,
    y,
    layer,
    scale,
    blend: 1,
    rgb: PARTICLE_RGB,
    born: st.tick,
  });
}

// a Spark: `count` lines at rolled angles, drawn for two ticks, the second
// with a third of them pushed outward; and the Zap_Sparks sprite beside them
export function emitSpark(st, rnd, count, minAngle, maxAngle, x, y) {
  const lines = [];
  for (let i = 0; i < count; i++)
    lines.push({
      ang: randomRange(st, rnd, minAngle, maxAngle) & 255,
      radius: 0,
      len: randomRange(st, rnd, 2, 4),
    });
  const layer = scaleOf(st) === 0.5 ? 17 : 36;
  st.fx.push({
    kind: "spark",
    x,
    y,
    scale: scaleOf(st),
    layer,
    lines,
    count,
    born: st.tick,
    segs: [],
  });
  emitSprite(st, "Zap_Sparks", x, y, layer);
}

// a SnoozeParticle: a dim yellow Z rising twenty units with the table's
// wobble, growing as it goes, then bursting for two ticks
const Z_DX = [
  1, 0, 0, 1, 0, 0, 1, 0, 1, 0, 1, 1, 1, 0, 1, 0, 1, 0, 0, 1, 0, 0, 0, -1, 0, -1, 0, -1, -1, -1, -1,
  -1, -1, 0, -1, 0, 0,
];
function emitZ(st, rnd, x, y, layer, scale) {
  const dy = -(0.35 + (0.15 * rnd()) / 256);
  const idx = rnd() % 36;
  st.fx.push({
    kind: "z",
    x,
    y,
    y0: y,
    dy,
    idx: idx + 1,
    dx: Z_DX[idx],
    scale: 0.4 * scale,
    scaleDx: 0.015 * -dy,
    rgb: [0, 0, 0],
    state: "rise",
    count: 1,
    layer,
    born: st.tick,
  });
}

// one engine tick of every effect a brain holds; what has died is dropped
export function stepEffects(st, now, rnd) {
  const keep = [];
  for (const p of st.fx) {
    if (p.kind === "sprite") {
      const a = st.anims[p.anim];
      if (!a || st.tick - p.born <= (a.frames.length - 1) * a.fps) keep.push(p);
    } else if (p.kind === "spark") {
      // struck this tick, lit on the next two: all its lines, then a third of them
      const age = st.tick - p.born;
      if (age >= 3) continue;
      if (age === 0) {
        keep.push(p);
        continue;
      }
      if (age === 2) p.count = Math.trunc(p.count / 3);
      p.segs = [];
      for (let i = 0; i < p.count; i++) {
        const l = p.lines[i];
        const th = (l.ang * Math.PI) / 128;
        const c = Math.cos(th),
          s = -Math.sin(th);
        p.segs.push([l.radius * c, l.radius * s, (l.radius + l.len) * c, (l.radius + l.len) * s]);
        l.radius = l.len + randomRange(st, rnd, 2, 5);
        l.len += 2;
      }
      keep.push(p);
    } else if (p.kind === "z") {
      if (p.state === "rise") {
        if (p.y >= p.y0 - 20) {
          if (p.rgb[0] < 70 && p.rgb[1] < 70 && p.rgb[2] < 20) {
            p.rgb[0] += 14;
            p.rgb[1] += 14;
            p.rgb[2] += 4;
          }
          p.scale += p.scaleDx;
          if (p.idx > 36) p.idx = 0;
          p.dx = Z_DX[p.idx];
          p.x += p.dx;
          p.y += p.dy;
          p.idx++;
        } else p.state = "burst";
        keep.push(p);
      } else {
        p.rgb = p.rgb.map((v) => Math.trunc(v / 2));
        p.x += p.dx;
        p.y += p.dy;
        if (p.count > 0) {
          p.count--;
          keep.push(p);
        }
      }
    } else if (p.kind === "fly") {
      p.angle = (p.angle + p.speed) & 255;
      const th = (p.angle * Math.PI) / 128;
      p.x += 5 * Math.cos(th);
      p.y -= 2 * Math.sin(th);
      keep.push(p);
    }
  }
  st.fx = keep;
}

// ---- brains that only give off effects --------------------------------------
// the ticks a sleeper breathes out a Z: the frame counter's multiples of sixty
// and twenty past them
const sleepTick = (now) => now % 60 === 0 || (now - 20) % 60 === 0;
const zAt = (st, rnd, ox, oy) => {
  const s = scaleOf(st);
  const u = st.game === "AO" ? 1 : s; // Oddysee places its sleepers' Zs unscaled
  emitZ(st, rnd, st.ax + ox * u, st.ay + oy * u, st.r.layer, s);
};

BRAINS.slogSleep = (st, now, rnd) => {
  if (sleepTick(now)) zAt(st, rnd, st.flip ? -18 : 18, -13);
};
BRAINS.sligSleep = (st, now, rnd) => {
  if (sleepTick(now)) zAt(st, rnd, st.flip ? 20 : -20, -10);
};
BRAINS.crawlSleep = (st, now, rnd) => {
  if ((now & 31) === 0) zAt(st, rnd, st.flip ? 10 : -10, -10);
};
BRAINS.fleechSleep = (st, now, rnd) => {
  if (st.m.frame === 4 && now % 4 === 0) zAt(st, rnd, st.flip ? -10 : 10, -20);
};
// a hanging fleech swings on its tongue, two angle steps a tick from a rolled start
STARTS.fleechHang = (st) => {
  st.angle = st.dice[st.seed2++ & 255];
};
BRAINS.fleechHang = (st, now, rnd) => {
  st.angle = (st.angle + 2) & 255;
  st.dx = 4 * Math.cos((st.angle * Math.PI) / 128);
  if (st.m.frame === 4 && now % 4 === 0) zAt(st, rnd, st.flip ? -10 : 10, -20);
};
// a ZzzSpawner breathes out a Z on its interval while its switch is off
BRAINS.zzz = (st, now, rnd) => {
  if (switchGet(st, st.p.switchId) !== 0) return;
  if (now > st.timer) {
    emitZ(st, rnd, st.ax, st.ay, st.p.layer, st.p.scale);
    st.timer = now + st.p.interval;
  }
};
// Oddysee's sit-chanting Mudokon lets off a chant orb every eight ticks
BRAINS.chant = (st, now, rnd) => {
  if (now % 8 !== 0) return;
  const s = scaleOf(st);
  emitSprite(
    st,
    "ChantOrb_Particle",
    st.ax + s * (Math.trunc((30 * rnd()) / 256) - 10),
    st.ay - s * (Math.trunc((20 * rnd()) / 256) + 10),
    s === 0.5 ? 17 : 36,
  );
};
// hint flies: twenty, each on its own loop about the point, walking the dice
// from a cursor of their own
STARTS.hintfly = (st) => {
  const own = () => st.dice[st.seed2++ & 255];
  for (let i = 0; i < 20; i++) {
    const x = st.ax - 16 + (own() & 31);
    const y = st.ay - 16 + (own() & 31);
    const angle = own();
    let speed = 12 + (own() % 4);
    if (own() & 1) speed = -speed;
    st.fx.push({
      kind: "fly",
      anim: "HintFly",
      x,
      y,
      angle,
      speed,
      layer: 39,
      scale: 1,
      blend: 1,
      rgb: PARTICLE_RGB,
    });
  }
};
BRAINS.hintfly = () => {};
