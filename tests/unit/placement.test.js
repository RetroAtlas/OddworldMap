import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  bodyBox,
  cameraAt,
  cameraOf,
  clipBox,
  endBox,
  frameRect,
  joinBoxes,
  pixelAt,
  ticksOf,
} from "../../public/js/painter/placement.js";
import { state } from "../../public/js/data/state.js";
import { poseAt, resolveRecord } from "../../public/js/engine/motion.js";
import { armFieldData } from "../../public/js/model/fields.js";
import { computeConnections, computeWiring, drawBox } from "../../public/js/model/model.js";
import { spriteDraws } from "../../public/js/rules/sprites.js";
import { AE_GEOMETRY, AO_GEOMETRY, pitches } from "./fixtures.js";

// a frame as the sidecar carries it: its sheet and corner there, its size, its offset
const frame = (w, h, xoff, yoff) => ["Sheet", 0, 0, w, h, xoff, yoff];
const FULL = { scale: 1 },
  HALF = { scale: 0.5 };
const [AO, AE] = [false, true];

test("cameraAt: the window of the cell a point falls in, in world and in draw space", () => {
  const [packed, spaced] = pitches(AO_GEOMETRY);
  const window = { wx: 1280, wy: 600 };
  assert.deepEqual(cameraAt(packed, 1400, 700), { ...window, dx: 368, dy: 240 });
  assert.deepEqual(cameraAt(spaced, 1400, 700), { ...window, dx: 1024, dy: 480 });
  // the slack either side of a window is its cell's own
  for (const [x, y] of [
    [1024, 480],
    [2047.9, 959.9],
  ])
    assert.deepEqual(cameraAt(packed, x, y), { ...window, dx: 368, dy: 240 });
});

test("cameraOf: the camera a record names, else the one its point falls in", () => {
  const [packed] = pitches(AO_GEOMETRY);
  const at = { x: 1400.9, y: 959.9 };
  assert.deepEqual(cameraOf({ camAt: null }, at, packed), cameraAt(packed, 1400, 959));
  assert.deepEqual(cameraOf({ camAt: { x: 300, y: 200 } }, at, packed), cameraAt(packed, 300, 200));
  // a point is cut to whole units before its camera is looked for
  const edge = { x: -0.5, y: -0.5 };
  assert.deepEqual(cameraOf({ camAt: null }, edge, packed), cameraAt(packed, 0, 0));
});

test("pixelAt: a world point cut to whole units, from its camera's corner", () => {
  const [packed] = pitches(AO_GEOMETRY);
  const cam = cameraAt(packed, 1400, 700);
  assert.deepEqual(pixelAt(cam, 1400.9, 700.2), [488, 340]);
  assert.deepEqual(pixelAt(cam, 1270, 590), [358, 230], "the slack before the window runs back");
});

test("frameRect: an offset is rounded toward the point and a size is kept", () => {
  assert.deepEqual(frameRect(frame(18, 39, 24, 1), FULL, false, AE), { x: 24, y: 1, w: 18, h: 39 });
  assert.deepEqual(frameRect(frame(21, 80, -10, -79), FULL, false, AE), {
    x: -9,
    y: -78,
    w: 21,
    h: 80,
  });
});

test("frameRect: a flip measures back from the point by the offset and the size together", () => {
  const f = frame(21, 80, -10, -79);
  assert.deepEqual(frameRect(f, FULL, true, AO), { x: -12, y: -78, w: 21, h: 80 });
  assert.deepEqual(frameRect(f, { ...FULL, flipY: true }, false, AO), {
    x: -9,
    y: -2,
    w: 21,
    h: 80,
  });
});

test("frameRect: at half scale the offset is a unit higher, and Exoddus's size a pixel larger", () => {
  const f = frame(21, 80, -10, -79);
  assert.deepEqual(frameRect(f, HALF, false, AO), { x: -4, y: -40, w: 10, h: 40 });
  assert.deepEqual(frameRect(f, HALF, false, AE), { x: -4, y: -40, w: 11, h: 41 });
  assert.deepEqual(frameRect(f, HALF, true, AO), { x: -6, y: -40, w: 10, h: 40 });
  assert.deepEqual(frameRect(f, HALF, true, AE), { x: -7, y: -40, w: 11, h: 41 });
  // any other scale takes the unit and not the pixel
  assert.deepEqual(frameRect(frame(10, 20, 10, -20), { scale: 1.5 }, false, AE), {
    x: 15,
    y: -30,
    w: 15,
    h: 30,
  });
});

test("frameRect: a copy truncates its offset and size, and a bare sprite reads no offset", () => {
  const f = frame(9, 7, -7, -9);
  const copy = { scale: 0.35, copy: true };
  assert.deepEqual(frameRect(f, copy, false, AE), { x: -2, y: -3, w: 3, h: 2 });
  assert.deepEqual(frameRect(f, copy, true, AE), { x: -1, y: -3, w: 3, h: 2 });
  assert.deepEqual(frameRect(f, { ...copy, flipY: true }, false, AE), { x: -2, y: 1, w: 3, h: 2 });
  assert.deepEqual(frameRect(f, { scale: 0.35, bare: true }, false, AE), {
    x: 0,
    y: 0,
    w: 9,
    h: 7,
  });
});

test("clipBox: the part inside the camera's window, and null where none is", () => {
  const cam = { dx: 368, dy: 240 };
  const clip = (x, y, w, h) => clipBox({ x, y, w, h }, cam, AO_GEOMETRY);
  assert.deepEqual(clip(400, 250, 30, 20), { x: 400, y: 250, w: 30, h: 20 });
  assert.deepEqual(clip(360, 230, 20, 30), { x: 368, y: 240, w: 12, h: 20 });
  assert.deepEqual(clip(720, 470, 40, 40), { x: 720, y: 470, w: 16, h: 10 });
  assert.equal(clip(340, 250, 28, 20), null, "a box that ends on the window's edge");
  assert.equal(clip(736, 250, 28, 20), null, "a box that starts on the far one");
  assert.equal(clip(400, 220, 30, 20), null);
  assert.equal(clip(400, 480, 30, 20), null);
});

test("joinBoxes: the box about two, whichever way round", () => {
  const a = { x: 10, y: 40, w: 20, h: 10 },
    b = { x: 25, y: 5, w: 14, h: 30 };
  assert.deepEqual(joinBoxes(a, b), { x: 10, y: 5, w: 29, h: 45 });
  assert.deepEqual(joinBoxes(b, a), { x: 10, y: 5, w: 29, h: 45 });
});

// a record standing in an animation of the given frames, and the pose it hands over
const record = (frames, o = {}) => ({ scale: 1, pose: { anim: { frames }, x: 100, y: 200 }, ...o });
const standing = (r, pose) => ({ ...r, pose: { ...r.pose, ...pose } });
const boxOf = (recs, layout = AE_GEOMETRY, ae = AE) => bodyBox(recs, (r) => r.pose, layout, ae);
const WIDE = frame(20, 40, 5, -40), // 5..25 by -39..1, of 800 texels
  SLIM = frame(10, 40, 20, -40), // 20..30 by -39..1, of 400
  BLANK = frame(1, 1, -60, -90);
const close = (b, want) => {
  for (const k in want) assert.ok(Math.abs(b[k] - want[k]) < 1e-9, `${k}: ${b[k]}`);
};

test("bodyBox: one frame's box is the one it is drawn in", () => {
  assert.deepEqual(boxOf([record([WIDE])]), { x: 105, y: 161, w: 20, h: 40 });
  const flipped = standing(record([WIDE]), { flip: true });
  assert.deepEqual(boxOf([flipped]), { x: 75, y: 161, w: 20, h: 40 });
  // a half-scale one's, in each game, and in the second screen down at the cell's own pitch
  const half = record([WIDE], { scale: 0.5 });
  assert.deepEqual(boxOf([half], AE_GEOMETRY, AE), { x: 102, y: 180, w: 11, h: 21 });
  assert.deepEqual(boxOf([half], AE_GEOMETRY, AO), { x: 102, y: 180, w: 10, h: 20 });
  const [packed, spaced] = pitches(AE_GEOMETRY);
  const below = standing(record([WIDE]), { x: 400.9, y: 400.9 });
  assert.deepEqual(boxOf([below], packed), { x: 398, y: 341, w: 20, h: 40 });
  assert.deepEqual(boxOf([below], spaced), { x: 405, y: 361, w: 20, h: 40 });
});

test("bodyBox: an animation's frames are averaged by their areas, a blank one all but left out", () => {
  // the wide frame weighs twice the slim one
  close(boxOf([record([WIDE, SLIM])]), { x: 110, y: 161, w: 50 / 3, h: 40 });
  const b = boxOf([record([WIDE, SLIM, BLANK])]);
  assert.ok(Math.abs(b.x + b.w / 2 - (110 + 25 / 3)) < 0.1, `${b.x + b.w / 2}`);
  assert.ok(Math.abs(b.y + b.h / 2 - 181) < 0.1, `${b.y + b.h / 2}`);
});

test("bodyBox: a frozen record is the frame it stands on, and one its brain tests those it lets show", () => {
  const frozen = record([WIDE, SLIM], { frozen: true, frame: 1 });
  assert.deepEqual(boxOf([frozen]), { x: 120, y: 161, w: 10, h: 40 });
  const tested = (seen) => boxOf([standing(record([WIDE, SLIM]), { seen })]);
  assert.deepEqual(
    tested((f) => f === SLIM),
    { x: 120, y: 161, w: 10, h: 40 },
  );
  assert.equal(
    tested(() => false),
    null,
  );
});

test("bodyBox: an object's parts are joined, but for a tiled one, one apart and one with no pose", () => {
  const body = record([WIDE]),
    part = standing(record([SLIM]), { y: 220 });
  const both = { x: 105, y: 161, w: 25, h: 60 };
  assert.deepEqual(boxOf([body, part]), both);
  assert.deepEqual(boxOf([part, body]), both);
  const far = standing(record([SLIM]), { x: 20 });
  for (const o of [{ tile: { top: 0, bottom: 200, step: 15 } }, { apart: true }, { pose: null }])
    assert.deepEqual(boxOf([body, { ...far, ...o }, part]), both, Object.keys(o)[0]);
  assert.equal(boxOf([{ ...far, apart: true }]), null);
  assert.equal(boxOf([]), null);
});

test("bodyBox: each part is clipped to its camera's screen, and a body none of which shows has no box", () => {
  // the screen is 240 high and the next cell starts at 260
  const low = standing(record([WIDE]), { y: 250 });
  const clipped = { x: 105, y: 211, w: 20, h: 29 };
  assert.deepEqual(boxOf([low]), clipped);
  // a frame 59 to 19 above a point ten down the next screen lies wholly above that screen
  const above = standing(record([frame(20, 40, 5, -60)]), { y: 270 });
  assert.equal(boxOf([above]), null);
  assert.deepEqual(boxOf([above, low]), clipped);
  // a creature on patrol keeps the box it would be drawn in
  assert.deepEqual(boxOf([standing(above, { moved: true })]), { x: 105, y: 191, w: 20, h: 40 });
  assert.deepEqual(boxOf([standing(low, { moved: true })]), clipped);
});

test("bodyBox: a record that names a camera is drawn and clipped there", () => {
  const named = standing(record([WIDE], { camAt: { x: 112, y: 12 } }), { y: 261 });
  assert.deepEqual(boxOf([named]), { x: 105, y: 222, w: 20, h: 18 });
});

test("ticksOf: the frame's own ticks, and the first frame's for the carried object", () => {
  const t = {},
    scene = { tick: 40, patrolAt: 7 };
  assert.deepEqual(ticksOf({ scene, held: null }, t), [40, 7]);
  assert.deepEqual(ticksOf({ scene, held: { to: {} } }, t), [40, 7]);
  assert.deepEqual(ticksOf({ scene, held: { to: t } }, t), [0, 0]);
});

// a motion detector whose laser sweeps right ten units a tick, in a frame that draws it as that
const DETECTOR = { name: "MotionDetector", x1: 100, y1: 180, x2: 300, y2: 204, fields: {} };
const LASER = {
  anim: "Laser",
  x: 100,
  y: 200,
  scale: 1,
  flip: false,
  frame: 0,
  cycle: { kind: "laser", x1: 100, x2: 300, speed: 10, left: false },
};
const ANIMS = { Laser: { frames: [WIDE], fps: 1, loop: true, loop_start: 0 } };
function frameWith(recs, o = {}) {
  state.data = { id: "AE" };
  state.show = { objects: true, markers: true };
  state.edit = false;
  const sprites = new Map([[DETECTOR, recs]]);
  return {
    data: state.data,
    layout: AE_GEOMETRY,
    held: null,
    art: { failed: false, drawn: true, lost: () => false },
    scene: { sprites, set: { anims: ANIMS }, tick: 3, patrolAt: 3 },
    ...o,
  };
}

test("endBox: the box about the sprite an object is drawn as, at the ticks it is drawn at", () => {
  assert.deepEqual(endBox(frameWith([LASER]), DETECTOR), { x: 135, y: 161, w: 20, h: 40 });
  const carried = frameWith([LASER], { held: { to: DETECTOR } });
  assert.deepEqual(endBox(carried, DETECTOR), { x: 105, y: 161, w: 20, h: 40 });
  const half = frameWith([{ ...LASER, scale: 0.5 }]);
  assert.deepEqual(endBox(half, DETECTOR), { x: 132, y: 180, w: 11, h: 21 });
  const oddysee = { ...half, data: { id: "AO" } };
  assert.deepEqual(endBox(oddysee, DETECTOR), { x: 132, y: 180, w: 10, h: 20 });
});

test("endBox: the marker's box where the sprite is not what is drawn, or none of it shows", () => {
  const marker = drawBox(DETECTOR, AE_GEOMETRY);
  const lost = { failed: false, drawn: true, lost: () => true };
  for (const [why, f] of Object.entries({
    "no sprites are drawn": frameWith([LASER], { scene: null }),
    "its sheet is lost": frameWith([LASER], { art: lost }),
    "its own state draws nothing": frameWith([]),
    "it is an effect alone": frameWith([{ ...LASER, anim: null, cycle: null }]),
    "none of it is on its screen": frameWith([{ ...LASER, x: 370, cycle: null }]),
  }))
    assert.deepEqual(endBox(f, DETECTOR), marker, why);
});

const pub = (f) => JSON.parse(readFileSync(new URL(`../../public/${f}`, import.meta.url), "utf8"));

// every object a shipped path's wires and arrows end at and records are drawn for, with them
const read = {};
function ends(g) {
  if (read[g]) return read[g];
  const lg = g.toLowerCase();
  armFieldData(g, pub(`field_types_${lg}.json`), pub(`enum_labels_${lg}.json`));
  const data = pub(`map_data_${lg}.json`),
    set = pub(`sprites_${lg}.json`);
  const found = [];
  for (const lvl of data.levels)
    for (const path of lvl.paths) {
      const edges = [...computeWiring(path, g).edges, ...computeConnections(data, lvl, path)];
      for (const t of new Set(edges.flatMap((e) => [e.src, e.dst ?? e.src]))) {
        const recs = spriteDraws(data, lvl, path, t, set).filter((r) => r.anim);
        const id = `${lvl.short} P${path.id} ${t.name} ${t.x1},${t.y1}`;
        if (recs.length) found.push({ id, type: t.name, recs });
      }
    }
  const body = (recs, tick) =>
    bodyBox(recs, (r) => poseAt(r, set, tick), data.geometry, g === "AE");
  return (read[g] = { geo: data.geometry, set, found, body });
}

// an object whose parts circle the point its end is at
const RING = new Set(["BirdPortal"]);

test("bodyBox: the middle of a shipped wire's or arrow's end lies in the frame one of its parts shows, or amid a ring's, and stands still while the sprite does", () => {
  const counts = {};
  for (const g of ["AO", "AE"]) {
    const { geo, set, found, body } = ends(g);
    const ae = g === "AE";
    // the boxes the frames on show are painted in, a blank one apart
    const painted = (recs, tick) => {
      const boxes = [];
      for (const r of recs) {
        const shown = r.tile || r.apart ? null : resolveRecord(r, set, tick);
        if (!shown) continue;
        const rect = frameRect(shown.anim.frames[shown.frame], r, shown.flip, ae);
        const cam = cameraOf(r, shown, geo);
        const [px, py] = pixelAt(cam, shown.x, shown.y);
        const b = clipBox({ ...rect, x: px + rect.x, y: py + rect.y }, cam, geo);
        if (b && rect.w * rect.h > 1) boxes.push(b);
      }
      return boxes;
    };
    counts[g] = { boxed: 0, not: 0 };
    for (const { id, type, recs } of found) {
      const poses = (tick) =>
        recs.map((r) => {
          const p = poseAt(r, set, tick);
          return p && `${p.name} ${Math.trunc(p.x)},${Math.trunc(p.y)} ${p.flip}`;
        });
      counts[g][body(recs, 0) ? "boxed" : "not"]++;
      let before = null;
      for (let tick = 0; tick <= 120; tick++) {
        const now = { body: body(recs, tick), poses: poses(tick).join() };
        if (before?.poses === now.poses)
          assert.deepEqual(now.body, before.body, `${id} at ${tick}`);
        before = now;
        const parts = painted(recs, tick);
        if (!parts.length) continue;
        const boxes = RING.has(type) ? [parts.reduce(joinBoxes)] : parts;
        // to within a unit: what a screen's edge leaves of a frame may be a sliver
        const x = now.body.x + now.body.w / 2,
          y = now.body.y + now.body.h / 2;
        assert.ok(
          boxes.some((p) => x > p.x - 1 && x < p.x + p.w + 1 && y > p.y - 1 && y < p.y + p.h + 1),
          `${id} at ${tick}: ${x},${y} off ${JSON.stringify(boxes)}`,
        );
      }
    }
  }
  // the rest are clipped away whole, or let none of their frames show
  assert.deepEqual(counts, { AO: { boxed: 395, not: 19 }, AE: { boxed: 1621, not: 99 } });
});

// the one record of an object whose parts lie apart that its body is
const ITSELF = {
  MotionDetector: (r) => r.anim === "MotionDetector_Laser",
  PullRingRope: (r) => !r.tile,
  MeatSaw: (r) => r.anim === "MeatSaw_Idle",
};

test("bodyBox: a shipped motion detector is its laser, wherever it has swept, a pull ring its ring and a meat saw its blade", () => {
  const counts = {};
  for (const g of ["AO", "AE"])
    for (const { id, type, recs } of ends(g).found) {
      if (!ITSELF[type]) continue;
      const { body } = ends(g);
      counts[type] = (counts[type] ?? 0) + 1;
      for (const tick of [0, 20, 60])
        assert.deepEqual(body(recs, tick), body(recs.filter(ITSELF[type]), tick), id);
    }
  assert.deepEqual(counts, { MotionDetector: 13, PullRingRope: 53, MeatSaw: 11 });
});
