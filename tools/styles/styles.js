// npm run styles [-- <ref>] [--dump <dir>]: what the stylesheet shows over a set of interface
// states at the working tree and at a ref, HEAD unless one is named: the computed style of every
// element of the page and of every pseudo-element it draws, hashed in the page, with the clock
// stopped and motion reduced. The ref is served straight from the repository, so nothing is checked
// out or stored. A state may first open a panel, a dialog or a mode through the page's own
// controls, as states.js has it. The run names every state in which an element shows differently,
// with the properties, and fails on one; --dump writes each state's element list for both trees.
import { chromium } from "@playwright/test";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { fromRef, fromTree, refExists, refModules, serve, treeModules } from "../trees.js";
import { REST, open, settled, states } from "./states.js";

const args = process.argv.slice(2);
const dumpAt = args.indexOf("--dump");
const DUMP = dumpAt >= 0 ? args.splice(dumpAt, 2)[1] : null;
const REF = args[0] ?? "HEAD";

// one state at one tree: the page opened and settled, the state's steps taken and what they
// opened standing, and every element's style hashed
async function capture(browser, side, state) {
  const ctx = await browser.newContext({
    ...state.screen,
    deviceScaleFactor: 1,
    reducedMotion: "reduce",
  });
  const page = await ctx.newPage();
  await open(page, side, state);
  await state.steps?.(page);
  // a step leaves the pointer on its button, whose anchored tip would show on its own clock
  if (!state.held) await page.mouse.move(REST.x, REST.y);
  await page.waitForSelector(state.stands, { state: "visible", timeout: 10000 });
  await settled(page);
  await page.waitForTimeout(400);
  // every element and the pseudo-elements it draws, hashed as the state stands, with motion allowed and
  // every animation held, and with the hover, focus and active rules forced; the texts stay for a
  // difference's detail
  await page.evaluate(() => {
    const pathOf = (el) => {
      const parts = [];
      for (let e = el; e; e = e.parentElement) {
        const i = e.parentElement ? [...e.parentElement.children].indexOf(e) : 0;
        parts.unshift(`${e.tagName.toLowerCase()}${e.id ? "#" + e.id : ""}[${i}]`);
      }
      return parts.join(">");
    };
    // the custom properties come in the order their sheets landed, so the list is sorted
    const text = (cs) =>
      Array.from(cs)
        .sort()
        .map((p) => `${p}=${cs.getPropertyValue(p)}`)
        .join("\0");
    const sha = async (s) =>
      [...new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s)))]
        .map((b) => b.toString(16).padStart(2, "0"))
        .join("");
    window.__styleText = new Map();
    window.__snap = async (suffix) => {
      const out = {};
      // the toasts come and go on their own clock, so they are no part of a state
      for (const el of document.querySelectorAll("html, body, body *")) {
        if (el.closest("#toastStack")) continue;
        const key = pathOf(el);
        const reads = [[key, null]];
        for (const pseudo of ["::before", "::after"])
          if (getComputedStyle(el, pseudo).content !== "none") reads.push([key + pseudo, pseudo]);
        for (const [k, pseudo] of reads) {
          const s = text(getComputedStyle(el, pseudo));
          window.__styleText.set(k + suffix, s);
          out[k + suffix] = await sha(s);
        }
      }
      return out;
    };
  });
  const plain = await page.evaluate(() => window.__snap(""));
  // the rules reduced motion switches off, read with every animation held at its first frame
  const cdp = await ctx.newCDPSession(page);
  await cdp.send("Animation.enable");
  await cdp.send("Animation.setPlaybackRate", { playbackRate: 0 });
  await page.emulateMedia({ reducedMotion: "no-preference" });
  await settled(page);
  const motion = await page.evaluate(() => window.__snap(" motion"));
  // a forced hover would start the transitions the two reads above already compare
  await page.addStyleTag({
    content: "*, *::before, *::after { transition: none !important; animation: none !important; }",
  });
  await cdp.send("DOM.enable");
  await cdp.send("CSS.enable");
  const { root } = await cdp.send("DOM.getDocument", { depth: -1 });
  const ids = [];
  const walk = (n) => {
    if (n.nodeType === 1) ids.push(n.nodeId);
    (n.children ?? []).forEach(walk);
  };
  walk(root);
  for (const nodeId of ids)
    await cdp.send("CSS.forcePseudoState", {
      nodeId,
      forcedPseudoClasses: ["hover", "focus", "focus-visible", "active"],
    });
  await settled(page);
  const forced = await page.evaluate(() => window.__snap(" forced"));
  const styles = { ...plain, ...motion, ...forced };
  const detail = (keys) =>
    page.evaluate(
      (keys) =>
        Object.fromEntries(
          keys
            .filter((k) => window.__styleText.has(k))
            .map((k) => [
              k,
              Object.fromEntries(
                window.__styleText
                  .get(k)
                  .split("\0")
                  .map((d) => [d.slice(0, d.indexOf("=")), d.slice(d.indexOf("=") + 1)]),
              ),
            ]),
        ),
      keys,
    );
  return { styles, detail, close: () => ctx.close() };
}

if (!(await refExists(REF))) {
  console.error(`no such ref: ${REF}`);
  process.exit(2);
}
const browser = await chromium.launch();
const tree = await serve(fromTree);
const ref = await serve(fromRef(REF));
const sides = [
  { base: `http://127.0.0.1:${tree.address().port}`, modules: await treeModules() },
  { base: `http://127.0.0.1:${ref.address().port}`, modules: await refModules(REF) },
];
let differing = 0;
try {
  if (DUMP) await mkdir(DUMP, { recursive: true });
  for (const [i, state] of states.entries()) {
    const [a, b] = await Promise.all([
      capture(browser, sides[0], state),
      capture(browser, sides[1], state),
    ]);
    if (DUMP)
      for (const [side, got] of [
        ["tree", a],
        ["ref", b],
      ])
        await writeFile(
          join(
            DUMP,
            `${String(i).padStart(2, "0")}-${state.name.replace(/\W+/g, "-")}.${side}.json`,
          ),
          JSON.stringify(got.styles, null, 1),
        );
    const keys = [...new Set([...Object.keys(a.styles), ...Object.keys(b.styles)])];
    const differs = keys.filter((k) => a.styles[k] !== b.styles[k]);
    if (differs.length) {
      differing++;
      console.log(`DIFF ${state.name}: ${differs.length} of ${keys.length} elements`);
      const [da, db] = await Promise.all([
        a.detail(differs.slice(0, 6)),
        b.detail(differs.slice(0, 6)),
      ]);
      for (const k of differs.slice(0, 6)) {
        const x = db[k],
          y = da[k];
        if (!x || !y) {
          console.log(`  ${k}: only at ${x ? REF : "the working tree"}`);
          continue;
        }
        const props = [...new Set([...Object.keys(x), ...Object.keys(y)])].filter(
          (p) => x[p] !== y[p],
        );
        console.log(`  ${k}`);
        for (const p of props.slice(0, 4)) console.log(`      ${p}: ${x[p]} -> ${y[p]}`);
      }
    } else console.log(`ok   ${state.name}: ${keys.length} elements`);
    await Promise.all([a.close(), b.close()]);
  }
  console.log(
    differing
      ? `${differing} of ${states.length} states differ between ${REF} and the working tree`
      : `${states.length} states show alike at ${REF} and the working tree`,
  );
  process.exitCode = differing ? 1 : 0;
} catch (e) {
  console.error(e.message);
  process.exitCode = 2;
} finally {
  await browser.close();
  tree.close();
  ref.close();
}
