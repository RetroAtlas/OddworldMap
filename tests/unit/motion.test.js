import { test } from "node:test";
import assert from "node:assert/strict";
import {
  advance,
  frameAt,
  motionTick,
  resolveRecord,
  setMotionRunning,
} from "../../public/js/motion.js";
import { raycastDown, snapX } from "../../public/js/sprites.js";

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

test("sway: a hanging fleech swings two steps a tick from the angle its roll gave it", () => {
  const r = {
    anim: "Fleech_SleepingWithTongue",
    x: 500,
    y: 0,
    flip: false,
    frame: 0,
    cycle: { kind: "sway", cx: 500, seed: 3 },
  };
  const set = {
    anims: { Fleech_SleepingWithTongue: anim(9, 4, true) },
    dice: new Array(256).fill(64),
  };
  // angle 64 is a quarter turn: the cosine is zero there and the swing crosses the middle
  assert.ok(Math.abs(resolveRecord(r, set, 0).x - 500) < 1e-9);
  assert.ok(Math.abs(resolveRecord(r, set, 32).x - 496) < 1e-9, "half a turn on: the far left");
  assert.ok(Math.abs(resolveRecord(r, set, 64).x - 500) < 1e-9);
  assert.ok(Math.abs(resolveRecord(r, set, 96).x - 504) < 1e-9);
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
