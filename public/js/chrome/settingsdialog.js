// The Settings dialog: the sidebar's gear button and its overlay, each boolean
// setting bound to its row, and the offline cache's gate, which the worker
// cannot read and the page keeps for it.

import {
  SETTINGS_DEFAULTS,
  chooseSetting,
  clearStoredLocation,
  clearStoredView,
  getSettings,
  persistSettings,
  rememberLocation,
  viewChanged,
} from "../data/settings.js";
import { GEAR_SVG } from "../ui/icons.js";
import { closeDialog, openDialog, trapDialogKeys } from "../ui/dialog.js";

// the opt-in marker bucket sw.js consults before storing anything
export const MARKER_CACHE = "cams-on";

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
      chooseSetting(key, cb.checked);
      markDefault(cb, SETTINGS_DEFAULTS[key]);
      apply(cb.checked);
    };
  };

  bind("sRememberView", "rememberView", (on) => {
    if (on)
      viewChanged(); // capture the current view right away
    else clearStoredView();
  });

  bind("sRememberLoc", "rememberLoc", (on) => {
    if (on)
      rememberLocation(location.hash); // capture the current spot right away
    else clearStoredLocation();
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
  bind("sLabelScenery", "labelScenery", () =>
    window.dispatchEvent(new CustomEvent("settings-changed", { detail: { key: "labelScenery" } })),
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
