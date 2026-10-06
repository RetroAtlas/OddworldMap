import { test } from "node:test";
import assert from "node:assert/strict";
import {
  advance,
  frameAt,
  motionTick,
  resolveRecord,
  setMotionRunning,
  brainAt,
  resetScene,
  resolveEffects,
  setPatrolsRunning,
  sceneTick,
  patrolTick,
} from "../../public/js/motion.js";
import { camVoidX, camVoidY, raycastDown, snapX } from "../../public/js/collide.js";

const anim = (n, fps, loop, loopStart = 0) => ({
  fps,
  loop,
  loop_start: loopStart,
  frames: Array.from({ length: n }, (_, i) => [0, i, 0, 1, 1, 0, 0]),
});

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

test("raycastDown: the nearest line of the asked types under the ray, interpolated along a slope", () => {
  const lines = [
    [0, 100, 100, 100, 0], // floor at 100
    [0, 80, 100, 80, 4], // background floor above it
    [0, 90, 100, 110, 1], // a sloping wall: y = 90 + x/5
    [200, 50, 300, 50, 0], // out of reach on x
  ];
  assert.equal(raycastDown(lines, 50, 70, 120, [0]), 100);
  assert.equal(raycastDown(lines, 50, 70, 120, [4]), 80);
  assert.equal(raycastDown(lines, 50, 70, 120, [0, 1]), 100); // the wall meets x=50 at y=100 too
  assert.equal(raycastDown(lines, 25, 70, 120, [1]), 95);
  assert.equal(raycastDown(lines, 50, 70, 90, [0]), null); // the ray stops short
  assert.equal(raycastDown(lines, 150, 0, 500, [0]), null);
});

test("snapX: 25-unit squares and 13 at half, each game from its own origin", () => {
  // Oddysee counts from 15 (full) and 11 (half); a remainder of 13 or 7 rounds up
  assert.equal(snapX("AO", 15, false), 15);
  assert.equal(snapX("AO", 27, false), 15);
  assert.equal(snapX("AO", 28, false), 40);
  assert.equal(snapX("AO", 11, true), 11);
  assert.equal(snapX("AO", 18, true), 24);
  // Exoddus counts from 12 at full scale and, at half, from 6 inside its 375-unit cell
  assert.equal(snapX("AE", 12, false), 12);
  assert.equal(snapX("AE", 25, false), 37);
  assert.equal(snapX("AE", 24, false), 12);
  assert.equal(snapX("AE", 381, true), 381);
  assert.equal(snapX("AE", 388, true), 394);
});

// the working Mudokons' animations at the sidecar's lengths and hold counts
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

const WORK_ANIMS = {
  Mudokon_StandScrubLoop: anim(10, 1, true),
  Mudokon_StandScrubLoopToPause: anim(3, 2, true),
  Mudokon_StandScrubPause: anim(6, 4, true),
  Mudokon_StandScrubPauseToLoop: anim(1, 1, false),
  Mudokon_CrouchScrub: anim(10, 1, false),
  Mudokon_CrouchIdle: anim(5, 4, true),
  Mudokon_CrouchTurn: anim(8, 1, false),
  Mudokon_CrouchToStand: anim(6, 1, false),
  Mudokon_Chisel: anim(6, 2, true),
  Mudokon_StartChisel: anim(1, 1, true),
  Mudokon_StopChisel: anim(1, 1, true),
  Mudokon_Idle: anim(6, 4, true),
};
// dice that always roll zero: the shortest timer of every range, and a sad
// worker stands up at its first break
const ZERO_DICE = { anims: WORK_ANIMS, dice: new Array(256).fill(0) };
const worker = (brain, emo = false) => ({
  anim: brain === "chisel" ? "Mudokon_Chisel" : "Mudokon_CrouchScrub",
  x: 0,
  y: 0,
  scale: 1,
  layer: 27,
  flip: false,
  frame: 0,
  cycle: { kind: "brain", brain, seed: 0, emo },
});
const shownAt = (r, set, tick) => {
  const s = resolveRecord(r, set, tick);
  return `${s.name.replace(/^[A-Za-z]+_/, "")}:${s.frame}${s.flip ? "<" : ""}`;
};
// what one record shows over a run of ticks, as the segments it passes through
function segments(r, set, from, to) {
  const out = [];
  for (let t = from; t <= to; t++) {
    const name = resolveRecord(r, set, t).name.replace(/^[A-Za-z]+_/, "");
    if (out.length && out[out.length - 1].name === name) out[out.length - 1].to = t;
    else out.push({ name, from: t, to: t });
  }
  return out.map((s) => `${s.name} ${s.from}-${s.to}`);
}

test("work: an Exoddus scrubber scrubs while its timer runs, idles a tick between scrubs, then breaks", () => {
  const r = worker("scrub");
  // the first timer is 15 ticks: one scrub, one tick of idle, a second scrub,
  // then the 15-tick break; the next bursts run 35 ticks, four scrubs each
  assert.deepEqual(segments(r, ZERO_DICE, 1, 99), [
    "CrouchScrub 1-10",
    "CrouchIdle 11-11",
    "CrouchScrub 12-21",
    "CrouchIdle 22-38",
    "CrouchScrub 39-48",
    "CrouchIdle 49-49",
    "CrouchScrub 50-59",
    "CrouchIdle 60-60",
    "CrouchScrub 61-70",
    "CrouchIdle 71-71",
    "CrouchScrub 72-81",
    "CrouchIdle 82-98",
    "CrouchScrub 99-99",
  ]);
  // a scrub runs its ten frames a tick each; the idle holds each of its five four ticks
  assert.equal(shownAt(r, ZERO_DICE, 21), "CrouchScrub:9");
  assert.equal(shownAt(r, ZERO_DICE, 22), "CrouchIdle:0");
  assert.equal(shownAt(r, ZERO_DICE, 38), "CrouchIdle:4");
  assert.equal(shownAt(r, ZERO_DICE, 0), "CrouchScrub:0");
});

test("work: a scrubber turns on a break once its turn timer has run, and faces the other way after", () => {
  const r = worker("scrub");
  const segs = segments(r, ZERO_DICE, 1, 600);
  const turn = segs.findIndex((s) => s.startsWith("CrouchTurn"));
  assert.ok(turn > 0, segs.join(", "));
  const [, from, to] = segs[turn].match(/(\d+)-(\d+)/).map(Number);
  assert.equal(to - from + 1, 8, "eight frames a tick each");
  assert.ok(segs[turn - 1].startsWith("CrouchIdle") && segs[turn + 1].startsWith("CrouchIdle"));
  assert.equal(resolveRecord(r, ZERO_DICE, from - 1).flip, false);
  assert.equal(resolveRecord(r, ZERO_DICE, to).flip, false, "the flip lands with the idle");
  assert.equal(resolveRecord(r, ZERO_DICE, to + 1).flip, true);
  assert.ok(from > 240, "no sooner than the turn timer");
});

test("work: Oddysee's crouched scrubber scrubs once, turns at its first break, then settles into bursts", () => {
  assert.deepEqual(segments(worker("crouchscrub"), ZERO_DICE, 1, 88), [
    "CrouchScrub 1-10",
    "CrouchIdle 11-12",
    "CrouchTurn 13-20",
    "CrouchIdle 21-27",
    "CrouchScrub 28-37",
    "CrouchIdle 38-38",
    "CrouchScrub 39-48",
    "CrouchIdle 49-49",
    "CrouchScrub 50-59",
    "CrouchIdle 60-60",
    "CrouchScrub 61-70",
    "CrouchIdle 71-87",
    "CrouchScrub 88-88",
  ]);
});

test("work: a chiseller finishes its loop before the one-tick stop, idles, and starts again", () => {
  assert.deepEqual(segments(worker("chisel"), ZERO_DICE, 1, 112), [
    "Chisel 1-36",
    "StopChisel 37-37",
    "CrouchIdle 38-74",
    "StartChisel 75-75",
    "Chisel 76-110",
    "StopChisel 111-111",
    "CrouchIdle 112-112",
  ]);
});

test("work: Oddysee's standing scrubber pauses through its transitions and resumes", () => {
  const segs = segments(worker("standscrub"), ZERO_DICE, 1, 200);
  assert.equal(segs[0], "StandScrubLoop 1-40", "the loop ends at its last frame, not at the timer");
  assert.equal(segs[1], "StandScrubLoopToPause 41-45");
  assert.ok(segs[2].startsWith("StandScrubPause 46-"), segs[2]);
  assert.ok(segs[3].startsWith("StandScrubPauseToLoop"), segs[3]);
  assert.equal(
    segs[3]
      .match(/(\d+)-(\d+)/)
      .slice(1)
      .reduce((a, b) => b - a + 1),
    1,
    "one tick",
  );
  assert.ok(segs[4].startsWith("StandScrubLoop"), segs[4]);
});

test("work: a sad worker stands at its first break and stays standing", () => {
  assert.deepEqual(segments(worker("chisel", true), ZERO_DICE, 36, 46), [
    "Chisel 36-36",
    "StopChisel 37-37",
    "CrouchIdle 38-38",
    "CrouchToStand 39-44",
    "Idle 45-46",
  ]);
  // the scrubber waits ten ticks of the break before it rises
  assert.deepEqual(segments(worker("scrub", true), ZERO_DICE, 22, 57), [
    "CrouchIdle 22-49",
    "CrouchToStand 50-55",
    "Idle 56-57",
  ]);
  assert.equal(shownAt(worker("scrub", true), ZERO_DICE, 5000).split(":")[0], "Idle");
});

test("work: the dice are the table walked from the seed, so two seeds give two rhythms and a tick asked twice agrees", () => {
  const dice = Array.from({ length: 256 }, (_, i) => (i * 97 + 13) & 255);
  const set = { anims: WORK_ANIMS, dice };
  const a = { ...worker("scrub"), cycle: { kind: "brain", brain: "scrub", seed: 3, emo: false } };
  const b = { ...worker("scrub"), cycle: { kind: "brain", brain: "scrub", seed: 90, emo: false } };
  assert.notDeepEqual(segments(a, set, 1, 400), segments(b, set, 1, 400));
  const once = segments(a, set, 1, 400);
  resolveRecord(a, set, 2000);
  assert.deepEqual(
    segments(a, set, 1, 400),
    once,
    "stepping back restarts the brain and lands the same",
  );
});

const IDLE_ANIMS = {
  ...WORK_ANIMS,
  Slog_Idle: anim(6, 2, true),
  Slog_MoveHeadUpwards: anim(7, 1, false),
  Slog_Scratch: anim(20, 1, false, 3),
  Slog_Growl: anim(7, 1, false),
  Paramite_Idle: anim(6, 4, true),
  Paramite_Turn: anim(7, 1, false),
  Paramite_GameSpeakBegin: anim(8, 1, false),
  Paramite_PreHiss: anim(2, 4, true),
  Paramite_GameSpeakEnd: anim(8, 1, false),
  MeatSaw_Idle: anim(6, 1, true),
  MeatSaw_Moving: anim(3, 1, true),
  Drill_Vertical_Off: anim(1, 1, true),
  Drill_Vertical_On: anim(4, 1, true),
};
const dice = (v) => ({ anims: IDLE_ANIMS, dice: new Array(256).fill(v) });
const creature = (animName, name, p = null, seed = 0) => ({
  anim: animName,
  x: 0,
  y: 0,
  scale: 1,
  layer: 27,
  flip: false,
  frame: 0,
  cycle: { kind: "brain", brain: name, seed, emo: false, p },
});

test("brain: an awake slog growls and scratches on timers its first tick finds long past", () => {
  // sevens never land the one-in-64 woof; the growl timer takes 7 + 60, the scratch 7 + 120
  const r = creature("Slog_Idle", "slog");
  assert.deepEqual(segments(r, dice(7), 1, 139), [
    "Idle 1-1",
    "Growl 2-8",
    "Idle 9-9",
    "Scratch 10-29",
    "Idle 30-69",
    "Growl 70-76",
    "Idle 77-137",
    "Growl 138-139",
  ]);
});

test("brain: a slog's growl after a woof holds its third frame a dozen ticks and growls again", () => {
  // zero dice woof every idle tick; a woof then a growl is forced by the growl timer's reset
  const r = creature("Slog_Idle", "slog");
  const segs = segments(r, dice(0), 1, 40);
  assert.equal(segs[0], "Idle 1-1");
  assert.equal(segs[1], "MoveHeadUpwards 2-8");
  // zero dice always woof, so the growl never comes: the head goes up and up
  assert.equal(segs[2], "Idle 9-9");
  assert.equal(segs[3], "MoveHeadUpwards 10-16");
  // a table that woofs once then rolls sevens: the growl that follows freezes
  const table = new Array(256).fill(7);
  table[0] = 0; // the first own roll woofs
  const set = { anims: IDLE_ANIMS, dice: table };
  const r2 = creature("Slog_Idle", "slog");
  const s2 = segments(r2, set, 1, 60);
  assert.equal(s2[1], "MoveHeadUpwards 2-8");
  assert.equal(s2[2], "Idle 9-9");
  assert.ok(s2[3].startsWith("Growl 10-"), s2[3]);
  const [, from, to] = s2[3].match(/(\d+)-(\d+)/).map(Number);
  assert.equal(to - from + 1, 7 + 13, "seven frames plus thirteen held ticks");
  assert.equal(resolveRecord(r2, set, 13).frame, 3);
  assert.equal(resolveRecord(r2, set, 26).frame, 3);
  assert.equal(resolveRecord(r2, set, 27).frame, 4);
  assert.ok(s2[5].startsWith("Growl"), `a second growl follows: ${s2[5]}`);
});

test("brain: a patrolling paramite waits, then turns or draws a hiss, and waits again", () => {
  // zero dice: the shortest wait, and a roll under six draws the hiss
  const r = creature("Paramite_Idle", "paramite");
  assert.deepEqual(segments(r, dice(0), 1, 105), [
    "Idle 1-46",
    "GameSpeakBegin 47-54",
    "PreHiss 55-59",
    "GameSpeakEnd 60-67",
    "Idle 68-104",
    "GameSpeakBegin 105-105",
  ]);
  // sevens turn instead, flipping at the turn's last frame
  const t = creature("Paramite_Idle", "paramite");
  assert.deepEqual(segments(t, dice(7), 1, 61), ["Idle 1-53", "Turn 54-60", "Idle 61-61"]);
  assert.equal(resolveRecord(t, dice(7), 60).flip, false);
  assert.equal(resolveRecord(t, dice(7), 61).flip, true);
});

test("brain: a meat saw strokes down and back and pauses the rolled time", () => {
  const p = {
    type: 0,
    start: 1,
    speed: 8,
    offSpeed: 0,
    maxRise: 65,
    switchMin: 15,
    switchMax: 45,
    autoMin: 30,
    autoMax: 30,
    initial: false,
    switchId: 0,
  };
  const r = creature("MeatSaw_Idle", "meatsaw", p);
  const set = dice(0);
  const dy = (t) => resolveRecord(r, set, t).y;
  assert.equal(resolveRecord(r, set, 1).name, "MeatSaw_Moving");
  assert.deepEqual([1, 2, 9, 10, 11, 18, 19].map(dy), [0, 8, 64, 72, 64, 8, 0]);
  assert.equal(resolveRecord(r, set, 19).name, "MeatSaw_Idle");
  assert.equal(resolveRecord(r, set, 33).name, "MeatSaw_Idle");
  assert.equal(resolveRecord(r, set, 34).name, "MeatSaw_Moving");
  assert.equal(dy(35), 8);
  // a switch-driven saw with its switch off at a fresh start never moves
  const still = creature("MeatSaw_Idle", "meatsaw", { ...p, type: 2, start: 0, switchId: 40 });
  assert.equal(segments(still, set, 1, 300).join(), "Idle 1-300");
  // one that starts at the bottom rises first
  const low = creature("MeatSaw_Idle", "meatsaw", { ...p, initial: true });
  assert.equal(resolveRecord(low, set, 1).y, 65 + 8 - (65 % 8) - 8);
  assert.ok(resolveRecord(low, set, 2).y < resolveRecord(low, set, 1).y);
});

test("brain: a drill strokes along its direction and rests a tick between strokes", () => {
  const p = {
    behavior: 0,
    startOn: true,
    speed: 5,
    offSpeed: 0,
    minOff: 0,
    maxOff: 0,
    minOffChange: 0,
    maxOffChange: 0,
    startBottom: false,
    direction: 0,
    width: 100,
    switchId: 0,
  };
  const r = creature("Drill_Vertical_Off", "drill", p);
  const set = dice(0);
  const at = (t) => resolveRecord(r, set, t);
  assert.equal(at(0).y, -100, "resting at the top of its rect");
  assert.equal(at(1).name, "Drill_Vertical_On");
  assert.deepEqual(
    [2, 3, 21, 22, 41, 42, 43].map((t) => at(t).y),
    [-95, -90, 0, -5, -100, -100, -95],
  );
  assert.equal(at(41).name, "Drill_Vertical_Off");
  assert.equal(at(42).name, "Drill_Vertical_On");
  // a toggled drill whose switch is off at a fresh start stands still
  const still = creature("Drill_Vertical_Off", "drill", {
    ...p,
    behavior: 1,
    startOn: false,
    switchId: 62,
  });
  assert.equal(segments(still, set, 1, 200).join(), "Vertical_Off 1-200");
  // the always-on switch id 1 flips the toggled outcomes: a start-off drill runs
  const run = creature("Drill_Vertical_Off", "drill", {
    ...p,
    behavior: 1,
    startOn: false,
    switchId: 1,
  });
  assert.equal(resolveRecord(run, set, 1).name, "Drill_Vertical_On");
  const held = creature("Drill_Vertical_Off", "drill", {
    ...p,
    behavior: 1,
    startOn: true,
    switchId: 1,
  });
  assert.equal(segments(held, set, 1, 50).join(), "Vertical_Off 1-50");
  // the quarter-speed code moves a fifth of a pixel a tick
  const slow = creature("Drill_Vertical_Off", "drill", { ...p, speed: 0.2 });
  assert.ok(Math.abs(resolveRecord(slow, set, 11).y - -98) < 1e-9);
});

// a flat world: one floor line, the objects given, no links
const PATROL_ANIMS = {
  ...IDLE_ANIMS,
  Slig_Idle: anim(6, 4, true),
  Slig_StandToWalk: anim(3, 1, false),
  Slig_Walking: anim(18, 1, true),
  Slig_WalkToStand: anim(3, 1, false),
  Slig_TurnAroundStanding: anim(9, 1, false),
  Slig_ReloadGun: anim(9, 2, false),
  Scrab_Idle: anim(6, 4, true),
  Scrab_Walk: anim(22, 1, true),
  Scrab_Run: anim(14, 1, true),
  Scrab_Turn: anim(12, 1, false),
  Scrab_RunToStand: anim(10, 1, false),
  Scrab_StandToWalk: anim(3, 1, false),
  Scrab_StandToRun: anim(3, 1, false),
  Scrab_WalkToStand: anim(3, 1, false),
  Scrab_HowlBegin: anim(15, 2, true),
  Scrab_HowlEnd: anim(6, 1, false),
  Scrab_Shriek: anim(12, 2, false),
  Fleech_Idle: anim(9, 1, true),
  Fleech_Crawl: anim(7, 1, true),
  Fleech_PatrolCry: anim(4, 2, true),
  Fleech_Knockback: anim(1, 1, false),
  Fleech_StopMidCrawlCycle: anim(4, 2, false),
  MovingBomb: anim(15, 2, true),
};
const world = (game, lines, tlvs, spawn, half = false) => ({
  game,
  half,
  lines,
  links: null,
  tlvs,
  spawn,
});
const tlv = (name, x1, y1, x2, y2, fields = {}) => ({ name, x1, y1, x2, y2, fields });
const walker = (animName, name, p, w, x, y, flip = false, seed = 0) => ({
  anim: animName,
  x,
  y,
  scale: w.half ? 0.5 : 1,
  layer: 27,
  flip,
  frame: 0,
  cycle: { kind: "brain", brain: name, seed, emo: false, p, world: w, patrol: true },
});
const trail = (r, set, from, to, step = 1) => {
  const out = [];
  for (let t = from; t <= to; t += step) {
    const s = resolveRecord(r, set, t);
    out.push(`${t}:${s.name.replace(/^[A-Za-z]+_/, "")}@${Math.round(s.x)}${s.flip ? "<" : ">"}`);
  }
  return out;
};

test("patrol: a slig walks to its zone's edge, waits the rolled pause, turns and walks back", () => {
  const floor = [[0, 100, 1000, 100, 0]];
  const w = world("AE", floor, [], { x: 300, y: 90 });
  const p = {
    pauseTime: 10,
    leftMin: 30,
    leftMax: 60,
    rightMin: 30,
    rightMax: 60,
    zone: { x: 200, w: 500 },
  };
  const r = walker("Slig_Idle", "slig", p, w, 300, 100);
  const set = { anims: PATROL_ANIMS, dice: new Array(256).fill(0) };
  // the pause_time wait, then the walk starts: three transition frames, then the loop
  assert.equal(resolveRecord(r, set, 9).name, "Slig_Idle");
  assert.equal(resolveRecord(r, set, 9).x, 300);
  assert.equal(resolveRecord(r, set, 10).name, "Slig_StandToWalk");
  assert.ok(resolveRecord(r, set, 20).x > 300, "it has moved right");
  assert.equal(resolveRecord(r, set, 20).name, "Slig_Walking");
  // a ninth of a grid a tick: 25/9 a tick once walking
  const dx = resolveRecord(r, set, 40).x - resolveRecord(r, set, 39).x;
  assert.ok(Math.abs(dx - 25 / 9) < 1e-9, `stride ${dx}`);
  // the zone's edge is read two grids ahead, but a walk ends only at its eleventh
  // frame, so it stops about at the edge; it idles the 30-tick pause, turns and heads left
  let stopT = null,
    turnT = null,
    backT = null;
  for (let t = 20; t < 600; t++) {
    const s = resolveRecord(r, set, t);
    if (stopT === null && s.name === "Slig_Idle") stopT = t;
    if (stopT !== null && turnT === null && s.name === "Slig_TurnAroundStanding") turnT = t;
    if (turnT !== null && s.name === "Slig_Walking" && s.flip) {
      backT = t;
      break;
    }
  }
  // the pause is armed when the edge is read, while the walk still has up to
  // twenty ticks to run, so the standing part of it is shorter than the field;
  // the ticks are a trace pinned from the port, not derived from the fields
  assert.deepEqual([stopT, turnT, backT], [82, 96, 109]);
  const atStop = resolveRecord(r, set, stopT);
  assert.ok(Math.abs(atStop.x - 500) < 1e-9, `stops at the edge: ${atStop.x}`);
  assert.equal(resolveRecord(r, set, turnT).flip, false);
  assert.equal(
    resolveRecord(r, set, turnT + 9).flip,
    true,
    "the facing flips at the turn's last frame",
  );
  assert.ok(resolveRecord(r, set, backT + 30).x < atStop.x, "it walks back left");
  // and keeps patrolling: it is somewhere inside the zone much later, still moving
  const late = trail(r, set, 3000, 3600, 100);
  assert.ok(new Set(late.map((s) => s.split("@")[1])).size > 1, late.join(" "));
});

test("patrol: a slig at its bound pauses in place, turns, and walks the open way", () => {
  const floor = [[0, 100, 1000, 100, 0]];
  const w = world("AO", floor, [], { x: 300, y: 90 });
  // Oddysee's unset zone reads 12809..6405: facing left it is always at the bound
  const p = {
    pauseTime: 0,
    leftMin: 20,
    leftMax: 20,
    rightMin: 20,
    rightMax: 20,
    zone: { x: 12809, w: 6405 },
  };
  const r = walker("Slig_Idle", "slig", p, w, 300, 100, true);
  const set = { anims: PATROL_ANIMS, dice: new Array(256).fill(0) };
  const steps = trail(r, set, 1, 400);
  const names = steps.map((s) => s.split(":")[1].split("@")[0]);
  const turn = names.indexOf("TurnAroundStanding"),
    walk = names.indexOf("Walking");
  assert.ok(turn > 0 && walk > turn, `turns before it walks: ${turn} ${walk}`);
  assert.ok(
    names.slice(0, turn).every((n) => n === "Idle"),
    "stands until the turn",
  );
  assert.ok(
    resolveRecord(r, set, 400).x > 300 && !resolveRecord(r, set, 400).flip,
    "then walks right",
  );
});

test("patrol: an Oddysee slig walks under a wall an Exoddus one stops at, its probe ten units lower", () => {
  const lines = [
    [0, 100, 1000, 100, 0],
    [400, 50, 400, 64, 1],
  ];
  const p = {
    pauseTime: 0,
    leftMin: 20,
    leftMax: 20,
    rightMin: 20,
    rightMax: 20,
    zone: { x: 200, w: 500 },
  };
  const set = { anims: PATROL_ANIMS, dice: new Array(256).fill(0) };
  const reach = (game, x = 300) => {
    const w = world(game, lines, [], { x, y: 90 });
    const r = walker("Slig_Idle", "slig", p, w, x, 100);
    return Math.max(...trail(r, set, 1, 300).map((s) => +s.split("@")[1].slice(0, -1)));
  };
  assert.ok(reach("AE") < 400, `Exoddus probes 45 up and meets the wall: ${reach("AE")}`);
  assert.ok(reach("AO") >= 490, `Oddysee probes 35 up and walks under it: ${reach("AO")}`);
  // a grid short of the wall the stand-to-walk probe is the one that answers
  assert.equal(reach("AE", 375), 375, "Exoddus never sets off");
  assert.ok(reach("AO", 375) > 450, `Oddysee walks to its zone's edge: ${reach("AO", 375)}`);
});

test("patrol: an Exoddus scrab walks to its bound and turns, waiting the side's rolled delay", () => {
  const floor = [[0, 100, 1000, 100, 0]];
  const bounds = [
    tlv("ScrabLeftBound", 100, 76, 124, 100),
    tlv("ScrabRightBound", 700, 76, 724, 100),
  ];
  const w = world("AE", floor, bounds, { x: 400, y: 90 });
  const p = { chance: 0, leftMin: 20, leftMax: 40, rightMin: 20, rightMax: 40 };
  const r = walker("Scrab_Idle", "scrab", p, w, 400, 100);
  // forties never shriek (under 3) nor howl (under 30), and always walk at chance 0
  const set = { anims: PATROL_ANIMS, dice: new Array(256).fill(40) };
  assert.equal(resolveRecord(r, set, 2).name, "Scrab_StandToWalk");
  assert.equal(resolveRecord(r, set, 10).name, "Scrab_Walk");
  let turnT = null;
  for (let t = 10; t < 2000 && turnT === null; t++)
    if (resolveRecord(r, set, t).name === "Scrab_Turn") turnT = t;
  // the bound is read a grid ahead and the walk ends at its next stop frame;
  // the tick and the place are a trace pinned from the port, not derived
  assert.equal(turnT, 133, "it turns at the right bound");
  const atTurn = resolveRecord(r, set, turnT);
  assert.ok(Math.abs(atTurn.x - 702.233417578125) < 1e-9, `turns beside the bound: ${atTurn.x}`);
  assert.equal(resolveRecord(r, set, turnT + 12).flip, true);
  assert.equal(resolveRecord(r, set, turnT + 12).name, "Scrab_Idle");
  assert.equal(resolveRecord(r, set, turnT + 30).name, "Scrab_Idle", "the 20-tick wait holds");
  assert.ok(resolveRecord(r, set, turnT + 60).x < atTurn.x, "then it walks back left");
  // chance 4 always runs
  const runner = walker("Scrab_Idle", "scrab", { ...p, chance: 4 }, w, 400, 100);
  assert.equal(resolveRecord(runner, set, 2).name, "Scrab_StandToRun");
  assert.equal(resolveRecord(runner, set, 8).name, "Scrab_Run");
});

test("patrol: a scrab whose walk meets a wall just before its bound still turns and walks back", () => {
  const floor = [
    [0, 100, 1000, 100, 0],
    [676, 40, 676, 100, 1],
  ];
  const bounds = [
    tlv("ScrabLeftBound", 100, 76, 124, 100),
    tlv("ScrabRightBound", 700, 76, 724, 100),
  ];
  const w = world("AE", floor, bounds, { x: 400, y: 90 });
  const p = { chance: 0, leftMin: 20, leftMax: 40, rightMin: 20, rightMax: 40 };
  const r = walker("Scrab_Idle", "scrab", p, w, 400, 100);
  const set = { anims: PATROL_ANIMS, dice: new Array(256).fill(40) };
  let turnT = null;
  for (let t = 1; t < 3000 && turnT === null; t++)
    if (resolveRecord(r, set, t).name === "Scrab_Turn") turnT = t;
  // a trace pinned from the port, not derived
  assert.equal(turnT, 120, "the armed turn survives the wall's stand");
  const atTurn = resolveRecord(r, set, turnT).x;
  assert.ok(Math.abs(atTurn - 664.5510295166016) < 1e-9, `stood by the wall: ${atTurn}`);
  assert.ok(resolveRecord(r, set, turnT + 80).x < atTurn - 50, "and it walks back left afterwards");
});

test("patrol: an Oddysee scrab meets its bound at its own point and howls on a low roll", () => {
  const floor = [[0, 100, 1000, 100, 0]];
  const bounds = [
    tlv("ScrabLeftBound", 100, 76, 124, 100),
    tlv("ScrabRightBound", 600, 76, 624, 100),
  ];
  const w = world("AO", floor, bounds, { x: 400, y: 90 });
  const p = { chance: 0, leftMin: 20, leftMax: 20, rightMin: 20, rightMax: 20 };
  const r = walker("Scrab_Idle", "scrab", p, w, 400, 100);
  const set = { anims: PATROL_ANIMS, dice: new Array(256).fill(0) };
  const names = trail(r, set, 1, 1500).map((s) => s.split(":")[1].split("@")[0]);
  assert.ok(
    names.includes("Turn") && names.includes("HowlBegin") && names.includes("HowlEnd"),
    [...new Set(names)].join(),
  );
  assert.ok(!names.includes("Shriek"), "Oddysee's patrol never shrieks");
  const xs = trail(r, set, 1, 1500).map((s) => +s.split("@")[1].slice(0, -1));
  assert.ok(
    Math.max(...xs) <= 625 && Math.min(...xs) >= 99,
    `stays between its bounds: ${Math.min(...xs)}..${Math.max(...xs)}`,
  );
});

test("patrol: an Oddysee scrab rolls for the three mixed types alone, and probes the wall through its last strides", () => {
  const floor = [[0, 100, 1000, 100, 0]];
  const bounds = [
    tlv("ScrabLeftBound", 100, 76, 124, 100),
    tlv("ScrabRightBound", 600, 76, 624, 100),
  ];
  const set = { anims: PATROL_ANIMS, dice: new Array(256).fill(40) };
  const w = world("AO", floor, bounds, { x: 400, y: 90 });
  const p = { chance: 0, leftMin: 20, leftMax: 20, rightMin: 20, rightMax: 20 };
  // a type the engine never rolls for walks whatever the dice say
  const five = walker("Scrab_Idle", "scrab", { ...p, chance: 5 }, w, 400, 100);
  assert.equal(resolveRecord(five, set, 2).name, "Scrab_StandToWalk");
  // type 4 runs rolled or not, so the type-5 line is the one that tells the branch
  const four = walker("Scrab_Idle", "scrab", { ...p, chance: 4 }, w, 400, 100);
  assert.equal(resolveRecord(four, set, 2).name, "Scrab_StandToRun");
  // a wall at the bound: the walk-to-stand strides probe it and stand short, where
  // without the probe the scrab would turn at 602.23; a trace pinned from the port
  const walled = world("AO", [...floor, [600, 60, 600, 100, 1]], bounds, { x: 400, y: 90 });
  const r = walker("Scrab_Idle", "scrab", p, walled, 400, 100);
  assert.equal(resolveRecord(r, set, 87).name, "Scrab_WalkToStand");
  const turn = resolveRecord(r, set, 91);
  assert.equal(turn.name, "Scrab_Turn");
  assert.equal(turn.x.toFixed(2), "599.37");
});

test("patrol: a sleepy fleech's anger counts down from its field, and it dozes off once it is spent", () => {
  const floor = [[0, 100, 1000, 100, 0]];
  const w = world("AE", floor, [], { x: 500, y: 90 });
  const anims = { ...PATROL_ANIMS, Fleech_Sleeping: anim(9, 4, true) };
  const set = { anims, dice: new Array(256).fill(7) };
  // anger starts at 2 + (increaser - 2) / 2 and drops one every 32 ticks; at 1 the fleech sleeps
  const dozes = (increaser) => {
    const r = walker(
      "Fleech_Idle",
      "fleech",
      { goesToSleep: true, increaser, range: 0 },
      w,
      500,
      100,
    );
    for (let t = 1; t < 600; t++) if (resolveRecord(r, set, t).name === "Fleech_Sleeping") return t;
    return null;
  };
  assert.equal(dozes(4), 56);
  assert.equal(dozes(8), 120);
});

test("patrol: a fleech facing left asks for a stopper at its own x, one facing right a grid ahead", () => {
  const floor = [[0, 100, 1000, 100, 0]];
  const stopper = (x1, x2, dir) =>
    tlv("EnemyStopper", x1, 76, x2, 100, { stop_direction: dir, switch_id: 1 });
  const table = Array.from({ length: 256 }, (_, i) => (i * 200 + 13) & 255);
  const span = (s, flip) => {
    const w = world("AE", floor, [s], { x: 500, y: 90 });
    const r = walker(
      "Fleech_Idle",
      "fleech",
      { goesToSleep: false, increaser: 4, range: 300 },
      w,
      500,
      100,
      flip,
    );
    const xs = trail(r, { anims: PATROL_ANIMS, dice: table }, 1, 1500).map(
      (q) => +q.split("@")[1].slice(0, -1),
    );
    return [Math.min(...xs), Math.max(...xs)];
  };
  // facing left it crawls left: a stopper under it holds it, one a grid to its left is not asked about
  assert.equal(span(stopper(495, 505, 0), true)[0], 500);
  assert.ok(span(stopper(468, 482, 0), true)[0] < 450);
  // facing right it crawls right: one under it is not asked about, one a grid ahead holds it
  assert.ok(span(stopper(495, 505, 1), false)[1] > 550);
  assert.equal(span(stopper(518, 532, 1), false)[1], 500);
});

test("patrol: a slam door the switches hold shut turns a scrab, a Glukkon and a fleech as a wall would", () => {
  const floor = [[0, 100, 1000, 100, 0]];
  const bounds = [
    tlv("ScrabLeftBound", 100, 76, 124, 100),
    tlv("ScrabRightBound", 700, 76, 724, 100),
  ];
  const door = (x, start_shut, switch_id) =>
    tlv("SlamDoor", x, 76, x + 24, 100, { start_shut, switch_id });
  const anims = { ...PATROL_ANIMS, ...ROAMER_ANIMS };
  const steps = (door, animName, brain, p, x, dice) => {
    const w = world("AE", floor, [...bounds, door], { x, y: 90 });
    return trail(walker(animName, brain, p, w, x, 100), { anims, dice }, 1, 1500);
  };
  const forties = new Array(256).fill(40);
  const scrab = { chance: 0, leftMin: 20, leftMax: 40, rightMin: 20, rightMax: 40 };
  const far = (d) => spanOf(steps(d, "Scrab_Idle", "scrab", scrab, 400, forties))[1];
  assert.ok(
    far(door(580, 1, 7)) < 580,
    "the scrab turns short of a door shut until its switch is thrown",
  );
  assert.ok(far(door(580, 0, 7)) > 650, "and walks through one open until then");
  assert.ok(far(door(580, 0, 1)) < 580, "a door the always-on switch shuts turns it too");
  assert.ok(far(door(580, 1, 1)) > 650, "and one that switch opens is walked through");
  const gluk = { type: "Normal", checkWalls: true };
  const gfar = (d) => spanOf(steps(d, "Glukkon_Normal_Idle", "glukkon", gluk, 400, forties))[1];
  assert.ok(gfar(door(580, 1, 7)) < 580, "the Glukkon turns at it");
  assert.ok(gfar(door(580, 0, 7)) > 650);
  // a fleech probes the door only as a crawl starts, a grid ahead: with these dice
  // every crawl would head right into it, so it stands all the while
  const fleech = { goesToSleep: false, increaser: 4, range: 300 };
  const table = Array.from({ length: 256 }, (_, i) => (i * 200 + 13) & 255);
  const shut = steps(door(520, 1, 7), "Fleech_Idle", "fleech", fleech, 500, table);
  assert.deepEqual([...kinds(shut)], ["Idle"], "it never sets off into the door");
  assert.deepEqual(spanOf(shut), [500, 500]);
  const open = steps(door(520, 0, 7), "Fleech_Idle", "fleech", fleech, 500, table);
  assert.ok(spanOf(open)[1] > 600, "an open door is crawled through");
});

test("patrol: an awake fleech turns on the spot, cries, and crawls within its range", () => {
  const floor = [[0, 100, 1000, 100, 0]];
  const w = world("AE", floor, [], { x: 500, y: 90 });
  const p = { goesToSleep: false, increaser: 4, range: 75 };
  const r = walker("Fleech_Idle", "fleech", p, w, 500, 100);
  const table = Array.from({ length: 256 }, (_, i) => (i * 97 + 13) & 255);
  const set = { anims: PATROL_ANIMS, dice: table };
  const steps = trail(r, set, 1, 4000);
  const names = new Set(steps.map((s) => s.split(":")[1].split("@")[0]));
  assert.ok(
    names.has("Crawl") && names.has("Knockback") && names.has("PatrolCry"),
    [...names].join(),
  );
  const xs = steps.map((s) => +s.split("@")[1].slice(0, -1));
  // a crawl stops at its loop's last frame, so it overruns its target by a few strides
  assert.ok(
    Math.min(...xs) >= 500 - 75 - 30 && Math.max(...xs) <= 500 + 75 + 30,
    `${Math.min(...xs)}..${Math.max(...xs)}`,
  );
  assert.ok(new Set(xs).size > 10, "it does wander");
});

test("void: Oddysee's skippers carry a point in the gap between screens to the next one's edge", () => {
  // the first screen spans 256..624; twelve units of margin count as on it
  assert.equal(camVoidX(503, 1, 12), null);
  assert.equal(camVoidX(636, 3, 12), null);
  assert.equal(camVoidX(640, 3, 12), 1268, "walking right lands twelve inside the next screen");
  assert.equal(camVoidX(1260, -3, 12), 636, "walking left lands twelve past the first's edge");
  assert.equal(camVoidX(1270, -3, 12), null);
  assert.equal(camVoidY(300, 1, 12), null);
  assert.equal(camVoidY(400, 2, 12), 588, "falling lands twelve above the next screen's top");
  assert.equal(camVoidY(400, -2, 12), 372, "rising lands twelve under the first's bottom");
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

test("patrol: an Oddysee slig whose bounds sit on two screens crosses the gap between them and comes back", () => {
  // two screens' floors each run some way into the gap, with nothing between
  const floors = [
    [452, 215, 770, 215, 0],
    [1129, 215, 1816, 215, 0],
  ];
  const bounds = [
    tlv("SligBoundLeft", 478, 195, 502, 219),
    tlv("SligBoundRight", 1428, 192, 1452, 216),
  ];
  const w = world("AO", floors, bounds, { x: 503, y: 194 });
  const p = {
    pauseTime: 10,
    leftMin: 30,
    leftMax: 60,
    rightMin: 30,
    rightMax: 60,
    zone: { x: 478, w: 1428 },
  };
  const r = walker("Slig_Idle", "slig", p, w, 503, 215);
  const set = { anims: PATROL_ANIMS, dice: new Array(256).fill(0) };
  const steps = trail(r, set, 1, 2000);
  const xs = steps.map((s) => +s.split("@")[1].slice(0, -1));
  // the step that lands in the gap is the one carried across, so no tick stands deep in it
  assert.ok(
    !xs.some((x) => x > 660 && x < 1250),
    `never stands in the gap: ${xs.filter((x) => x > 660 && x < 1250)[0]}`,
  );
  assert.ok(Math.max(...xs) > 1300, `reaches the second screen: ${Math.max(...xs)}`);
  const back = xs.findIndex((x, i) => i > 0 && xs[i - 1] > 1250 && x < 660);
  assert.ok(back > 0, "and steps back across");
  assert.ok(Math.min(...xs.slice(back)) < 540, "to walk its first screen again");
  assert.ok(
    steps.every((s) => !s.includes("@NaN")),
    "stays on its floor throughout",
  );
});

test("patrol: a moving bomb follows its track, pauses at a stopper and carries on", () => {
  const track = [[100, 200, 900, 200, 8]];
  const stopper = tlv("MovingBombStopper", 500, 190, 524, 214, { min_delay: 10, max_delay: 30 });
  const w = world("AO", track, [stopper], { x: 290, y: 190 });
  const p = { speed: 2048 / 256, startSpeed: 0, switchId: 1 };
  const r = walker("MovingBomb", "bomb", p, w, 300, 200);
  const set = { anims: PATROL_ANIMS, dice: new Array(256).fill(0) };
  assert.equal(resolveRecord(r, set, 1).x, 300, "the switch is read before the first move");
  assert.equal(resolveRecord(r, set, 2).x, 300.5, "half a unit of speed on its first moving tick");
  assert.ok(resolveRecord(r, set, 60).x > 450);
  // it brakes inside the stopper, waits ten ticks past braking, then pulls away
  let stopT = null;
  // braking passes through a tick of zero speed and half a step back before the wait
  for (let t = 1; t < 600; t++) {
    const a = resolveRecord(r, set, t).x,
      b = resolveRecord(r, set, t + 1).x,
      c = resolveRecord(r, set, t + 2).x;
    if (a === b && b === c) {
      stopT = t;
      break;
    }
  }
  // a trace pinned from the port, not derived
  assert.equal(stopT, 51, "it stops");
  const xStop = resolveRecord(r, set, stopT).x;
  assert.equal(xStop, 563.5, "past the stopper's edge by its braking distance");
  assert.equal(resolveRecord(r, set, stopT + 8).x, xStop, "the ten-tick wait holds");
  assert.ok(resolveRecord(r, set, stopT + 40).x > xStop, "it moves on");
  // the track's end leaves it standing
  assert.equal(resolveRecord(r, set, 2000).x, resolveRecord(r, set, 3000).x);
  // and a switch that is off at a fresh start never moves it
  const still = walker("MovingBomb", "bomb", { ...p, switchId: 41 }, w, 300, 200);
  assert.equal(resolveRecord(still, set, 500).x, 300);
});

const ROAMER_ANIMS = {
  ...PATROL_ANIMS,
  Slurg_Move: anim(6, 2, true),
  Slurg_Turn_Around: anim(6, 2, false),
  Greeter_Moving: anim(9, 1, true),
  Greeter_Turn: anim(6, 1, false),
  Greeter_Speak: anim(8, 1, false),
  MotionDetector_Flare: anim(1, 1, true),
  MotionDetector_Laser: anim(1, 1, true),
  Bat: anim(10, 2, true),
  Bat_Unknown: anim(7, 1, false),
  Bat_Flying: anim(15, 1, true),
  Glukkon_Normal_Idle: anim(7, 4, true),
  Glukkon_Normal_BeginWalk: anim(3, 1, false),
  Glukkon_Normal_Walk: anim(18, 1, true),
  Glukkon_Normal_EndWalk: anim(3, 1, false),
  Glukkon_Normal_EndSingleStep: anim(3, 1, false),
  Glukkon_Normal_Turn: anim(10, 1, false),
  Glukkon_Normal_Speak1: anim(11, 1, false),
  Glukkon_Normal_LongLaugh: anim(22, 1, false),
  Background_Glukkon_Idle: anim(6, 4, true),
  Background_Glukkon_KillHim1: anim(11, 2, false),
  Background_Glukkon_KillHim2: anim(11, 2, false),
  FlyingSlig_Idle: anim(4, 1, true),
  FlyingSlig_IdleToHorizontal: anim(4, 1, false),
  FlyingSlig_IdleTurnAround: anim(10, 1, false),
  FlyingSlig_MoveHorizontal: anim(4, 1, true),
  FlyingSlig_MoveHorizontalEnd: anim(4, 1, false),
  FlyingSlig_TurnQuick: anim(11, 1, false),
  FlyingSlig_BeginDownMovement: anim(3, 1, false),
  FlyingSlig_MoveDown: anim(4, 1, true),
  FlyingSlig_EndDownMovement: anim(3, 1, true),
  FlyingSlig_MoveDownToHorizontal: anim(3, 1, false),
  FlyingSlig_MoveDownTurnAround: anim(6, 1, false),
  FlyingSlig_MoveUp: anim(4, 1, true),
  FlyingSlig_EndUpMovement: anim(3, 1, true),
  FlyingSlig_MoveUpToHorizontal: anim(3, 1, false),
  FlyingSlig_MoveUpTurnAround: anim(6, 1, false),
  FlyingSlig_MoveHorizontalToDown: anim(3, 1, false),
  FlyingSlig_HorizontalToUpMovement: anim(3, 1, false),
};
const roamSet = (v) => ({ anims: ROAMER_ANIMS, dice: new Array(256).fill(v) });
const spanOf = (steps) => {
  const xs = steps.map((s) => +s.split("@")[1].slice(0, -1));
  return [Math.min(...xs), Math.max(...xs)];
};
const kinds = (steps) => new Set(steps.map((s) => s.split(":")[1].split("@")[0]));

test("roam: a slurg creeps half a unit a tick, pauses on its timer, and turns at a bound", () => {
  const floor = [[0, 100, 1000, 100, 0]];
  const bounds = [
    tlv("ScrabLeftBound", 300, 76, 324, 100),
    tlv("ScrabRightBound", 700, 76, 724, 100),
  ];
  const w = world("AE", floor, bounds, { x: 500, y: 90 });
  // a right-starting slurg moves toward -x first, unflipped, and turns flipped
  const r = walker("Slurg_Move", "slurg", { delay: 40, right: true }, w, 500, 100);
  const set = roamSet(0);
  assert.equal(resolveRecord(r, set, 1).x, 499, "one unit every other tick");
  assert.equal(resolveRecord(r, set, 2).x, 499);
  assert.equal(resolveRecord(r, set, 3).x, 498);
  const steps = trail(r, set, 1, 1500);
  const names = kinds(steps);
  assert.ok(names.has("Turn_Around"), "it pauses or turns");
  assert.deepEqual(
    spanOf(steps),
    [324, 700],
    "turns at the left bound and stays under the right one",
  );
  // the first pause comes when the 40-tick timer runs out, direction kept; the
  // span is a trace pinned from the port, not derived
  const pause = steps.findIndex((s) => s.includes("Turn_Around"));
  assert.equal(pause, 40, `first pause at ${pause}`);
  assert.equal(resolveRecord(r, set, pause + 1).flip, false, "a pause keeps the facing");
});

test("roam: a greeter rolls three units a tick, turns at bounds, stops to speak and sweeps its laser", () => {
  const floor = [[0, 100, 1000, 100, 0]];
  const bounds = [
    tlv("ScrabLeftBound", 200, 76, 224, 100),
    tlv("ScrabRightBound", 800, 76, 824, 100),
  ];
  const w = world("AE", floor, bounds, { x: 500, y: 90 });
  // facing right (start_direction Right_1) it moves toward -x
  const body = walker("Greeter_Moving", "greeter", { part: "body" }, w, 500, 100, false);
  const laser = walker("MotionDetector_Laser", "greeter", { part: "laser" }, w, 500, 100, false);
  const set = roamSet(0);
  assert.equal(resolveRecord(body, set, 1).x, 497);
  assert.equal(resolveRecord(body, set, 2).x, 494);
  const steps = trail(body, set, 1, 2000);
  const names = kinds(steps);
  assert.ok(names.has("Turn") && names.has("Speak"), [...names].join());
  // a trace pinned from the port, not derived
  assert.deepEqual(spanOf(steps), [236, 788], "turns four strides short of either bound");
  // the first speech comes at the 70-tick timer, standing still
  const speak = steps.findIndex((s) => s.includes("Speak"));
  assert.equal(speak, 70, `speaks at ${speak}`);
  assert.equal(resolveRecord(body, set, speak + 2).x, resolveRecord(body, set, speak + 5).x);
  // the laser rides along and sweeps two units a tick past the body
  const dl = resolveRecord(laser, set, 10).x - resolveRecord(laser, set, 9).x;
  assert.equal(dl, -3 + 2, "the body's stride plus the sweep's own");
  assert.equal(resolveRecord(laser, set, speak + 2), null, "hidden while it speaks");
});

test("roam: a bat hangs its while, takes off along its line and returns to its perch at the chain's end", () => {
  const track = [[100, 50, 700, 50, 8]];
  const w = world("AO", track, [], { x1: 90, y1: 40, x2: 114, y2: 64 });
  const r = walker("Bat", "bat", { wait: 20, speed: 1280 / 256 }, w, 100, 55);
  const set = roamSet(0);
  assert.equal(resolveRecord(r, set, 21).name, "Bat");
  assert.equal(resolveRecord(r, set, 22).name, "Bat_Unknown", "takes off the tick after the wait");
  assert.ok(Math.abs(resolveRecord(r, set, 23).x - 101.8) < 1e-9, "accelerating 1.8 a tick");
  assert.equal(resolveRecord(r, set, 29).name, "Bat_Flying");
  const steps = trail(r, set, 1, 400);
  const back = steps.findIndex((s, i) => i > 30 && s.includes(":Bat@100"));
  assert.ok(back > 100, `returns to its perch after the line's end: ${back}`);
  assert.equal(resolveRecord(r, set, back + 5).name, "Bat");
});

test("roam: a wall-checking Glukkon paces to its bound, pauses, turns, and has a word", () => {
  const floor = [[0, 100, 1000, 100, 0]];
  const bounds = [
    tlv("ScrabLeftBound", 100, 76, 124, 100),
    tlv("ScrabRightBound", 600, 76, 624, 100),
  ];
  const w = world("AE", floor, bounds, { x: 300, y: 90 });
  const r = walker(
    "Glukkon_Normal_Idle",
    "glukkon",
    { type: "Normal", checkWalls: true },
    w,
    300,
    100,
  );
  // forties never roll under five, so the walk is unbroken by speech
  const set = roamSet(40);
  assert.equal(resolveRecord(r, set, 2).name, "Glukkon_Normal_BeginWalk");
  assert.equal(resolveRecord(r, set, 5).name, "Glukkon_Normal_Walk");
  assert.ok(resolveRecord(r, set, 30).x > 300, "it strides right");
  const steps = trail(r, set, 1, 3000);
  const names = kinds(steps);
  const has = (set, end) => [...set].some((n) => n.endsWith(end));
  assert.ok(
    has(names, "Turn") && (has(names, "Speak1") || has(names, "LongLaugh")),
    [...names].join(),
  );
  const [lo, hi] = spanOf(steps);
  assert.ok(hi <= 630 && lo >= 95, `between its bounds: ${lo}..${hi}`);
  // the standing Glukkon never walks
  const stand = walker(
    "Glukkon_Normal_Idle",
    "glukkon",
    { type: "Normal", checkWalls: false },
    w,
    300,
    100,
  );
  const still = trail(stand, set, 1, 1000);
  assert.ok(!has(kinds(still), "Walk"));
  assert.equal(spanOf(still)[0], spanOf(still)[1]);
});

test("roam: Oddysee's background Glukkon speaks a rolled line every dozen-odd ticks", () => {
  const r = creature("Background_Glukkon_Idle", "glukkonAO");
  const set = roamSet(0);
  // zero dice: the pause is twelve ticks and the line is the first
  assert.deepEqual(segments(r, set, 1, 40), [
    "Glukkon_Idle 1-14",
    "Glukkon_KillHim1 15-35",
    "Glukkon_Idle 36-40",
  ]);
  // a roll of four holds its tongue a tick longer each time
  const quiet = creature("Background_Glukkon_Idle", "glukkonAO");
  assert.equal(segments(quiet, roamSet(4), 1, 200).join(), "Glukkon_Idle 1-200");
});

test("roam: a flying slig waits its delay, flies its track to the end, pauses and flies back", () => {
  const track = [[100, 300, 900, 300, 8]];
  const w = world("AE", track, [], { x1: 400, y1: 280, x2: 424, y2: 320 });
  const p = { left: false, delayed: false, delay: 0, pauseMin: 30, pauseMax: 60, maxSpeed: 6 };
  const r = walker("FlyingSlig_Idle", "flyslig", p, w, 100, 320, false);
  const set = roamSet(0);
  // facing right and travelling toward the line's start, it turns about first
  const steps = trail(r, set, 1, 1500);
  const names = kinds(steps);
  assert.ok(
    names.has("MoveHorizontal") && names.has("Idle") && names.has("IdleTurnAround"),
    [...names].join(),
  );
  assert.deepEqual(spanOf(steps), [100, 900], "flies the whole track");
  // the push is let off short of the end, so the flight reads as ended while it
  // coasts in, pushes once more for the last stretch, and rests the rolled delay;
  // the ticks and places are a trace pinned from the port, not derived
  const changes = [];
  for (let i = 1; i < steps.length; i++) {
    const [was, now] = [steps[i - 1], steps[i]].map((s) => s.split(":")[1].split("@")[0]);
    if (now !== was) changes.push(`${i + 1}:${now}@${steps[i].split("@")[1]}`);
  }
  assert.deepEqual(changes.slice(0, 10), [
    "31:IdleToHorizontal@100>",
    "35:MoveHorizontal@106>",
    "164:MoveHorizontalEnd@862>",
    "168:Idle@880>",
    "169:IdleToHorizontal@884>",
    "173:MoveHorizontalEnd@898>",
    "177:Idle@900>",
    "211:IdleTurnAround@900>",
    "221:MoveHorizontal@874<",
    "344:MoveHorizontalEnd@138<",
  ]);
  // it tops out at its max velocity
  let fastest = 0;
  for (let t = 2; t < 400; t++)
    fastest = Math.max(
      fastest,
      Math.abs(resolveRecord(r, set, t).x - resolveRecord(r, set, t - 1).x),
    );
  assert.ok(Math.abs(fastest - 6) < 1e-9, `top speed ${fastest}`);
  // and bobs about its hanging height
  const ys = new Set(
    trail(r, set, 1, 60).map((_, i) => Math.round(resolveRecord(r, set, i + 1).y * 1000)),
  );
  assert.ok(ys.size > 3, "the bob moves it");
});

const FX_ANIMS = {
  ...ROAMER_ANIMS,
  Mudokon_CrouchChant: anim(8, 4, true),
  ChantOrb_Particle: anim(8, 2, true),
  Zap_Sparks: anim(2, 1, true),
  HintFly: anim(12, 2, true),
  Slog_Sleeping: anim(4, 4, true),
  Fleech_SleepingWithTongue: anim(9, 4, true),
};
const fxSet = (v) => ({ anims: FX_ANIMS, dice: new Array(256).fill(v) });
const fxCreature = (animName, name, p = null, game = "AO") => ({
  ...creature(animName, name, p),
  cycle: { kind: "brain", brain: name, game, seed: 0, emo: false, p },
});

test("effects: a sit-chanting Mudokon lets off a chant orb every eight ticks that plays once", () => {
  const r = fxCreature("Mudokon_CrouchChant", "chant");
  const set = fxSet(0);
  assert.deepEqual(resolveEffects(r, set, 7), []);
  const [orb] = resolveEffects(r, set, 8);
  assert.equal(orb.name, "ChantOrb_Particle");
  // zero dice: ten units left and ten up of the mud
  assert.deepEqual([orb.x, orb.y, orb.layer, orb.blend], [-10, -10, 36, 1]);
  assert.equal(orb.frame, 0);
  assert.equal(resolveEffects(r, set, 9)[0].frame, 0);
  assert.equal(resolveEffects(r, set, 10)[0].frame, 1);
  // the eight frames at two ticks each show through tick 22, and the next orb joins at 16
  assert.equal(resolveEffects(r, set, 16).length, 2);
  assert.equal(resolveEffects(r, set, 22).length, 2);
  assert.equal(resolveEffects(r, set, 23).length, 1);
  assert.equal(
    resolveRecord(r, set, 100).name,
    "Mudokon_CrouchChant",
    "the mud itself keeps chanting",
  );
});

test("effects: a chiselling Mudokon strikes sparks on the odd ticks of its stroke's last frame", () => {
  const r = {
    ...worker("chisel"),
    cycle: { kind: "brain", brain: "chisel", game: "AE", seed: 0, emo: false, p: null },
  };
  const set = fxSet(7);
  // the chisel loops six frames at two ticks: its last frame is seen at ticks 12 and 13, the odd one strikes
  assert.deepEqual(resolveEffects(r, set, 12), []);
  const struck = resolveEffects(r, set, 13);
  assert.equal(struck.length, 1, "the sprite shows at once, the lines a tick later");
  assert.equal(struck[0].name, "Zap_Sparks");
  assert.deepEqual([struck[0].x, struck[0].y], [18, -3]);
  const lit = resolveEffects(r, set, 14);
  const lines = lit.find((e) => e.kind === "lines");
  assert.equal(lines.segs.length, 9, "nine lines on the first lit tick");
  for (const [x0, y0, x1, y1] of lines.segs) {
    assert.ok(Math.abs(x0) < 1e-9 && Math.abs(y0) < 1e-9, "from the strike point");
    assert.ok(Math.abs(Math.hypot(x1, y1) - 3) < 1e-9, "sevens roll a length of three");
  }
  const later = resolveEffects(r, set, 15).find((e) => e.kind === "lines");
  assert.equal(later.segs.length, 3, "a third of them pushed outward");
  assert.ok(Math.hypot(later.segs[0][0], later.segs[0][1]) > 2);
  assert.ok(!resolveEffects(r, set, 16).some((e) => e.kind === "lines"), "gone after two ticks");
});

test("effects: a sleeping slog breathes out a Z on the minute's ticks, which rises twenty units and bursts", () => {
  const r = fxCreature("Slog_Sleeping", "slogSleep", null, "AE");
  const set = fxSet(0);
  assert.deepEqual(resolveEffects(r, set, 19), []);
  const [z] = resolveEffects(r, set, 20);
  assert.equal(z.kind, "z");
  assert.ok(Math.abs(z.y - -13 - -0.35) < 1e-9, "placed thirteen up and already risen one step");
  assert.ok(Math.abs(z.x - 18) < 1e-9, "eighteen along; the table's first step read is a nought");
  assert.deepEqual(z.rgb, [14, 14, 4], "brightening toward dim yellow");
  assert.ok(Math.abs(z.scale - (0.4 + 0.015 * 0.35)) < 1e-9);
  const high = resolveEffects(r, set, 20 + 57)[0];
  assert.ok(high.y < -13 - 19.9 && !high.burst, `near the top: ${high.y}`);
  assert.ok(resolveEffects(r, set, 20 + 58)[0].burst, "bursting past twenty units");
  assert.equal(resolveEffects(r, set, 60).length, 2, "the Zs of ticks 20 and 40 both up");
  assert.ok(
    resolveEffects(r, set, 80).every((z) => z.y > -13 - 20),
    "the first has burst by the time the third is out",
  );
  // Oddysee places its Zs unscaled; a half-scale Exoddus slog scales them
  const ao = { ...fxCreature("Slog_Sleeping", "slogSleep"), scale: 0.5 };
  assert.ok(Math.abs(resolveEffects(ao, set, 20)[0].x - 18) < 1e-9);
  const half = { ...fxCreature("Slog_Sleeping", "slogSleep", null, "AE"), scale: 0.5 };
  assert.ok(Math.abs(resolveEffects(half, set, 20)[0].x - 9) < 1e-9);
});

test("effects: a Zzz spawner breathes out on its interval while its switch is off", () => {
  const r = fxCreature(null, "zzz", { switchId: 112, interval: 60, layer: 39, scale: 1 }, "AE");
  const set = fxSet(0);
  assert.equal(resolveEffects(r, set, 1).length, 1, "the first on the first tick");
  assert.equal(resolveEffects(r, set, 1)[0].layer, 39);
  assert.equal(
    resolveEffects(r, set, 61).length,
    0,
    "the first has burst before the second is due",
  );
  assert.equal(resolveEffects(r, set, 62).length, 1);
  const quiet = fxCreature(null, "zzz", { switchId: 1, interval: 60, layer: 39, scale: 1 }, "AE");
  assert.deepEqual(resolveEffects(quiet, set, 100), [], "the always-on switch silences it");
});

test("effects: twenty hint flies hover about their point, each on its own loop", () => {
  const r = fxCreature(null, "hintfly");
  const set = { anims: FX_ANIMS, dice: Array.from({ length: 256 }, (_, i) => (i * 97 + 13) & 255) };
  const flies = resolveEffects(r, set, 1);
  assert.equal(flies.length, 20);
  assert.ok(flies.every((f) => f.name === "HintFly" && f.frame === 0 && f.layer === 39));
  const later = resolveEffects(r, set, 200);
  assert.ok(
    later.some((f, i) => f.x !== flies[i].x),
    "they move",
  );
  for (const f of later)
    assert.ok(Math.abs(f.x) < 60 && Math.abs(f.y) < 40, `stays about the point: ${f.x},${f.y}`);
  // a constant angle step closes the loop: after 256/step ticks a fly is back near its start
  const a = resolveEffects(r, set, 1)[0],
    b = resolveEffects(r, set, 1 + 64)[0];
  assert.ok(Math.abs(a.x - b.x) < 6 && Math.abs(a.y - b.y) < 3, `${a.x},${a.y} vs ${b.x},${b.y}`);
});

test("effects: a hanging fleech swings two steps a tick from the angle its roll gave it", () => {
  const r = fxCreature("Fleech_SleepingWithTongue", "fleechHang", null, "AE");
  const set = fxSet(64);
  // angle 64 is a quarter turn: the cosine is zero there, so the swing starts at the middle
  assert.ok(Math.abs(resolveRecord(r, set, 1).x - 4 * Math.cos(((64 + 2) * Math.PI) / 128)) < 1e-9);
  assert.ok(Math.abs(resolveRecord(r, set, 32).x - -4) < 1e-9, "half a turn on: the far left");
  assert.ok(Math.abs(resolveRecord(r, set, 96).x - 4) < 1e-9);
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
