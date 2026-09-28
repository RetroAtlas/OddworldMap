import { test } from "node:test";
import assert from "node:assert/strict";
import { drawX, drawY, worldX, worldY } from "../../public/js/geometry.js";
import { AO_GEOMETRY, AE_GEOMETRY, SYNTH_GEOMETRY, pitches } from "./fixtures.js";

test("drawX and drawY answer for the layout they are handed, packed or spaced", () => {
  const [packed, spaced] = pitches(AO_GEOMETRY);
  // packed, a window lands on its own screen, the slack before it folded away
  assert.equal(drawX(256, packed), 0);
  assert.equal(drawX(2 * 1024 + 256 + 100, packed), 2 * 368 + 100);
  assert.equal(drawY(3 * 480 + 120 + 50, packed), 3 * 240 + 50);
  // spaced, the slack keeps its size and the transform is the window offset alone
  assert.equal(drawX(2 * 1024 + 256 + 100, spaced), 2 * 1024 + 100);
  assert.equal(drawY(3 * 480 + 120 + 50, spaced), 3 * 480 + 50);
  // AE's 7 units of slack fold onto the next screen's corner
  assert.equal(drawX(375, pitches(AE_GEOMETRY)[0]), 368);
});

test("worldX and worldY undo the transform inside a window, at either pitch", () => {
  for (const g of [AO_GEOMETRY, AE_GEOMETRY, SYNTH_GEOMETRY])
    for (const layout of pitches(g))
      for (const cell of [0, 1, 5]) {
        const wx = cell * g.worldW + g.winX + 90,
          wy = cell * g.worldH + g.winY + 60;
        assert.equal(worldX(drawX(wx, layout), layout), wx);
        assert.equal(worldY(drawY(wy, layout), layout), wy);
      }
});
