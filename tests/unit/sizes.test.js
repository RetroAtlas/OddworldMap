import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../../", import.meta.url));

function under(dir, ends) {
  return readdirSync(join(root, dir)).flatMap((name) => {
    const path = `${dir}/${name}`;
    if (statSync(join(root, path)).isDirectory()) return under(path, ends);
    return ends.some((end) => name.endsWith(end)) ? [path] : [];
  });
}

// A file is read whole, so each kind stays under a size.
const KINDS = [
  ["public/js", 800, () => under("public/js", [".js"])],
  ["tests/browser", 800, () => under("tests/browser", [".js", ".py"])],
  ["tests/unit", 1000, () => under("tests/unit", [".js"])],
  ["tools", 1000, () => under("tools", [".py", ".js"])],
];

// A file already over its cap stands here at the next hundred above its size,
// a row a commit may lower and none may raise.
const OVER = {
  "public/js/edits.js": 900,
  "public/js/interaction.js": 900,
  "public/js/model.js": 900,
  "public/js/render.js": 1800,
  "public/js/sprites.js": 1600,
  "tests/unit/edits.test.js": 1300,
  "tests/unit/model.test.js": 1500,
  "tests/unit/motion.test.js": 2000,
  "tools/tests/test_build_map.py": 1300,
};

const lines = (path) =>
  readFileSync(join(root, path), "utf8").replace(/\n$/, "").split("\n").length;
const nextHundred = (n) => Math.floor(n / 100) * 100 + 100;
const capOf = (path) => KINDS.find(([dir]) => path.startsWith(`${dir}/`))?.[1];
const CUT = "split it where its sections join, a subject to a file";

test("every module, spec, unit test and tool is short enough to read whole", () => {
  const over = [];
  for (const [, cap, files] of KINDS)
    for (const path of files()) {
      const n = lines(path);
      const row = OVER[path];
      if (row !== undefined && n > row)
        over.push(
          `${path}: ${n} lines, over its ${row} on the table; ${CUT}, since a row is never raised`,
        );
      else if (row === undefined && n > cap)
        over.push(`${path}: ${n} lines, over ${cap}; ${CUT}, and add no row`);
    }
  assert.deepEqual(over, []);
});

test("the table names only files still over their cap, at the next hundred above their size", () => {
  const stale = [];
  for (const [path, row] of Object.entries(OVER)) {
    if (!existsSync(join(root, path))) {
      stale.push(`${path}: gone; move or take out its row`);
      continue;
    }
    const n = lines(path);
    const cap = capOf(path);
    if (cap === undefined) {
      stale.push(`${path}: outside every kind; take its row out`);
      continue;
    }
    if (n <= cap) stale.push(`${path}: ${n} lines, within ${cap}; take its row out`);
    else if (row > nextHundred(n))
      stale.push(
        `${path}: ${n} lines, its row ${row}; write the next hundred above, ${nextHundred(n)}`,
      );
  }
  assert.deepEqual(stale, []);
});
