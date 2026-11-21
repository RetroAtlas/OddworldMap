import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { spriteDraws } from "../../public/js/rules/sprites.js";
import { armFieldData } from "../../public/js/model/fields.js";
import { brainAt, resolveEffects } from "../../public/js/engine/motion.js";
import { AE_GEOMETRY, AO_GEOMETRY } from "./fixtures.js";

// ---- a well's leaves ---------------------------------------------------------

const FP = 65536;
// the leaf's six frames, four ticks each, their bounding rect up and left of its point
const LEAF = {
  fps: 4,
  loop: true,
  loop_start: 0,
  frames: Array.from({ length: 6 }, (_, i) => [0, i, 0, 6, 8, -9, -17, -9, -17, -4, -11]),
};
// dice that neither let a leaf go nor jitter one, but for the bytes named
const dice = (bytes = {}) => Object.assign(new Array(256).fill(127), bytes);
const leafSet = (d = dice({ 0: 0 })) => ({ anims: { Well_Leaf: LEAF }, dice: d });
const WIN = [1000, 500, 1368, 740];
const [LEFT, TOP, RIGHT, BOTTOM] = WIN;
// a camera's wells as the rule hands them over, one record a well, on a seed
function camera(wells, p = {}, seed = 0) {
  const all = wells.map((w) => ({ x: 1100, y: 600, speed: [0, 0], scale: 1, layer: 27, ...w }));
  return all.map((w, own) => ({
    anim: null,
    x: w.x,
    y: w.y,
    scale: 1,
    layer: 27,
    flip: false,
    frame: 0,
    cycle: {
      kind: "brain",
      brain: "well",
      game: "AE",
      seed,
      emo: false,
      p: {
        wells: all,
        own,
        floors: [],
        win: WIN,
        cam: { x: 1010, y: 510 },
        hold: 1,
        lift: 0,
        ...p,
      },
    },
  }));
}
const well = (w, p, seed) => camera([w], p, seed)[0];
// the leaves a record's brain is flying, as raw 16.16 places
const flying = (r, set, tick) => brainAt(r, set, tick).state.fx.map((q) => [q.x, q.y]);
// the leaves the painter is handed, where they are drawn
const drawn = (r, set, tick) => resolveEffects(r, set, tick).map((e) => [e.x * FP, e.y * FP]);
// how far a leaf let go with no speed has fallen after its moves
function fallen(moves) {
  let y = 0,
    v = 0;
  for (let i = 0; i < moves; i++) y += v = Math.floor(((v + FP / 2) * 0xcccc) / FP);
  return y;
}
const AT = [1100 * FP, 600 * FP];

test("well: a camera's wells roll one cursor between them, each once a tick in the camera's order, and a roll under ten lets a leaf go", () => {
  const set = leafSet(Array.from({ length: 256 }, (_, i) => i));
  const lets = (r) => {
    const out = [];
    const { x, y } = r.cycle.p.wells[r.cycle.p.own];
    for (let tick = 1; tick <= 100; tick++)
      if (flying(r, set, tick).some(([lx, ly]) => lx === x * FP && ly === y * FP)) out.push(tick);
    return out;
  };
  assert.deepEqual(
    camera([{ x: 1100 }, { x: 1200 }, { x: 1300 }], {}, 250).map(lets),
    [
      [3, 4, 5, 6, 89, 90, 91],
      [3, 4, 5, 88, 89, 90, 91],
      [3, 4, 5, 88, 89, 90],
    ],
    "from byte 250 three a tick: bytes 0, 1 and 2 fall to tick 3, and byte 9 to the first well on tick 6",
  );
  assert.deepEqual(lets(well({}, {}, 250)), [7, 8, 9, 10, 11, 12, 13, 14, 15, 16]);
});

test("well: a leaf keeps four fifths of its speed a tick and gains half a unit of fall, each product cut toward minus infinity", () => {
  const set = leafSet();
  const r = well({ speed: [200, -2000] });
  assert.deepEqual(flying(r, set, 1), [AT], "let go on the first roll, 2 across and 20 up");
  assert.deepEqual(flying(r, set, 2), [[AT[0] + 104856, AT[1] - 1022346]]);
  assert.deepEqual(
    flying(r, set, 3),
    [[AT[0] + 104856 + 83883, AT[1] - 1022346 - 791651]],
    "83883.5 across and 791650.3 up, the one cut down and the other up",
  );
  const half = well({ speed: [-268, -1500], scale: 0.5, layer: 8 });
  assert.deepEqual(
    flying(half, set, 2),
    [[AT[0] - 70254, AT[1] - 366996]],
    "the first speeds halved, 87818 and 491520, and the fall not",
  );
});

test("well: a leaf jitters a sixty-fourth of a unit for each step of a byte off 127, across then down, at its scale, off a cursor a leaf steps as it is let go", () => {
  const set = leafSet(dice({ 0: 0, 1: 127 + 64, 2: 127 - 32 }));
  assert.deepEqual(flying(well({}), set, 2), [[AT[0] + FP, AT[1] + fallen(1) - FP / 2]]);
  assert.deepEqual(flying(well({ scale: 0.5 }), set, 2), [
    [AT[0] + FP / 2, AT[1] + fallen(1) - FP / 4],
  ]);
  const two = leafSet(dice({ 0: 0, 1: 0, 4: 127 + 64, 5: 127 + 64 }));
  const [a, b] = camera([{}, { x: 1200 }]);
  assert.deepEqual(
    [flying(a, two, 2), flying(b, two, 2)],
    [[[AT[0], AT[1] + fallen(1)]], [[1200 * FP + FP, AT[1] + fallen(1) + FP]]],
    "of two let go together, the second reads the two bytes after the first's",
  );
});

test("well: an Exoddus leaf holds its first move a tick, an Oddysee one moves on the tick it is let go", () => {
  const set = leafSet();
  const w = { speed: [200, -2000] };
  const moved = [AT[0] + 104856, AT[1] - 1022346];
  assert.deepEqual([flying(well(w), set, 1), flying(well(w), set, 2)], [[AT], [moved]]);
  assert.deepEqual(flying(well(w, { hold: 0 }), set, 1), [moved]);
});

test("well: a leaf comes to rest once, on the first floor of its own plane it meets, and falls through it from there", () => {
  const set = leafSet();
  const floors = [
    [1000, 610, 1368, 610, 4],
    [1000, 620, 1368, 620, 0],
  ];
  const ys = (r, from, to) =>
    Array.from({ length: to - from + 1 }, (_, i) => flying(r, set, from + i)[0][1] - AT[1]);
  const run = (to) => Array.from({ length: to }, (_, i) => fallen(i + 1));
  assert.ok(
    fallen(8) < 10 * FP && fallen(9) > 10 * FP && fallen(13) < 20 * FP && fallen(14) > 20 * FP,
  );
  const full = well({}, { floors });
  assert.deepEqual(ys(full, 2, 14), run(13), "through the background's floor 10 below");
  const rest = 20 * FP - 256;
  assert.deepEqual(
    ys(full, 15, 15),
    [rest],
    "where the engine's raycast puts the floor, a 256th short",
  );
  assert.deepEqual(
    ys(full, 16, 19),
    run(4).map((y) => rest + y),
    "from a standing start, through the floor it rested on",
  );
  const half = well({ scale: 0.5, layer: 8 }, { floors });
  assert.deepEqual(ys(half, 2, 9), run(8));
  assert.deepEqual(ys(half, 10, 10), [10 * FP - 512], "at rest on the background's floor");
  assert.deepEqual(
    ys(half, 11, 18),
    run(8).map((y) => 10 * FP - 512 + y),
  );
  assert.deepEqual(
    flying(half, set, 19),
    [],
    "the ninth move meets the foreground's, and it is gone",
  );
});

test("well: a leaf dies off its screen, alive still on the screen's last column and row", () => {
  const set = leafSet();
  const lives = (w) => flying(well(w), set, 3).length;
  assert.deepEqual([lives({ x: LEFT }), lives({ x: LEFT - 1 })], [1, 0]);
  assert.deepEqual([lives({ x: RIGHT }), lives({ x: RIGHT + 1 })], [1, 0]);
  assert.deepEqual([lives({ y: TOP }), lives({ y: TOP - 1 })], [1, 0]);
  assert.ok(fallen(1) < FP && fallen(2) > FP);
  const low = well({ y: BOTTOM });
  assert.deepEqual(flying(low, set, 2), [[AT[0], BOTTOM * FP + fallen(1)]]);
  assert.deepEqual(flying(low, set, 3), []);
  const [across] = flying(well({ x: LEFT - 1, speed: [200, 0] }), set, 3);
  assert.ok(across[0] >= LEFT * FP, "let go off its screen, and brought onto it by its first move");
});

test("well: the engine's list hands a dead leaf's place to its last, and the leaves fly in that order", () => {
  const set = leafSet(dice({ 0: 0, 1: 0, 2: 0, 15: 127 + 64 }));
  const recs = camera([{ y: BOTTOM }, { x: 1200 }, { x: 1300 }]);
  const count = (tick) => recs.map((r) => flying(r, set, tick).length);
  assert.deepEqual(
    [count(2), count(3)],
    [
      [1, 1, 1],
      [0, 1, 1],
    ],
  );
  assert.deepEqual(
    [flying(recs[1], set, 4)[0][0], flying(recs[2], set, 4)[0][0]],
    [1200 * FP, 1300 * FP + FP],
    "the third leaf stands where the first stood, and reads byte 15 on the third move",
  );
});

test("well: a leaf is handed to the painter in the frames whose bounding rect meets its screen, five lower in Oddysee", () => {
  const set = leafSet();
  const r = well({});
  const handed = (rec) => {
    const [e] = resolveEffects(rec, set, 1);
    return [e.kind, e.name, e.x, e.y, e.scale, e.layer, e.blend, e.rgb, e.cam, e.frame];
  };
  const tint = [100, 100, 100],
    cam = { x: 1010, y: 510 };
  assert.deepEqual(handed(r), ["sprite", "Well_Leaf", 1100, 600, 1, 27, 0, tint, cam, 0]);
  assert.deepEqual(
    handed(well({ scale: 0.5, layer: 8 })),
    ["sprite", "Well_Leaf", 1100, 600, 0.5, 8, 0, tint, cam, 0],
    "a half-scale leaf at its own scale and layer, in the one tint",
  );
  assert.deepEqual(
    handed(well({}, { lift: 5 })),
    ["sprite", "Well_Leaf", 1100, 605, 1, 27, 0, tint, cam, 0],
    "Oddysee's leaf five lower, on its well's camera still",
  );
  assert.deepEqual(
    [1, 4, 5, 8, 9, 21, 24, 25].map((tick) => resolveEffects(r, set, tick)[0].frame),
    [0, 0, 1, 1, 2, 5, 5, 0],
    "a frame every four ticks of its life, round again after the sixth",
  );
  assert.deepEqual(
    [7, 10, 11].map((tick) => resolveEffects(r, leafSet(dice({ 6: 0 })), tick)[0].frame),
    [0, 0, 1],
    "its life counted from the tick it is let go on",
  );
  assert.deepEqual(
    resolveEffects(r, set, 0),
    [],
    "a stopped clock shows no leaf of the first step",
  );
  assert.deepEqual(drawn(well({}, { lift: 5 }), set, 2), [[AT[0], AT[1] + fallen(1) + 5 * FP]]);
  const high = well({ y: TOP + 10 });
  assert.deepEqual(
    drawn(well({ y: TOP + 10 }, { lift: 5 }), set, 2),
    [],
    "the rect is taken where the leaf flies, not five lower",
  );
  assert.deepEqual(
    [flying(high, set, 2).length, drawn(high, set, 2), drawn(high, set, 3).length],
    [1, [], 1],
    "its rect ends 11 above its point, which two moves take 11 below the screen's top",
  );
  const small = well({ y: TOP + 4, scale: 0.5, layer: 8 });
  assert.deepEqual(
    [drawn(small, set, 2), drawn(small, set, 3).length],
    [[], 1],
    "5 above at half scale",
  );
  assert.equal(resolveEffects(small, set, 3)[0].layer, 8);
  const tall = { ...LEAF, frames: LEAF.frames.map((f, i) => (i ? f : [...f.slice(0, 10), 0])) };
  assert.equal(
    resolveEffects(high, { ...set, anims: { Well_Leaf: tall } }, 2).length,
    1,
    "the rect is the frame's own",
  );
  const short = {
    ...LEAF,
    frames: LEAF.frames.map((f, i) => (i === 1 ? [...f.slice(0, 8), -40, -4, -30] : f)),
  };
  assert.deepEqual(
    [4, 5].map(
      (tick) => resolveEffects(high, { ...set, anims: { Well_Leaf: short } }, tick).length,
    ),
    [1, 0],
    "and that of the frame shown",
  );
});

test("well: the same seed gives the same leaves, whichever record of the camera flies them and whenever it is asked", () => {
  const set = leafSet(Array.from({ length: 256 }, (_, i) => (i * 37 + 11) & 255));
  const wells = [{}, { x: 1200, scale: 0.5, layer: 8 }, { x: 1250, speed: [-268, -1500] }];
  const p = { floors: [[1000, 640, 1368, 640, 0]] };
  const all = (recs, tick) => recs.flatMap((r) => flying(r, set, tick));
  const once = camera(wells, p, 9);
  const at600 = all(once, 600);
  assert.ok(at600.length > 3);
  const again = camera(wells, p, 9);
  assert.deepEqual(all(again, 600), at600);
  for (const r of again)
    assert.deepEqual(
      brainAt(r, set, 600)
        .state.leaves.map((q) => [q.x, q.y])
        .sort(),
      [...at600].sort(),
      "each record flies the whole camera's leaves and gives off its own",
    );
  assert.deepEqual(all(once, 300), all(camera(wells, p, 9), 300), "a tick asked behind the state");
  assert.deepEqual(all(once, 600), at600);
  assert.notDeepEqual(all(camera(wells, p, 10), 600), at600);
});

// ---- the rule ---------------------------------------------------------------

const LINES = [
  [0, 200, 400, 200, 0],
  [0, 210, 400, 210, 4],
  [0, 220, 400, 220, 1],
  [400, 100, 400, 200, 2],
];
// the records a game's rule gives an object of a path two screens across
function place(game, tlvs, abe = null) {
  const data = { id: game, geometry: game === "AE" ? AE_GEOMETRY : AO_GEOMETRY };
  const path = { id: 7, w: 2, h: 1, cams: [], lines: LINES, tlvs };
  const set = { ...leafSet(), ...(abe ? { abe: { ZZ: { 7: abe } } } : {}) };
  return (t) => spriteDraws(data, { short: "ZZ" }, path, t, set);
}
const tlvOf = (name, x1, y1, fields) => ({
  name,
  x1,
  y1,
  x2: x1 + 25,
  y2: y1 + 24,
  fields: { scale: 0, switch_id: 0, emit_leaves: 1, ...fields },
});
const leafBrain = (recs) => recs.find((r) => r.cycle?.brain === "well");

test("well rule: an Exoddus well's leaves start over the middle of its rect five below its top, or where its fields put them from the path's Abe start, at 2 across and 20 up", () => {
  const local = (f) => tlvOf("LocalWell", 100, 60, { leaf_xpos: 0, leaf_ypos: 0, ...f });
  const express = (f) =>
    tlvOf("WellExpress", 100, 60, { leaf_x: 0, leaf_y: 0, exit_x: 9, exit_y: 9, ...f });
  const only = (t, abe = [300, 40]) => {
    const recs = place("AE", [t], abe)(t);
    assert.equal(recs.length, 1);
    return recs[0];
  };
  const r = only(local());
  assert.deepEqual(
    [r.anim, r.x, r.y, r.cycle.kind, r.cycle.brain, r.cycle.seed],
    [null, 100, 60, "brain", "well", 0],
  );
  assert.deepEqual(r.cycle.p, {
    wells: [{ x: 112, y: 65, speed: [200, -2000], scale: 1, layer: 27 }],
    own: 0,
    floors: [LINES[0], LINES[1]],
    win: [0, 0, 368, 240],
    cam: { x: 112, y: 72 },
    hold: 1,
    lift: 0,
  });
  const leaf = (t, abe) => only(t, abe).cycle.p.wells[0];
  assert.deepEqual(leaf(express()), { x: 112, y: 65, speed: [200, -2000], scale: 1, layer: 27 });
  assert.deepEqual(
    [
      leaf(local({ leaf_xpos: 30, leaf_ypos: -10 })).x,
      leaf(local({ leaf_xpos: 30, leaf_ypos: -10 })).y,
    ],
    [330, 30],
  );
  assert.deepEqual(
    [leaf(express({ leaf_x: -200 })).x, leaf(express({ leaf_x: -200 })).y],
    [100, 65],
    "x alone, and short of Abe's start",
  );
  assert.deepEqual(
    [leaf(express({ leaf_y: 100 })).x, leaf(express({ leaf_y: 100 })).y],
    [112, 140],
  );
  assert.deepEqual(
    [leaf(local({ scale: 1 })).scale, leaf(local({ scale: 1 })).layer],
    [0.5, 8],
    "the background's well",
  );
  assert.equal(leaf(local({ leaf_xpos: 30 }), null).x, 30, "with no Abe start to measure from");
});

test("well rule: an Oddysee well's leaves start over the middle of its rect at its top, or where its fields put them, at the speed its record gives its exit, and behind the well where that leads down", () => {
  const local = (f) =>
    tlvOf("WellLocal", 1300, 200, {
      animation_id: 5003,
      exit_x: -268,
      exit_y: -1500,
      leaf_x: 0,
      leaf_y: 0,
      ...f,
    });
  const only = (t) => place("AO", [t], [300, 40])(t)[0];
  const r = only(local());
  assert.deepEqual(
    [r.anim, r.x, r.y, r.layer, r.cycle.brain],
    ["bg:5003", 1300, 205, 23, "well"],
    "the well's own art, with its leaves' brain",
  );
  assert.deepEqual(r.cycle.p, {
    wells: [{ x: 1312, y: 200, speed: [-268, -1500], scale: 1, layer: 27 }],
    own: 0,
    floors: [LINES[0], LINES[1]],
    win: [1280, 120, 1648, 360],
    cam: { x: 1300, y: 200 },
    hold: 0,
    lift: 5,
  });
  const leaf = (f) => only(local(f)).cycle.p.wells[0];
  assert.deepEqual(
    [leaf({ leaf_x: 1400, leaf_y: 150 }).x, leaf({ leaf_x: 1400, leaf_y: 150 }).y],
    [1400, 150],
    "Abe's start no part of it",
  );
  assert.deepEqual(
    [{ exit_y: 1500 }, { exit_y: 1500, scale: 1 }, { exit_y: 0 }, { scale: 1 }].map(
      (f) => leaf(f).layer,
    ),
    [22, 3, 27, 8],
  );
  const bare = only(
    tlvOf("WellExpress", 1300, 200, {
      animation_id: 0,
      exit_x: 0,
      exit_y: 1500,
      leaf_x: 0,
      leaf_y: 0,
    }),
  );
  assert.deepEqual(
    [bare.anim, bare.cycle.brain, bare.cycle.p.wells[0].layer],
    [null, "well", 22],
    "a well with no art of its own draws its leaves alone",
  );
});

test("well rule: a well lets leaves go where its record says so and its switch is none or the always-on id", () => {
  for (const [game, name] of [
    ["AE", "LocalWell"],
    ["AE", "WellExpress"],
    ["AO", "WellLocal"],
    ["AO", "WellExpress"],
  ]) {
    const brains = (f) => {
      const t = tlvOf(name, 100, 300, { exit_x: 0, exit_y: -1500, ...f });
      return place(game, [t])(t).filter((r) => r.cycle?.brain === "well").length;
    };
    assert.deepEqual(
      [{}, { switch_id: 1 }, { emit_leaves: 2 }, { emit_leaves: -1 }].map(brains),
      [1, 1, 1, 1],
      `${game} ${name}`,
    );
    assert.deepEqual(
      [{ emit_leaves: 0 }, { switch_id: 2 }, { switch_id: 255 }].map(brains),
      [0, 0, 0],
      `${game} ${name} lets none go`,
    );
  }
  const quiet = (game, name) => {
    const t = tlvOf(name, 100, 300, { emit_leaves: 0, animation_id: 5003 });
    return place(game, [t])(t).map((r) => [r.anim, r.cycle]);
  };
  assert.deepEqual(quiet("AE", "LocalWell"), [], "an Exoddus well that lets none go draws nothing");
  assert.deepEqual(quiet("AO", "WellLocal"), [["bg:5003", null]], "an Oddysee one its art alone");
});

test("well rule: the wells a camera builds that let leaves go fly one brain between them, in its list's order, from the first's place in the path", () => {
  const shape = (game, tlvs) =>
    tlvs.map((t) => {
      const r = leafBrain(place(game, tlvs)(t));
      return r && [r.cycle.seed, r.cycle.p.own, r.cycle.p.wells.map((w) => w.x), r.cycle.p.win[0]];
    });
  assert.deepEqual(
    shape("AE", [
      tlvOf("Door", 0, 0, {}),
      tlvOf("LocalWell", 40, 100, {}),
      tlvOf("LocalWell", 90, 100, { emit_leaves: 0 }),
      tlvOf("WellExpress", 140, 100, { scale: 1 }),
      tlvOf("WellExpress", 365, 100, {}),
      tlvOf("LocalWell", 500, 100, { switch_id: 9 }),
      tlvOf("LocalWell", 600, 100, {}),
    ]),
    [
      undefined,
      [1, 0, [52, 152], 0],
      undefined,
      [1, 1, [52, 152], 0],
      [4, 0, [377, 612], 375],
      undefined,
      [4, 1, [377, 612], 375],
    ],
    "Exoddus files a well under the cell its rect's middle lies in",
  );
  assert.deepEqual(
    shape("AO", [
      tlvOf("WellLocal", 1010, 200, { exit_x: 0, exit_y: -1500 }),
      tlvOf("WellExpress", 1100, 200, { exit_x: 0, exit_y: -1500 }),
    ]),
    [
      [0, 0, [1022], 256],
      [1, 0, [1112], 1280],
    ],
    "Oddysee under the cell its corner lies in",
  );
  const far = [
    ...Array.from({ length: 300 }, () => tlvOf("Door", 0, 0, {})),
    tlvOf("LocalWell", 40, 100, {}),
  ];
  assert.equal(leafBrain(place("AE", far)(far[300])).cycle.seed, 300 & 255, "a seed is a byte");
});

// ---- every well the games place ------------------------------------------------

const pub = (f) => JSON.parse(readFileSync(new URL(`../../public/${f}`, import.meta.url), "utf8"));
const GAMES = ["AO", "AE"];
const data = {},
  sheets = {};
for (const g of GAMES) {
  const lg = g.toLowerCase();
  armFieldData(g, pub(`field_types_${lg}.json`), pub(`enum_labels_${lg}.json`));
  data[g] = pub(`map_data_${lg}.json`);
  sheets[g] = pub(`sprites_${lg}.json`);
}
// every well with a brain, by the place of its record in its path
function leafy(g) {
  const out = [];
  for (const lvl of data[g].levels)
    for (const path of lvl.paths)
      path.tlvs.forEach((t, index) => {
        const r = leafBrain(spriteDraws(data[g], lvl, path, t, sheets[g]));
        if (r) out.push({ t, index, r, at: `${g} ${lvl.short} P${path.id}` });
      });
  return out;
}
function wellAt(g, lv, pid, index) {
  const lvl = data[g].levels.find((l) => l.short === lv);
  const path = lvl.paths.find((p) => p.id === pid);
  return leafBrain(spriteDraws(data[g], lvl, path, path.tlvs[index], sheets[g]));
}

// four turns of the dice, the run the PlayStation's own code was held beside
const TURNS = 1024;

// each well's rolls due to let a leaf go over the run, and every leaf its brain flew
const flown = {};
function flights(g) {
  if (flown[g]) return flown[g];
  const set = sheets[g];
  return (flown[g] = leafy(g).map(({ t, index, r, at }) => {
    const p = r.cycle.p;
    const due = [];
    for (let tick = 1; tick <= TURNS; tick++)
      if (set.dice[(r.cycle.seed + p.wells.length * (tick - 1) + p.own) & 255] < 10) due.push(tick);
    const leaves = new Map();
    const sum = [0, 0, 0];
    const [left, top, right, bottom] = p.win;
    for (let tick = 1; tick <= TURNS; tick++)
      for (const q of brainAt(r, set, tick).state.fx) {
        [1, q.x, q.y].forEach((v, k) => (sum[k] += v));
        const was = leaves.get(q) ?? { born: q.born, seen: 0, top: q.y, foot: q.y, scale: q.scale };
        const x = Math.trunc(q.x / FP),
          y = Math.trunc(q.y / FP);
        leaves.set(q, {
          ...was,
          seen: was.seen + 1,
          top: Math.min(was.top, q.y),
          foot: Math.max(was.foot, q.y),
          off: was.off || x < left || x > right || y < top || y > bottom,
          last: { tick, x: q.x, y: q.y, vx: q.vx, vy: q.vy },
        });
      }
    return {
      t,
      index,
      r,
      p,
      due,
      sum,
      leaves: [...leaves.values()],
      where: `${at} (${t.x1},${t.y1})`,
      at,
    };
  }));
}

test("wells: every well that lets leaves go lets one go on each of its rolls under ten, from over its rect's middle at its top, its screen's wells sharing the rolls", () => {
  const wells = { AO: 0, AE: 0 },
    made = { AO: 0, AE: 0 },
    cameras = { AO: new Map(), AE: new Map() },
    never = [];
  for (const g of GAMES)
    for (const { t, index, r, p, due, leaves, where, at } of flights(g)) {
      wells[g]++;
      const cam = `${at} ${p.win}`;
      const mates = cameras[g].get(cam) ?? cameras[g].set(cam, []).get(cam);
      mates.push(index);
      assert.deepEqual(
        [r.cycle.seed, p.own, p.wells.length >= mates.length],
        [mates[0] & 255, mates.length - 1, true],
        `${where} shares its camera's brain`,
      );
      assert.deepEqual(
        [p.wells[p.own].x, p.wells[p.own].y],
        [Math.trunc((t.x1 + t.x2) / 2), t.y1 + (g === "AE" ? 5 : 0)],
        `${where} starts`,
      );
      made[g] += due.length;
      const born = [...new Set(leaves.map((q) => q.born))];
      if (!born.length) never.push(where);
      else assert.deepEqual(born, due, `${where} lets go`);
    }
  assert.deepEqual(wells, { AO: 49, AE: 170 });
  assert.deepEqual([cameras.AO.size, cameras.AE.size], [38, 126]);
  assert.deepEqual(made, { AO: 49 * 40, AE: 170 * 40 }, "ten rolls in 256, a well a roll a tick");
  const shares = (g, n) => [...cameras[g].values()].filter((mates) => mates.length === n).length;
  assert.deepEqual(
    [1, 2, 3, 4].map((n) => [shares("AO", n), shares("AE", n)]),
    [
      [28, 93],
      [9, 25],
      [1, 5],
      [0, 3],
    ],
    "the screens of one well, two, three and four",
  );
  assert.deepEqual(
    never,
    ["AO D2 P3 (300,1056)"],
    "a well in a ceiling lets its leaves go 24 above its screen, each lost on its first move",
  );
});

test("wells: every leaf rises from a well that leads up, stays on its screen, and is lost within a move of its screen's edge or, at half scale, of a foreground floor", () => {
  const down = [],
    grounded = [],
    lost = { AO: [0, 0], AE: [0, 0] };
  let longest = 0;
  const reach = (v, scale) => (0.8 * Math.abs(v)) / FP + 0.4 + 2 * scale + 1;
  for (const g of GAMES)
    for (const { p, leaves, where } of flights(g)) {
      const own = p.wells[p.own];
      const [left, top, right, bottom] = p.win;
      if (own.speed[1] >= 0) down.push(where);
      const flew = leaves.filter((q) => q.seen > p.hold);
      const least = Math.min(...flew.map((q) => own.y * FP - q.top));
      if (own.speed[1] >= 0)
        assert.ok(
          flew.every((q) => q.foot > own.y * FP),
          `${where} sheds downward`,
        );
      else if (least <= 0) grounded.push(where);
      else assert.ok(least > 6 * FP, `${where}: a leaf rises no more than ${least / FP}`);
      for (const q of leaves) {
        const at = `${where}, the leaf of tick ${q.born}`;
        const { x, y, vx, vy, tick } = q.last;
        longest = Math.max(longest, tick - q.born);
        assert.ok(!q.off, `${at} stays on its screen`);
        if (tick === TURNS) continue;
        const X = Math.trunc(x / FP),
          Y = Math.trunc(y / FP),
          rx = reach(vx, q.scale),
          ry = reach(vy, q.scale);
        const edge = X - left < rx || right - X < rx || Y - top < ry || bottom - Y < ry;
        const floor =
          q.scale !== 1 &&
          p.floors.some(
            ([ax, ay, bx, by, kind]) =>
              kind === 0 &&
              Math.min(ax, bx) <= X + rx &&
              Math.max(ax, bx) >= X - rx &&
              Math.min(ay, by) <= Y + ry &&
              Math.max(ay, by) >= Y - ry,
          );
        assert.ok(edge || floor, `${at} is lost at ${X},${Y} with nothing in reach`);
        lost[g][edge ? 0 : 1]++;
      }
    }
  assert.deepEqual(down, ["AO D1 P1 (4665,720)", "AO D2 P3 (300,1056)"]);
  assert.deepEqual(
    grounded,
    ["AE PV P4 (600,995)"],
    "a well whose leaves start on its floor's own line: each rests where it is let go, and sinks",
  );
  assert.ok(
    lost.AO[1] > 0 && lost.AE[1] > 0,
    `lost on a floor alone: ${lost.AO[1]} and ${lost.AE[1]}`,
  );
  assert.ok(longest > 150 && longest < 400, `the longest flight, ${longest} ticks`);
});

// raw 16.16 as each game's own code flies them on the PlayStation, from the map's seed
test("wells: a leaf of each game, held to the PlayStation's run of it move by move", () => {
  const first = (r, g, ticks) => ticks.map((tick) => flying(r, sheets[g], tick)[0]);
  const ao = wellAt("AO", "L1", 1, 3);
  assert.deepEqual(flying(ao, sheets.AO, 16), []);
  assert.deepEqual(
    first(ao, "AO", [17, 18, 19, 20]),
    [
      [365984549, 18838130],
      [366003216, 18087434],
      [365934181, 17418892],
      [365975209, 17007560],
    ],
    "Monsaic Lines' first well lets its first leaf go on tick 17, which moves at once",
  );
  assert.deepEqual(
    first(ao, "AO", [52, 53, 54, 55]),
    [
      [366643255, 20627971],
      [366626560, 320 * FP - 256],
      [366743296, 20956518],
      [366963659, 20878775],
    ],
    "onto the floor at 320 and through it",
  );
  assert.deepEqual(drawn(ao, sheets.AO, 17), [[365984549, 18838130 + 5 * FP]]);
  const ae = wellAt("AE", "MI", 1, 50);
  assert.deepEqual(flying(ae, sheets.AE, 2), []);
  assert.deepEqual(
    first(ae, "AE", [3, 4, 5, 6]),
    [
      [887 * FP, 945 * FP],
      [58360216, 60784246],
      [58506152, 59814830],
      [58694579, 59078835],
    ],
    "the Mines' first express well lets one go on tick 3, where it stands that tick",
  );
  assert.deepEqual(
    first(ae, "AE", [37, 38, 39, 40]),
    [
      [61403635, 62812853],
      [61433088, 960 * FP - 256],
      [61346048, 62877030],
      [61338881, 62847825],
    ],
    "onto the floor at 960 and through it",
  );
  assert.deepEqual(
    first(wellAt("AE", "PV", 4, 25), "AE", [89, 90, 91]),
    [
      [612 * FP, 1000 * FP],
      [612 * FP, 1000 * FP],
      [40145920, 65434214],
    ],
    "a Mudomo Vault well stands five above its floor's line: its leaf rests where it is let go",
  );
});

test("wells: the leaves of a camera of several, summed at three ticks of the PlayStation's run", () => {
  const sums = (g, lv, pid, wells) =>
    [300, 600, 1024].map((tick) => {
      const all = wells.flatMap((index) => flying(wellAt(g, lv, pid, index), sheets[g], tick));
      return [all.length, all.reduce((s, q) => s + q[0], 0), all.reduce((s, q) => s + q[1], 0)];
    });
  assert.deepEqual(
    sums("AE", "SV", 1, [43, 44, 49, 50]),
    [
      [13, 1767683106, 339174475],
      [15, 2053813742, 394136582],
      [14, 1897298865, 355972023],
    ],
    "four wells on a screen of Mudanchee Vault's first path",
  );
  assert.deepEqual(
    sums("AO", "D2", 9, [37, 39, 41]),
    [
      [9, 874401502, 709423424],
      [9, 839259848, 717735717],
      [9, 864411496, 720986658],
    ],
    "three on a screen of the Scrabanian Temple's ninth",
  );
});

test("wells: every leaf at every tick of the PlayStation's run, counted and its place summed", () => {
  const flew = { AO: [0, 0, 0], AE: [0, 0, 0] };
  for (const g of GAMES) for (const { sum } of flights(g)) sum.forEach((v, k) => (flew[g][k] += v));
  assert.deepEqual(flew, {
    AO: [139005, 27361925135795, 8317431355601],
    AE: [540965, 44781249267503, 28674884991801],
  });
});
