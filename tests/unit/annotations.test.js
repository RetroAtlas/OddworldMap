import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  sanitizeAnnotations,
  setAnnotations,
  pathDisplayName,
  pathNickname,
  pathNote,
} from "../../public/js/model/annotations.js";
import { isDemoPath } from "../../public/js/model/demo.js";

const load = (name) =>
  JSON.parse(readFileSync(new URL(`../../public/${name}`, import.meta.url), "utf8"));

// a note is prose among labels: it opens capitalized and closes punctuated
const SENTENCE = /^[A-Z].*[.!?]$/;
// a nickname is a label among prose: it opens capitalized and does not close punctuated
const NICKNAME = /^[A-Z](.*[^.!?])?$/;
const NICKNAME_MAX = 24;

test("sanitizeAnnotations: tolerates a missing or garbage file", () => {
  assert.deepEqual(sanitizeAnnotations(null), {});
  assert.deepEqual(sanitizeAnnotations("nonsense"), {});
  assert.deepEqual(sanitizeAnnotations(42), {});
  assert.deepEqual(sanitizeAnnotations({ AO: null, AE: "x" }), {});
});

test("sanitizeAnnotations: copies only known sections with expected types", () => {
  const s = sanitizeAnnotations({
    AO: {
      paths: {
        R1: {
          15: "Free-Fire Zone",
          16: "",
          17: 3,
          18: { name: "Packaging", note: "the conveyors run here", junk: 1 },
          19: { note: "no curated name: the disc name keeps it" },
          20: {},
          21: { nickname: "The Conveyor Floor" },
        },
        L1: "not an object",
      },
      future: { anything: true },
    },
  });
  assert.deepEqual(s, {
    AO: {
      paths: {
        R1: {
          15: { name: "Free-Fire Zone" },
          18: { name: "Packaging", note: "the conveyors run here" },
          19: { note: "no curated name: the disc name keeps it" },
          21: { nickname: "The Conveyor Floor" },
        },
      },
    },
  });
});

test("pathDisplayName: a curated name overrides, the disc name shows otherwise", () => {
  setAnnotations({
    AO: { paths: { R1: { 15: "Curated", 17: { name: "Curated" }, 18: { note: "a note" } } } },
  });
  assert.equal(pathDisplayName("AO", "R1", { id: 15, name: "Disc Name" }), "Curated");
  assert.equal(pathDisplayName("AO", "R1", { id: 15 }), "Curated"); // numeric id vs string key
  assert.equal(pathDisplayName("AO", "R1", { id: 17, name: "Disc Name" }), "Curated"); // object form
  assert.equal(pathDisplayName("AO", "R1", { id: 18, name: "Disc Name" }), "Disc Name"); // note only
  assert.equal(pathDisplayName("AO", "R1", { id: 16, name: "Disc Name" }), "Disc Name");
  assert.equal(pathDisplayName("AO", "R1", { id: 16 }), null);
  assert.equal(pathDisplayName("AO", "R2", { id: 15 }), null);
  assert.equal(pathDisplayName("AE", "R1", { id: 15 }), null); // unannotated game
  setAnnotations(null);
  assert.equal(pathDisplayName("AO", "R1", { id: 15, name: "Disc Name" }), "Disc Name");
  assert.equal(pathDisplayName("AO", "R1", { id: 15 }), null);
});

test("pathNote: hit, miss, and a name-only entry", () => {
  setAnnotations({
    AO: { paths: { R1: { 15: { name: "Curated", note: "worth knowing" }, 16: "Curated" } } },
  });
  assert.equal(pathNote("AO", "R1", { id: 15 }), "worth knowing");
  assert.equal(pathNote("AO", "R1", { id: 16 }), null);
  assert.equal(pathNote("AO", "R1", { id: 17 }), null);
  assert.equal(pathNote("AO", "R2", { id: 15 }), null);
  assert.equal(pathNote("AE", "R1", { id: 15 }), null);
  setAnnotations(null);
  assert.equal(pathNote("AO", "R1", { id: 15 }), null);
});

test("pathNickname: hit, miss, and an entry carrying nothing else", () => {
  setAnnotations({
    AO: {
      paths: {
        R1: {
          15: { name: "Curated", nickname: "Industrial Machines" },
          16: "Curated",
          17: { nickname: "Tear Gas" },
        },
      },
    },
  });
  assert.equal(pathNickname("AO", "R1", { id: 15 }), "Industrial Machines");
  assert.equal(pathNickname("AO", "R1", { id: 16 }), null);
  assert.equal(pathNickname("AO", "R1", { id: 17 }), "Tear Gas");
  assert.equal(pathNickname("AO", "R1", { id: 18 }), null);
  assert.equal(pathNickname("AO", "R2", { id: 15 }), null);
  assert.equal(pathNickname("AE", "R1", { id: 15 }), null);
  // a nickname never stands in for the name, whether or not there is one
  assert.equal(pathDisplayName("AO", "R1", { id: 17 }), null);
  assert.equal(pathDisplayName("AO", "R1", { id: 17, name: "Disc Name" }), "Disc Name");
  setAnnotations(null);
  assert.equal(pathNickname("AO", "R1", { id: 15 }), null);
});

// ---- schema sanity over the shipped file, cross-checked against the shipped
// map data: annotations are hand-curated, so typos and dead entries (a name
// for a path the game does not hold) must not ship
test("annotations.json entries all point at live targets", () => {
  const ann = load("annotations.json");
  const data = { AO: load("map_data_ao.json"), AE: load("map_data_ae.json") };

  for (const [game, g] of Object.entries(ann)) {
    assert.ok(game in data, `game ${game} is a shipped dataset`);
    const levels = new Map(data[game].levels.map((l) => [l.short, l]));
    for (const k of Object.keys(g)) assert.ok(["paths"].includes(k), `${game}.${k} known`);

    for (const [short, byId] of Object.entries(g.paths ?? {})) {
      const L = levels.get(short);
      assert.ok(L, `${game} ${short}: path annotations need an on-map level`);
      for (const [id, v] of Object.entries(byId)) {
        assert.match(id, /^(0|[1-9]\d*)$/, `${game} ${short} P${id}: canonical id key`);
        const P = L.paths.find((p) => p.id === +id);
        assert.ok(P, `${game} ${short} P${id}: path exists`);
        // a bare string is the name; the object form adds a note and a
        // nickname, and any one of the three may stand alone
        const e = typeof v === "string" ? { name: v } : v;
        const keys = Object.keys(e);
        assert.ok(
          keys.length && keys.every((k) => ["name", "note", "nickname"].includes(k)),
          `${game} ${short} P${id}: known keys`,
        );
        for (const k of keys)
          assert.ok(
            typeof e[k] === "string" && e[k] && e[k] === e[k].trim(),
            `${game} ${short} P${id}.${k} is a trimmed string`,
          );
        if (e.note)
          assert.match(e.note, SENTENCE, `${game} ${short} P${id}: note reads as a sentence`);
        if (e.nickname) {
          const at = `${game} ${short} P${id}`;
          assert.match(e.nickname, NICKNAME, `${at}: nickname reads as a name, not prose`);
          assert.ok(
            e.nickname.length <= NICKNAME_MAX,
            `${at}: nickname "${e.nickname}" stays label-sized`,
          );
          // it shows beside the name, so repeating one says nothing twice
          assert.notEqual(e.nickname, e.name, `${at}: nickname repeats the curated name`);
          assert.notEqual(e.nickname, P.name, `${at}: nickname repeats the disc name`);
        }
        // an override may refine a disc name, never erase it: the authentic
        // label must stay visible inside the curated one ("Zulag 2 — Lobby")
        if (e.name && P.name)
          assert.ok(
            e.name.includes(P.name),
            `${game} ${short} P${id}: override "${e.name}" keeps the disc name "${P.name}"`,
          );
      }
    }
  }
});

// what licenses adopting a nickname: the fit it claims, checked against the shipped
// data — a predicate, or the reason written down where the evidence is artwork

const count = (P, type) => P.tlvs.filter((t) => t.name === type).length;
// a tie still counts, and an absent type can't pass vacuously
const holdsMost = (L, P, type) =>
  count(P, type) > 0 && L.paths.every((Q) => count(Q, type) <= count(P, type));
const holders = (L, has) =>
  L.paths
    .filter(has)
    .map((P) => P.id)
    .sort((a, b) => a - b);
const same = (a, b) => a.length === b.length && a.every((v, i) => v === b[i]);
// `blind` is a Choice_short, so it carries no enum_labels entry: read it raw
const blind = (P) => P.tlvs.filter((t) => t.name === "Mudokon" && t.fields?.blind).length;
const flying = (L) => holders(L, (P) => count(P, "FlyingSlig") > 0);

const CLAIMS = {
  // the pair is the claim, not the magnitude: two zulags carry them, two each
  "AE BR 2": (L) => same(flying(L), [2, 9]),
  "AE BR 9": (L) => same(flying(L), [2, 9]),
  "AE BR 3": (L, P) => holdsMost(L, P, "SlogSpawner"),
  "AE BR 5": (L, P) => holdsMost(L, P, "ElectricWall"),
  "AE BR 6": (L) =>
    same(
      holders(L, (P) => blind(P) > 0),
      [6],
    ),
  "AE BR 10": (L, P) => holdsMost(L, P, "Slig"),
  "AE BR 11": "the artwork paints TEAR X-TRACTOR on the wall directly under the rig",
  "AE BR 12": (L, P) => holdsMost(L, P, "Drill"),
  "AE BR 18": (L, P) => holdsMost(L, P, "LaughingGas"),
};

// keyed to exactly the nicknamed paths: no nickname unbacked, no backing outliving its name
test("every adopted nickname is backed by the fit it claims", () => {
  const ann = load("annotations.json");
  const data = { AO: load("map_data_ao.json"), AE: load("map_data_ae.json") };
  const nicknamed = [];
  for (const [game, g] of Object.entries(ann))
    for (const [short, byId] of Object.entries(g.paths ?? {}))
      for (const [id, v] of Object.entries(byId))
        if (v?.nickname) nicknamed.push(`${game} ${short} ${id}`);
  assert.deepEqual(nicknamed.sort(), Object.keys(CLAIMS).sort());

  for (const key of nicknamed) {
    const [game, short, id] = key.split(" ");
    const L = data[game].levels.find((l) => l.short === short);
    const P = L.paths.find((p) => p.id === +id);
    const claim = CLAIMS[key];
    if (typeof claim === "string") assert.ok(claim.trim(), `${key}: its reason is written down`);
    else assert.ok(claim(L, P), `${key}: the fit its nickname claims no longer holds`);
  }
});

// the paths the map hides say so in their name, which is what an arrival reads
test("every demo path's curated name marks it [Demo]", () => {
  setAnnotations(load("annotations.json"));
  for (const game of ["AO", "AE"])
    for (const L of load(`map_data_${game.toLowerCase()}.json`).levels)
      for (const P of L.paths)
        if (isDemoPath(P))
          assert.ok(
            (pathDisplayName(game, L.short, P) || "").startsWith("[Demo] "),
            `${game} ${L.short} P${P.id}: curated name marks the demo copy`,
          );
  setAnnotations(null);
});
