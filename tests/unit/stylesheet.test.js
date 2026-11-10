import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";

// the link order of the partials under public/css is the cascade, and their names carry it
const pub = new URL("../../public/", import.meta.url);
const html = readFileSync(new URL("index.html", pub), "utf8").replace(/<!--[\s\S]*?-->/g, "");
const linked = [...html.matchAll(/<link\b([^>]*)>/gs)]
  .map(([, attrs]) => attrs)
  .filter((attrs) => /\brel="stylesheet"/.test(attrs))
  .map((attrs) => attrs.match(/\bhref="([^"]*)"/)?.[1] ?? "");
const partials = readdirSync(new URL("css/", pub))
  .filter((f) => f.endsWith(".css"))
  .sort();

test("stylesheet: index.html links every partial under public/css once, in name order", () => {
  assert.ok(partials.length > 0, "a partial under public/css");
  for (const href of linked)
    assert.match(href, /^css\/[^/]+\.css$/, `${href} is not a file under public/css`);
  assert.deepEqual(
    linked.map((href) => href.slice("css/".length)),
    partials,
    "the stylesheet links are the partials under public/css, each once, in name order",
  );
});

test("stylesheet: a partial is named NN-word.css, its rank in the cascade first", () => {
  for (const f of partials) assert.match(f, /^\d\d-[a-z]+\.css$/, `${f} is not NN-word.css`);
});
