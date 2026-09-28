import { test } from "node:test";
import assert from "node:assert/strict";
import { isDemoPath } from "../../public/js/demo.js";
import { pathVisible, revealPath } from "../../public/js/pathvisible.js";
import { getSettings } from "../../public/js/settings.js";
import { path, tlv } from "./fixtures.js";

const demoPath = (id) => path(id, [tlv("Door"), tlv("DemoSpawnPoint")]);
const playPath = (id) => path(id, [tlv("Door"), tlv("AbeStart")]);

// localStorage is absent in bare Node, so getSettings() hands back the defaults
// object itself and a test can drive the setting through it
const withDemoPaths = (on, run) => {
  const s = getSettings();
  const was = s.showDemoPaths;
  s.showDemoPaths = on;
  try {
    run();
  } finally {
    s.showDemoPaths = was;
  }
};

test("isDemoPath: a DemoSpawnPoint marks the path, and only that", () => {
  assert.equal(isDemoPath(demoPath(1)), true);
  assert.equal(isDemoPath(playPath(1)), false);
  assert.equal(isDemoPath(path(1, [])), false);
  const p = demoPath(1);
  assert.equal(isDemoPath(p), isDemoPath(p)); // memoized per path
});

test("pathVisible: gameplay paths always, demo paths only when asked", () => {
  const demo = demoPath(1),
    play = playPath(2);
  withDemoPaths(false, () => {
    assert.equal(pathVisible(play), true);
    assert.equal(pathVisible(demo), false);
  });
  withDemoPaths(true, () => {
    assert.equal(pathVisible(play), true);
    assert.equal(pathVisible(demo), true);
  });
});

test("revealPath: a hidden path stays listed for the session once arrived at", () => {
  const demo = demoPath(1);
  withDemoPaths(false, () => {
    assert.equal(revealPath(demo), true);
    assert.equal(pathVisible(demo), true);
    assert.equal(revealPath(demo), false); // already revealed: no rebuild wanted
    assert.equal(pathVisible(demoPath(2)), false); // one path, not the class
  });
  // and the reveal outlives the setting being turned on and off again
  withDemoPaths(true, () => assert.equal(pathVisible(demo), true));
  withDemoPaths(false, () => assert.equal(pathVisible(demo), true));
});

test("revealPath: a gameplay path needs no reveal", () => {
  withDemoPaths(false, () => assert.equal(revealPath(playPath(1)), false));
});
