import { test } from "node:test";
import assert from "node:assert/strict";
import {
  advance,
  brainAt,
  frameAt,
  motionTick,
  patrolTick,
  resetScene,
  resolveRecord,
  sceneTick,
  setMotionRunning,
  setPatrolsRunning,
} from "../../public/js/motion.js";
import { PATROL_ANIMS, anim, tlv, walker, world } from "./creatures.js";

test("frameAt: frame 0 stands at construction and the first tick decodes it again", () => {
  const a = anim(4, 2, true);
  assert.equal(frameAt(a, 0), 0);
  assert.equal(frameAt(a, 1), 0);
  assert.equal(frameAt(a, 2), 0);
  assert.equal(frameAt(a, 3), 1);
});

test("frameAt: every frame is held fps ticks", () => {
  const a = anim(3, 3, true);
  // frame k shows from tick 1 + 3k
  assert.deepEqual(
    [1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map((t) => frameAt(a, t)),
    [0, 0, 0, 1, 1, 1, 2, 2, 2, 0],
  );
});

test("frameAt: a looping animation returns to its loop start, a parking one holds its last frame", () => {
  const loop = anim(5, 1, true, 2);
  assert.deepEqual(
    [1, 2, 3, 4, 5, 6, 7, 8, 9].map((t) => frameAt(loop, t)),
    [0, 1, 2, 3, 4, 2, 3, 4, 2],
  );
  const park = anim(3, 1, false);
  assert.deepEqual(
    [1, 2, 3, 4, 50].map((t) => frameAt(park, t)),
    [0, 1, 2, 2, 2],
  );
});

test("frameAt: a start frame shifts the sequence and a single frame never moves", () => {
  assert.equal(frameAt(anim(4, 1, true), 1, 2), 2);
  assert.equal(frameAt(anim(4, 1, true), 3, 2), 0);
  assert.equal(frameAt(anim(1, 1, true), 999), 0);
});

test("clock: a frame advances the ticks its lateness holds and keeps the remainder", () => {
  const queue = new Map();
  let id = 0;
  globalThis.requestAnimationFrame = (cb) => (queue.set(++id, cb), id);
  globalThis.cancelAnimationFrame = (h) => queue.delete(h);
  try {
    setMotionRunning(true, () => {});
    const t0 = motionTick();
    const now = performance.now();
    assert.equal(advance(now + 1000 / 30), 1, "one tick per 33.3 ms frame");
    assert.equal(advance(now + 1000 / 30 + 100), 3, "a 100 ms frame holds three");
    assert.equal(motionTick(), t0 + 4);
    assert.equal(
      advance(now + 1000 / 30 + 100 + 1),
      0,
      "the remainder carries, a millisecond is not a tick",
    );
    assert.equal(advance(now + 1000 / 30 + 100 + 1000 / 30), 1, "and completes the next");
    setMotionRunning(false);
  } finally {
    delete globalThis.requestAnimationFrame;
    delete globalThis.cancelAnimationFrame;
  }
});

test("clock: the scene starts over at the tick it is reset on, and the patrols count from their toggle", () => {
  const queue = new Map();
  let id = 0;
  globalThis.requestAnimationFrame = (cb) => (queue.set(++id, cb), id);
  globalThis.cancelAnimationFrame = (h) => queue.delete(h);
  try {
    setMotionRunning(true, () => {});
    const now = performance.now();
    advance(now + 10 * (1000 / 30) + 1);
    resetScene();
    assert.equal(sceneTick(), 0);
    setPatrolsRunning(false);
    assert.equal(patrolTick(), null, "null while the patrols are off");
    advance(now + 15 * (1000 / 30) + 1);
    assert.equal(sceneTick(), 5);
    setPatrolsRunning(true);
    assert.equal(patrolTick(), 0, "the patrols count from the tick their toggle came on");
    advance(now + 17 * (1000 / 30) + 1);
    assert.equal(patrolTick(), 2);
    assert.equal(sceneTick(), 7);
    resetScene();
    assert.equal(sceneTick(), 0);
    assert.equal(patrolTick(), 0, "a scene reset sends the patrols back to their marks");
    setMotionRunning(false);
  } finally {
    delete globalThis.requestAnimationFrame;
    delete globalThis.cancelAnimationFrame;
  }
});

const CYCLE_ANIMS = {
  Bomb_Flash: anim(2, 1, true),
  Bomb_RedGreenTick: anim(10, 1, true),
  "Bomb_RedGreenTick@GreenFlash": anim(10, 1, true),
  MotionDetector_Laser: anim(1, 1, true),
  ElectricWall_Idle: anim(2, 4, true),
  ChimeLock_Ball: anim(1, 1, true),
  Dove_Flying: anim(6, 2, true),
};
const cycleSet = { anims: CYCLE_ANIMS, dice: new Array(256).fill(0) };
const cycled = (animName, cycle) => ({
  anim: animName,
  x: 100,
  y: 200,
  scale: 1,
  layer: 20,
  flip: false,
  frame: 0,
  cycle,
});

test("cycle: a UXB flashes two ticks in twelve and spells its pattern, so many red cycles then a green", () => {
  const r = cycled("Bomb_RedGreenTick", { kind: "uxb", digits: [2] });
  const at = (t) => resolveRecord(r, cycleSet, t);
  assert.equal(at(0).name, "Bomb_Flash");
  assert.equal(at(1).name, "Bomb_Flash");
  assert.equal(at(2).name, "Bomb_RedGreenTick");
  assert.equal(at(2).frame, 0, "the tick light counts from the flash's end");
  assert.equal(at(4).frame, 1);
  assert.equal(at(11).frame, 8);
  assert.equal(at(12).name, "Bomb_Flash");
  assert.equal(
    at(14).name,
    "Bomb_RedGreenTick@GreenFlash",
    "the second cycle of a 2 is the green one",
  );
  assert.equal(
    at(26).name,
    "Bomb_RedGreenTick",
    "the cycle after the green loads the digit red again",
  );
  assert.equal(at(38).name, "Bomb_RedGreenTick");
  assert.equal(
    at(50).name,
    "Bomb_RedGreenTick@GreenFlash",
    "and the pattern repeats three cycles on",
  );
  const two = cycled("Bomb_RedGreenTick", { kind: "uxb", digits: [1, 3] });
  const names = [2, 14, 26, 38, 50, 62, 74, 86].map((t) =>
    resolveRecord(two, cycleSet, t).name.endsWith("@GreenFlash") ? "G" : "r",
  );
  assert.deepEqual(names, ["G", "r", "r", "r", "G", "r", "G", "r"], "1 then 3: the digits in turn");
});

test("cycle: a motion detector's laser sweeps to the far edge, waits fifteen ticks, and comes back", () => {
  const r = cycled("MotionDetector_Laser", {
    kind: "laser",
    x1: 100,
    x2: 150,
    speed: 10,
    left: false,
  });
  const x = (t) => resolveRecord(r, cycleSet, t).x;
  assert.equal(x(0), 100);
  assert.equal(x(3), 130);
  assert.equal(x(5), 150, "five ticks out at ten a tick");
  assert.equal(x(19), 150, "fifteen ticks at the far edge");
  assert.equal(x(20), 150);
  assert.equal(x(22), 130, "back at the same pace");
  assert.equal(x(25), 100);
  assert.equal(x(39), 100, "fifteen ticks at the near edge");
  assert.equal(x(40), 100, "and the next sweep begins");
  assert.equal(x(41), 110);
  const left = cycled("MotionDetector_Laser", {
    kind: "laser",
    x1: 100,
    x2: 150,
    speed: 10,
    left: true,
  });
  assert.equal(resolveRecord(left, cycleSet, 0).x, 150, "a leftward one starts at the right edge");
  assert.equal(resolveRecord(left, cycleSet, 3).x, 120);
});

test("cycle: an electric wall flips every eight ticks", () => {
  const r = cycled("ElectricWall_Idle", { kind: "flip8" });
  const flip = (t) => resolveRecord(r, cycleSet, t).flip;
  assert.deepEqual([0, 7, 8, 15, 16, 23, 24].map(flip), [
    false,
    false,
    true,
    true,
    false,
    false,
    true,
  ]);
});

test("cycle: the chime lock's ball bobs on two cosines, five wide at four steps a tick and three high at three", () => {
  const r = cycled("ChimeLock_Ball", { kind: "chime", x: 100, y: 200 });
  const at = (t) => resolveRecord(r, cycleSet, t);
  assert.equal(at(0).x, 105);
  assert.equal(at(0).y, 203);
  assert.ok(Math.abs(at(16).x - 100) < 1e-9, "a quarter turn of the 256-step wheel at tick 16");
  assert.ok(Math.abs(at(32).x - 95) < 1e-9, "and the far side at 32");
  assert.ok(Math.abs(at(64).x - 105) < 1e-9, "x round in 64 ticks");
  assert.ok(Math.abs(at(43).y - 197) < 0.02, "y round in about 85, the far side near 43");
});

test("cycle: the portal doves orbit at four angle steps a tick, an Abe portal's ring breathing its width", () => {
  const r = cycled("Dove_Flying", { kind: "orbit", cx: 100, cy: 200, rx: 30, ry: 35, phase: 0 });
  const at = (t) => resolveRecord(r, cycleSet, t);
  const near = (a, b) => Math.abs(a - b) < 1e-9;
  assert.ok(near(at(0).x, 100) && near(at(0).y, 235), "angle 0 sits below the centre");
  assert.ok(near(at(16).x, 130) && near(at(16).y, 200), "a quarter round after 16 ticks");
  assert.ok(near(at(32).y, 165), "half round at 32");
  assert.ok(near(at(64).x, 100) && near(at(64).y, 235), "sixty-four ticks a revolution");
  const phased = cycled("Dove_Flying", {
    kind: "orbit",
    cx: 100,
    cy: 200,
    rx: 30,
    ry: 35,
    phase: 64,
  });
  assert.ok(near(resolveRecord(phased, cycleSet, 0).x, 130), "a dove's phase is its start angle");
  // the ring's width walks between 30 and 0 a unit a tick, turning at each end; a
  // dove starting at angle 64 is back at the ring's full width every 32 ticks, so
  // the width reads off its x there
  const ring = (width, dir) =>
    cycled("Dove_Flying", {
      kind: "orbit",
      cx: 100,
      cy: 200,
      rx: 30,
      ry: 35,
      phase: 64,
      abe: { width, dir },
    });
  const widthAt = (rec, t) =>
    Math.round(Math.abs(resolveRecord(rec, cycleSet, t).x - 100) * 1e6) / 1e6;
  const sides = [0, 32, 64, 96];
  assert.deepEqual(
    sides.map((t) => widthAt(ring(0, 1), t)),
    [0, 28, 4, 24],
    "opening from closed",
  );
  assert.deepEqual(
    sides.map((t) => widthAt(ring(30, -1), t)),
    [30, 2, 26, 6],
    "closing from open",
  );
  assert.deepEqual(
    sides.map((t) => widthAt(ring(12, -1), t)),
    [12, 20, 8, 24],
    "closing from 12 wide",
  );
});

test("pulse: the door lights rest dim, then breathe up and back over the windows the dice set", () => {
  const set = { anims: { GoldGlow: anim(1, 15, true) }, dice: new Array(256).fill(0) };
  const r = {
    anim: "GoldGlow",
    x: 0,
    y: 0,
    scale: 1,
    layer: 17,
    flip: false,
    frame: 0,
    cycle: { kind: "pulse" },
  };
  const level = (t) => Math.round(resolveRecord(r, set, t).bright * 255);
  // zero dice: a first window of 30 ticks from tick 0, then rests of 6 and windows of 30
  assert.equal(level(0), 32);
  assert.equal(level(1), 57);
  assert.equal(level(3), 107, "four angle steps a tick up the half sine");
  assert.equal(level(15), 255);
  assert.equal(level(29), 57);
  assert.equal(level(30), 32, "the window's last tick is back at rest");
  assert.equal(level(36), 32, "the six-tick rest");
  assert.equal(level(37), 32, "the second window opens at angle zero");
  assert.equal(level(38), 57);
  assert.equal(level(42), 159, "mid-ramp");
  assert.equal(level(52), 255);
  assert.equal(level(66), 57);
  assert.equal(level(67), 32, "and closes");
  assert.equal(level(68), 32);
  assert.equal(level(3), 107, "a tick already passed reads the same");
  assert.equal(level(1), 57, "asking back behind the cursor answers from the record");
});

test("clock: stopping cancels the queued frame, so a restart stacks no second callback", () => {
  const queue = new Map();
  let id = 0;
  globalThis.requestAnimationFrame = (cb) => (queue.set(++id, cb), id);
  globalThis.cancelAnimationFrame = (h) => queue.delete(h);
  try {
    for (let i = 0; i < 3; i++) {
      setMotionRunning(true, () => {});
      setMotionRunning(false);
    }
    setMotionRunning(true, () => {});
    assert.equal(queue.size, 1);
    const [h, cb] = [...queue][0];
    queue.delete(h);
    cb(performance.now() + 40);
    assert.equal(queue.size, 1, "one frame re-queues exactly one");
    setMotionRunning(false);
    assert.equal(queue.size, 0);
  } finally {
    delete globalThis.requestAnimationFrame;
    delete globalThis.cancelAnimationFrame;
  }
});

test("brainAt: a new clock generation replaces a cached state, and a tick behind it is answered from a throwaway", () => {
  const floor = [[0, 100, 1000, 100, 0]];
  const bounds = [
    tlv("SligBoundLeft", 100, 76, 124, 100),
    tlv("SligBoundRight", 700, 76, 724, 100),
  ];
  const w = world("AE", floor, bounds, { x: 400, y: 90 });
  const p = {
    pauseTime: 10,
    leftMin: 30,
    leftMax: 60,
    rightMin: 30,
    rightMax: 60,
    zone: { x: 100, w: 724 },
  };
  const r = walker("Slig_Idle", "slig", p, w, 400, 100);
  const set = { anims: PATROL_ANIMS, dice: new Array(256).fill(0) };
  const far = brainAt(r, set, 300).state;
  assert.equal(brainAt(r, set, 300).state, far, "the same ask reuses the state");
  assert.notEqual(brainAt(r, set, 5).state, far, "a tick behind is a throwaway");
  assert.equal(brainAt(r, set, 301).state, far, "and the kept state was not replaced by it");
  // the patrols' toggle turning on is a new generation for a patrol
  setPatrolsRunning(false);
  setPatrolsRunning(true);
  const fresh = brainAt(r, set, 5).state;
  assert.notEqual(fresh, far);
  assert.equal(
    brainAt(r, set, 6).state,
    fresh,
    "a new patrol generation starts the brain over and keeps the new state",
  );
  // a scene reset is one for a standing brain and for a patrol alike
  const idle = { ...r, cycle: { ...r.cycle, patrol: false } };
  const stood = brainAt(idle, set, 100).state;
  assert.equal(brainAt(idle, set, 100).state, stood);
  resetScene();
  const again = brainAt(idle, set, 5).state;
  assert.notEqual(again, stood);
  assert.equal(
    brainAt(idle, set, 6).state,
    again,
    "the scene reset starts a standing brain over and keeps the new state",
  );
  const walked = brainAt(r, set, 5).state;
  assert.notEqual(walked, fresh);
  assert.equal(
    brainAt(r, set, 6).state,
    walked,
    "and a patrol too, its clock restarting with the scene",
  );
});
