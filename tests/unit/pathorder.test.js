import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  entryCell,
  levelOrder,
  orderPaths,
  levelEntry,
  invalidateEntry,
} from "../../public/js/model/pathorder.js";
import { setAnnotations, pathDisplayName } from "../../public/js/model/annotations.js";
import { isDemoPath } from "../../public/js/model/demo.js";
import { camIdOf, destOf, destTrusted, pathIn } from "../../public/js/model/model.js";
import { at, dataset, level, path, tlv } from "./fixtures.js";

const load = (name) =>
  JSON.parse(readFileSync(new URL(`../../public/${name}`, import.meta.url), "utf8"));

// the synthetic paths carry their names on the path the way Oddysee's disc does,
// so nothing here depends on the curated file, and their ways out are plain
// same-level transitions, which name no partner and so are trusted as they lie
const area = (id, name, to = [], opt = {}) => {
  const tlvs = to.map((pa) => tlv("PathTransition", { to_level: "L", to_path: pa }));
  if (opt.out) tlvs.push(tlv("PathTransition", { to_level: "OUT", to_path: 1 }));
  if (opt.start) tlvs.unshift(tlv("AbeStart"));
  return {
    ...path(id, tlvs),
    ...(name && { name }),
    ...(opt.section && { section: opt.section }),
  };
};
const order = (...paths) => {
  const L = level("L", ...paths);
  return levelOrder(dataset([L, level("OUT", path(1, []))]), L);
};

test("the way in leads, and the chain follows it however the disc stores it", () => {
  // Stock Yards' shape: the entrance is stored last and leads back to the head
  const ids = order(
    area(1, "Free-Fire Zone", [2, 6]),
    area(2, "Free-Fire Zone II", [1, 3]),
    area(3, "Free-Fire Zone III", [2, 4]),
    area(4, "Free-Fire Zone IV", [3]),
    area(6, "Stockyards Entrance", [1], { start: true }),
  );
  assert.deepEqual(ids, [6, 1, 2, 3, 4]);
});

test("a hub follows the way in, and nothing but their ids orders its spokes", () => {
  // the Paramonian Temple: six trials off one room, in no order the game states
  const ids = order(
    area(1, "Temple Entrance", [8], { start: true }),
    area(2, "Trial of the Rolling Boulder", [8]),
    area(5, "Trial of the Falling Boulder", [8]),
    area(8, "The Trials", [6, 2, 5]),
    area(6, "Trial of the No Boulder", [8]),
  );
  assert.deepEqual(ids, [1, 8, 2, 5, 6]);
});

test("an area is walked whole before the walk leaves it", () => {
  // Rupture Farms Return's shape: the way on out of Zulag 1 sits three rooms in
  const ids = order(
    area(19, "Zulag 1", [18, 20], { start: true }),
    area(20, "Zulag 1", [19]),
    area(18, "Zulag 1", [16, 19, 1]),
    area(16, "Zulag 1", [15, 18]),
    area(15, "Zulag 1", [16, 18]),
    area(1, "Zulag 2", [18]),
  );
  assert.deepEqual(ids, [19, 20, 18, 16, 15, 1]);
});

test("inside an area, a room you can only come back from goes first", () => {
  // Zulag 1's Boom Machine room hangs off the arrival screen beside the corridor
  // on; Zulag 4's exit hangs off its own beside the room that unlocks it, and
  // carries on out of the level, so it waits
  const zulag1 = order(
    area(19, "Zulag 1", [18, 20], { start: true }),
    area(18, "Zulag 1", [19, 16]),
    area(16, "Zulag 1", [18]),
    area(20, "Zulag 1", [19]),
  );
  assert.deepEqual(zulag1, [19, 20, 18, 16]);
  const zulag4 = order(
    area(14, "Zulag 4", [4, 11], { start: true }),
    area(4, "Zulag 4", [14, 8]),
    area(8, "Zulag 4", [4]),
    area(11, "Zulag 4", [14], { out: true }),
  );
  assert.deepEqual(zulag4, [14, 4, 8, 11]);
});

test("the branch whose number comes soonest goes first", () => {
  // the Brewery: hub 2 is numbered lower than the zulags hub 1 serves, and the
  // level counts itself in zulags, so it waits for all five of them
  const brewery = order(
    area(16, "Brewery Terminal", [23], { start: true }),
    area(23, "Hub 1", [14, 1, 24]),
    area(24, "Hub 2", [6, 23]),
    area(1, "Zulag 1", [23]),
    area(14, "Zulag 5", [23]),
    area(6, "Zulag 6", [24]),
  );
  assert.deepEqual(brewery, [16, 23, 1, 14, 24, 6]);
  // FeeCo: the corridor is numbered nothing at all and still goes before the
  // terminal beside it, because terminal 3 is behind it
  const feeco = order(
    area(1, "Terminal 1", [2], { start: true }),
    area(2, "Main Lobby", [9, 5]),
    area(9, "Path to the Terminals", [3, 2]),
    area(3, "Terminal 3", [9]),
    area(5, "Terminal 5", [2]),
  );
  assert.deepEqual(feeco, [1, 2, 9, 3, 5]);
});

test("a branch that reaches none of the numbers is a pocket, looked into first", () => {
  // the Mudomo Vault: its third room is a dead end off its second, and the bird
  // portal beside that dead end's door is what opens the six trials
  const ids = order(
    area(1, "Mudomo Vaults", [7], { start: true }),
    area(7, "Mudomo Vaults II", [10, 8]),
    area(8, "Mudomo Vaults Hub", [9, 11]),
    area(9, "Trial 1", [8]),
    area(10, "Mudomo Vaults III", [7]),
    area(11, "Trial 2", [8]),
  );
  assert.deepEqual(ids, [1, 7, 10, 8, 9, 11]);
});

test("a sub-area and a copy of an area are walked inside it", () => {
  const ids = order(
    area(1, "Tunnel 1", [7, 2], { start: true }),
    area(7, "Tunnel 1: Secret Area", [1]),
    area(8, "[Demo] Tunnel 1: Mudokons", [1]),
    area(2, "Tunnel 2", [1]),
  );
  assert.deepEqual(ids, [1, 7, 8, 2]);
});

test("an area nothing travels to still counts in its run", () => {
  const ids = order(
    area(1, "Tunnel 1", [2], { start: true }),
    area(4, "Tunnels 3-5", [5]),
    area(11, "[Demo] Tunnel 5: Blind Mudokons"),
    area(5, "Tunnel 6", [4]),
    area(2, "Tunnel 2", [4, 1]),
  );
  assert.deepEqual(ids, [1, 2, 4, 11, 5]);
});

test("an ender half sits at the tail, whenever the walk met it", () => {
  // Bonewerkz' shape: the office is reached through the ender's own approach,
  // and is the one path the tail move lists ahead of what reaches it
  const ids = order(
    area(1, "Annex 1", [14], { start: true }),
    area(14, "Executive Office Approach", [9], { section: "Bonewerkz Ender" }),
    area(9, "Executive Office", []),
  );
  assert.deepEqual(ids, [1, 9, 14]);
});

test("a hand stone's view is a sight, not a way through", () => {
  // an AO stone carries a whole level/path/camera triple and names no partner, so
  // destTrusted believes it wherever it points: unguarded, the sight would make
  // the room it shows reachable, and a pocket at that
  const seen = order(
    {
      ...area(1, "Entrance", [2], { start: true }),
      tlvs: [
        tlv("AbeStart"),
        tlv("PathTransition", { to_level: "L", to_path: 2 }),
        tlv("HandStone", { view1_level: "L", view1_path: 9, view1_cam: 1 }),
      ],
    },
    area(2, "Zulag 1", [1]),
    area(9, "Secret Room"),
  );
  assert.deepEqual(seen, [1, 2, 9]);
});

test("an area nothing travels to never lands ahead of the way in", () => {
  // Bonewerkz opens on Entrance and Annex 2, so an unreached Annex 1 would slot
  // in front of the level's own way in if the run had no floor
  const ids = order(
    area(1, "Entrance and Annex 2", [2], { start: true }),
    area(2, "Annexes 3-6", [1]),
    area(7, "Annex 1"),
  );
  assert.deepEqual(ids, [1, 7, 2]);
});

test("what the walk misses inside an area: parent, sub-area, then copy", () => {
  const ids = order(
    area(1, "Zulag 4", [], { start: true }),
    area(2, "[Demo] Zulag 4", []),
    area(3, "Zulag 4: Tear X-Tractor", []),
  );
  assert.deepEqual(ids, [1, 3, 2]);
});

test("an unnamed path is an area of its own, walked in its place", () => {
  const ids = order(
    area(1, "Zulag 1", [3], { start: true }),
    area(3, null, [2]),
    area(2, "Zulag 2", [3]),
  );
  assert.deepEqual(ids, [1, 3, 2]);
});

test("orderPaths permutes what it is handed and leaves the array alone", () => {
  const L = level(
    "L",
    area(1, "Zulag 1", [2], { start: true }),
    area(2, "Zulag 2", [1, 3]),
    area(3, "Zulag 3", [2]),
  );
  const data = dataset([L]);
  const some = [L.paths[2], L.paths[0]];
  assert.deepEqual(
    orderPaths(data, L, some).map((P) => P.id),
    [1, 3],
  );
  assert.deepEqual(
    L.paths.map((P) => P.id),
    [1, 2, 3],
  );
  assert.deepEqual(
    some.map((P) => P.id),
    [3, 1],
  );
});

// ---- levelEntry -----------------------------------------------------------

const goesTo = (lv, pa) => tlv("PathTransition", { to_level: lv, to_path: pa });

test("levelEntry: the way in from an earlier level beats a start marker elsewhere", () => {
  // Bonewerkz' shape: its AbeStart sits deep in Annex 8
  const data = dataset([
    level("A", path(1, [goesTo("B", 1)])),
    level("B", path(1, []), path(4, [tlv("AbeStart")])),
  ]);
  assert.equal(levelEntry(data).B, 1);
});

test("levelEntry: a start marker beats a later level's door back in", () => {
  // Rupture Farms Return's shape: the Board Room comes back through P11
  const data = dataset([
    level("B", path(11, []), path(19, [tlv("AbeStart")])),
    level("C", path(6, [goesTo("B", 11)])),
  ]);
  assert.equal(levelEntry(data).B, 19);
});

test("levelEntry: a later level's arrival wins where nothing else speaks", () => {
  const data = dataset([
    level("B", path(11, []), path(19, [])),
    level("C", path(6, [goesTo("B", 11)])),
  ]);
  assert.equal(levelEntry(data).B, 11);
});

test("levelEntry: with nothing to go on, the path the game stores first", () => {
  const data = dataset([level("CR", path(5, []), path(2, []))]);
  assert.equal(levelEntry(data).CR, 5);
});

test("levelEntry: neither an untrusted destination nor a hand stone's view elects", () => {
  const doorTo = (lv, pa) =>
    tlv("Door", { to_level: lv, to_path: pa, to_cam: 1, "target_door#": 7 });
  const data = dataset([
    level(
      "A",
      path(1, [
        doorTo("B", 4),
        tlv("HandStone", { view1_level: "B", view1_path: 4, view1_cam: 1 }),
      ]),
    ),
    level("B", path(1, []), path(4, [])),
  ]);
  assert.equal(levelEntry(data).B, 1); // no Door answers to door# 7 over there
});

// ---- the shipped data -----------------------------------------------------

setAnnotations(load("annotations.json"));
const GAMES = [
  ["AO", load("map_data_ao.json")],
  ["AE", load("map_data_ae.json")],
];

// every level's way in. Cross-checked against the decomp's own level-select
// tables (AliveLibAO sLevelList_4D0300, AliveLibAE gPerLvlData_561700), which
// agree on every level either of them names
const ENTRY = {
  AO: { R1: 15, E1: 6, L1: 1, F1: 1, F2: 1, F4: 9, D1: 1, D2: 1, D7: 11, E2: 4, R2: 19, R6: 6, C1: 1, S1: 1 }, // prettier-ignore
  AE: { MI: 1, NE: 2, PV: 1, SV: 6, FD: 1, BA: 1, BW: 1, BR: 16, BM: 1, CR: 1, ST: 1 },
};

// every level the walk lists in an order the discs do not. The rest are chains
// the games happen to store in the order you walk them, Paramonia and Scrabania
// among them, and they come back exactly as they ship
const WALKED = {
  AO: {
    E1: [6, 1, 2, 3, 4],
    F2: [1, 8, 2, 3, 4, 5, 6, 7],
    D2: [1, 10, 2, 3, 4, 5, 6, 7, 8, 9],
    E2: [4, 3, 2],
    R2: [19, 20, 18, 16, 15, 1, 2, 3, 10, 13, 5, 7, 12, 9, 14, 4, 8, 11],
  },
  AE: {
    MI: [1, 7, 8, 2, 9, 3, 4, 11, 5, 12, 10, 6],
    NE: [2, 3, 1, 6, 7, 4, 5],
    PV: [1, 2, 7, 6, 10, 8, 9, 11, 12, 15, 3, 14, 4, 5, 13],
    SV: [6, 13, 7, 2, 5, 3, 8, 4, 12, 1, 9, 14, 10, 11],
    FD: [1, 6, 7, 12, 2, 9, 3, 4, 8, 5, 10, 11, 14, 13],
    BA: [1, 13, 2, 10, 5, 3, 7, 15, 4, 9, 14, 11, 16],
    BW: [1, 7, 2, 3, 4, 11, 9, 14, 12, 13],
    BR: [16, 23, 1, 7, 2, 8, 12, 18, 19, 28, 14, 24, 5, 13, 6, 3, 17, 21, 10, 26, 25, 9, 11, 27, 20, 15, 29, 4], // prettier-ignore
  },
};

const nameIn = (id, L, P) => pathDisplayName(id, L.short, P) || "";

for (const [id, data] of GAMES) {
  test(`${id}: every level's elected entrance`, () => {
    assert.deepEqual(levelEntry(data), ENTRY[id]);
  });

  test(`${id}: every level's whole order`, () => {
    for (const L of data.levels) {
      const want = WALKED[id][L.short] ?? L.paths.map((P) => P.id);
      assert.deepEqual(levelOrder(data, L), want, L.short);
    }
    const walked = data.levels
      .filter((L) => String(levelOrder(data, L)) !== String(L.paths.map((P) => P.id)))
      .map((L) => L.short);
    assert.deepEqual(walked, Object.keys(WALKED[id]));
  });

  test(`${id}: every level lists its own paths once each, opening on its way in`, () => {
    for (const L of data.levels) {
      const out = levelOrder(data, L);
      assert.deepEqual([...out].sort((a, b) => a - b), L.paths.map((P) => P.id).sort((a, b) => a - b), `${L.short} is a permutation`); // prettier-ignore
      assert.equal(new Set(out).size, out.length, `${L.short} lists each path once`);
      assert.equal(out[0], ENTRY[id][L.short], `${L.short} opens on its way in`);
    }
  });

  test(`${id}: no path is listed before everything that reaches it`, () => {
    const early = [];
    for (const L of data.levels) {
      const into = new Map(L.paths.map((P) => [P.id, new Set()]));
      for (const P of L.paths)
        for (const t of P.tlvs) {
          if ((t.extra || {}).view1_cam != null) continue;
          const d = destOf(t, data, L, P);
          if (!d || d.lv !== L.short || d.pa === P.id) continue;
          if (pathIn(data, d.lv, d.pa) && destTrusted(d, data, L)) into.get(d.pa).add(P.id);
        }
      const at = new Map(levelOrder(data, L).map((pid, i) => [pid, i]));
      for (const [pid, from] of into)
        if (pid !== ENTRY[id][L.short] && from.size)
          if (![...from].some((s) => at.get(s) < at.get(pid))) early.push(`${L.short} P${pid}`);
    }
    // the ender tail is the one thing that outranks the walk, and Bonewerkz'
    // office is the only path it lists ahead of the approach that reaches it
    assert.deepEqual(early, id === "AE" ? ["BW P9"] : []);
  });

  test(`${id}: a run never descends once the level is under way`, () => {
    // derived independently of the module: the word before a name's first number.
    // The way in is exempt because it leads whatever it is numbered, which is
    // Bonewerkz opening on Entrance and Annex 2 ahead of Annex 1
    const run = (name) => {
      const bare = name.replace(/^\[Demo\] /, "").split(":")[0];
      const m = /^(.*?)(\d+)/.exec(bare);
      return m ? [m[1].trim().split(/\s+/).pop().toLowerCase().replace(/e?s$/, ""), +m[2]] : null;
    };
    for (const L of data.levels) {
      const seen = new Map();
      for (const pid of levelOrder(data, L).slice(1)) {
        const P = L.paths.find((p) => p.id === pid);
        const r = run(nameIn(id, L, P));
        if (!r) continue;
        const [stem, num] = r;
        const was = seen.get(stem);
        assert.ok(was == null || num >= was, `${L.short} P${P.id}: ${stem} ${num} after ${was}`);
        seen.set(stem, num);
      }
    }
  });

  test(`${id}: every area's paths sit together`, () => {
    // derived independently of the module: the name with the demo mark and
    // anything after a colon dropped, an unnamed path an area of its own
    const key = (L, P) => {
      const raw = nameIn(id, L, P);
      if (!raw) return `#${P.id}`;
      const bare = raw
        .replace(/^\[Demo\] /, "")
        .split(":")[0]
        .trim();
      return `${P.section || ""}|${bare}`;
    };
    for (const L of data.levels) {
      const byId = new Map(L.paths.map((P) => [P.id, P]));
      const runs = levelOrder(data, L).map((pid) => key(L, byId.get(pid)));
      const spans = new Map();
      runs.forEach((k, i) => {
        const at = spans.get(k);
        if (at == null) spans.set(k, i);
        else assert.equal(at, i - 1, `${L.short}: ${k} is split apart`);
        spans.set(k, i);
      });
    }
  });

  test(`${id}: no unsectioned path follows a sectioned one`, () => {
    for (const L of data.levels) {
      let sectioned = false;
      for (const pid of levelOrder(data, L)) {
        const P = L.paths.find((p) => p.id === pid);
        if (P.section) sectioned = true;
        else assert.equal(sectioned, false, `${L.short} P${P.id} follows a section`);
      }
    }
  });

  test(`${id}: no level opens on a demo copy`, () => {
    for (const L of data.levels) {
      const first = L.paths.find((P) => P.id === levelOrder(data, L)[0]);
      assert.equal(isDemoPath(first), false, `${L.short}`);
    }
  });
}

test("a dataset whose transitions changed recomputes its elections and every walk seeded from them", () => {
  // level M's way in is elected from a door in level L; the door moves, M's own
  // object is untouched, and only an explicit invalidation can reseed its walk
  const enter = (pa) => ({
    ...path(1, [tlv("PathTransition", { to_level: "M", to_path: pa })]),
    name: "Way",
  });
  const M = level("M", area(3, "Room A", [5]), area(5, "Room B", [3]));
  const data = dataset([level("L", enter(5)), M]);
  assert.equal(levelEntry(data).M, 5);
  assert.deepEqual(levelOrder(data, M), [5, 3]);
  data.levels[0] = level("L", enter(3));
  assert.equal(levelEntry(data).M, 5); // memoized
  invalidateEntry(data);
  assert.equal(levelEntry(data).M, 3);
  assert.deepEqual(levelOrder(data, M), [3, 5]);
});

// ---- the screen a path is entered on ---------------------------------------

// a 3x1 path of three screens numbered against their cells, so the lowest
// number is never the first cell; SYNTH_GEOMETRY cells are 400 world units wide
const cams = (id) => [
  { cell: 0, name: `LP${id}C03` },
  { cell: 1, name: `LP${id}C01` },
  { cell: 2, name: `LP${id}C02` },
];
const room = (id, tlvs) => path(id, tlvs, cams(id), 3, 1);
const inCell = (t, cell) => at(t, cell * 400 + 60, 40);
// a door into path `pa`, landing on the door numbered `n` in camera `ca` there
const doorTo = (pa, ca, n) =>
  tlv("Door", { to_level: "L", to_path: pa, to_cam: ca, "door#": 90 + n, "target_door#": n });
const door = (n, cell) => inCell(tlv("Door", { "door#": n }), cell);
const cellOf = (levels, P) => entryCell(dataset(levels), P);

test("a path is entered where the first path before it to lead in lands", () => {
  const P2 = room(2, [door(7, 2)]);
  const L = level("L", room(1, [tlv("AbeStart"), doorTo(2, 2, 7)]), P2);
  assert.equal(cellOf([L], P2), 2);
});

test("the way in from the path before it beats a start marker", () => {
  // Annex 8's shape: an AbeStart deep inside a path the walk enters by a door
  const P2 = room(2, [inCell(tlv("AbeStart"), 0), door(7, 2)]);
  const L = level("L", room(1, [tlv("AbeStart"), doorTo(2, 2, 7)]), P2);
  assert.equal(cellOf([L], P2), 2);
});

test("with nothing leading in from before it, a path is entered at its start marker", () => {
  // the opening path's shape: the only way in is the door back from the path after it
  const P1 = room(1, [inCell(tlv("AbeStart"), 2), door(4, 0)]);
  const L = level("L", P1, room(2, [doorTo(1, 3, 4)]));
  assert.equal(cellOf([L], P1), 2);
});

test("a demo copy is entered where its demo starts", () => {
  const P2 = room(2, [inCell(tlv("DemoSpawnPoint"), 0)]);
  const L = level("L", room(1, [tlv("AbeStart")]), P2);
  assert.equal(cellOf([L], P2), 0);
});

test("with no start marker either, where a path listed after it leads in", () => {
  // the Bonewerkz office's shape: reached only from a path the level lists behind it
  const P1 = room(1, [door(4, 2)]);
  const L = level("L", P1, room(2, [doorTo(1, 2, 4)]));
  assert.equal(cellOf([L], P1), 2);
});

test("a path nothing leads into and nothing starts in is entered on its lowest-numbered screen", () => {
  const P1 = room(1, []);
  assert.equal(cellOf([level("L", P1)], P1), 1);
});

test("several ways in from one path: the lowest-numbered screen they land on, however they are stored", () => {
  const ways = [doorTo(2, 3, 7), doorTo(2, 2, 8)];
  for (const stored of [ways, [...ways].reverse()]) {
    const P2 = room(2, [door(7, 0), door(8, 2)]);
    const L = level("L", room(1, [tlv("AbeStart"), ...stored]), P2);
    assert.equal(cellOf([L], P2), 2);
  }
});

test("only the first path to lead in is asked, whatever a later one lands on", () => {
  const P3 = room(3, [door(7, 0), door(8, 1)]);
  const L = level(
    "L",
    room(1, [tlv("AbeStart"), doorTo(2, 1, 1), doorTo(3, 3, 7)]),
    room(2, [door(1, 1), doorTo(3, 1, 8)]),
    P3,
  );
  assert.equal(cellOf([L], P3), 0);
});

test("the first path to lead in is the first in play order, not the first the level stores", () => {
  // stored 2, 1, 3 and walked 1, 2, 3: both lead into 3, onto different screens
  const P3 = room(3, [door(7, 0), door(8, 2)]);
  const L = level(
    "L",
    room(2, [door(1, 1), doorTo(3, 2, 8)]),
    room(1, [tlv("AbeStart"), doorTo(2, 1, 1), doorTo(3, 3, 7)]),
    P3,
  );
  assert.equal(cellOf([L], P3), 0);
});

test("a partner standing in the grid's first cell is where the way in lands", () => {
  const P2 = room(2, [door(7, 0)]);
  const L = level("L", room(1, [tlv("AbeStart"), doorTo(2, 2, 7)]), P2);
  assert.equal(cellOf([L], P2), 0);
});

test("start markers on several screens: the lowest-numbered of them", () => {
  const P1 = room(1, [inCell(tlv("AbeStart"), 2), inCell(tlv("AbeStart"), 1)]);
  assert.equal(cellOf([level("L", P1)], P1), 1);
});

test("a path transition lands on the camera its archive names", () => {
  const P2 = room(2, []);
  const way = { ...tlv("PathTransition", { to_level: "L", to_path: 2 }), fields: { camera: 2 } };
  const L = level("L", room(1, [tlv("AbeStart"), way]), P2);
  assert.equal(cellOf([L], P2), 2);
});

test("a way in landing on no screen the path holds is no way in", () => {
  const P2 = room(2, []);
  const way = { ...tlv("PathTransition", { to_level: "L", to_path: 2 }), fields: { camera: 9 } };
  const L = level("L", room(1, [tlv("AbeStart"), way]), P2);
  assert.equal(cellOf([L], P2), 1);
});

test("a partner found outside the camera its link names is where the way in lands", () => {
  // the follow centres on the partner wherever it is found, and so does this
  const P2 = room(2, [door(7, 2)]);
  const L = level("L", room(1, [tlv("AbeStart"), doorTo(2, 3, 7)]), P2);
  assert.equal(cellOf([L], P2), 2);
});

test("an object standing where the path holds no screen names none", () => {
  // a 3x1 grid with its last cell empty: the marker there falls through to the
  // lowest-numbered screen, and the door there to the camera its link names
  const two = (id, tlvs) => path(id, tlvs, cams(id).slice(0, 2), 3, 1);
  const P1 = two(1, [inCell(tlv("AbeStart"), 2)]);
  assert.equal(cellOf([level("L", P1)], P1), 1);
  const P2 = two(2, [door(7, 2)]);
  const L = level("L", two(1, [tlv("AbeStart"), doorTo(2, 3, 7)]), P2);
  assert.equal(cellOf([L], P2), 0);
});

test("a level's way in is entered from the level before it", () => {
  const P1 = room(1, [inCell(tlv("AbeStart"), 0), door(7, 2)]);
  const way = { ...doorTo(1, 2, 7), extra: { ...doorTo(1, 2, 7).extra, to_level: "M" } };
  const data = dataset([level("L", room(1, [tlv("AbeStart"), way])), level("M", P1)]);
  assert.equal(entryCell(data, P1), 2);
});

test("a demo copy leads nowhere", () => {
  // the copy sits ahead of the path its door names; the real way in is behind it
  const P3 = room(3, [door(7, 0), door(8, 2)]);
  const L = level(
    "L",
    room(1, [tlv("AbeStart"), doorTo(2, 1, 1), doorTo(4, 1, 2)]),
    room(2, [tlv("DemoSpawnPoint"), door(1, 1), doorTo(3, 3, 7)]),
    P3,
    room(4, [door(2, 1), doorTo(3, 2, 8)]),
  );
  assert.equal(cellOf([L], P3), 2);
});

test("an edit's invalidation moves the entrance with the door", () => {
  const P2 = room(2, [door(7, 0), door(8, 2)]);
  const data = dataset([level("L", room(1, [tlv("AbeStart"), doorTo(2, 3, 7)]), P2)]);
  assert.equal(entryCell(data, P2), 0);
  data.levels[0] = level("L", room(1, [tlv("AbeStart"), doorTo(2, 2, 8)]), P2);
  assert.equal(entryCell(data, P2), 0); // memoized
  invalidateEntry(data);
  assert.equal(entryCell(data, P2), 2);
});

// ---- the shipped data -----------------------------------------------------

// the camera every path is entered on, by level and path id: where the way in
// from the path before it lands, or its start marker stands
// prettier-ignore
const ENTERED = {
  AO: {
    R1: { 15: 1, 16: 1, 18: 10, 19: 1, 20: 1 },
    E1: { 1: 1, 2: 1, 3: 1, 4: 1, 6: 6 },
    L1: { 1: 14, 2: 8, 3: 1, 5: 1, 6: 1 },
    F1: { 1: 1, 2: 1, 5: 9, 6: 1, 7: 1, 8: 1, 9: 1 },
    F2: { 1: 1, 2: 6, 3: 1, 4: 9, 5: 1, 6: 1, 7: 1, 8: 1 },
    F4: { 9: 1 },
    D1: { 1: 1, 2: 1, 3: 1, 4: 1, 6: 9, 7: 1, 8: 5, 9: 2 },
    D2: { 1: 1, 2: 1, 3: 1, 4: 1, 5: 1, 6: 3, 7: 6, 8: 2, 9: 1, 10: 1 },
    D7: { 11: 1 },
    E2: { 2: 4, 3: 6, 4: 7 },
    R2: { 1: 4, 2: 1, 3: 1, 4: 1, 5: 1, 7: 1, 8: 1, 9: 1, 10: 1, 11: 1, 12: 1, 13: 5, 14: 5, 15: 8, 16: 7, 18: 4, 19: 3, 20: 1 },
    R6: { 6: 1 },
    C1: { 1: 1 },
    S1: { 1: 1 },
  },
  AE: {
    MI: { 1: 4, 2: 16, 3: 1, 4: 1, 5: 27, 6: 10, 7: 11, 8: 6, 9: 18, 10: 18, 11: 22, 12: 2 },
    NE: { 1: 5, 2: 1, 3: 1, 4: 1, 5: 6, 6: 1, 7: 1 },
    PV: { 1: 1, 2: 13, 3: 1, 4: 1, 5: 1, 6: 8, 7: 6, 8: 1, 9: 1, 10: 1, 11: 1, 12: 1, 13: 1, 14: 10, 15: 6 },
    SV: { 1: 1, 2: 2, 3: 6, 4: 1, 5: 2, 6: 23, 7: 1, 8: 1, 9: 4, 10: 1, 11: 2, 12: 2, 13: 5, 14: 1 },
    FD: { 1: 1, 2: 8, 3: 1, 4: 1, 5: 1, 6: 3, 7: 1, 8: 1, 9: 2, 10: 4, 11: 1, 12: 1, 13: 1, 14: 2 },
    BA: { 1: 3, 2: 1, 3: 9, 4: 6, 5: 1, 7: 7, 9: 4, 10: 1, 11: 5, 13: 14, 14: 2, 15: 1, 16: 2 },
    BW: { 1: 18, 2: 17, 3: 15, 4: 24, 7: 5, 9: 9, 11: 7, 12: 2, 13: 9, 14: 10 },
    BR: { 1: 1, 2: 16, 3: 1, 4: 5, 5: 10, 6: 1, 7: 1, 8: 4, 9: 14, 10: 19, 11: 1, 12: 1, 13: 10, 14: 8, 15: 1, 16: 1, 17: 1, 18: 2, 19: 1, 20: 1, 21: 1, 23: 1, 24: 1, 25: 1, 26: 4, 27: 7, 28: 4, 29: 1 },
    BM: { 1: 1 },
    CR: { 1: 1, 2: 1 },
    ST: { 1: 1 },
  },
};
const cameraOf = (P, cell) => camIdOf(P.cams.find((c) => c.cell === cell)?.name);

for (const [id, data] of GAMES) {
  test(`${id}: every path is entered on a screen it holds`, () => {
    for (const L of data.levels)
      for (const P of L.paths)
        assert.ok(P.cams.some((c) => c.cell === entryCell(data, P)), `${L.short} P${P.id}`); // prettier-ignore
  });

  test(`${id}: the screen every path is entered on`, () => {
    const got = {};
    for (const L of data.levels)
      got[L.short] = Object.fromEntries(
        L.paths.map((P) => [P.id, cameraOf(P, entryCell(data, P))]),
      );
    assert.deepEqual(got, ENTERED[id]);
  });
}

test("AE: Bonewerkz, where each link of the chain decides a path", () => {
  const data = GAMES.find(([id]) => id === "AE")[1];
  const BW = data.levels.find((L) => L.short === "BW");
  const camera = (pa) => {
    const P = BW.paths.find((p) => p.id === pa);
    return cameraOf(P, entryCell(data, P));
  };
  assert.equal(camera(4), 24); // the door the walk comes in by, not the start marker on C01
  assert.equal(camera(7), 5); // two doors in from one path: the lower-numbered screen
  assert.equal(camera(9), 9); // reached only from a path the level lists after it
});
