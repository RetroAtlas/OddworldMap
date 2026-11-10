// Settings: the persisted options, the Display snapshot and the remembered
// location, each sanitized on the way in. Importable in bare Node: localStorage
// only inside the guarded store calls.

import { CATS } from "../config.js";
import { parseHash } from "../model/model.js";

const SETTINGS_KEY = "owm:settings";
const VIEW_KEY = "owm:view";
const LOC_KEY = "owm:lastloc";

export const SETTINGS_DEFAULTS = {
  rememberView: true,
  rememberLoc: false,
  fullNames: true,
  playOrder: true,
  showDemoPaths: false,
  screenList: true,
  cacheMap: false,
  showRawValues: false,
  editObjects: false,
  animate: true,
  labelScenery: false,
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
  "release",
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
  keys() {
    try {
      return Object.keys(localStorage);
    } catch {
      return [];
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

// the stored settings the visitor has set: only known keys of the boolean kind
export function sanitizeChosen(raw) {
  let p;
  try {
    p = JSON.parse(raw);
  } catch {
    return {};
  }
  const chosen = {};
  if (p && typeof p === "object")
    for (const k of Object.keys(SETTINGS_DEFAULTS)) if (typeof p[k] === "boolean") chosen[k] = p[k];
  return chosen;
}

// every setting as it stands: the defaults under what the visitor has set,
// and the field picks
export function sanitizeSettings(raw) {
  let p;
  try {
    p = JSON.parse(raw);
  } catch {
    p = null;
  }
  return {
    ...SETTINGS_DEFAULTS,
    ...sanitizeChosen(raw),
    fieldPrefs: sanitizeFieldPrefs(p?.fieldPrefs),
  };
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
let chosen = null;
let view = null;

export function getSettings() {
  if (!settings) {
    const raw = store.get(SETTINGS_KEY);
    settings = sanitizeSettings(raw);
    chosen = sanitizeChosen(raw);
  }
  return settings;
}

// the kept set: the Settings the visitor has set, each held until it is set
// back to its default, so a default that changes reaches whoever left that
// setting alone and no one who set it; a setting loaded from storage counts
// as set
export function chooseSetting(key, value) {
  getSettings()[key] = value;
  if (value === SETTINGS_DEFAULTS[key]) delete chosen[key];
  else chosen[key] = value;
  persistSettings();
}

export function persistSettings() {
  const { fieldPrefs } = getSettings();
  const picked = Object.values(fieldPrefs.byType).some((types) => Object.keys(types).length);
  const kept = fieldPrefs.mode !== "default" || picked ? { ...chosen, fieldPrefs } : chosen;
  store.set(SETTINGS_KEY, JSON.stringify(kept));
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

// the Display switches and Objects filters the visitor has set
export function getViewSnapshot() {
  if (!view) {
    const stored = getSettings().rememberView ? sanitizeView(store.get(VIEW_KEY)) : null;
    view = stored || { show: {}, cats: {} };
  }
  return view;
}

export function viewChanged() {
  if (getSettings().rememberView) store.set(VIEW_KEY, JSON.stringify(getViewSnapshot()));
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

export function clearStoredView() {
  store.remove(VIEW_KEY);
}
