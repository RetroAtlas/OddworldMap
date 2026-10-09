import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { spriteDraws, spriteTypes } from "../../public/js/sprites.js";
import { armFieldData } from "../../public/js/fields.js";
import { resolveEffects, resolveRecord } from "../../public/js/motion.js";
import { patrolZone, sligBounds } from "../../public/js/model.js";
import { drawX } from "../../public/js/geometry.js";

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

// every record of every placed object, with the object and place it came from
function allRecords(g) {
  const out = [];
  const set = sheets[g];
  for (const lvl of data[g].levels)
    for (const path of lvl.paths) {
      for (const t of path.tlvs)
        for (const r of spriteDraws(data[g], lvl, path, t, set)) out.push({ lvl, path, t, r });
    }
  return out;
}

// the sprite-drawing types the rules cover, pinned so a rule going missing
// shows up as a count rather than as blank screens
const SPRITE_TYPES = { AO: 44, AE: 46 };

// a brain's cycle has no period, since it rolls dice; two hundred seconds of
// it is long past the longest timer and holds every break and turn
const BRAIN_WINDOW = 6000;
function brainAnims(r, set) {
  const names = new Set();
  let moved = false;
  for (let t = 0; t <= BRAIN_WINDOW; t++) {
    for (const e of resolveEffects(r, set, t)) {
      assert.ok(Number.isFinite(e.x) && Number.isFinite(e.y), `${r.anim} effect at ${t}`);
      if (e.kind === "sprite") names.add(e.name);
      moved = true;
    }
    const shown = resolveRecord(r, set, t);
    if (!shown) continue; // a brain may hide its record for a spell

    assert.ok(shown.frame >= 0 && shown.frame < shown.anim.frames.length, `${r.anim} at ${t}`);
    assert.ok(Number.isFinite(shown.x) && Number.isFinite(shown.y), `${r.anim} place at ${t}`);
    names.add(shown.name);
    if (shown.x !== r.x || shown.y !== r.y) moved = true;
  }
  if (r.anim !== null) assert.ok(names.size > 0, `${r.anim} is never shown`);
  else assert.ok(moved, `an effect-only record that gives off nothing`);
  names.moved = moved;
  return names;
}

// the one-shot animations a record is meant to stand on, parked
const ONE_SHOTS = new Set();

// animations the rules reach only from a state an edit puts an object in
const EDIT_REACHED = new Set([
  "CrawlingSlig_Idle", // a crawling slig whose state is set awake
  "Scrab_JumpAndRunToFall", // a scrab whose scale leaves it no floor
  "Slig_ReloadGun", // an Oddysee slig turned to face a wall, standing past its reload timer
  "Slig_ReloadGun@StockYardsSlig",
]);

// animations the sheets carry before the rule or brain that draws them is
// written; one leaves its game's list with the code that draws it
const SHIPPED_AHEAD = {
  AO: new Set([
    "Bee_Swarm", // a honey sack's swarm and the bee hole's
    "DeathFlare_2", // a sling Mudokon appearing
    "Explosion_Stick", // a falling item's debris
    "FallingMeat_Waiting", // meat on the always-on switch
    "Honey_Drip", // a hanging honey sack
    "Meat_Gib", // meat's debris
    "Mudokon_Sling_Idle", // a sling Mudokon
    "Mudokon_Sling_Speak",
    "ObjectShadow", // a creature's drop shadow
    "Scrab_AO_ToFall", // a scrab walking off its line's end
    "Security_Claw_Upper_NoRotation", // a claw carrying motion detectors
    "Well_Leaf", // a well letting a leaf go
  ]),
  AE: new Set([
    "AE_FallingRock_Waiting", // a rock on the always-on switch
    "AirExplosion", // a crate's blast
    "ChantOrb_Particle", // the flare running down a web line
    "Explosion_Rock", // a rock's debris
    "Explosion_Stick", // a crate's debris
    "FallingCrate_Waiting", // a crate on the always-on switch
    "Fleech_Climb", // a fleech climbing a hoist
    "Fleech_RaiseHead",
    "Fleech_SettleOnGround",
    "Lever_Pull_Left", // a lever an angry worker pulls
    "Lever_Pull_Release_Left",
    "Lever_Pull_Release_Right",
    "Lever_Pull_Right",
    "Mudokon_LeverUse", // an angry worker at its lever
    "Mudokon_Speak3@WiredMud", // a wired Mudokon laughing
    "Mudokon_SpeakFart@WiredMud",
    "Mudokon_TurnWheel", // an angry worker at its wheel
    "Mudokon_TurnWheelBegin",
    "ObjectShadow", // a creature's drop shadow
    "Scrab_Knockback", // a scrab walking into a wall
    "Scrab_Landing", // a scrab landing from a fall
    "SlapLock_Shaking", // a slap lock holding its ghost
    "Status_Light_Green", // a status light whose switch is on
    "Well_Leaf", // a well letting a leaf go
    "Work_Wheel_Turning", // a wheel an angry worker turns
  ]),
};

test("every record names an animation the sidecar carries, and every sidecar animation is drawn", () => {
  for (const g of GAMES) {
    const used = new Set();
    for (const { r } of allRecords(g)) {
      // an effect-only object draws no sprite of its own
      if (r.anim !== null) {
        assert.ok(
          sheets[g].anims[r.anim],
          `${g}: ${r.anim} is drawn but not in sprites_${g.toLowerCase()}.json`,
        );
        used.add(r.anim);
      }
      // the cycles name animations of their own
      if (r.cycle?.kind === "uxb")
        for (const n of ["Bomb_Flash", "Bomb_RedGreenTick", "Bomb_RedGreenTick@GreenFlash"])
          used.add(n);
      if (r.cycle?.kind === "brain") for (const n of brainAnims(r, sheets[g])) used.add(n);
    }
    for (const n of Object.keys(sheets[g].anims))
      assert.ok(
        used.has(n) || EDIT_REACHED.has(n) || SHIPPED_AHEAD[g].has(n),
        `${g}: ${n} is shipped but nothing draws it`,
      );
    for (const n of SHIPPED_AHEAD[g]) {
      assert.ok(
        sheets[g].anims[n],
        `${g}: ${n} is listed as shipped ahead but the sidecar lacks it`,
      );
      assert.ok(!used.has(n), `${g}: ${n} is drawn, so it leaves SHIPPED_AHEAD`);
    }
  }
});

// a rule or a brain names an animation by its string, and a name no sidecar
// carries draws nothing with no marker to show for it; a name built from parts
// is reached by the brain sweep instead
test("every animation name written whole into the viewer's modules is on a sidecar", () => {
  const dir = new URL("../../public/js/", import.meta.url);
  const carried = (name) =>
    GAMES.some((g) =>
      Object.keys(sheets[g].anims).some((k) => k === name || k.startsWith(name + "@")),
    );
  let seen = 0;
  for (const m of readdirSync(dir).filter((f) => f.endsWith(".js"))) {
    const src = readFileSync(new URL(m, dir), "utf8");
    for (const [, name] of src.matchAll(/"([A-Z][A-Za-z0-9]*_[A-Za-z0-9_@]+)"/g)) {
      seen++;
      assert.ok(carried(name), `${m} names ${name}, which no sidecar carries`);
    }
  }
  assert.ok(seen > 100, `${seen} names swept`);
});

test("the rules cover the pinned number of types per game", () => {
  for (const g of GAMES) assert.equal(spriteTypes(g).length, SPRITE_TYPES[g], g);
});

test("records are well-formed: finite anchors, the engine's scales and layers, a colour and a frame", () => {
  for (const g of GAMES)
    for (const { t, r } of allRecords(g)) {
      const where = `${g} ${t.name}@${t.x1},${t.y1}`;
      assert.ok(Number.isFinite(r.x) && Number.isFinite(r.y), `${where} anchor`);
      assert.ok(r.scale > 0 && r.scale <= 1, `${where} scale ${r.scale}`);
      assert.ok(
        Number.isInteger(r.layer) && r.layer >= 1 && r.layer <= 39,
        `${where} layer ${r.layer}`,
      );
      assert.equal(r.rgb.length, 3, `${where} rgb`);
      if (r.anim === null)
        assert.ok(r.cycle?.kind === "brain", `${where} draws nothing and does nothing`);
      else assert.ok(r.frame < sheets[g].anims[r.anim].frames.length, `${where} start frame`);
      if (r.tile) assert.ok(r.tile.top <= r.tile.bottom && r.tile.step > 0, `${where} tile`);
    }
});

test("every frame a sidecar names sits inside its sheet's declared list", () => {
  for (const g of GAMES) {
    const n = sheets[g].sheets.length;
    for (const [name, a] of Object.entries(sheets[g].anims)) {
      assert.ok(a.fps >= 1 && a.frames.length >= 1, `${g} ${name}`);
      assert.ok(a.loop_start >= 0 && a.loop_start < a.frames.length, `${g} ${name} loop start`);
      for (const f of a.frames)
        assert.ok(f[0] >= 0 && f[0] < n && f[3] > 0 && f[4] > 0, `${g} ${name} frame`);
    }
  }
});

test("a record resolves at every tick of its cycle to a frame of a shipped animation", () => {
  for (const g of GAMES) {
    const set = sheets[g];
    const cycles = new Map();
    for (const { r } of allRecords(g))
      if (r.cycle && !cycles.has(r.cycle.kind)) cycles.set(r.cycle.kind, r);
    for (const [kind, r] of cycles)
      for (const tick of [0, 1, 2, 11, 12, 13, 59, 60, 61, 255, 256, 1000]) {
        const shown = resolveRecord(r, set, tick);
        assert.ok(shown, `${g} ${kind} at ${tick}`);
        assert.ok(
          shown.frame >= 0 && shown.frame < shown.anim.frames.length,
          `${g} ${kind} frame at ${tick}`,
        );
        assert.ok(
          Number.isFinite(shown.x) && Number.isFinite(shown.y),
          `${g} ${kind} place at ${tick}`,
        );
      }
  }
});

// placements read off the decomp by hand, pinned so a rule edit cannot drift them
test("nothing parks: every record whose animation does not loop is frozen on purpose, cycles, or is a listed one-shot", () => {
  for (const g of GAMES)
    for (const { t, r } of allRecords(g)) {
      const a = sheets[g].anims[r.anim];
      if (!a || a.loop || a.frames.length <= 1 || r.frozen || r.cycle) continue;
      assert.ok(ONE_SHOTS.has(r.anim), `${g} ${t.name} parks on ${r.anim}`);
    }
});

test("brains: every brain runs on the sidecar's animations and keeps moving", () => {
  for (const g of GAMES) {
    const set = sheets[g];
    const seen = new Map();
    for (const { t, r } of allRecords(g)) {
      if (r.cycle?.kind !== "brain") continue;
      const key = `${r.cycle.brain} ${r.cycle.emo} ${r.anim}`;
      if (seen.has(key)) continue;
      seen.set(key, t);
      const names = brainAnims(r, set);
      assert.ok(names.size > 1 || names.moved, `${g} ${key} never changes animation or place`);
      for (const n of names)
        assert.ok(set.anims[n], `${g} ${key} reaches ${n}, which the sidecar lacks`);
    }
    assert.ok(seen.size > 0, `${g} has brains`);
  }
});

test("pinned placements: a Mines slig sleeps snapped on its floor, a Rupture Farms mudokon scrubs where its diagonal meets the walkway", () => {
  const ae = data.AE;
  const mi = ae.levels.find((l) => l.short === "MI");
  const p1 = mi.paths.find((p) => p.id === 1);
  const slig = p1.tlvs.find((t) => t.name === "Slig");
  assert.equal(slig.fields.start_state, 2, "the first slig of the Mines is placed asleep");
  const [r] = spriteDraws(ae, mi, p1, slig, sheets.AE);
  assert.equal(r.anim, "Slig_Sleeping");
  assert.equal(r.x, 1412); // 1400 snapped to the Exoddus grid, whose squares sit at 12 + 25k
  assert.ok(r.y > slig.y1 && r.y <= slig.y1 + 24, "the floor is within the raycast");
  assert.deepEqual(r.rgb, [102, 127, 118]);
  assert.equal(r.layer, 33);
  const ao = data.AO;
  const r1 = ao.levels.find((l) => l.short === "R1");
  const path = r1.paths.find((p) => p.tlvs.some((t) => t.name === "Mudokon" && t.fields.job === 0));
  const mud = path.tlvs.find((t) => t.name === "Mudokon" && t.fields.job === 0);
  const [m] = spriteDraws(ao, r1, path, mud, sheets.AO);
  assert.equal(m.anim, "Mudokon_StandScrubLoop");
  assert.equal(m.x, 6584); // the rect's middle snapped to the Oddysee grid
  assert.equal(m.y, 321); // the walkway at 316 plus the base offset
  assert.deepEqual(m.rgb, [87, 103, 67]);
  assert.equal(m.layer, 32);
});

test("pinned placements: a rolling ball snaps to the grid, and a lift's two ropes hang where each game hangs them", () => {
  const ao = data.AO;
  const f2 = ao.levels.find((l) => l.short === "F2");
  const balls = f2.paths.flatMap((p) =>
    p.tlvs.filter((t) => t.name === "RollingBall").map((t) => [p, t]),
  );
  assert.deepEqual(
    balls.map(([p, t]) => [t.x1, spriteDraws(ao, f2, p, t, sheets.AO)[0].x]),
    [
      [5677, 5685],
      [284, 290],
    ],
  );
  const ropesOf = (d, lv, x1, y1) => {
    const l = d.levels.find((l) => l.short === lv);
    const [p, t] = l.paths.flatMap((p) =>
      p.tlvs.filter((t) => t.name === "LiftPoint" && t.x1 === x1 && t.y1 === y1).map((t) => [p, t]),
    )[0];
    return spriteDraws(d, l, p, t, sheets[d.id])
      .filter((r) => /Rope/.test(r.anim))
      .sort((a, b) => a.x - b.x)
      .map((r) => [r.x, r.y]);
  };
  // Oddysee: the far rope 25 above the lift and the near one 25 below, each the rope's length on
  assert.deepEqual(ropesOf(ao, "R1", 9670, 313), [
    [9696, 366],
    [9719, 316],
  ]);
  // Exoddus: both 25 below, the near rope a unit higher for the phase taken off it
  assert.deepEqual(ropesOf(data.AE, "MI", 4000, 1500), [
    [4027, 1606],
    [4050, 1605],
  ]);
});

test("pinned placements: of two start points on one lift shaft in a camera, the first its list reaches builds the lift", () => {
  const lift = (d, lvl, path, t) =>
    spriteDraws(d, lvl, path, t, sheets[d.id]).some((r) => /^LiftPlatform/.test(r.anim));
  const at = (d, lv, pid, x1, y1) => {
    const l = d.levels.find((l) => l.short === lv);
    const p = l.paths.find((p) => p.id === pid);
    return lift(
      d,
      l,
      p,
      p.tlvs.find((t) => t.name === "LiftPoint" && t.x1 === x1 && t.y1 === y1),
    );
  };
  // Mine Run lists its upper start point first, and the game's lift stands there
  assert.deepEqual(
    [at(data.AO, "D1", 7, 6522, 1179), at(data.AO, "D1", 7, 6523, 1259)],
    [true, false],
  );
  assert.deepEqual(
    [at(data.AE, "BA", 5, 3900, 900), at(data.AE, "BA", 5, 3900, 840)],
    [true, false],
  );
  // Exoddus asks the standing lift for the start point's own id, Oddysee does not
  const shaft = (g, lv) => {
    const point = (y1, id) => ({
      name: "LiftPoint",
      x1: 400,
      y1,
      x2: 475,
      y2: y1 + 24,
      fields: { start_point: 1, lift_point_id: id, scale: 0 },
    });
    const path = { id: 1, w: 1, h: 1, cams: [], lines: [], tlvs: [point(300, 1), point(380, 2)] };
    const lvl = data[g].levels.find((l) => l.short === lv);
    return path.tlvs.map((t) => lift(data[g], lvl, path, t));
  };
  assert.deepEqual(shaft("AO", "R1"), [true, false]);
  assert.deepEqual(shaft("AE", "MI"), [true, true]);
  // and no camera of the shipped paths draws two lifts on one shaft
  for (const g of GAMES) {
    const G = data[g].geometry;
    const drawn = new Map();
    for (const { lvl, path, t, r } of allRecords(g)) {
      if (!/^LiftPlatform/.test(r.anim)) continue;
      const k = `${g} ${lvl.short} P${path.id} ${Math.floor(t.x1 / G.worldW)},${Math.floor(t.y1 / G.worldH)}`;
      const xs = drawn.get(k) ?? [];
      assert.ok(!xs.some((x) => Math.abs(x - r.x) < 25), `${k}: a second lift at x ${r.x}`);
      drawn.set(k, [...xs, r.x]);
    }
  }
});

test("pinned placements: each game's first Abe stands on the floor inside his own screen", () => {
  const abeAt = (d, lv, pid) => {
    const l = d.levels.find((l) => l.short === lv);
    const p = l.paths.find((p) => p.id === pid);
    const t = p.tlvs.find((t) => t.name === "AbeStart");
    return [t, spriteDraws(d, l, p, t, sheets[d.id])[0]];
  };
  // Rupture Farms: the rect's top sits above the 120..360 window, the walkway at 314 plus the base offset
  const [aoStart, ao] = abeAt(data.AO, "R1", 15);
  assert.equal(ao.x, aoStart.x1 + 12);
  assert.equal(ao.y, 319);
  // the Mines: the rect's top is the window's own top edge, the floor 200 down
  const [aeStart, ae] = abeAt(data.AE, "MI", 1);
  assert.equal(ae.x, aeStart.x1 + 12);
  assert.equal(ae.y, 1500);
});

// the record a placed object draws, found by its place
function recordAt(g, lv, pid, name, x1, y1) {
  const lvl = data[g].levels.find((l) => l.short === lv);
  const path = lvl.paths.find((p) => p.id === pid);
  const t = path.tlvs.find((o) => o.name === name && o.x1 === x1 && o.y1 === y1);
  return spriteDraws(data[g], lvl, path, t, sheets[g])[0];
}

test("pinned placements: an Exoddus Mudokon stands aside from the ones its camera built first, a full step even on the half plane", () => {
  // the second of MIP01C06's three, chiselling on the half plane
  const r = recordAt("AE", "MI", 1, "Mudokon", 1697, 1340);
  assert.equal(r.anim, "Mudokon_Chisel");
  assert.equal(r.scale, 0.5);
  assert.equal(r.x, 1717); // the middle 1709 snapped to the half grid at 1714, plus the table's 3 unhalved
});

// a minute of the patrol clock, longer than any pause a creature on patrol rolls
const PATROL_MINUTE = 1800;
function xSpan(r, set) {
  let lo = Infinity,
    hi = -Infinity;
  for (let t = 0; t <= PATROL_MINUTE; t++) {
    const { x } = resolveRecord(r, set, t);
    lo = Math.min(lo, x);
    hi = Math.max(hi, x);
  }
  return [lo, hi];
}

test("pinned patrols: a slig with two bounds of a side in reach takes the last, as the engine's scan overwrites", () => {
  // a pair of bounds on each of two screens, all sharing the slig's id
  const r = recordAt("AO", "R2", 9, "Slig", 1503, 753);
  assert.deepEqual(r.cycle.p.zone, { x: 1428, w: 1599 });
  const [lo, hi] = xSpan(r, sheets.AO);
  assert.ok(lo >= 1428 && hi <= 1599, `paces between its bounds: ${lo}..${hi}`);
  assert.ok(hi - lo > 80, `and does pace: ${lo}..${hi}`);
});

test("pinned patrols: a slig's side without a bound reads zero, and only an Oddysee slig with none takes the decomp's hack values", () => {
  const oneSided = recordAt("AO", "R2", 4, "Slig", 2639, 655);
  assert.deepEqual(oneSided.cycle.p.zone, { x: 2605, w: 0 });
  // at an edge whichever way it faces, it turns where it stands
  assert.deepEqual(xSpan(oneSided, sheets.AO), [oneSided.x, oneSided.x]);
  const facings = new Set();
  for (let t = 0; t <= PATROL_MINUTE; t++) facings.add(resolveRecord(oneSided, sheets.AO, t).flip);
  assert.equal(facings.size, 2);
  assert.deepEqual(recordAt("AO", "D1", 8, "Slig", 4649, 311).cycle.p.zone, { x: 12809, w: 6405 });
  assert.deepEqual(recordAt("AE", "MI", 2, "Slig", 1800, 840).cycle.p.zone, { x: 0, w: 0 });
});

test("pinned patrols: an Oddysee slig placed in the void beside its screen stays between its bounds", () => {
  const r = recordAt("AO", "F1", 9, "Slig", 660, 294);
  assert.deepEqual(r.cycle.p.zone, { x: 565, w: 673 });
  const [lo, hi] = xSpan(r, sheets.AO);
  assert.ok(lo >= 565 && hi <= 673 && lo < r.x, `walks between its bounds: ${lo}..${hi}`);
});

test("patrols: a patrolling slig's pen is the zone it walks, wherever both its bounds stand", () => {
  let penned = 0;
  for (const g of GAMES) {
    const geo = data[g].geometry;
    for (const { path, t, r } of allRecords(g)) {
      if (t.name !== "Slig" || !r.cycle?.patrol) continue;
      const where = `${g} Slig@${t.x1},${t.y1}`;
      const { left, right } = sligBounds(t, path, geo, g);
      const pen = patrolZone(t, path, geo, g);
      assert.equal(!!pen, !!left && !!right && right.x1 > left.x1, where);
      if (!pen) continue;
      penned++;
      const { x, w } = r.cycle.p.zone;
      assert.deepEqual([pen.x1, pen.x2], [drawX(x, geo), drawX(w, geo)], where);
    }
  }
  assert.ok(penned > 200, `${penned} penned`);
});

// stranded: ending the minute far from its spawn, after standing longer than
// any pause a shipped field rolls
const STRANDED_FAR = 200;
const STRANDED_STILL = 750;
// the creatures whose walk runs off the end of their line, where the game has
// them fall and the patrols stand them at the edge
const FALLS = new Map([
  ["AO E1 P6 Scrab (2551,1260)", "runs right off its floor"],
  ["AO D2 P4 Scrab (2501,299)", "turns at its right bound and walks left off its floor"],
  ["AO D2 P4 Scrab (4526,1242)", "turns at its right bound and walks left off its floor"],
  ["AE SV P2 Scrab (53,550)", "runs right off its floor, with no bound before the edge"],
  ["AE BA P5 MovingBomb (3101,2261)", "rides off the end of its track"],
]);

test("patrols: no creature on patrol is left stranded far from its spawn, but for the falls at a line's end", () => {
  const stranded = [];
  for (const g of GAMES)
    for (const { lvl, path, t, r } of allRecords(g)) {
      if (!r.cycle?.patrol) continue;
      let end = null,
        moved = 0;
      for (let tick = 0; tick <= PATROL_MINUTE; tick++) {
        const s = resolveRecord(r, sheets[g], tick);
        if (!s) continue; // a brain may hide its record for a spell
        if (end && (s.x !== end.x || s.y !== end.y)) moved = tick;
        end = s;
      }
      const far = Math.hypot(end.x - r.x, end.y - r.y) > STRANDED_FAR;
      if (far && PATROL_MINUTE - moved >= STRANDED_STILL)
        stranded.push(`${g} ${lvl.short} P${path.id} ${t.name} (${t.x1},${t.y1})`);
    }
  assert.deepEqual(
    stranded.filter((k) => !FALLS.has(k)),
    [],
    "stranded far from their spawn",
  );
  const stale = [...FALLS].filter(([k]) => !stranded.includes(k));
  assert.deepEqual(stale, [], "a listed fall no longer strands its creature");
});
