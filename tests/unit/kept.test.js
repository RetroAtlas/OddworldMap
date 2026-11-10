import { test } from "node:test";
import assert from "node:assert/strict";
import { CATS, KEPT_UNSEEN, PENS, catOf } from "../../public/js/config.js";
import { connections, drawnAs, kept, resetKept } from "../../public/js/kept.js";
import { spriteTypes } from "../../public/js/rules/sprites.js";
import { state } from "../../public/js/data/state.js";
import { at, dataset, level, path, tlv } from "./fixtures.js";

// one Exoddus path of two screens, standing as the live one; the data's id names
// the game whose rules and wiring table are read
const CAMS = [
  { cell: 0, name: "MIP15C01" },
  { cell: 1, name: "MIP15C02" },
];
function stand(tlvs, show = {}) {
  const P = path(15, tlvs, CAMS, 2, 1);
  const G = { ...dataset([level("MI", P)]), id: "AE" };
  state.data = G;
  state.lvl = G.levels[0];
  state.path = P;
  state.show = { objects: true, markers: false, conn: false, wires: false, ...show };
  state.edit = false;
  return P;
}
// a flag set for the call and put back after it
function withOn(flag, on, fn) {
  const was = flag.on;
  flag.on = on;
  try {
    return fn();
  } finally {
    flag.on = was;
  }
}
const cat = (key) => CATS.find((c) => c.key === key);
const door = (x, extra) => at(tlv("Door", extra), x, 20);
const wired = (name, switch_id) => ({ ...tlv(name), fields: { switch_id } });
const RULED = spriteTypes("AE").find((name) => catOf({ name }).on);
const ART = { failed: false, drawn: true, lost: () => false };

test("kept: a type in KEPT_UNSEEN is kept", () => {
  const stone = tlv("HandStone"),
    slig = tlv("Slig");
  stand([stone, slig]);
  assert.ok(KEPT_UNSEEN.includes(stone.name));
  assert.equal(kept(stone), true);
  assert.equal(kept(slig), false);
});

test("kept: a trusted destination keeps its object, an untrusted one does not", () => {
  const out = door(50, { to_level: "MI", to_path: 16, to_cam: 1 });
  const lost = door(450, { to_level: "ZZ", to_path: 3, to_cam: 1, "door#": 1, "target_door#": 1 });
  stand([out, lost]);
  assert.equal(kept(out), true);
  assert.equal(kept(lost), false);
});

test("kept: with the arrows on, a connection's far end is kept while its source's category is on", () => {
  const a = door(50, { to_level: "MI", to_path: 15, to_cam: 2, "door#": 1, "target_door#": 2 });
  const b = door(450, { "door#": 2 });
  stand([a, b]);
  assert.equal(kept(b), false);
  state.show.conn = true;
  assert.deepEqual(connections(state.data, state.lvl, state.path), [
    { src: a, dst: b, twoWay: false },
  ]);
  assert.equal(kept(b), true);
  assert.equal(
    withOn(cat("door"), false, () => kept(b)),
    false,
  );
});

test("kept: with the wiring on, both ends of a wire whose markers show are kept", () => {
  const lever = wired("Lever", 5),
    gate = wired("Door", 5);
  stand([lever, gate]);
  assert.deepEqual([kept(lever), kept(gate)], [false, false]);
  state.show.wires = true;
  assert.deepEqual([kept(lever), kept(gate)], [true, true]);
  assert.deepEqual(
    withOn(cat("switch"), false, () => [kept(lever), kept(gate)]),
    [false, false],
  );
});

test("kept: the set is cached by path, the two toggles and the filters, and resetKept empties it", () => {
  const nav = cat("nav");
  const navWas = nav.on,
    pensWas = PENS.on;
  const P = stand([tlv("Slig")]);
  assert.ok(KEPT_UNSEEN.length >= 6);
  const [s1, s2, s3, s4, s5, s6] = KEPT_UNSEEN.map((name) => tlv(name));
  // a stone added to the path after its set was built: kept only once the set is rebuilt
  const arrives = (s) => (P.tlvs.push(s), kept(s));
  try {
    assert.equal(kept(P.tlvs[0]), false);
    assert.equal(arrives(s1), false);
    state.show.conn = true;
    assert.equal(kept(s1), true);
    assert.equal(arrives(s2), false);
    state.show.wires = true;
    assert.equal(kept(s2), true);
    assert.equal(arrives(s3), false);
    nav.on = !navWas;
    assert.equal(kept(s3), true);
    assert.equal(arrives(s4), false);
    PENS.on = !pensWas;
    assert.equal(kept(s4), true);
    assert.equal(arrives(s5), false);
    state.path = { ...P };
    assert.equal(kept(s5), true);
    assert.equal(arrives(s6), false);
    const a = door(50, { to_level: "MI", to_path: 15, to_cam: 2, "door#": 1, "target_door#": 2 });
    const b = door(450, { "door#": 2 });
    P.tlvs.push(a, b);
    assert.deepEqual(connections(state.data, state.lvl, state.path), []);
    resetKept();
    assert.equal(kept(s6), true);
    assert.deepEqual(connections(state.data, state.lvl, state.path), [
      { src: a, dst: b, twoWay: false },
    ]);
  } finally {
    nav.on = navWas;
    PENS.on = pensWas;
  }
});

test("drawnAs: a type whose marker is not shown is null", () => {
  const hoist = tlv("Hoist");
  stand([hoist]);
  assert.equal(catOf(hoist).on, false);
  assert.equal(drawnAs(hoist, new Map([[hoist, [{}]]]), ART), null);
  state.show.markers = true;
  state.show.objects = false;
  assert.equal(drawnAs(hoist, null, ART), null);
});

test("drawnAs: a barrier post with the pens on is a marker", () => {
  const post = tlv("SligBoundLeft");
  stand([post]);
  assert.equal(
    withOn(PENS, true, () => drawnAs(post, new Map(), ART)),
    "marker",
  );
  assert.equal(drawnAs(post, new Map(), ART), null);
});

test("drawnAs: with the objects off, a shown type is a marker", () => {
  const ruled = tlv(RULED),
    plain = tlv("ContinuePoint");
  stand([ruled, plain], { objects: false });
  assert.equal(drawnAs(ruled, null, ART), "marker");
  assert.equal(drawnAs(plain, null, ART), "marker");
});

test("drawnAs: a ruled type with no sprites is a marker once the sidecar failed and null while it is coming", () => {
  const t = tlv(RULED);
  stand([t]);
  assert.equal(drawnAs(t, null, { ...ART, failed: true }), "marker");
  assert.equal(drawnAs(t, null, { ...ART, failed: false }), null);
});

test("drawnAs: a ruled type absent from the sprites is a marker with the markers or the mode on, unseen otherwise", () => {
  const t = tlv(RULED);
  stand([t]);
  const none = new Map();
  assert.equal(drawnAs(t, none, ART), "unseen");
  state.show.markers = true;
  assert.equal(drawnAs(t, none, ART), "marker");
  state.show.markers = false;
  state.edit = true;
  assert.equal(drawnAs(t, none, ART), "marker");
});

test("drawnAs: a ruled type present before the sprites have drawn is a marker in the mode, unseen outside it", () => {
  const t = tlv(RULED);
  stand([t]);
  const sprites = new Map([[t, [{}]]]);
  const coming = { ...ART, drawn: false };
  assert.equal(drawnAs(t, sprites, coming), "unseen");
  state.show.markers = true;
  assert.equal(drawnAs(t, sprites, coming), "unseen");
  state.edit = true;
  assert.equal(drawnAs(t, sprites, coming), "marker");
});

test("drawnAs: a ruled type whose record lost its sheet is a marker, one whose did not a sprite", () => {
  const whole = tlv(RULED),
    torn = tlv(RULED);
  stand([whole, torn]);
  const lost = {};
  const sprites = new Map([
    [whole, [{}, {}]],
    [torn, [{}, lost]],
  ]);
  const art = { ...ART, lost: (r) => r === lost };
  assert.equal(drawnAs(whole, sprites, art), "sprite");
  assert.equal(drawnAs(torn, sprites, art), "marker");
});

test("drawnAs: an unruled type is a marker with the markers or the mode on, else unseen when kept and null when not", () => {
  const stone = tlv("HandStone"),
    point = tlv("ContinuePoint");
  for (const t of [stone, point]) assert.ok(!spriteTypes("AE").includes(t.name), t.name);
  stand([stone, point]);
  assert.equal(drawnAs(stone, new Map(), ART), "unseen");
  assert.equal(drawnAs(point, new Map(), ART), null);
  state.show.markers = true;
  assert.equal(drawnAs(stone, new Map(), ART), "marker");
  assert.equal(drawnAs(point, new Map(), ART), "marker");
  state.show.markers = false;
  state.edit = true;
  assert.equal(drawnAs(point, new Map(), ART), "marker");
});
