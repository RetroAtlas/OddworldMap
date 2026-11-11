// Opens the page from the working tree and from a git ref, HEAD unless one
// is given, in every interface state of states.js, each on a page of its
// own with its clock stopped, and compares the computed style of every
// element and of every ::before and ::after it draws, read as the state
// stands under reduced motion, with motion allowed and every animation held
// at its first frame, and with hover, focus and active forced on every
// element, each alone and then all at once. It names every state in which a
// read differs, with the elements and the properties, and every error a page
// logs. A change to the stylesheet that is to show exactly as before passes
// with nothing named.
//
//     npm run styles -- [<ref>] [--dump <dir>] [--only <text>]... [--unseen]
//
// --dump writes each state's reads at both trees as JSON, --only runs the
// states whose names hold a text, and --unseen lists every rule of the
// page's stylesheets that no state run puts on screen.
import { mkdir, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { chromium } from "@playwright/test";
import { fromRef, fromTree, refExists, refModules, serve, treeModules } from "../trees.js";
import { REST, open, settled, states } from "./states.js";

/** End a run that cannot start. */
function refuse(why) {
  console.error(why);
  process.exit(2);
}

const args = process.argv.slice(2);
/** Every value the arguments give after `name`, taken out of them. */
const values = (name) => {
  const out = [];
  for (let i = args.indexOf(name); i >= 0; i = args.indexOf(name)) {
    const [, value] = args.splice(i, 2);
    if (value === undefined || value.startsWith("--")) refuse(`${name} takes a value`);
    out.push(value);
  }
  return out;
};
/** Whether the arguments hold `name`, taken out of them. */
const flag = (name) => args.includes(name) && args.splice(args.indexOf(name), 1).length > 0;
const [dump = null] = values("--dump");
const only = values("--only");
const listing = flag("--unseen");
const ref = args[0] || "HEAD";

const TREE = "the working tree";
const STANDING = "as it stands";
const MOTION = "with motion";
const PSEUDO = ["hover", "focus", "focus-visible", "active"];
// what a pointer or a key can put on an element, each alone and then all at once: forced
// together, a rule under one class hides a rule of equal weight under another
const FORCED = [["hover"], ["focus"], ["focus", "focus-visible"], ["active"], PSEUDO];
/** The name of the read that forces `classes` on every element. */
const forcing = (classes) => `${classes === PSEUDO ? "all" : classes.join(" and ")} forced`;
const READS = [STANDING, MOTION, ...FORCED.map(forcing)];
const ABSENT = "(absent)";
const STILL = "*, *::before, *::after { transition: none !important; animation: none !important; }";
const OPENS_MS = 10000;
const TRIES = 3;
const ELEMENTS = 6;
const PROPERTIES = 4;
const CHUNK = 200;

/** In the page: a hash of the computed style of each element and drawn pseudo-element, by path. */
async function read(name) {
  const texts = new Map();
  // sorted, since the browser lists custom properties in an order that differs between loads
  const text = (style) =>
    Array.from(style)
      .sort()
      .map((property) => `${property}=${style.getPropertyValue(property)}`)
      .join("\0");
  const walk = (el, path) => {
    texts.set(path, text(getComputedStyle(el)));
    for (const pseudo of ["::before", "::after"]) {
      const style = getComputedStyle(el, pseudo);
      if (style.content !== "none") texts.set(path + pseudo, text(style));
    }
    [...el.children].forEach((child, i) => {
      if (child !== document.head)
        walk(child, `${path} > ${child.localName}${child.id ? `#${child.id}` : ""}[${i}]`);
    });
  };
  walk(document.documentElement, "html[0]");
  (window.__styles ??= {})[name] = texts;
  const hex = async (s) =>
    [...new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s)))]
      .map((byte) => byte.toString(16).padStart(2, "0"))
      .join("");
  return Object.fromEntries(
    await Promise.all([...texts].map(async ([path, s]) => [path, await hex(s)])),
  );
}

/** In the page: the texts a read kept for `paths`, null where it kept none. */
const kept = ([name, paths]) => paths.map((path) => window.__styles[name].get(path) ?? null);

/** In the page: each style rule of the linked stylesheets, with whether the page shows it. */
function shown() {
  const bare = (selectors) =>
    selectors.replace(
      /::[\w-]+(\([^()]*\))?|:(hover|focus-visible|focus-within|focus|active|before|after)(?![\w-])/g,
      ":is(*)",
    );
  const out = [];
  const walk = (rules, sheet, queries) => {
    for (const rule of rules) {
      if (rule instanceof CSSMediaRule)
        walk(rule.cssRules, sheet, [...queries, rule.conditionText]);
      if (!(rule instanceof CSSStyleRule)) continue;
      let found = [];
      try {
        found = [...document.querySelectorAll(bare(rule.selectorText))];
      } catch {
        found = [];
      }
      // a rule that hides is shown where its element would be drawn without it
      const hides = rule.style.display === "none";
      const priority = rule.style.getPropertyPriority("display");
      if (hides) rule.style.removeProperty("display");
      const on = found.some((el) => el.checkVisibility());
      if (hides) rule.style.setProperty("display", "none", priority);
      out.push([
        `${sheet.path}#${sheet.rules++}`,
        `${queries.map((query) => `@media ${query} `).join("")}${rule.selectorText}`,
        on && queries.every((query) => matchMedia(query).matches),
      ]);
    }
  };
  for (const sheet of document.styleSheets)
    if (sheet.href) walk(sheet.cssRules, { path: new URL(sheet.href).pathname, rules: 0 }, []);
  return out;
}

/** The ids of the elements under a node of the document, as the browser's protocol lists it. */
const elementsOf = (node) => [
  ...(node.nodeType === 1 ? [node.nodeId] : []),
  ...(node.children ?? []).flatMap(elementsOf),
];

/** Every read of a stopped page; with `counting`, what it shows of its stylesheets as well. */
async function readings(page, counting) {
  const reads = {};
  const seen = [];
  const look = async () => counting && seen.push(...(await page.evaluate(shown)));
  reads[STANDING] = await page.evaluate(read, STANDING);
  await look();
  // every animation is held before the media changes, so one it starts stays at its first frame
  const cdp = await page.context().newCDPSession(page);
  await cdp.send("Animation.enable");
  await cdp.send("Animation.setPlaybackRate", { playbackRate: 0 });
  await page.emulateMedia({ reducedMotion: "no-preference" });
  reads[MOTION] = await page.evaluate(read, MOTION);
  await look();
  // a forced hover starts transitions
  await page.addStyleTag({ content: STILL });
  await page.emulateMedia({ reducedMotion: "reduce" });
  await cdp.send("DOM.enable");
  await cdp.send("CSS.enable");
  const { root } = await cdp.send("DOM.getDocument", { depth: -1 });
  const nodes = elementsOf(root);
  // what is forced on a node takes the place of what was
  for (const forcedPseudoClasses of FORCED) {
    await Promise.all(
      nodes.map((nodeId) => cdp.send("CSS.forcePseudoState", { nodeId, forcedPseudoClasses })),
    );
    const name = forcing(forcedPseudoClasses);
    reads[name] = await page.evaluate(read, name);
  }
  return { reads, seen };
}

/** Open a state on a page, settle it and stop its clock; whether what it opened still stands. */
async function stopped(page, side, state, doing) {
  doing("opening the page");
  await page.clock.install();
  await open(page, side, state);
  doing("taking its steps");
  await state.steps?.(page);
  if (!state.held) {
    await page.mouse.move(REST.x, REST.y);
    await page.waitForFunction(() => !document.querySelector(":active"));
  }
  doing(`waiting for ${state.stands} to stand`);
  await page.waitForSelector(state.stands, { state: "visible" });
  doing("settling its layout");
  await settled(page, state);
  doing("being read");
  // the clock cannot stop at a time it has passed; once stopped, no timer and no frame runs
  await page.clock.pauseAt((await page.evaluate(() => Date.now())) + 1000);
  await page.evaluate(() => document.getAnimations().forEach((animation) => animation.finish()));
  return page.locator(state.stands).first().isVisible();
}

/** One state at one tree on a page of its own, read with what it opened still standing. */
async function capture(browser, side, state, counting) {
  const errors = [];
  let doing = "opening the page";
  try {
    for (let tries = TRIES; ; tries--) {
      const context = await browser.newContext({
        ...state.screen,
        deviceScaleFactor: 1,
        reducedMotion: "reduce",
      });
      context.setDefaultTimeout(OPENS_MS);
      const page = await context.newPage();
      page.on("pageerror", (e) => errors.push(`page error: ${e.message}`));
      page.on("console", (m) => m.type() === "error" && errors.push(`console: ${m.text()}`));
      if (await stopped(page, side, state, (what) => (doing = what))) {
        const { reads, seen } = await readings(page, counting);
        return {
          reads,
          seen,
          errors,
          kept: (name, paths) => page.evaluate(kept, [name, paths]),
          close: () => context.close(),
        };
      }
      // what leaves by a timer of its own leaves ahead of the stop where the machine stalls
      await context.close();
      const left = `${state.stands} had left when the clock stopped`;
      if (tries === 1) throw new Error(left);
      console.error(`opening "${state.name}" again: ${left}`);
    }
  } catch (e) {
    throw Object.assign(new Error(`${doing}: ${e.message.split("\n")[0]}`), { errors });
  }
}

/** A state at both trees at once, the working tree first; one that fails at either fails the run. */
const both = (browser, sides, state) =>
  Promise.all(
    sides.map(([name, side], i) =>
      capture(browser, side, state, i === 0).catch((e) => {
        for (const text of e.errors ?? [])
          console.error(`error at ${name} in ${state.name}: ${text}`);
        throw new Error(`the state "${state.name}" failed at ${name}, ${e.message}`);
      }),
    ),
  );

/** A kept text as its properties. */
const propertiesOf = (text) =>
  new Map(text.split("\0").map((d) => [d.slice(0, d.indexOf("=")), d.slice(d.indexOf("=") + 1)]));

/** What differs between an element's two texts: the one tree that has it, or each property. */
function between(was, now) {
  if (was === null || now === null) return { only: was === null ? TREE : ref };
  const [a, b] = [propertiesOf(was), propertiesOf(now)];
  const differing = [...new Set([...a.keys(), ...b.keys()])].filter((p) => a.get(p) !== b.get(p));
  // the shortest names first, which puts a property before the ones that follow it
  differing.sort((p, q) => p.length - q.length || (p < q ? -1 : 1));
  return { properties: differing.map((p) => [p, a.get(p) ?? ABSENT, b.get(p) ?? ABSENT]) };
}

/** Every path either tree has in a read. */
const pathsOf = (ours, theirs, name) => [
  ...new Set([...Object.keys(theirs.reads[name]), ...Object.keys(ours.reads[name])]),
];

/** Every read the two trees do not share alike, in the page's order, each with what differs. */
async function differences(ours, theirs) {
  const out = [];
  for (const name of Object.keys(ours.reads)) {
    const paths = pathsOf(ours, theirs, name).filter(
      (path) => ours.reads[name][path] !== theirs.reads[name][path],
    );
    for (let at = 0; at < paths.length; at += CHUNK) {
      const some = paths.slice(at, at + CHUNK);
      const [was, now] = await Promise.all([theirs.kept(name, some), ours.kept(name, some)]);
      some.forEach((path, i) => out.push({ name, path, ...between(was[i], now[i]) }));
    }
  }
  return out;
}

/** The path of the element that the one at `path` stands in or grows from, null above html. */
function above(path) {
  const pseudo = /::(before|after)$/.exec(path);
  if (pseudo) return path.slice(0, pseudo.index);
  const cut = path.lastIndexOf(" > ");
  return cut < 0 ? null : path.slice(0, cut);
}

/** Whether a difference is no more than the one above it, as that of an inherited property is. */
const handedDown = (d, up) =>
  !!up &&
  (d.only
    ? d.only === up.only
    : !!up.properties &&
      d.properties.every(([p, was, now]) =>
        up.properties.some(([q, a, b]) => q === p && a === was && b === now),
      ));

/** The differences not handed down from above, with how many under each are, alike reads as one. */
function topmost(found) {
  const by = new Map(found.map((d) => [`${d.name}\0${d.path}`, d]));
  const topOf = (d) => {
    const up = by.get(`${d.name}\0${above(d.path)}`);
    return handedDown(d, up) ? topOf(up) : d;
  };
  const more = new Map();
  for (const d of found) {
    const top = topOf(d);
    more.set(top, (more.get(top) ?? 0) + (top === d ? 0 : 1));
  }
  const out = new Map();
  for (const [d, n] of more) {
    const key = JSON.stringify([d.path, d.only, d.properties, n]);
    if (out.has(key)) out.get(key).names.push(d.name);
    else out.set(key, { ...d, more: n, names: [d.name] });
  }
  return [...out.values()];
}

/** Print a state's verdict, its first differing elements and their first properties, its errors. */
function report(state, found, total, errors) {
  if (!found.length) console.log(`ok   ${state.name}: ${total} reads`);
  else {
    console.log(`DIFF ${state.name}: ${found.length} of ${total} reads`);
    const tops = topmost(found);
    for (const d of tops.slice(0, ELEMENTS)) {
      const where = d.names.length === READS.length ? "every read" : d.names.join(", ");
      console.log(`  ${d.path}, ${where}${d.only ? `: only at ${d.only}` : ""}`);
      for (const [p, was, now] of (d.properties ?? []).slice(0, PROPERTIES))
        console.log(`      ${p}: ${was} -> ${now}`);
      if (d.properties?.length > PROPERTIES)
        console.log(`      and ${d.properties.length - PROPERTIES} more properties`);
      if (d.more) console.log(`      and ${d.more} more ${d.only ? "under it" : "inherit it"}`);
    }
    if (tops.length > ELEMENTS) console.log(`  and ${tops.length - ELEMENTS} more elements`);
  }
  for (const [side, text] of errors) console.log(`  error at ${side} in ${state.name}: ${text}`);
}

/** Write a state's reads at both trees under the dump's folder. */
async function dumped(state, ours, theirs) {
  const nth = String(states.indexOf(state)).padStart(2, "0");
  const name = `${nth}-${state.name.replace(/\W+/g, "-")}`;
  for (const [side, got] of [
    ["tree", ours],
    ["ref", theirs],
  ])
    await writeFile(
      join(resolve(dump), `${name}.${side}.json`),
      JSON.stringify(got.reads, null, 1),
    );
}

if (!(await refExists(ref))) refuse(`no such ref: ${ref}`);
const todo = states.filter((state) => !only.length || only.some((t) => state.name.includes(t)));
if (!todo.length) refuse(`no state's name holds ${only.join(" or ")}`);
const browser = await chromium.launch();
const servers = await Promise.all([serve(fromTree), serve(fromRef(ref))]);
const modules = await Promise.all([treeModules(), refModules(ref)]);
const sides = [TREE, ref].map((name, i) => [
  name,
  { base: `http://127.0.0.1:${servers[i].address().port}`, modules: modules[i] },
]);
const started = Date.now();
const rules = new Map();
let differing = 0;
let erring = 0;
try {
  if (dump) await mkdir(resolve(dump), { recursive: true });
  for (const state of todo) {
    const [ours, theirs] = await both(browser, sides, state);
    for (const [id, label, on] of ours.seen)
      rules.set(id, { label, on: on || !!rules.get(id)?.on });
    if (dump) await dumped(state, ours, theirs);
    const found = await differences(ours, theirs);
    const total = Object.keys(ours.reads).reduce(
      (n, name) => n + pathsOf(ours, theirs, name).length,
      0,
    );
    const errors = [ours, theirs].flatMap((got, i) =>
      got.errors.map((text) => [sides[i][0], text]),
    );
    report(state, found, total, errors);
    if (found.length) differing++;
    if (errors.length) erring++;
    await Promise.all([ours.close(), theirs.close()]);
  }
  const unseen = [...rules.values()].filter((rule) => !rule.on);
  const counted = `${unseen.length} of ${rules.size} rules, counted by rule and not by selector`;
  console.log(`${counted}, are shown by no state${only.length ? " run" : ""}`);
  if (listing) for (const rule of unseen) console.log(`  ${rule.label}`);
  const took = ((Date.now() - started) / 1000).toFixed(0);
  const erred = erring ? `, ${erring} with an error on the page` : "";
  const trees = `${ref} and the working tree${erred} (${took}s)`;
  console.log(
    differing
      ? `${differing} of ${todo.length} states differ between ${trees}`
      : `${todo.length} states show alike at ${trees}`,
  );
  process.exitCode = differing || erring ? 1 : 0;
} catch (e) {
  console.error(e.message);
  process.exitCode = 2;
} finally {
  await browser.close();
  for (const server of servers) server.close();
}
