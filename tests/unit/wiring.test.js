import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { computeWiring, levelWiring, wireEnds } from "../../public/js/model.js";
import { WIRES } from "../../public/js/config.js";

const load = (name) =>
  JSON.parse(readFileSync(new URL(`../../public/${name}`, import.meta.url), "utf8"));

const tlv = (name, fields) => ({ name, fields, x1: 0, y1: 0, x2: 10, y2: 10 });
const path = (...tlvs) => ({ id: 1, tlvs });

test("an id wires every producer to every consumer, except itself", () => {
  const lever = tlv("Lever", { switch_id: 5 });
  const doors = [tlv("Door", { switch_id: 5 }), tlv("Door", { switch_id: 5 })];
  const { edges } = computeWiring(path(lever, ...doors), "AE");
  assert.deepEqual(
    edges.map((e) => [e.src, e.dst]),
    doors.map((d) => [lever, d]),
  );
  // a gate feeding one of its own inputs never wires to itself
  const syncer = tlv("WheelSyncer", { output_switch_id: 7, input_switch_id_1: 7 });
  assert.equal(computeWiring(path(syncer), "AE").edges.length, 0);
});

test("ids the engine cannot fire draw no wire: 0, 1, and past the 256-slot array", () => {
  for (const id of [0, 1, 256, 1026]) {
    const p = path(tlv("Lever", { switch_id: id }), tlv("Door", { switch_id: id }));
    assert.equal(computeWiring(p, "AE").edges.length, 0);
  }
});

test("a pair sharing several ids draws one edge", () => {
  const trigger = tlv("TimerTrigger", { output_switch_id_1: 5, output_switch_id_2: 6 });
  const multi = tlv("MultiSwitchController", { input_switch_id_1: 5, input_switch_id_2: 6 });
  assert.equal(computeWiring(path(trigger, multi), "AE").edges.length, 1);
});

test("hub ids are inputs and the door's own id an output on gate doors alone", () => {
  const fields = { switch_id: 4, hub_1_id: 3, start_state: 2, door_type: 2 };
  for (const [game, gate] of [
    ["AO", { start_state: 2 }],
    ["AE", { door_type: 2 }],
    ["AE", { door_type: 3 }],
  ]) {
    // the gate rewrites the door's own id every frame, so it is an output
    // alone — an external feed could never hold it
    const door = tlv("Door", { ...fields, start_state: 0, door_type: 0, ...gate });
    assert.deepEqual(wireEnds(door, game), { out: [4], in: [3] });
    const plain = tlv("Door", { ...fields, start_state: 0, door_type: 0 });
    assert.deepEqual(wireEnds(plain, game), { out: [], in: [4] });
  }
});

// computeWiring skips the whole table for gate doors, so Door's entry must
// stay exactly the one field that branch supersedes — a second Door field
// would be silently dropped on every gate door
test("the Door table holds only the field the gate branch supersedes", () => {
  for (const game of ["AO", "AE"]) {
    assert.deepEqual(WIRES[game].in.Door, ["switch_id"]);
    assert.equal(WIRES[game].out.Door, undefined);
  }
});

test("wiring is memoized by path identity", () => {
  const p = path(tlv("Lever", { switch_id: 5 }), tlv("Door", { switch_id: 5 }));
  assert.equal(computeWiring(p, "AE"), computeWiring(p, "AE"));
});

test("a game the tables do not name is refused, never read as a game without wires", () => {
  const p = path(tlv("Lever", { switch_id: 5 }), tlv("Door", { switch_id: 5 }));
  for (const game of [undefined, "XX"]) {
    assert.throws(() => computeWiring(p, game), /not a game this table names/);
    assert.throws(() => wireEnds(p.tlvs[0], game), /not a game this table names/);
    assert.throws(() => levelWiring({ paths: [p] }, game), /not a game this table names/);
  }
});

test("level wiring skips demo paths", () => {
  const lvl = {
    paths: [
      { id: 1, tlvs: [tlv("Lever", { switch_id: 5 })] },
      { id: 2, tlvs: [tlv("Door", { switch_id: 5 }), tlv("DemoSpawnPoint", {})] },
    ],
  };
  const w = levelWiring(lvl, "AE");
  assert.deepEqual([...w.prod.get(5)], [1]);
  assert.equal(w.cons.get(5), undefined);
});

for (const [file, game] of [
  ["map_data_ao.json", "AO"],
  ["map_data_ae.json", "AE"],
]) {
  test(`${game}: every WIRES key names a field the shipped data carries`, () => {
    const data = load(file);
    const carried = new Map();
    for (const L of data.levels)
      for (const P of L.paths)
        for (const t of P.tlvs) {
          let set = carried.get(t.name);
          if (!set) carried.set(t.name, (set = new Set()));
          for (const k of Object.keys(t.fields || {})) set.add(k);
        }
    for (const role of ["out", "in"])
      for (const [type, fields] of Object.entries(WIRES[game][role]))
        for (const f of fields)
          assert.ok(carried.get(type)?.has(f), `${game} ${role} ${type}.${f} exists in the data`);
  });
}

// totals over the shipped data, pinned: a table edit that changes the graph
// has to answer for the difference
test("shipped wiring totals", () => {
  const expect = { AO: [364, 64, 74], AE: [2380, 105, 117] };
  for (const [file, game] of [
    ["map_data_ao.json", "AO"],
    ["map_data_ae.json", "AE"],
  ]) {
    let edges = 0,
      wired = 0,
      paths = 0;
    for (const L of load(file).levels)
      for (const P of L.paths) {
        const n = computeWiring(P, game).edges.length;
        edges += n;
        paths++;
        if (n) wired++;
      }
    assert.deepEqual([edges, wired, paths], expect[game], `${game} totals`);
  }
});

test("a known circuit: the Mines' first lever fans out to twelve", () => {
  const mi1 = load("map_data_ae.json")
    .levels.find((L) => L.short === "MI")
    .paths.find((P) => P.id === 1);
  const lever = mi1.tlvs.find((t) => t.name === "Lever" && t.fields?.switch_id === 66);
  const { edges } = computeWiring(mi1, "AE");
  assert.equal(edges.filter((e) => e.src === lever).length, 12);
  // hand stones write their trigger id when used, same as movie stones
  const stone = mi1.tlvs.find((t) => t.name === "HandStone" && t.fields?.trigger_switch_id === 124);
  assert.equal(edges.filter((e) => e.src === stone).length, 1);
});

test("the R2 hub door answers ids set in other paths of the level", () => {
  const r2 = load("map_data_ao.json").levels.find((L) => L.short === "R2");
  const hub = r2.paths
    .find((P) => P.id === 1)
    .tlvs.find((t) => t.name === "Door" && t.fields?.start_state === 2);
  assert.deepEqual(wireEnds(hub, "AO"), { out: [14], in: [11, 12, 13] });
  const { prod } = levelWiring(r2, "AO");
  assert.deepEqual([...prod.get(11)], [2]);
  assert.deepEqual([...prod.get(12)], [10]);
  assert.deepEqual([...prod.get(13)], [3]);
});

test("an AE tasks door reads the same way, its hardwired-1 hub pads filtered", () => {
  const sv = load("map_data_ae.json").levels.find((L) => L.short === "SV");
  const door = sv.paths
    .find((P) => P.id === 12)
    .tlvs.find((t) => t.name === "Door" && t.fields?.door_type === 3);
  // one live hub among eight: seven pads carry the hardwired 1
  assert.deepEqual(wireEnds(door, "AE"), { out: [165], in: [164] });
  assert.deepEqual([...levelWiring(sv, "AE").prod.get(164)], [4]);
});

test("value-1 consumers stay unwired: AE's always-on EnemyStoppers", () => {
  let live = 0;
  for (const L of load("map_data_ae.json").levels)
    for (const P of L.paths)
      for (const list of computeWiring(P, "AE").cons.values())
        live += list.filter((t) => t.name === "EnemyStopper").length;
  assert.equal(live, 6); // 144 of the 150 carry the hardwired 1
});

test("a cross-path note never invents a producer or consumer", () => {
  // BA id 44 is produced in two paths; its only taker is a demo copy, which
  // levelWiring leaves out — so the producers must see no consumer at all
  const ba = load("map_data_ae.json").levels.find((L) => L.short === "BA");
  const w = levelWiring(ba, "AE");
  assert.deepEqual([...w.prod.get(44)].sort(), [15, 7].sort());
  assert.equal(w.cons.get(44), undefined);
});
