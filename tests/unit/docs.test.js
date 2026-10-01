import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

// Nothing regenerates the index or the docs' links, so a renamed or unlisted file fails here

const root = fileURLToPath(new URL("../../", import.meta.url));
const read = (path) => readFileSync(join(root, path), "utf8");
const docs = readdirSync(join(root, "docs"))
  .filter((f) => f.endsWith(".md"))
  .map((f) => `docs/${f}`)
  .sort();
const claude = read("CLAUDE.md");
const slug = (heading) =>
  heading
    .toLowerCase()
    .replace(/[`*]/g, "")
    .replace(/[^a-z0-9_ -]/g, "")
    .trim()
    .replace(/ /g, "-");

test("every topic doc has an index entry in CLAUDE.md", () => {
  for (const doc of docs) {
    assert.match(
      claude,
      new RegExp(`^- \\[${doc}\\]\\(${doc}\\) — `, "m"),
      `${doc} is listed under Topic docs`,
    );
  }
});

test("every relative link in CLAUDE.md and docs/ resolves", () => {
  for (const file of ["CLAUDE.md", ...docs]) {
    for (const [, target, fragment] of read(file).matchAll(
      /\]\((?!https?:)([^)#]+)(?:#([^)]*))?\)/g,
    )) {
      const path = join(dirname(file), target);
      assert.ok(existsSync(join(root, path)), `${file} links to ${target}, which is not there`);
      if (fragment) {
        const headings = [...read(path).matchAll(/^#+ (.+)$/gm)].map(([, h]) => slug(h));
        assert.ok(
          headings.includes(fragment),
          `${file} links to ${target}#${fragment}, which has no such heading`,
        );
      }
    }
  }
});
