import { test } from "node:test";
import assert from "node:assert/strict";
import { resolveRecord } from "../../public/js/motion.js";
import { IDLE_ANIMS, WORK_ANIMS, creature, segments, worker } from "./creatures.js";

// dice that always roll zero: the shortest timer of every range, and a sad or
// angry worker stands up at every break
const ZERO_DICE = { anims: WORK_ANIMS, dice: new Array(256).fill(0) };

const shownAt = (r, set, tick) => {
  const s = resolveRecord(r, set, tick);
  return `${s.name.replace(/^[A-Za-z]+_/, "")}:${s.frame}${s.flip ? "<" : ""}`;
};

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

test("work: a sad worker stands at a break, sighs in its mood's palette and goes back to work", () => {
  // the chiseller rises at once and holds the rest of its ten ticks standing;
  // back in its crouch it takes its next break at once, where zeros stand it again
  assert.deepEqual(segments(worker("chisel", "sad"), ZERO_DICE, 36, 76), [
    "Chisel 36-36",
    "StopChisel 37-37",
    "CrouchIdle 38-38",
    "CrouchToStand 39-44",
    "Idle 45-49",
    "SpeakFart@SadMud 50-62",
    "Idle 63-63",
    "StandToCrouch 64-74",
    "CrouchIdle 75-75",
    "CrouchToStand 76-76",
  ]);
  // the scrubber holds its ten ticks crouched before it rises, and returns to its break
  assert.deepEqual(segments(worker("scrub", "sad"), ZERO_DICE, 22, 82), [
    "CrouchIdle 22-49",
    "CrouchToStand 50-55",
    "Idle 56-56",
    "SpeakFart@SadMud 57-69",
    "Idle 70-70",
    "StandToCrouch 71-81",
    "CrouchIdle 82-82",
  ]);
  // the mood's palette speaks under the engine's flat grey, the worker's own tint either side
  const rgbAt = (t) => resolveRecord(worker("scrub", "sad"), ZERO_DICE, t).rgb;
  assert.deepEqual(
    [rgbAt(56), rgbAt(57), rgbAt(69), rgbAt(70)],
    [
      [87, 103, 67],
      [63, 63, 63],
      [63, 63, 63],
      [87, 103, 67],
    ],
  );
});

test("work: an angry worker stands at a break, has its say and goes back to its job", () => {
  assert.deepEqual(segments(worker("scrub", "angry"), ZERO_DICE, 50, 97), [
    "CrouchToStand 50-55",
    "Idle 56-58",
    "Speak3@AngryMud 59-71",
    "Idle 72-72",
    "StandToCrouch 73-83",
    "CrouchIdle 84-85",
    "CrouchScrub 86-95",
    "CrouchIdle 96-96",
    "CrouchScrub 97-97",
  ]);
  // a chiseller goes back down into its chiselling
  assert.deepEqual(segments(worker("chisel", "angry"), ZERO_DICE, 64, 80), [
    "Speak3@AngryMud 64-64",
    "Idle 65-65",
    "StandToCrouch 66-76",
    "CrouchIdle 77-77",
    "StartChisel 78-78",
    "Chisel 79-80",
  ]);
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

const dice = (v) => ({ anims: IDLE_ANIMS, dice: new Array(256).fill(v) });

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
