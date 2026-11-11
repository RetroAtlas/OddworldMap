import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { posix } from "node:path";
import { Linter } from "eslint";

const dir = new URL("../../public/js/", import.meta.url);

// what may stand between `import` and `from`: anything but a semicolon or a
// quote, and a comment whole, whatever it holds
const CLAUSE = String.raw`(?:[^;"'/]|//.*$|/\*(?:[^*]|\*(?!/))*\*/)*?`;
// `import … from "./x.js"`, `export … from "../y/x.js"` and a bare `import "./x.js"`
const IMPORT = new RegExp(
  String.raw`^(?:import\s*|(?:import|export)\b${CLAUSE}\bfrom\s*)["'](\.\.?/[^"']+)["']`,
  "gm",
);
// a module's imports as paths under public/js, resolved from where the module stands
const imports = (name, src) =>
  [...src.matchAll(IMPORT)].map((m) => posix.join(posix.dirname(name), m[1]));

test("the sweep reads each import form and sees through an import list's comments", () => {
  const src = [
    "import {",
    "  a, // one; two",
    '  /* "b" */ b,',
    "  c, // don't",
    '} from "./x.js";',
    'import "./y.js";',
    'export { d } from "../z.js";',
    '// import { e } from "./gone.js";',
  ].join("\n");
  assert.deepEqual(imports("ui/m.js", src), ["ui/x.js", "ui/y.js", "z.js"]);
});

// every module under public/js, by its path there
function modules(at = "") {
  return readdirSync(new URL(at || ".", dir), { withFileTypes: true })
    .flatMap((e) => {
      const path = posix.join(at, e.name);
      if (e.isDirectory()) return modules(path);
      return e.name.endsWith(".js") ? [path] : [];
    })
    .sort();
}
const byName = (files) => new Map(files.map((f) => [posix.basename(f), f]));

// The folders are layers, and a module reaches only its own layer and those
// beneath it. A row names the folders a module in that folder may import from,
// itself included, a single file of a folder where a further import from it is
// to be a change of the row, or the root's config.js. "." is the root.
const LAYERS = {
  ui: ["ui"],
  engine: ["engine", "config.js"],
  model: ["model", "engine/lcd.js", "config.js"],
  rules: ["rules", "model", "engine", "config.js"],
  data: ["data", "model", "engine/collide.js", "ui/searchquery.js", "config.js"],
  painter: ["painter", "rules", "data", "model", "engine", "ui", "config.js"],
  navigation: ["navigation", "painter", "data", "model", "engine", "ui", "config.js"],
  panels: ["panels", "navigation", "painter", "data", "model", "ui", "config.js"],
  chrome: [
    "chrome",
    "panels",
    "navigation",
    "painter",
    "data",
    "model",
    "engine",
    "ui",
    "config.js",
  ],
  ".": [
    "chrome",
    "data",
    "engine",
    "model",
    "navigation",
    "painter",
    "panels",
    "rules",
    "ui",
    "config.js",
  ],
};

// every viewer module, with the modules its import statements name
function importGraph() {
  const files = modules();
  const deps = new Map();
  for (const f of files) {
    const specs = imports(f, readFileSync(new URL(f, dir), "utf8"));
    for (const s of specs) assert.ok(files.includes(s), `${f} imports ${s}, which is not there`);
    deps.set(f, specs);
  }
  return deps;
}

// The regression guard for the whole suite: the modules of these folders, and
// these files beside them, must never touch the DOM at import time, or nothing
// but a browser session would catch it.
const PURE_FOLDERS = ["engine", "model", "rules", "data"];
const PURE_FILES = ["config.js", "ui/redraw.js", "ui/searchquery.js", "painter/kept.js"];

test("the pure folders and files import in bare Node", async () => {
  const files = modules();
  for (const d of PURE_FOLDERS)
    assert.ok(
      files.some((f) => posix.dirname(f) === d),
      `${d}/ holds a module`,
    );
  for (const f of PURE_FILES) assert.ok(files.includes(f), `${f} is a module`);
  const pure = files.filter(
    (f) => PURE_FOLDERS.includes(posix.dirname(f)) || PURE_FILES.includes(f),
  );
  for (const f of pure) await import(new URL(f, dir));
});

// A cycle between ES modules links and runs without complaint for as long as no
// module reads an imported binding mid-evaluation, so nothing but the import
// statements themselves says one has formed.
test("the viewer's modules import one way", () => {
  const deps = importGraph();
  const files = [...deps.keys()];

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

test("a module imports only its own layer and those beneath it", () => {
  const deps = importGraph();
  assert.equal(byName([...deps.keys()]).size, deps.size, "every module's name is its own");
  const folders = new Set([...deps.keys()].map((f) => posix.dirname(f)));
  assert.deepEqual(
    [...folders].filter((f) => !LAYERS[f]).sort(),
    [],
    "every folder under public/js has a row in the table",
  );
  assert.deepEqual(
    Object.keys(LAYERS).filter((f) => !folders.has(f)),
    [],
    "every row names a folder under public/js",
  );
  // a row's entries as folders: a file entry stands for its folder, a root file for none
  const folderOf = (e) => (LAYERS[e] ? e : e.includes("/") ? posix.dirname(e) : null);
  const stray = [];
  for (const [f, row] of Object.entries(LAYERS))
    for (const e of row)
      if (!LAYERS[e] && !(e.includes("/") ? LAYERS[posix.dirname(e)] : deps.has(e)))
        stray.push(`${f}: ${e}`);
  assert.deepEqual(stray, [], "every entry of a row is a folder with a row or a file under one");
  const cyclic = [];
  const seen = new Map();
  const walk = (f, trail) => {
    seen.set(f, "open");
    for (const g of new Set(LAYERS[f].map(folderOf).filter((g) => g && g !== f)))
      if (seen.get(g) === "open") cyclic.push([...trail, g].join(" -> "));
      else if (!seen.has(g)) walk(g, [...trail, g]);
    seen.set(f, "done");
  };
  for (const f of Object.keys(LAYERS)) if (!seen.has(f)) walk(f, [f]);
  assert.deepEqual(cyclic, [], "a row names only itself and the rows beneath it");
  const unused = [];
  for (const [f, row] of Object.entries(LAYERS))
    for (const e of row.filter((e) => e.includes("/")))
      if (![...deps].some(([m, specs]) => posix.dirname(m) === f && specs.includes(e)))
        unused.push(`${f}: ${e}`);
  assert.deepEqual(unused, [], "a file a row names is imported by a module of that folder");
  const wrong = [];
  for (const [f, specs] of deps) {
    const allowed = LAYERS[posix.dirname(f)];
    for (const d of specs)
      if (!allowed.includes(posix.dirname(d)) && !allowed.includes(d))
        wrong.push(`${f} imports ${d}`);
  }
  assert.deepEqual(wrong, []);
});

// model.js is handed the layout and the dataset, level and path a call depends
// on, so nothing it runs may reach the module holding the live ones
test("model.js never reaches state.js", () => {
  const deps = importGraph();
  const where = byName([...deps.keys()]);
  const model = where.get("model.js"),
    state = where.get("state.js");
  const from = new Map([[model, null]]);
  for (const f of from.keys()) for (const d of deps.get(f)) if (!from.has(d)) from.set(d, f);
  const trail = [];
  for (let f = from.has(state) ? state : null; f; f = from.get(f)) trail.unshift(f);
  assert.deepEqual(trail, [], `model.js reaches state.js: ${trail.join(" -> ")}`);
});

// the Wayback Machine declares these above the first line of every module it serves
const WAYBACK = ["window", "self", "document", "location", "top", "parent", "frames", "opener"];

test("every module parses as the Wayback Machine serves it", () => {
  const above = WAYBACK.map((name) => `var ${name};`).join(" ");
  const linter = new Linter();
  const errors = modules().flatMap((f) =>
    linter
      .verify(above + readFileSync(new URL(f, dir), "utf8"), {
        languageOptions: { ecmaVersion: "latest", sourceType: "module" },
      })
      .map((e) => `${f}:${e.line}: ${e.message}`),
  );
  assert.deepEqual(errors, []);
});
