import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import {
  GAME_FILES,
  GAME_IDS,
  bootGame,
  knownGame,
  loadGame,
  loadRelease,
  loadReleaseIndex,
} from "../../public/js/data.js";

test("knownGame: the games the map ships, and nothing borrowed from Object", () => {
  for (const id of GAME_IDS) assert.equal(knownGame(id), true);
  assert.equal(knownGame("XX"), false);
  assert.equal(knownGame("constructor"), false);
});

test("bootGame: the link's game, else the remembered one, else the first", () => {
  assert.equal(bootGame("#AE/MI/1", null), "AE");
  assert.equal(bootGame("#ao/R1/1", null), "AO"); // parseHash uppercases
  assert.equal(bootGame("", "#AE/MI/1"), "AE");
  assert.equal(bootGame(null, null), GAME_IDS[0]);
  // a link the map cannot answer must not decide which dataset boots
  assert.equal(bootGame("#XX/R1/1", "#AE/MI/1"), "AE");
  assert.equal(bootGame("#XX/R1/1", null), GAME_IDS[0]);
  assert.equal(bootGame("not a hash", null), GAME_IDS[0]);
});

test("every game's file is a shipped dataset that names it back", async () => {
  for (const id of GAME_IDS) {
    const data = JSON.parse(await readFile(`public/${GAME_FILES[id]}`, "utf8"));
    assert.equal(data.id, id);
  }
});

test("a release stands over the very base the game loads, one dataset however often asked", async () => {
  const fetched = [];
  const was = globalThis.fetch;
  globalThis.fetch = async (file) => {
    fetched.push(file);
    try {
      const body = await readFile(`public/${file}`, "utf8");
      return { ok: true, json: async () => JSON.parse(body) };
    } catch {
      return { ok: false };
    }
  };
  try {
    const index = await loadReleaseIndex();
    assert.deepEqual(
      index.AO.releases.map((r) => r.code),
      ["us-r0", "us-r1", "eu", "fr", "de", "jp"],
    );
    const base = await loadGame("AO");
    const R = await loadRelease("AO", "jp");
    assert.equal(R.id, "AO");
    assert.equal(R.release.code, "jp");
    assert.equal(await loadRelease("AO", "jp"), R);
    assert.equal(await loadGame("AO"), base);
    assert.equal(base.release, undefined);
    // the Japanese Oddysee changes no object, so it never asks for the editor data
    assert.ok(!fetched.some((f) => f.startsWith("relive_export_ao")));
    assert.equal(await loadRelease("AO", "us-r3"), null);
    assert.equal(await loadRelease("AO", "../x"), null);
  } finally {
    globalThis.fetch = was;
  }
});
