import { test } from "node:test";
import assert from "node:assert/strict";
import { resolveEffects, resolveRecord } from "../../public/js/engine/motion.js";
import { ROAMER_ANIMS, anim, creature, worker } from "./creatures.js";

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
