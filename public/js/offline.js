// Offline storage, the page's half of sw.js: warming the app shell when the
// setting goes on, and the Settings panel that stores a whole game's artwork in
// one go, so a place you have never opened still opens with no connection.

import { CAM_FILE_BYTES, SHEET_FILE_BYTES } from "./config.js";
import { GAME_FILES, GAME_IDS, loadSprites } from "./data.js";
import { hasStoredEdits } from "./edits.js";
import { $ } from "./dom.js";
import { camFiles } from "./model.js";
import {
  MARKER_CACHE,
  displayLabel,
  getSettings,
  markerReady,
  workerRegistered,
} from "./settings.js";
import { state } from "./state.js";
import { toast } from "./toast.js";

const CONCURRENCY = 6; // fetches in flight
const CONTROL_MS = 10000; // how long a download waits for the worker to take the page
const PROGRESS_MS = 120; // redraw pace while files land

const sleep = (ms) => new Promise((res) => setTimeout(res, ms));
// an atlas is sized as a sheet; the font map beside them is a few hundred bytes
const bytesOf = (url) => (/\/sprites\/.*\/\d+\.png$/.test(url) ? SHEET_FILE_BYTES : CAM_FILE_BYTES);
const estimateMB = (urls) => Math.round(urls.reduce((n, u) => n + bytesOf(u), 0) / 1e6);

// the worker only answers fetches on a page it controls, so nothing is worth
// downloading until it has one. A first registration's claim() can land after
// ready resolves, and a worker that never arrives must not hang the caller.
async function whenControlled() {
  if (!("serviceWorker" in navigator)) return false;
  if (!navigator.serviceWorker.controller) {
    const taken = navigator.serviceWorker.ready.then(
      () =>
        navigator.serviceWorker.controller ||
        new Promise((res) =>
          navigator.serviceWorker.addEventListener("controllerchange", res, { once: true }),
        ),
    );
    await Promise.race([taken.catch(() => {}), sleep(CONTROL_MS)]);
  }
  return !!navigator.serviceWorker.controller;
}

// the worker stores only what passes through it, and a page from before it
// loaded uncontrolled — so once the worker takes the page, re-fetch everything
// it already pulled, and offline works from the enabling visit onward. Named
// outright: the document, which is no resource entry of its own, the datasets,
// one of which may still be in flight and so have no entry yet, and the editor
// data a game with saved edits boots through
async function warmShell() {
  await markerReady();
  if (!(await whenControlled())) return;
  if (!getSettings().cacheMap) return; // toggled back off before the worker took the page
  const named = [
    "index.html",
    ...Object.values(GAME_FILES),
    ...GAME_IDS.map((id) => `sprites_${id.toLowerCase()}.json`),
    ...GAME_IDS.filter(hasStoredEdits).map((id) => `relive_export_${id.toLowerCase()}.json`),
  ];
  const urls = new Set(named.map((f) => new URL(f, location.href).href));
  for (const e of performance.getEntriesByType("resource")) {
    const u = new URL(e.name, location.href);
    if (u.origin === location.origin) urls.add(u.href);
  }
  for (const url of urls) fetch(url).catch(() => {});
}

// what the artwork cache holds right now. Every "cams-" bucket but the marker
// is artwork: the worker deletes a stale one the moment it activates, so the
// union is the honest answer at any instant.
async function storedUrls() {
  const out = new Set();
  if (!("caches" in window)) return out;
  try {
    for (const name of await caches.keys()) {
      if (!name.startsWith("cams-") || name === MARKER_CACHE) continue;
      const cache = await caches.open(name);
      for (const req of await cache.keys()) out.add(req.url);
    }
  } catch {
    /* an unreadable cache reads as an empty one */
  }
  return out;
}

// one row per game: its whole file list, how much of that is stored, and the
// download in flight over it
const rows = new Map();
let active = null;

const complete = (row) => row.stored >= row.urls.length;
const idle = (row) => !row.running && !row.queued;
const pending = (row) => idle(row) && !complete(row);
const allUrls = () => [...rows.values()].flatMap((row) => row.urls);

function addSheets(row, sprites) {
  for (const f of sprites.sheets) {
    const url = new URL(f, location.href).href;
    if (!row.urls.includes(url)) row.urls.push(url);
  }
}

function buildRows() {
  const host = $("oflRows");
  for (const G of state.games) {
    if (rows.has(G.id)) continue;
    const el = document.createElement("div");
    el.className = "ofl-row";
    const name = document.createElement("div");
    name.className = "ofl-name";
    // named in full however the selector buttons are set: a download this size
    // is worth naming outright
    name.textContent = displayLabel(G.id, G.game, true);
    const stat = document.createElement("div");
    stat.className = "ofl-stat";
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "ofl-go";
    const bar = document.createElement("div");
    bar.className = "ofl-bar";
    // a progressbar rather than a live region: a percent that moves several
    // times a second must not announce, and the finishing toast already does
    bar.setAttribute("role", "progressbar");
    bar.setAttribute("aria-valuemin", "0");
    bar.setAttribute("aria-valuemax", "100");
    bar.setAttribute("aria-label", `${name.textContent} artwork stored`);
    const fill = document.createElement("i");
    bar.append(fill);
    el.append(name, btn, stat, bar);
    host.append(el);
    const row = {
      id: G.id,
      name: name.textContent,
      urls: camFiles(G).map((f) => new URL(f, location.href).href),
      stat,
      btn,
      bar,
      fill,
      stored: 0,
      done: 0,
      asked: false,
      running: false,
      queued: false,
      error: "",
      abort: null,
    };
    btn.onclick = () => (idle(row) ? start(row) : stop(row));
    rows.set(G.id, row);
  }
  askSheets();
}

// the sprite sheets are artwork too, listed once a game is on screen: that
// game asks at the painter's priority, the others behind its cams
function askSheets() {
  if (!state.data) return;
  for (const row of rows.values()) {
    if (row.asked) continue;
    row.asked = true;
    loadSprites(row.id, row.id !== state.data.id).then((d) => {
      if (!d) return;
      addSheets(row, d);
      refresh();
    });
  }
}
window.addEventListener("selection-changed", askSheets);

function render() {
  for (const row of rows.values()) {
    const files = row.urls.length;
    const pct = (n) => Math.round((n / Math.max(files, 1)) * 100);
    const shown = pct(row.running ? row.done : row.stored);
    row.fill.style.width = `${shown}%`;
    row.bar.setAttribute("aria-valuenow", shown);
    row.btn.hidden = idle(row) && complete(row);
    row.btn.textContent = idle(row) ? "Download" : "Stop";
    row.btn.setAttribute("aria-label", `${row.btn.textContent} ${row.name}`);
    if (row.queued) row.stat.textContent = "Waiting";
    else if (row.running) row.stat.textContent = `Storing… ${pct(row.done)}%`;
    else if (row.error) row.stat.textContent = row.error;
    else if (complete(row)) row.stat.textContent = "Stored on this device";
    else if (row.stored)
      row.stat.textContent = `${pct(row.stored)}% stored, about ${estimateMB(row.urls.slice(row.stored))} MB left`;
    else row.stat.textContent = `about ${estimateMB(row.urls)} MB`;
  }
  const both = $("oflBoth");
  both.textContent = `Download both games (about ${estimateMB(allUrls())} MB)`;
  both.hidden = rows.size < 2 || ![...rows.values()].some(pending);
}

let redraw = null;
function scheduleRender() {
  if (redraw) return;
  redraw = setTimeout(() => {
    redraw = null;
    render();
  }, PROGRESS_MS);
}

// re-read the cache: what a download achieved, and what plain browsing has
// stored since the panel last looked
async function refresh() {
  if (!rows.size) return;
  const have = await storedUrls();
  for (const row of rows.values())
    row.stored = row.urls.reduce((n, url) => n + (have.has(url) ? 1 : 0), 0);
  render();
}

function start(row) {
  if (!pending(row)) return;
  row.queued = true;
  row.error = "";
  render();
  pump();
}

function stop(row) {
  row.queued = false;
  row.abort?.abort();
  render();
}

// one game at a time, so a queued second game gets the whole connection rather
// than halving the first one's
async function pump() {
  if (active) return;
  active = [...rows.values()].find((row) => row.queued);
  if (!active) return;
  const row = active;
  row.queued = false;
  row.running = true;
  row.abort = new AbortController();
  render();
  let stopped = true;
  try {
    stopped = await download(row);
  } catch (err) {
    console.warn("offline storage: the download ended in an error", err);
  } finally {
    row.running = false;
    active = null;
  }
  await refresh();
  if (!stopped && !row.error)
    toast(
      complete(row)
        ? `${row.name} is stored on this device`
        : `${row.name}: some screens could not be stored`,
    );
  pump();
}

// fetch every file the cache is missing, letting the worker store each one on
// its way through. Returns whether it ended early.
async function download(row) {
  await markerReady();
  // a controlling worker stores whatever a later registration answered, so only
  // an uncontrolled page rides on that answer
  if (!navigator.serviceWorker?.controller && !(await workerRegistered())) {
    row.error = "This browser refused offline storage";
    return true;
  }
  if (!(await whenControlled())) {
    row.error = "Storage isn't ready: reload the page and try again";
    return true;
  }
  // artwork asked for this deliberately should outlive the browser's own
  // housekeeping, which is free to evict a merely-cached origin
  navigator.storage?.persist?.().catch(() => {});
  // the sheets are known only once the sidecar is in, so the list is settled here
  const sprites = await loadSprites(row.id);
  if (!sprites) {
    row.error = "The sprite sheets could not be listed: reload the page and try again";
    return true;
  }
  addSheets(row, sprites);
  const have = await storedUrls();
  const todo = row.urls.filter((url) => !have.has(url));
  row.done = row.urls.length - todo.length;
  render();
  let next = 0;
  const fetcher = async () => {
    while (next < todo.length && !row.abort.signal.aborted) {
      try {
        const res = await fetch(todo[next++], { signal: row.abort.signal });
        // the body has to be read: the copy the worker keeps is a clone of it
        if (res.ok) await res.blob();
      } catch {
        /* a file that fails stays missing, and the next run picks it up */
      }
      row.done++;
      scheduleRender();
    }
  };
  await Promise.all(Array.from({ length: CONCURRENCY }, fetcher));
  return row.abort.signal.aborted;
}

// the panel exists only while the setting does: with caching off there is
// nothing to store into, and switching off sweeps whatever a download stored.
// It reads the cache rather than remembering it, so it never claims artwork a
// sweep has taken away.
function sync() {
  const on = getSettings().cacheMap;
  $("offlineStore").hidden = !on;
  if (!on) {
    for (const row of rows.values()) stop(row);
    return;
  }
  buildRows();
  render();
  refresh();
}

$("oflBoth").onclick = () => {
  for (const row of rows.values()) if (pending(row)) start(row);
};

// only a switch-on warms, which is what this event is: a page that booted with
// the setting already on refreshed the shell through its own boot fetches
window.addEventListener("settings-changed", (e) => {
  if (e.detail?.key !== "cacheMap") return;
  sync();
  if (getSettings().cacheMap) warmShell();
});

window.addEventListener("settings-opened", sync);

// a dataset landing behind the boot one brings a game's artwork with it
window.addEventListener("games-changed", sync);

sync();
