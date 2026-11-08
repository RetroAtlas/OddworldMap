import { test } from "node:test";
import assert from "node:assert/strict";
import { brainAt, resolveEffects, resolveRecord } from "../../public/js/motion.js";
import { burstParts } from "../../public/js/effects.js";
import { fpDiv, fpMul } from "../../public/js/patrolkit.js";
import { anim } from "./creatures.js";

// ---- falling items ---------------------------------------------------------

const FP = 65536;
// a frame of the given bounding rect
const bounded = (n, fps, loop, rect) => ({
  ...anim(n, fps, loop),
  frames: Array.from({ length: n }, (_, i) => [0, i, 0, 1, 1, 0, 0, ...rect]),
});
const ITEM_ANIMS = {
  Item_Falling: bounded(4, 4, true, [-10, -30, 10, -5]),
  Item_Waiting: bounded(4, 1, true, [-10, -30, 10, -5]),
  Stopper: bounded(1, 1, true, [-20, -10, 20, 0]),
  Explosion_Rock: anim(8, 2, true),
  Explosion_Stick: anim(8, 2, true),
  Meat_Gib: anim(8, 1, true),
  AirExplosion: anim(16, 1, false),
};
const itemSet = (dice) => ({
  anims: ITEM_ANIMS,
  dice: Array.isArray(dice) ? dice : new Array(256).fill(dice ?? 128),
});
// an item 100 along the top of a screen, a floor at 200 under it and a
// background floor at 230
const fallingItem = (p = {}, scale = 1, game = "AE") => {
  const q = {
    switchId: 1,
    interval: 10,
    max: 0,
    reset: true,
    art: "Item_Falling",
    waiting: "Item_Waiting",
    x: 100,
    y: 0,
    lines: [
      [0, 200, 400, 200, 0],
      [0, 230, 400, 230, 4],
    ],
    floor: scale === 1 ? [0] : [4],
    win: [0, 0, 368, 240],
    cam: { x: 112, y: 12 },
    stays: true,
    debris: [],
    blast: false,
    stoppers: [],
    ...p,
  };
  return {
    anim: "Item_Falling",
    x: q.x,
    y: q.y,
    scale,
    layer: 31,
    flip: false,
    frame: 0,
    cycle: { kind: "brain", brain: "fallingItem", game, seed: 0, emo: false, p: q },
  };
};
// how far an item has fallen after n moving ticks: the gain added while the
// speed is under 20, which the twelfth takes past it
const GAIN = 117964 / FP;
const fallen = (n, gain = GAIN, adds = 12) =>
  (gain * Math.min(n, adds) * (Math.min(n, adds) + 1)) / 2 + gain * adds * Math.max(0, n - adds);

test("fixed point: the engine's multiply truncates the magnitude and its divide goes a byte at a time", () => {
  assert.equal(fpMul(FP / 2, 117964), 58982, "1.8 at half scale");
  assert.equal(fpMul(-22 * FP, 26214), -576708, "toward zero, the sign put back after");
  assert.equal(fpDiv(100 * FP, 300 * FP), 21845, "a third, its last bits dropped past 2^24");
  assert.equal(fpDiv(100 * FP, 15 * FP), 436906, "the largest a depth gives");
  assert.equal(fpDiv(-FP, 4 * FP), -FP / 4);
});

test("falling item: once its switch reads on it rumbles its interval, then falls 1.8 a tick faster, holding the 21.6 the cap lets it reach", () => {
  const r = fallingItem();
  const set = itemSet();
  assert.deepEqual(
    [resolveRecord(r, set, 0).name, resolveRecord(r, set, 0).frame, resolveRecord(r, set, 0).y],
    ["Item_Waiting", 0, 0],
    "an export draws the rumble's first frame where the item waits",
  );
  // the switch is read on at tick 1 and the interval runs from there
  for (let t = 1; t <= 11; t++) assert.equal(resolveRecord(r, set, t).y, 0, `waits at ${t}`);
  assert.deepEqual(
    [1, 2, 3, 4, 5].map((t) => resolveRecord(r, set, t).frame),
    [0, 1, 2, 3, 0],
    "the rumble at a frame a tick",
  );
  for (let n = 1; n <= 14; n++)
    assert.equal(resolveRecord(r, set, 11 + n).y, fallen(n), `${n} ticks into the fall`);
  assert.equal(
    resolveRecord(r, set, 25).y - resolveRecord(r, set, 24).y,
    12 * GAIN,
    "the cap is asked before the gain is added",
  );
  assert.equal(resolveRecord(r, set, 25).name, "Item_Waiting", "it falls in its rumbling art");
});

test("falling item: it smashes on the floor of its own plane, stands where it waited in its first art the tick after, and rumbles again", () => {
  const set = itemSet();
  const r = fallingItem();
  // fourteen moves fall 183.6, the fifteenth meets the floor
  assert.equal(resolveRecord(r, set, 25).y, fallen(14));
  assert.equal(resolveRecord(r, set, 26).y, 200, "on the floor line, not past it");
  assert.deepEqual(
    [resolveRecord(r, set, 27).name, resolveRecord(r, set, 27).y],
    ["Item_Falling", 0],
  );
  assert.equal(resolveRecord(r, set, 28).name, "Item_Waiting");
  assert.equal(resolveRecord(r, set, 38).y, 0, "the interval again, read from tick 28");
  assert.equal(resolveRecord(r, set, 39).y, GAIN);
  // a half-scale item gains 0.9 a tick, and falls past the floor in front of
  // it to its own plane's on the move that takes its speed past 20
  const half = fallingItem({}, 0.5);
  const halfGain = 58982 / FP;
  for (let n = 1; n <= 22; n++)
    assert.equal(resolveRecord(half, set, 11 + n).y, fallen(n, halfGain, 23), `${n} half`);
  assert.equal(resolveRecord(half, set, 34).y, 230);
});

test("falling item: on a switch a fresh game holds off it waits in its first art, and a switch written on drops it, which it sets back off", () => {
  const set = itemSet();
  const r = fallingItem({ switchId: 7 });
  assert.deepEqual(
    [resolveRecord(r, set, 400).name, resolveRecord(r, set, 400).y],
    ["Item_Falling", 0],
  );
  brainAt(r, set, 400).state.sw[7] = 1;
  assert.equal(resolveRecord(r, set, 401).name, "Item_Waiting", "read through switchGet");
  assert.equal(resolveRecord(r, set, 426).y, 200);
  assert.deepEqual(
    [resolveRecord(r, set, 600).name, resolveRecord(r, set, 600).y],
    ["Item_Falling", 0],
    "its reset sets the switch back off",
  );
  const kept = fallingItem({ switchId: 7, reset: false });
  brainAt(kept, set, 400).state.sw[7] = 1;
  assert.equal(resolveRecord(kept, set, 426).y, 200);
  assert.equal(resolveRecord(kept, set, 453).y, 200, "and without it falls again");
});

test("falling item: it retires after the fall that spends its count, or where its rect's foot lies off its screen", () => {
  const set = itemSet();
  const once = fallingItem({ max: 1 });
  assert.equal(resolveRecord(once, set, 26).y, 200);
  assert.equal(resolveRecord(once, set, 27), null);
  assert.equal(resolveRecord(once, set, 600), null);
  const off = fallingItem({ stays: false });
  assert.equal(resolveRecord(off, set, 27), null);
  // any count but none is one, a negative one spent at the first fall
  assert.equal(resolveRecord(fallingItem({ max: -1 }), set, 27), null);
  assert.equal(resolveRecord(fallingItem({ max: -1 }, 1, "AO"), set, 27), null);
});

const ROCKS = { anim: "Explosion_Rock", type: "rocks", count: 25 };
const STICKS = { anim: "Explosion_Stick", type: "sticks", count: 25 };
const MEAT = { anim: "Meat_Gib", type: "meat", count: 25 };

test("debris: an Exoddus smash throws every piece asked for, each at speeds the dice roll, drawn opaque on the item's screen", () => {
  const r = fallingItem({ debris: [ROCKS] });
  const set = itemSet(192); // every roll 64 over the middle, 8 a tick
  assert.deepEqual(resolveEffects(r, set, 25), []);
  const fx = resolveEffects(r, set, 26);
  assert.equal(fx.length, 25);
  // a piece moves in the tick that throws it: 8 along, 8 up and 8 toward the eye
  for (const e of fx)
    assert.deepEqual([e.x, e.y, e.scale], [108, 192, fpDiv(100 * FP, 292 * FP) / FP]);
  assert.deepEqual(
    fx.map((e) => e.copy),
    [false, ...new Array(24).fill(true)],
    "the first drawn by the burst's animation, the rest as its copies",
  );
  const [e] = fx;
  assert.deepEqual(
    [e.name, e.frame, e.layer, e.blend, e.semi, e.rgb, e.cam],
    ["Explosion_Rock", 0, 39, 0, false, [128, 128, 128], { x: 112, y: 12 }],
  );
  // falling a quarter faster each tick: 8 up, then 7.75
  assert.equal(resolveEffects(r, set, 27)[0].y, 184.25);
  assert.equal(resolveEffects(r, set, 28)[0].frame, 1);
  // a half-scale burst flings at half the speed, draws at half its depth's scale, on layer 20
  const half = resolveEffects(fallingItem({ debris: [ROCKS] }, 0.5), set, 34);
  assert.deepEqual(
    [half[0].x, half[0].y, half[0].scale, half[0].layer],
    [104, 226, fpMul(fpDiv(100 * FP, 296 * FP), FP / 2) / FP, 20],
  );
});

test("debris: the dice set each piece's speeds in turn, the depth's sign from one roll and its size from the next", () => {
  const dice = Array.from({ length: 256 }, (_, i) => (i * 37 + 11) & 255);
  const r = fallingItem({ debris: [ROCKS] });
  const st = brainAt(r, itemSet(dice), 26).state;
  const [burst] = st.fx;
  let away = 0;
  burst.parts.forEach((q, i) => {
    const roll = (k) => fpMul((dice[(4 * i + k) & 255] - 128) * 8192, FP);
    const vz = roll(2) >= 0 ? -roll(3) : roll(3);
    assert.deepEqual([q.vx, q.vy - FP / 4, q.vz], [roll(0), 0 - roll(1), vz], `piece ${i}`);
    if (vz > 0) away++;
  });
  assert.equal(st.seed, 100, "four rolls a piece");
  assert.ok(away > 0, "a piece the second roll sends away from the eye");
});

test("debris: a piece turned back short of the eye rolls for its sound, and the burst is gone after its 91 ticks", () => {
  // eight toward the eye a tick turns back on the thirty-sixth move
  const r = fallingItem({ debris: [ROCKS], max: 1 });
  const set = itemSet(192);
  assert.equal(brainAt(r, set, 26 + 34).state.seed, 100);
  assert.equal(brainAt(r, set, 26 + 35).state.seed, 100 + 25 * 3, "three rolls a piece");
  const burstAt = (t) => brainAt(r, set, t).state.fx.some((p) => p.kind === "burst");
  assert.ok(burstAt(26 + 91), "it outlives the item that threw it");
  assert.ok(!burstAt(26 + 92));
});

test("debris: Oddysee flings its meat and sticks upward, every piece asked for, the sticks at 0.4 of the speed", () => {
  const r = fallingItem({ debris: [MEAT, STICKS] }, 1, "AO");
  const fx = resolveEffects(r, itemSet(192), 26);
  assert.equal(fx.length, 50);
  assert.deepEqual([fx[0].name, fx[0].x, fx[0].y], ["Meat_Gib", 108, 192]);
  const slow = fpMul(64 * 8192, 26214) / FP;
  assert.deepEqual([fx[25].name, fx[25].x, fx[25].y], ["Explosion_Stick", 100 + slow, 200 - slow]);
  assert.deepEqual(
    [fx[0].copy, fx[1].copy, fx[25].copy, fx[26].copy],
    [false, true, false, true],
    "each burst draws its first piece by its own animation",
  );
});

test("debris: Oddysee carries a piece over the void between screens", () => {
  // a piece flung right from 600 is on its screen, margin and all, until it passes 640
  const r = fallingItem(
    { x: 600, debris: [ROCKS], win: [256, 0, 624, 240], lines: [[0, 200, 800, 200, 0]] },
    1,
    "AO",
  );
  const set = itemSet(192);
  const xs = [26, 27, 28, 29, 30, 31].map((t) => brainAt(r, set, t).state.fx[0].parts[0].x / FP);
  assert.deepEqual(xs, [608, 616, 624, 632, 640, 1264]);
});

test("debris render: a piece off its screen is not drawn, and one near the eye is drawn however large", () => {
  const burst = (ae, z, scale = FP) => ({
    ae,
    scale,
    win: [0, 0, 368, 240],
    parts: [
      { x: 10 * FP, y: 10 * FP, z },
      { x: 400 * FP, y: 10 * FP, z: 0 },
      { x: 20 * FP, y: 20 * FP, z: 0 },
    ],
  });
  const near = -290 * FP;
  for (const ae of [true, false])
    assert.deepEqual(
      burstParts(burst(ae, near)).map((q) => [q.x, q.scale, q.copy]),
      [
        [10, 10, false],
        [20, fpDiv(100 * FP, 300 * FP) / FP, true],
      ],
      ae ? "Exoddus" : "Oddysee",
    );
  assert.equal(burstParts(burst(true, 0, FP / 2))[0].scale, fpMul(21845, FP / 2) / FP);
});

test("the Bonewerkz blast: AirExplosion three quarters the item's scale, fifteen up, additive on layer 27, on the item's screen", () => {
  const set = itemSet(192);
  const at = (scale) =>
    resolveEffects(fallingItem({ blast: true }, scale), set, scale === 1 ? 26 : 34).find(
      (e) => e.name === "AirExplosion",
    );
  const full = at(1);
  assert.deepEqual(
    [full.x, full.y, full.scale, full.layer, full.blend, full.cam],
    [100, 185, 0.75, 27, 1, { x: 112, y: 12 }],
  );
  const half = at(0.5);
  assert.deepEqual([half.y, half.scale], [230 - 7.5, 0.375]);
});

test("falling item: an Exoddus item stops where its rect first meets a drill's or a mine car's and smashes there", () => {
  const set = itemSet(192);
  // a stopper's rect spans 140..150 under the item, edges meeting counting
  const stopper = (x) => ({
    anim: "Stopper",
    x,
    y: 150,
    scale: 1,
    flip: false,
    frame: 0,
    cycle: null,
  });
  const r = fallingItem({
    debris: [ROCKS],
    stoppers: [{ rec: stopper(100), first: false }],
  });
  // the item's foot is 5 above its anchor: after 12 moves it stands at 140.4,
  // its rect reaching 135.4, short of the stopper's top; the 13th move takes it
  // to 162, whose rect meets it in the next tick's check before it moves
  assert.equal(resolveRecord(r, set, 23).y, fallen(12));
  assert.equal(resolveRecord(r, set, 24).y, fallen(13));
  assert.equal(resolveRecord(r, set, 25).y, fallen(13), "stopped where it stands, not moved");
  assert.equal(resolveEffects(r, set, 25)[0].y, fallen(13) - 8, "the debris thrown from there");
  assert.equal(resolveRecord(r, set, 26).y, 0, "and it starts over");
  // one beside its column is passed by
  const past = fallingItem({ stoppers: [{ rec: stopper(131), first: false }] });
  assert.equal(resolveRecord(past, set, 26).y, 200);
});
