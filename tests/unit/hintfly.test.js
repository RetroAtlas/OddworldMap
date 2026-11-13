import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolveEffects } from "../../public/js/engine/motion.js";
import { creature } from "./creatures.js";

// the game's own dice and the flies' own animation, with the flies' cursor
// where the overlays start it, so a run is the PlayStation's own
const sprites = JSON.parse(
  readFileSync(new URL("../../public/sprites_ao.json", import.meta.url), "utf8"),
);
const set = { anims: { HintFly: sprites.anims.HintFly }, dice: sprites.dice };
const AT = [180, 120];
// a hint at a point of the screen whose corner is given
const hint = (at = AT, screen = [0, 0]) => ({
  ...creature(null, "hintfly", { screen }, 37),
  x: at[0],
  y: at[1],
});
// each sprite's corner about the hint's point, in fly order
const corners = (r, tick) =>
  resolveEffects(r, set, tick)
    .map((f) => `${f.x - r.x},${f.y - r.y}`)
    .join(" ");

test("hintfly: twenty flies loop about the hint's point where the PlayStation puts them", () => {
  const r = hint();
  assert.equal(
    corners(r, 1),
    "1,5 -20,13 -12,-10 -11,8 7,-6 9,12 10,-5 19,13 0,2 -18,15 -4,6 -15,-3 17,10 -2,8 11,5 -2,8 -1,-4 -8,-14 4,12 -14,-10",
  );
  assert.equal(
    corners(r, 64),
    "0,-2 0,5 -16,-10 -25,2 18,-12 -19,8 -19,-5 15,13 2,4 -23,7 18,3 -11,-4 -7,4 -31,9 15,4 27,9 -10,2 -9,-12 9,23 -31,-12",
  );
  assert.equal(
    corners(r, 300),
    "1,-2 -8,4 -11,-9 -23,2 18,-11 -13,6 -16,-2 21,13 -1,1 -37,7 14,-3 -16,-3 0,2 -28,6 10,6 22,12 -11,2 -7,-15 1,22 -30,-12",
  );
});

test("hintfly: a fly past its screen's left or top edge is cut toward the screen's corner", () => {
  // the hint six across and four down from the corner of a screen far into its path
  const r = hint([5126, 964], [5120, 960]);
  assert.equal(
    corners(r, 1),
    "1,5 -19,13 -11,-9 -11,8 7,-5 9,12 10,-4 19,13 0,2 -17,15 -4,6 -14,-3 17,10 -2,8 11,5 -2,8 -1,-4 -7,-13 4,12 -13,-9",
  );
  assert.equal(
    corners(r, 64),
    "0,-2 0,5 -16,-10 -24,2 18,-11 -18,8 -18,-4 15,13 2,4 -22,7 18,3 -11,-4 -6,4 -30,9 15,4 27,9 -9,2 -9,-12 9,23 -30,-11",
  );
  assert.equal(
    corners(r, 300),
    "1,-2 -7,4 -10,-8 -22,2 18,-10 -12,6 -15,-2 21,13 -1,1 -36,7 14,-3 -15,-3 0,2 -27,6 10,6 22,12 -10,2 -6,-14 1,22 -29,-11",
  );
});

test("hintfly: every fly is a bare sprite on the frame its hint's animation stands on", () => {
  const r = hint();
  const frames = { 1: 0, 2: 0, 3: 1, 12: 5, 14: 6, 24: 11, 25: 0 };
  for (const [tick, frame] of Object.entries(frames)) {
    const flies = resolveEffects(r, set, +tick);
    assert.equal(flies.length, 20);
    for (const f of flies)
      assert.deepEqual(
        [f.name, f.frame, f.bare, f.layer, f.blend, f.scale, f.rgb, f.cam],
        ["HintFly", frame, true, 39, 1, 1, [128, 128, 128], null],
        `tick ${tick}`,
      );
  }
});
