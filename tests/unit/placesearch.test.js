import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { placeCandidates, matchPlaces } from "../../public/js/data/placesearch.js";
import { parseQuery, queryTerms } from "../../public/js/ui/searchquery.js";
import { setAnnotations } from "../../public/js/model/annotations.js";

const load = (name) =>
  JSON.parse(readFileSync(new URL(`../../public/${name}`, import.meta.url), "utf8"));

const run = (games, q, current = games[0]) => {
  const groups = parseQuery(q);
  return matchPlaces(games, groups, queryTerms(groups), current);
};
const where = (hits) => hits.map((c) => `${c.G.id} ${c.code}`);

// two stand-in games carrying one of each thing the blob is built from: a disc
// name, a curated name, a nickname, a section — and a level short ending in the
// digit a query is about to ask for
const GAMES = [
  {
    id: "XX",
    levels: [
      { short: "L1", name: "Monsaic Lines", paths: [{ id: 1 }, { id: 3 }] },
      {
        short: "R2",
        name: "Rupture Farms Return",
        paths: [
          { id: 1, name: "Zulag 2", cams: [{ cell: 0, name: "R2P01C05" }] },
          { id: 4, section: "Ender Wing" },
          { id: 12 },
        ],
      },
    ],
  },
  {
    id: "YY",
    levels: [{ short: "BR", name: "SoulStorm Brewery", paths: [{ id: 2 }] }],
  },
];
const ANN = {
  XX: { paths: { L1: { 3: "The Chant Gate" } } },
  YY: { paths: { BR: { 2: { name: "Zulag 2", nickname: "Flying Sligs" } } } },
};

// a level whose code holds a digit, with paths either side of ten and one
// holding its screens out of the order of their numbers
const camsNamed = (...names) => names.map((name) => ({ name }));
const VAULTS = [
  {
    id: "ZZ",
    levels: [
      {
        short: "Q7",
        name: "Vaults",
        paths: [
          { id: 1 },
          { id: 5, cams: camsNamed("Q7P05C02", "Q7P05C10", "Q7P05C01", "Q7P05C03") },
          { id: 12 },
          { id: 15, cams: camsNamed("Q7P15C01") },
        ],
      },
    ],
  },
];

test("placeCandidates: one row per level, per path and per screen", () => {
  setAnnotations(ANN);
  const cands = placeCandidates(GAMES);
  assert.equal(cands.length, 3 + 6 + 1); // 3 levels, 6 paths, 1 screen

  const level = cands.find((c) => c.code === "L1");
  assert.equal(level.pa, null);
  assert.equal(level.lv, "L1");
  assert.equal(level.name, "Monsaic Lines");
  assert.equal(level.text, "monsaic lines");
  assert.deepEqual(level.tokens, ["l1"]);

  // a path indexes its level's name alongside its own, so a level name finds
  // what is inside it
  const path = cands.find((c) => c.code === "L1 P3");
  assert.equal(path.pa, 3);
  assert.equal(path.levelName, "Monsaic Lines");
  assert.equal(path.name, "The Chant Gate");
  assert.equal(path.text, "monsaic lines the chant gate");
  assert.deepEqual(path.tokens, ["l1", "p3", "l1p", "l1p0", "l1p03"]);

  const unnamed = cands.find((c) => c.code === "L1 P1");
  assert.equal(unnamed.name, null);
  assert.equal(unnamed.text, "monsaic lines");

  // a screen carries its path's blob plus the tokens that name the camera
  const screen = cands.find((c) => c.code === "R2 P1 C5");
  assert.equal(screen.cam, 5);
  assert.equal(screen.text, "rupture farms return zulag 2");
  assert.deepEqual(screen.camTokens, ["c5", "c05", "r2p01c", "r2p01c0", "r2p01c05"]);
  assert.deepEqual(screen.tokens, ["r2", "p1", "r2p", "r2p0", "r2p01", ...screen.camTokens]);
});

test("placeCandidates: a row names its place and holds no level or path object", () => {
  // an edit stands a rebuilt level in the dataset; a row that kept the old one
  // would land a click on the shipped data
  for (const c of placeCandidates(GAMES)) {
    assert.ok(!("L" in c) && !("P" in c), c.code);
    assert.equal(typeof c.lv, "string");
  }
});

test("matchPlaces: a screen answers only a query that names one", () => {
  setAnnotations(ANN);
  assert.deepEqual(where(run(GAMES, "r2 p1")), ["XX R2 P1"]); // no screens uninvited
  assert.deepEqual(where(run(GAMES, "r2 p1 c5")), ["XX R2 P1 C5"]);
  assert.deepEqual(where(run(GAMES, "zulag 2 c05")), ["XX R2 P1 C5"]);
  assert.deepEqual(where(run(GAMES, "r2p01c05")), ["XX R2 P1 C5"]);
  assert.deepEqual(where(run(GAMES, "c5")), ["XX R2 P1 C5"]);
});

test("matchPlaces: a level's name reaches its paths, and the level still leads", () => {
  setAnnotations(ANN);
  assert.deepEqual(where(run(GAMES, "monsaic")), ["XX L1", "XX L1 P1", "XX L1 P3"]);
});

test("matchPlaces: the code answers a whole term only", () => {
  setAnnotations(ANN);
  // "R2 P12" holds both a 2 and a 1, so a plain blob would answer either query
  assert.deepEqual(where(run(GAMES, "zulag 2")), ["XX R2 P1", "YY BR P2"]);
  assert.deepEqual(where(run(GAMES, "r2 p12")), ["XX R2 P12"]);
  assert.deepEqual(where(run(GAMES, "l1 p3, br p2")), ["XX L1 P3", "YY BR P2"]);
});

test("matchPlaces: a camera name answers as it is typed, with its paths short of the C and its screens from it", () => {
  setAnnotations(ANN);
  const typed = (q) => where(run(VAULTS, q));
  assert.deepEqual(typed("q7p"), ["ZZ Q7 P1", "ZZ Q7 P5", "ZZ Q7 P12", "ZZ Q7 P15"]);
  assert.deepEqual(typed("q7p0"), ["ZZ Q7 P1", "ZZ Q7 P5"]);
  assert.deepEqual(typed("q7p1"), ["ZZ Q7 P12", "ZZ Q7 P15"]);
  assert.deepEqual(typed("q7p05"), ["ZZ Q7 P5"]); // the path, and none of its screens
  const screens = ["ZZ Q7 P5 C1", "ZZ Q7 P5 C2", "ZZ Q7 P5 C3", "ZZ Q7 P5 C10"];
  assert.deepEqual(typed("q7p05c"), screens); // by number
  assert.deepEqual(typed("q7p05c0"), screens.slice(0, 3));
  assert.deepEqual(typed("q7p05c1"), ["ZZ Q7 P5 C10"]);
  assert.deepEqual(typed("q7p05c10"), ["ZZ Q7 P5 C10"]);
  assert.deepEqual(typed("q7p15c"), ["ZZ Q7 P15 C1"]);
});

test("matchPlaces: a camera name answers from its P on, and only by its beginning", () => {
  setAnnotations(ANN);
  const typed = (q) => where(run(VAULTS, q));
  assert.deepEqual(typed("q"), []);
  assert.deepEqual(typed("q7"), ["ZZ Q7", "ZZ Q7 P1", "ZZ Q7 P5", "ZZ Q7 P12", "ZZ Q7 P15"]);
  assert.deepEqual(typed("q7p5"), []); // a path under ten is named with its zero
  assert.deepEqual(typed("q7p05c4"), []);
  assert.deepEqual(typed("q7p05c011"), []);
  assert.deepEqual(typed("7p05"), []);
  assert.deepEqual(typed("p05c01"), []);
});

test("matchPlaces: a term typed toward a camera name joins the rest of a query as a code does", () => {
  setAnnotations(ANN);
  const typed = (q) => where(run([...GAMES, ...VAULTS], q));
  // a screen answers what its path answers, once a term names it
  assert.deepEqual(typed("q7p05 c2"), ["ZZ Q7 P5 C2"]);
  assert.deepEqual(typed("q7p0 c1"), ["ZZ Q7 P5 C1"]);
  assert.deepEqual(typed("q7p05c1 vaults"), ["ZZ Q7 P5 C10"]);
  assert.deepEqual(typed("q7p05c monsaic"), []);
  assert.deepEqual(typed("q7p15c, q7p0"), ["ZZ Q7 P1", "ZZ Q7 P5", "ZZ Q7 P15 C1"]);
  assert.deepEqual(typed("r2p1, q7p05c0"), [
    "XX R2 P12",
    "ZZ Q7 P5 C1",
    "ZZ Q7 P5 C2",
    "ZZ Q7 P5 C3",
  ]);
});

test("matchPlaces: a row is labelled with the camera name where a term answered that its code does not hold", () => {
  setAnnotations(ANN);
  const labels = (q) => run(VAULTS, q).map((c) => c.label);
  assert.deepEqual(labels("q7p0"), ["Q7P01", "Q7P05"]);
  assert.deepEqual(labels("q7p05c0"), ["Q7P05C01", "Q7P05C02", "Q7P05C03"]);
  assert.deepEqual(labels("q7p05c10"), ["Q7P05C10"]);
  assert.deepEqual(labels("c02"), ["Q7P05C02"]);
  // whichever of a query's terms it is, a beginning of the path's part for a screen too
  assert.deepEqual(labels("c1 q7p0"), ["Q7P05C01"]);
  assert.deepEqual(labels("vaults q7p05c0"), ["Q7P05C01", "Q7P05C02", "Q7P05C03"]);
  assert.deepEqual(labels("q7 p5 c2"), ["Q7 P5 C2"]);
  assert.deepEqual(labels("vaults"), ["Q7", "Q7 P1", "Q7 P5", "Q7 P12", "Q7 P15"]);
  // a term names its own rows only: the level and the paths answered to the code
  assert.deepEqual(labels("q7p15c, q7"), ["Q7", "Q7 P1", "Q7 P5", "Q7 P12", "Q7 P15", "Q7P15C01"]);
});

test("matchPlaces: a nickname and a section are as findable as a name", () => {
  setAnnotations(ANN);
  assert.deepEqual(where(run(GAMES, "flying sligs")), ["YY BR P2"]);
  assert.deepEqual(where(run(GAMES, "ender")), ["XX R2 P4"]);
});

test("matchPlaces: the current game breaks a rank tie", () => {
  setAnnotations(ANN);
  assert.deepEqual(where(run(GAMES, "zulag 2", GAMES[1])), ["YY BR P2", "XX R2 P1"]);
});

test("matchPlaces: the queries the sidebar's buttons were the only answer to", () => {
  setAnnotations(load("annotations.json"));
  const games = [load("map_data_ao.json"), load("map_data_ae.json")];
  const hits = (q) => where(run(games, q));

  // a level name leads the paths it reaches
  assert.equal(hits("monsaic")[0], "AO L1");
  assert.equal(hits("feeco")[0], "AE FD");
  assert.deepEqual(
    hits("necrum").filter((h) => !h.includes("P")),
    ["AE NE", "AE MI"],
  );

  // the four Rupture Farms Return paths the game itself calls Zulag 2 lead, and
  // not the fourteen others whose R2 would answer a "2" in a plain blob; the
  // names stay a substring index, so AE's Zulag 12 follows on its "12"
  assert.deepEqual(hits("zulag 2").slice(0, 4), ["AO R2 P1", "AO R2 P2", "AO R2 P3", "AO R2 P10"]);

  assert.deepEqual(hits("r2 p1"), ["AO R2 P1"]);
  assert.ok(run(games, "p3").every((c) => c.pa === 3));

  // the nicknames, which are the half of this a player reaches for when they
  // know what a place is like but not what it is called
  assert.deepEqual(hits("tear extractors"), ["AE BR P11"]);
  assert.deepEqual(hits("high security"), ["AE BR P10"]);

  // a single screen, by code or by the cam name the grid overlay shows —
  // and never as a stowaway on a bare place query
  assert.deepEqual(hits("r1 p15 c3"), ["AO R1 P15 C3"]);
  assert.deepEqual(hits("r1p15c03"), ["AO R1 P15 C3"]);
  // Scrabania's P2 C1s answer too ("ba" is a substring index), ranked behind the code match
  assert.equal(hits("ba p2 c1")[0], "AE BA P2 C1");
  assert.ok(hits("monsaic").every((h) => !/ C\d/.test(h)));
});

test("matchPlaces: every camera name of both games, a letter at a time", () => {
  setAnnotations(load("annotations.json"));
  const games = [load("map_data_ao.json"), load("map_data_ae.json")];
  const cut = (name) => name.lastIndexOf("C");
  const number = (name) => +name.slice(cut(name) + 1);
  const most = { paths: 0, screens: 0 };
  const seen = new Set();
  for (const G of games)
    for (const L of G.levels)
      for (const P of L.paths) {
        const screens = P.cams.map((c) => c.name).sort((a, b) => number(a) - number(b));
        for (const name of screens)
          for (let n = L.short.length + 1; n <= name.length; n++) {
            const typed = name.slice(0, n);
            if (seen.has(typed)) continue;
            seen.add(typed);
            const kind = n <= cut(name) ? "paths" : "screens";
            // what the names themselves begin with it, each beside its row's label
            const want =
              kind === "paths"
                ? L.paths
                    .filter((p) => p.cams.some((c) => c.name.startsWith(typed)))
                    .map((p) => [`${G.id} ${L.short} P${p.id}`, p.cams[0].name.slice(0, cut(name))])
                : screens
                    .filter((s) => s.startsWith(typed))
                    .map((s) => [`${G.id} ${L.short} P${P.id} C${number(s)}`, s]);
            const rows = run(games, typed.toLowerCase());
            assert.deepEqual(
              rows.map((c) => [`${c.G.id} ${c.code}`, c.label]),
              want,
              typed,
            );
            most[kind] = Math.max(most[kind], rows.length);
          }
      }
  // the 1,761 names and the 755 ways of beginning one past its level's code
  assert.equal(seen.size, 2516);
  // SoulStorm Brewery's paths at BRP, and the screens of Necrum Mines' fourth at MIP04C
  assert.deepEqual(most, { paths: 28, screens: 37 });
});
