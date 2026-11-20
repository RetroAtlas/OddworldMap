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

// a list split at the commas that stand outside every bracket
function listed(text) {
  const out = [];
  let depth = 0,
    from = 0;
  for (let i = 0; i <= text.length; i++) {
    if ("([".includes(text[i])) depth++;
    if (")]".includes(text[i])) depth--;
    if (i === text.length || (text[i] === "," && !depth)) {
      out.push(text.slice(from, i).trim().replace(/\s+/g, " "));
      from = i + 1;
    }
  }
  return out;
}

// the partials' style rules in cascade order: each one's selectors, its declarations and the
// media queries it stands under
function styleRules() {
  const out = [];
  const walk = (text, under) => {
    for (let at = 0, open; (open = text.indexOf("{", at)) >= 0;) {
      let close = open + 1;
      for (let depth = 1; depth && close < text.length; close++)
        depth += { "{": 1, "}": -1 }[text[close]] ?? 0;
      const head = text.slice(at, open).trim();
      const body = text.slice(open + 1, close - 1);
      at = close;
      if (head.startsWith("@media")) walk(body, [...under, head.replace(/\s+/g, " ")]);
      else if (!head.startsWith("@keyframes")) {
        assert.ok(!head.startsWith("@"), `${head} is an at-rule this reading knows`);
        assert.ok(!body.includes("{"), `${head} holds no rule within it, which this reading skips`);
        const declared = body.split(";").map((d) => d.trim().replace(/\s+/g, " "));
        out.push({ selectors: listed(head), declared: declared.filter(Boolean), under });
      }
    }
  };
  for (const f of partials)
    walk(readFileSync(new URL(`css/${f}`, pub), "utf8").replace(/\/\*[\s\S]*?\*\//g, ""), []);
  return out;
}

test("stylesheet: reduced motion is one list under two keys, stilling every rule that sets a transition or an animation", () => {
  const ASKED = "@media (prefers-reduced-motion: reduce)";
  const SYSTEM = ":root:not([data-motion]) ";
  const CHOICE = ':root[data-motion="reduce"] ';
  const rules = styleRules();
  const keyed = (key, among) =>
    among.map(({ selectors, declared }) => {
      for (const s of selectors) assert.ok(s.startsWith(key), `${s} stands under ${key.trim()}`);
      return { selectors: selectors.map((s) => s.slice(key.length)), declared };
    });
  const asks = (r) => r.under.some((q) => q.includes("prefers-reduced-motion"));
  const names = (r) => r.selectors.some((s) => s.includes("data-motion"));
  for (const r of rules.filter(asks))
    assert.deepEqual(r.under, [ASKED], `${r.selectors[0]} asks the system and nothing beside`);
  const bySystem = keyed(SYSTEM, rules.filter(asks));
  const byChoice = keyed(
    CHOICE,
    rules.filter((r) => names(r) && !asks(r)),
  );
  assert.ok(bySystem.length > 0, "a rule under the system's query");
  assert.deepEqual(byChoice, bySystem, "the two keys carry one list");
  // what the list does to each selector it names
  const done = new Map();
  for (const r of bySystem)
    for (const s of r.selectors) done.set(s, [...(done.get(s) ?? []), ...r.declared]);
  // a transition or an animation set by its shorthand or a longhand, under a vendor's prefix or none
  const MOVES = /^(?:-[a-z]+-)?(transition|animation)(?:-[a-z-]+)?\s*:\s*(.*)$/;
  let moving = 0;
  for (const r of rules.filter((r) => !asks(r) && !names(r)))
    for (const d of r.declared) {
      const [, kind, value] = MOVES.exec(d) ?? [];
      if (!kind || value === "none") continue;
      moving++;
      const whose = (s) => `the ${kind} of ${s}`;
      assert.ok(
        !value.endsWith("!important"),
        `${whose(r.selectors[0])} yields to the list's rule`,
      );
      for (const s of r.selectors) {
        const does = done.get(s) ?? [];
        assert.ok(
          does.includes(`${kind}: none`) || does.includes("display: none"),
          `${whose(s)} is taken away or hidden by the list`,
        );
      }
    }
  assert.ok(moving > 0, "a rule that sets a transition or an animation");
});
