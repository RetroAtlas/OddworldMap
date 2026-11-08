import { test } from "node:test";
import assert from "node:assert/strict";
import { resolveRecord } from "../../public/js/motion.js";
import {
  PATROL_ANIMS,
  ROAMER_ANIMS,
  anim,
  creature,
  segments,
  tlv,
  walker,
  world,
} from "./creatures.js";

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

test("patrol: an Oddysee slig placed in the void walks it uncarried, between its own bounds", () => {
  // a floor from beside the first screen far into the void, the zone across the screen's edge
  const floor = [[127, 317, 894, 317, 4]];
  const w = world("AO", floor, [], { x: 661, y: 294 }, true);
  const p = {
    pauseTime: 10,
    leftMin: 30,
    leftMax: 60,
    rightMin: 30,
    rightMax: 60,
    zone: { x: 565, w: 673 },
  };
  const r = walker("Slig_Idle", "slig", p, w, 661, 317, true);
  const set = { anims: PATROL_ANIMS, dice: new Array(256).fill(0) };
  const xs = trail(r, set, 1, 1800).map((s) => +s.split("@")[1].slice(0, -1));
  const [lo, hi] = [Math.min(...xs), Math.max(...xs)];
  assert.ok(lo >= 565 && hi <= 673, `paces between its bounds: ${lo}..${hi}`);
  // the screen counts to 636 with the skippers' margin
  const out = xs.findIndex((x, i) => i > 0 && xs[i - 1] <= 636 && x > 636);
  assert.ok(lo < 636 && out > 0, "walks onto its screen and back out into the void");
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
