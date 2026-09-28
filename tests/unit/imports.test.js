import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";

// what may stand between `import` and `from`: anything but a semicolon or a
// quote, and a comment whole, whatever it holds
const CLAUSE = String.raw`(?:[^;"'/]|//.*$|/\*(?:[^*]|\*(?!/))*\*/)*?`;
// `import … from "./x.js"`, `export … from "./x.js"` and a bare `import "./x.js"`
const SIBLING = new RegExp(
  String.raw`^(?:import\s*|(?:import|export)\b${CLAUSE}\bfrom\s*)["']\./([^"']+)["']`,
  "gm",
);
const siblings = (src) => [...src.matchAll(SIBLING)].map((m) => m[1]);

test("the sweep reads each import form and sees through an import list's comments", () => {
  const src = [
    "import {",
    "  a, // one; two",
    '  /* "b" */ b,',
    "  c, // don't",
    '} from "./x.js";',
    'import "./y.js";',
    'export { d } from "./z.js";',
    '// import { e } from "./gone.js";',
  ].join("\n");
  assert.deepEqual(siblings(src), ["x.js", "y.js", "z.js"]);
});

// The regression guard for the whole suite: these modules must never touch the
// DOM at import time, or nothing but a browser session would catch it.
test("pure modules import in bare Node", async () => {
  for (const mod of [
    "annotations",
    "config",
    "data",
    "demo",
    "pathvisible",
    "fields",
    "state",
    "geometry",
    "util",
    "model",
    "settings",
    "searchquery",
    "placesearch",
    "pathorder",
    "glossary",
    "messages",
    "census",
    "placesummary",
    "typeinfo",
    "worldgraph",
    "graphsvg",
    "reliveexport",
    "extra",
    "edits",
  ]) {
    const m = await import(`../../public/js/${mod}.js`);
    assert.ok(Object.keys(m).length > 0, `${mod}.js has exports`);
  }
});

// A cycle between ES modules links and runs without complaint for as long as no
// module reads an imported binding mid-evaluation, so nothing but the import
// statements themselves says one has formed.
test("the viewer's modules import one way", () => {
  const dir = new URL("../../public/js/", import.meta.url);
  const files = readdirSync(dir)
    .filter((f) => f.endsWith(".js"))
    .sort();
  const deps = new Map();
  for (const f of files) {
    const specs = siblings(readFileSync(new URL(f, dir), "utf8"));
    for (const s of specs) assert.ok(files.includes(s), `${f} imports ./${s}, which is not there`);
    deps.set(f, specs);
  }

  // the boot entry reaching every module is what shows the sweep read the whole graph
  const reached = new Set(["main.js"]);
  for (const f of reached) for (const d of deps.get(f)) reached.add(d);
  assert.deepEqual(
    files.filter((f) => !reached.has(f)),
    [],
    "main.js reaches every module by static import, so a module loaded by import() alone is listed here",
  );

  const open = new Set(),
    done = new Set();
  const walk = (f, trail) => {
    open.add(f);
    for (const d of deps.get(f)) {
      assert.ok(
        !open.has(d),
        `import cycle: ${[...trail.slice(trail.indexOf(d)), d].join(" -> ")}`,
      );
      if (!done.has(d)) walk(d, [...trail, d]);
    }
    open.delete(f);
    done.add(f);
  };
  for (const f of files) if (!done.has(f)) walk(f, [f]);
});
