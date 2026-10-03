// Settings: the sidebar gear button, its overlay and the persisted options.
// The module stays importable in bare Node: no DOM access at import time and
// localStorage only inside the guarded store calls. initSettings() does all
// the DOM wiring.

import { CATS } from "./config.js";
import { state } from "./state.js";
import { parseHash } from "./model.js";
import { GEAR_SVG } from "./icons.js";
import { closeDialog, openDialog, trapDialogKeys } from "./dialog.js";

const SETTINGS_KEY = "owm:settings";
const VIEW_KEY = "owm:view";
const LOC_KEY = "owm:lastloc";

// the opt-in marker bucket sw.js consults before storing anything
export const MARKER_CACHE = "cams-on";

export const SETTINGS_DEFAULTS = {
  rememberView: true,
  rememberLoc: false,
  fullNames: true,
  playOrder: false,
  showDemoPaths: false,
  screenList: true,
  cacheMap: false,
  showRawValues: false,
  editObjects: false,
  animate: true,
};
// fieldPrefs (not a boolean; added by sanitizeSettings) — which object fields
// to show: mode "default" (the notable ones) or "more" (per-game, per-type
// picks in byType, falling back to the defaults).
export const SHOW_KEYS = [
  "spaced",
  "grid",
  "coll",
  "fg",
  "conn",
  "wires",
  "pens",
  "labels",
  "dim",
  "objects",
  "patrols",
  "markers",
];

// localStorage may be unavailable (private mode, blocked); never let that break the viewer
export const store = {
  get(key) {
    try {
      return localStorage.getItem(key);
    } catch {
      return null;
    }
  },
  set(key, value) {
    try {
      localStorage.setItem(key, value);
    } catch {
      /* ignore */
    }
  },
  remove(key) {
    try {
      localStorage.removeItem(key);
    } catch {
      /* ignore */
    }
  },
};

// a fresh, validated fieldPrefs (never shares a reference with the default, so
// callers may mutate byType without corrupting it). byType nests per game:
// the games' field vocabularies differ even for same-named types, so a pick
// made in one game must not hide the other game's fields
function sanitizeFieldPrefs(p) {
  const out = { mode: "default", byType: {} };
  if (p && typeof p === "object") {
    if (p.mode === "more") out.mode = "more";
    if (p.byType && typeof p.byType === "object")
      for (const [game, types] of Object.entries(p.byType)) {
        if (!types || typeof types !== "object" || Array.isArray(types)) continue;
        const g = (out.byType[game] = {});
        for (const [type, keys] of Object.entries(types))
          if (Array.isArray(keys)) g[type] = keys.filter((k) => typeof k === "string");
      }
  }
  return out;
}

// copy only known keys with the expected type; anything else keeps its default
export function sanitizeSettings(raw) {
  const s = { ...SETTINGS_DEFAULTS, fieldPrefs: sanitizeFieldPrefs(null) };
  let p;
  try {
    p = JSON.parse(raw);
  } catch {
    return s;
  }
  if (!p || typeof p !== "object") return s;
  for (const k of Object.keys(SETTINGS_DEFAULTS)) if (typeof p[k] === "boolean") s[k] = p[k];
  s.fieldPrefs = sanitizeFieldPrefs(p.fieldPrefs);
  return s;
}

// stored display/filter snapshot -> { show, cats } with only known boolean keys
export function sanitizeView(raw) {
  let p;
  try {
    p = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!p || typeof p !== "object") return null;
  const view = { show: {}, cats: {} };
  for (const k of SHOW_KEYS) if (p.show && typeof p.show[k] === "boolean") view.show[k] = p.show[k];
  for (const c of CATS)
    if (p.cats && typeof p.cats[c.key] === "boolean") view.cats[c.key] = p.cats[c.key];
  return view;
}

let settings = null;

export function getSettings() {
  if (!settings) settings = sanitizeSettings(store.get(SETTINGS_KEY));
  return settings;
}

export function persistSettings() {
  store.set(SETTINGS_KEY, JSON.stringify(getSettings()));
}

// the field-display policy for one game's objects: the mode plus that game's
// live per-type picks (created on demand, so mutations land in the stored
// object), plus the global raw-values flag folded in for the display callers
export function fieldPrefsFor(gameId) {
  const s = getSettings();
  return {
    game: gameId,
    mode: s.fieldPrefs.mode,
    byType: (s.fieldPrefs.byType[gameId] ??= {}),
    raw: s.showRawValues,
  };
}

// the persisted display/filter snapshot, or null when off/absent/corrupt
export function getViewSnapshot() {
  return getSettings().rememberView ? sanitizeView(store.get(VIEW_KEY)) : null;
}

export function viewChanged() {
  if (!getSettings().rememberView) return;
  const cats = {};
  CATS.forEach((c) => (cats[c.key] = c.on));
  store.set(VIEW_KEY, JSON.stringify({ show: state.show, cats }));
}

// a selector-button label: the short code alone, or "code — full name" in
// full-names mode ("Oddworld: " is dropped so games read "AO — Abe's Oddysee")
export function displayLabel(code, fullName, on) {
  const name = (fullName || "").replace(/^Oddworld:\s*/, "");
  return on && name ? `${code} — ${name}` : code;
}

// a candidate "#GAME/LEVEL/…" permalink string, or null; whether its level and
// path still exist is applyHash's job to validate
export function sanitizeLocationHash(raw) {
  return typeof raw === "string" && raw.startsWith("#") && parseHash(raw) ? raw : null;
}

export function rememberLocation(hash) {
  if (getSettings().rememberLoc && sanitizeLocationHash(hash)) store.set(LOC_KEY, hash);
}

// the remembered permalink for hashless loads, or null when off/absent/corrupt
export function storedLocationHash() {
  return getSettings().rememberLoc ? sanitizeLocationHash(store.get(LOC_KEY)) : null;
}

export function clearStoredLocation() {
  store.remove(LOC_KEY);
}

// a row whose value isn't the default says so
function markDefault(cb, dflt) {
  let mark = cb.parentElement.querySelector(".st-def");
  if (!mark) {
    mark = document.createElement("span");
    mark.className = "st-def";
    cb.parentElement.append(mark);
  }
  mark.textContent = cb.checked === dflt ? "" : dflt ? "on by default" : "off by default";
}

export function initSettings() {
  const s = getSettings();
  const $ = (id) => document.getElementById(id);
  const btn = $("settingsBtn"),
    overlay = $("settingsOverlay"),
    closeBtn = $("settingsClose");
  btn.innerHTML = GEAR_SVG;

  const open = () => {
    openDialog(overlay, close);
    closeBtn.focus();
    window.dispatchEvent(new Event("settings-opened"));
  };
  const close = () => {
    closeDialog(overlay);
    btn.focus();
  };
  btn.onclick = open;
  closeBtn.onclick = close;
  overlay.onclick = (e) => {
    if (e.target === overlay) close();
  };
  trapDialogKeys(() => overlay.classList.contains("open"), $("settings"), close);

  // seed each checkbox from the stored settings, then persist + apply on change
  const bind = (id, key, apply) => {
    const cb = $(id);
    cb.checked = s[key];
    markDefault(cb, SETTINGS_DEFAULTS[key]);
    cb.onchange = () => {
      s[key] = cb.checked;
      persistSettings();
      markDefault(cb, SETTINGS_DEFAULTS[key]);
      apply(cb.checked);
    };
  };

  bind("sRememberView", "rememberView", (on) => {
    if (on)
      viewChanged(); // capture the current view right away
    else store.remove(VIEW_KEY);
  });

  bind("sRememberLoc", "rememberLoc", (on) => {
    if (on)
      rememberLocation(location.hash); // capture the current spot right away
    else store.remove(LOC_KEY);
  });

  bind("sScreenList", "screenList", () => {});

  bind("sRawValues", "showRawValues", () =>
    window.dispatchEvent(new CustomEvent("settings-changed", { detail: { key: "rawValues" } })),
  );

  bind("sEditObjects", "editObjects", () =>
    window.dispatchEvent(new CustomEvent("settings-changed", { detail: { key: "editObjects" } })),
  );

  // fieldPrefs isn't a boolean setting, so it gets a custom binding: the
  // checkbox flips mode between "default" and "more"
  const showMore = $("sShowMore");
  showMore.checked = s.fieldPrefs.mode === "more";
  markDefault(showMore, false);
  showMore.onchange = () => {
    s.fieldPrefs.mode = showMore.checked ? "more" : "default";
    persistSettings();
    markDefault(showMore, false);
    window.dispatchEvent(new CustomEvent("settings-changed", { detail: { key: "fieldPrefs" } }));
  };

  document.body.classList.toggle("fullnames", s.fullNames);
  bind("sAnimate", "animate", () =>
    window.dispatchEvent(new CustomEvent("settings-changed", { detail: { key: "animate" } })),
  );
  bind("sFullNames", "fullNames", (on) => {
    document.body.classList.toggle("fullnames", on);
    window.dispatchEvent(new CustomEvent("settings-changed", { detail: { key: "fullNames" } }));
  });

  bind("sPlayOrder", "playOrder", () =>
    window.dispatchEvent(new CustomEvent("settings-changed", { detail: { key: "playOrder" } })),
  );

  bind("sDemoPaths", "showDemoPaths", () =>
    window.dispatchEvent(new CustomEvent("settings-changed", { detail: { key: "demoPaths" } })),
  );

  applyCacheMap(s.cacheMap); // boot: register, or sweep leftovers from a mid-session disable
  bind("sCacheMap", "cacheMap", (on) => {
    applyCacheMap(on);
    window.dispatchEvent(new CustomEvent("settings-changed", { detail: { key: "cacheMap" } }));
  });
}

// the last registration attempt: not fatal to the app, but fatal to everything
// offline, so the answer is kept rather than swallowed
let registered = Promise.resolve(false);
export const workerRegistered = () => registered;

// the marker's existence is what admits a response to the cache, so anything
// that wants its fetches stored has to follow this
export function markerReady() {
  if (!("caches" in window)) return Promise.resolve();
  return caches.open(MARKER_CACHE).then(
    () => {},
    () => {},
  );
}

// offline caching (sw.js) is opt-in; the worker can't read settings, so the
// page gates it. The marker bucket, not registration, is the real switch:
// unregister() leaves the worker controlling the page until reload, so only
// deleting the marker stops caching immediately.
function applyCacheMap(on) {
  if (!("serviceWorker" in navigator)) return;
  if (on) {
    markerReady();
    registered = navigator.serviceWorker.register("sw.js").then(
      () => true,
      (err) => {
        console.warn("offline storage: the service worker would not register", err);
        return false;
      },
    );
    return;
  }
  // every registration on the origin: sw.js is the only worker there is
  navigator.serviceWorker.getRegistrations().then(
    (regs) => regs.forEach((r) => r.unregister()),
    () => {},
  );
  // the marker goes first: it is what the worker consults, so nothing can
  // repopulate a bucket the sweep is still deleting
  if ("caches" in window)
    caches.delete(MARKER_CACHE).then(
      () =>
        caches.keys().then(
          (names) =>
            names
              .filter((n) => n.startsWith("cams-") || n.startsWith("shell-"))
              .forEach((n) => caches.delete(n)),
          () => {},
        ),
      () => {},
    );
}
