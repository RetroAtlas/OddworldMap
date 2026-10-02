// Pointer input on the map (mouse, touch, pen), hover inspection, and the menu toggle.

import { esc, formatDist, segDist } from "./util.js";
import { fieldEntries } from "./fields.js";
import { hideAnchorTip } from "./anchortip.js";
import {
  KEY_PAN_PX,
  KEY_ZOOM_STEP,
  EDITED_NOTE,
  OFFSCREEN_NOTE,
  PAGE_ZOOM_MIN,
  markerShown,
  PENS,
  LINE_COLORS,
  LINE_NAMES,
  WIRE_COLOR,
} from "./config.js";
import {
  $,
  cv,
  tip,
  hud,
  sidebar,
  menuBtn,
  scrim,
  copyLinkBtn,
  openSiteBtn,
  narrowMQ,
} from "./dom.js";
import { toast } from "./toast.js";
import { state, GEO, LAYOUT, wX, wY, gX, gY } from "./state.js";
import {
  draw,
  scheduleDraw,
  setConnFocus,
  setHighlight,
  setPatrol,
  setWireFocus,
} from "./render.js";
import {
  camCenter,
  computeWiring,
  destOf,
  destTrusted,
  drawBox,
  isLoopback,
  levelWiring,
  lineRuns,
  markerCentre,
  offScreen,
  pathIn,
  patrolZone,
  resolveTarget,
  smallestMarker,
  snapTarget,
  wireEnds,
  zoomAt,
} from "./model.js";
import {
  cyclePath,
  flushHash,
  navigateToDest,
  objectHash,
  scheduleHash,
  viewHash,
} from "./navigate.js";
import { typeSummary } from "./typeinfo.js";
import { DARK_NOTE, objectMessages } from "./messages.js";
import { markKeyHeld, toggleShow } from "./sidebar.js";
import { getSettings, fieldPrefsFor } from "./settings.js";
import { focusCamPanel, openCamPanel, openCamPanelNear } from "./campanel.js";
import { togglePlace } from "./place.js";
import { selectObject, setEditMode } from "./editpanel.js";
import { editedFields } from "./edits.js";
import { toggleGraph } from "./graphview.js";
import { addRoutePoint, routeArrive, routeSeam, undoRoutePoint } from "./route.js";
import { closeDialog, openDialog, trapDialogKeys } from "./dialog.js";
import { HAMBURGER_SVG, CLOSE_SVG, LINK_SVG, EXTERNAL_SVG } from "./icons.js";

let hoverTlvs = [],
  mouse = { x: 0, y: 0 };
let panMoved = false;
let measuring = false;

// ---- menu --------------------------------------------------------------
const isNarrow = () => narrowMQ.matches;
function syncMenu() {
  const open = document.body.classList.contains("menu-open");
  menuBtn.innerHTML = open ? CLOSE_SVG : HAMBURGER_SVG;
  const label = open ? "Close menu" : "Open menu";
  menuBtn.title = label;
  menuBtn.setAttribute("aria-label", label);
  if (!open && sidebar.contains(document.activeElement)) menuBtn.focus();
  if (!open) hideAnchorTip(); // a tap that closes the drawer takes its own anchor off-screen
  sidebar.inert = !open; // sliding it off-screen leaves its controls focusable
}
document.body.classList.toggle("menu-open", !isNarrow()); // set before first paint: open on wide, out of the way on narrow
export function toggleMenu(open) {
  document.body.classList.toggle(
    "menu-open",
    open ?? !document.body.classList.contains("menu-open"),
  );
  syncMenu();
}
syncMenu();
menuBtn.onclick = () => toggleMenu();
scrim.onclick = () => toggleMenu(false);
window.addEventListener("selection-changed", (e) => {
  if (isNarrow() && !e.detail.fromHash) toggleMenu(false); // reveal the map after picking
});

// the mode acts on the map, so on narrow the drawer comes off it
window.addEventListener("edit-changed", () => {
  if (state.edit && isNarrow()) toggleMenu(false);
});

// the graph takes the whole surface, so the drawer has to come off it
window.addEventListener("graph-changed", () => {
  if (state.graph && isNarrow()) toggleMenu(false);
  // clicking a box closes the diagram, which hands the rest of that gesture to
  // the canvas underneath: the second click of a double-click would land on the
  // map, adding a route waypoint or opening a screen list nobody asked for. The
  // next press that begins its own sequence clears it, so nothing is timed
  else graphHandover = true;
});
let graphHandover = false;

// ---- page zoom -----------------------------------------------------------
// #cv's touch-action: none would swallow the pinch that ends a page zoom, so while
// one is in effect the canvas hands two-finger gestures over instead of zooming the map.
const vv = window.visualViewport;
let pageZoomed = false;
function syncPageZoom() {
  pageZoomed = vv.scale > PAGE_ZOOM_MIN;
  document.body.classList.toggle("page-zoomed", pageZoomed);
}
if (vv) {
  vv.addEventListener("resize", syncPageZoom);
  vv.addEventListener("scroll", syncPageZoom);
  syncPageZoom(); // a reload can come back at the scale it left
}

// ---- pointers: one pointer pans (or measures), two pinch-zoom, click follows ----
// touch-action: none on #cv keeps the browser's own pan/zoom gestures off the map
let panning = false,
  panStart = null;
const pointers = new Map(); // active pointerId -> {x, y} in canvas space
let pinchDist = 0;
function ptrXY(e) {
  const r = cv.getBoundingClientRect();
  return { x: e.clientX - r.left, y: e.clientY - r.top };
}

cv.addEventListener("pointerdown", (e) => {
  if (e.detail <= 1) graphHandover = false; // a press of its own, not a gesture's tail
  const p = ptrXY(e);
  pointers.set(e.pointerId, p);
  try {
    // capture would hold a touch pinch back from the browser; a mouse drag
    // released off the canvas needs it to end at all
    if (!pageZoomed || e.pointerType !== "touch") cv.setPointerCapture(e.pointerId);
  } catch {
    /* pointer already lifted */
  }
  mouse.x = p.x;
  mouse.y = p.y;
  if (pointers.size === 1) {
    if (state.show.ruler) {
      const pt = snapAtMouse();
      state.ruler = { x1: pt.x, y1: pt.y, x2: pt.x, y2: pt.y };
      measuring = true;
      draw();
      return;
    }
    panning = true;
    panMoved = false;
    cv.classList.add("panning");
    panStart = { x: p.x, y: p.y, cx: state.cam.x, cy: state.cam.y };
  } else if (pointers.size === 2) {
    panning = false;
    measuring = false;
    cv.classList.remove("panning");
    const [a, b] = pointers.values();
    pinchDist = Math.hypot(a.x - b.x, a.y - b.y);
  }
});

cv.addEventListener("pointermove", (e) => {
  const p = ptrXY(e);
  if (pointers.has(e.pointerId)) pointers.set(e.pointerId, p);
  if (pointers.size === 2) {
    const [a, b] = pointers.values();
    const dist = Math.hypot(a.x - b.x, a.y - b.y);
    if (pageZoomed) {
      pinchDist = dist; // the zoom can end mid-pinch; the map would jump if it resumed from a stale baseline
      return;
    }
    if (dist && pinchDist)
      // coincident fingers make the factor 0 or Infinity; skip those frames
      Object.assign(
        state.cam,
        zoomAt(state.cam, dist / pinchDist, (a.x + b.x) / 2, (a.y + b.y) / 2),
      );
    pinchDist = dist;
    scheduleDraw();
    return;
  }
  mouse.x = p.x;
  mouse.y = p.y;
  if (measuring && state.ruler) {
    const pt = snapAtMouse();
    state.ruler.x2 = pt.x;
    state.ruler.y2 = pt.y;
  }
  if (panning) {
    if (
      Math.abs(p.x - panStart.x) + Math.abs(p.y - panStart.y) >
      (e.pointerType === "mouse" ? 4 : 6)
    )
      panMoved = true;
    state.cam.x = panStart.cx - (p.x - panStart.x) / state.cam.z;
    state.cam.y = panStart.cy - (p.y - panStart.y) / state.cam.z;
  }
  if (e.pointerType !== "touch" || !panning) updateHover(); // no tooltips under a panning finger
  scheduleDraw();
});

function endPointer(e) {
  if (!pointers.delete(e.pointerId)) return;
  if (pointers.size === 1) {
    // pinch ended with a pointer still down: continue as a pan
    const [p] = pointers.values();
    panning = true;
    panMoved = true;
    panStart = { x: p.x, y: p.y, cx: state.cam.x, cy: state.cam.y };
  } else if (!pointers.size) {
    if (panMoved) scheduleHash(false);
    panning = false;
    measuring = false;
    cv.classList.remove("panning");
  }
}
cv.addEventListener("pointerup", endPointer);
cv.addEventListener("pointercancel", endPointer);

// measurements don't outlive their path
window.addEventListener("selection-changed", () => {
  if (!state.ruler) return;
  state.ruler = null;
  scheduleDraw();
});

// an armed tool owns the cursor; hover writes must not overwrite it
const modeCursor = () => (state.edit || state.show.ruler || state.show.route ? "crosshair" : "");

cv.addEventListener("pointerleave", () => {
  if (pointers.size) return; // a captured drag only leaves after release
  hoverTlvs = [];
  tip.style.display = "none";
  cv.style.cursor = modeCursor();
  setHighlight(null);
  setConnFocus(null);
  setWireFocus(null);
  setPatrol(null);
});

// the pointed-at objects are the path's old ones after an edit
window.addEventListener("data-changed", () => {
  hoverTlvs = [];
  tip.style.display = "none";
});

cv.addEventListener("click", () => {
  if (panMoved || graphHandover || state.show.ruler) return;
  if (state.show.route) {
    updateHover(); // taps arrive without a preceding hover move
    // a followed object seams the route: the segment closes on it, the ride
    // happens, and the next opens where it lands. Hand stones only show a
    // camera and loopbacks travel nowhere, so both stay plain waypoints
    const seam = hoverTlvs.find(
      (t) =>
        (t.extra || {}).view1_cam == null &&
        !isLoopback(t, state.data, state.lvl, state.path) &&
        followableDest(t),
    );
    if (seam) {
      const d = followableDest(seam);
      flushHash(); // the entry left behind keeps the route as plotted so far
      const [sx, sy] = markerCentre(seam, LAYOUT);
      routeSeam({ x: sx, y: sy }, d);
      navigateToDest(d);
      routeArrive(d);
    } else addRoutePoint(snapAtMouse()); // click-to-add: pan/pinch/wheel gestures stay live
    return;
  }
  updateHover(); // taps arrive without a preceding hover move
  if (state.edit) {
    selectObject(smallestMarker(hoverTlvs, LAYOUT));
    return;
  }
  for (const t of hoverTlvs) {
    const d = followableDest(t);
    if (d) {
      navigateToDest(d);
      return;
    }
  }
  if (!getSettings().screenList) return;
  const pt = drawAtMouse(); // nothing to follow: list the screen's objects
  openCamPanel(pt.x, pt.y, hoverTlvs[0] ?? null);
});

// right-click (long-press on touch) copies a permalink to the object under
// the pointer; over empty map the native menu stays available
cv.addEventListener("contextmenu", (e) => {
  const r = cv.getBoundingClientRect();
  mouse.x = e.clientX - r.left;
  mouse.y = e.clientY - r.top;
  updateHover();
  if (!hoverTlvs.length) return;
  e.preventDefault();
  const t = hoverTlvs[0];
  const url = location.href.split("#")[0] + objectHash(t);
  // the link names the shipped object, the one a recipient can resolve
  const copied = Object.keys(editedFields(t)).length
    ? `${t.name} link copied — it opens on the shipped ${t.name}`
    : `${t.name} link copied`;
  (navigator.clipboard?.writeText(url) ?? Promise.reject()).then(
    () => toast(copied),
    () => toast("copy failed"),
  );
});

// the full-site permalink to the current view. viewHash(), not location.href:
// the hash write is debounced and can lag a pan
function fullSiteUrl() {
  const url = new URL(location.href);
  url.searchParams.delete("embed");
  url.hash = state.path ? viewHash() : location.hash;
  return url.href;
}

// the top-right chain button copies that permalink — the address bar
// equivalent, which phones and installed/standalone mode may hide
copyLinkBtn.innerHTML = LINK_SVG;
copyLinkBtn.onclick = () => {
  if (!state.path) return;
  (navigator.clipboard?.writeText(fullSiteUrl()) ?? Promise.reject()).then(
    () => toast("view link copied"),
    () => toast("copy failed"),
  );
};

// in embeds the chain button gives way to this link out to the full site at
// the same view; the href is seeded at boot (an <a> without one isn't even
// focusable) and refreshed on pointerdown/click, before navigation reads it
openSiteBtn.innerHTML = EXTERNAL_SVG;
openSiteBtn.href = fullSiteUrl();
openSiteBtn.onpointerdown = openSiteBtn.onclick = () => {
  openSiteBtn.href = fullSiteUrl();
};

cv.addEventListener(
  "wheel",
  (e) => {
    e.preventDefault();
    Object.assign(state.cam, zoomAt(state.cam, Math.exp(-e.deltaY * 0.0015), mouse.x, mouse.y));
    updateHover();
    scheduleDraw();
    scheduleHash(false);
  },
  { passive: false },
);

// draw space, not world units; wX/wY convert where world units are wanted
function drawAtMouse() {
  return { x: state.cam.x + mouse.x / state.cam.z, y: state.cam.y + mouse.y / state.cam.z };
}

// measuring points stick to what they are aimed at — a shown object's center,
// or a collision endpoint while those are drawn — within a few screen pixels
function snapAtMouse() {
  const pt = drawAtMouse();
  return snapTarget(pt, state.path, 8 / state.cam.z, LAYOUT, state.show.coll) ?? pt;
}

// ---- keyboard: arrows pan, + / - zoom about the canvas center, [ / ] cycle
// paths, letter keys flip the display toggles, ? lists the shortcuts --------
const SHOW_KEY = {
  s: "spaced",
  g: "grid",
  a: "conn",
  w: "wires",
  p: "pens",
  c: "coll",
  f: "fg",
  o: "objects",
  b: "patrols",
  m: "ruler",
  r: "route",
};
window.addEventListener("keyup", (e) => {
  const show = SHOW_KEY[e.key];
  if (show) markKeyHeld(show, false);
});
// a key released outside the window never sends its keyup
window.addEventListener("blur", () => {
  for (const key of Object.values(SHOW_KEY)) markKeyHeld(key, false);
});
window.addEventListener("keydown", (e) => {
  if (e.ctrlKey || e.metaKey || e.target.matches?.("input, textarea, select")) return;
  // brackets before the Alt guard: several layouts type them via Option/AltGr
  if (e.key === "[" || e.key === "]") {
    cyclePath(e.key === "]" ? 1 : -1);
    e.preventDefault();
    return;
  }
  if (e.altKey) return;
  const show = SHOW_KEY[e.key];
  if (show) {
    markKeyHeld(show, true);
    if (!e.repeat) toggleShow(show); // a held key autorepeats; the toggle must not
    return;
  }
  if (e.key === "Backspace" && state.route) {
    undoRoutePoint();
    e.preventDefault(); // Backspace must not fall through to history-back
    return;
  }
  if (e.key === "i") {
    togglePlace();
    return;
  }
  if (e.key === "v") {
    if (!e.repeat) toggleGraph(); // a held key autorepeats; the mode must not
    return;
  }
  if (e.key === "e") {
    if (!e.repeat) setEditMode(!state.edit);
    return;
  }
  if (e.key === "l") {
    if (e.repeat || !state.path) return;
    const c = camCenter(state.cam, cv.clientWidth, cv.clientHeight);
    if (openCamPanelNear(c.x, c.y)) {
      if (isNarrow()) toggleMenu(false); // the panel is a bottom sheet under the scrim otherwise
      focusCamPanel();
    }
    return;
  }
  if (e.key === "?") {
    openShortcuts();
    e.preventDefault();
    return;
  }
  const pan = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] }[
    e.key
  ];
  if (pan) {
    state.cam.x += (pan[0] * KEY_PAN_PX) / state.cam.z;
    state.cam.y += (pan[1] * KEY_PAN_PX) / state.cam.z;
  } else if (e.key === "+" || e.key === "=" || e.key === "-" || e.key === "_") {
    const f = e.key === "-" || e.key === "_" ? 1 / KEY_ZOOM_STEP : KEY_ZOOM_STEP;
    Object.assign(state.cam, zoomAt(state.cam, f, cv.clientWidth / 2, cv.clientHeight / 2));
  } else return;
  e.preventDefault();
  updateHover();
  scheduleDraw();
  scheduleHash(false);
});

// ---- shortcuts panel (the ? key) -----------------------------------------
const shortcutsOverlay = $("shortcutsOverlay");
function openShortcuts() {
  openDialog(shortcutsOverlay, closeShortcuts);
  $("shortcutsClose").focus();
}
const closeShortcuts = () => closeDialog(shortcutsOverlay);
$("shortcutsClose").onclick = closeShortcuts;
shortcutsOverlay.onclick = (e) => {
  if (e.target === e.currentTarget) closeShortcuts();
};
trapDialogKeys(() => shortcutsOverlay.classList.contains("open"), $("shortcuts"), closeShortcuts);

// where an object may be said to lead: destOf's answer, less the links whose
// named partner isn't at the destination to receive them. Deliberately not
// wayThrough, which is this with a hand stone's view excluded as well: that
// guard is the level graph's, and a click is not the level graph — clicking a
// stone follows it to the camera it shows.
const shownDest = (t) => {
  const { data, lvl, path } = state;
  const d = destOf(t, data, lvl, path);
  return d && destTrusted(d, data, lvl) ? d : null;
};

// a destination is followable only when its level AND path are on the map:
// dozens of Exoddus one-way links name a placeholder path their level does not
// hold, and a link naming no partner has nothing for destTrusted to check
function followableDest(t) {
  const d = shownDest(t);
  return d && pathIn(state.data, d.lv, d.pa) ? d : null;
}

// ---- hover inspection ----------------------------------------------------
let tipHtml = "",
  tipSpaceW = 0,
  tipSpaceH = 0,
  tipW = 0,
  tipH = 0;

function updateHover() {
  if (!state.path) return;
  const pt = drawAtMouse();
  let hoverLines = [];
  if (state.show.coll) {
    const tol = 6 / state.cam.z;
    // a line is pointed at where it is drawn: the packing bends it at every
    // window edge it crosses, so the straight run between its two ends is
    // ground it may never cover
    hoverLines = state.path.lines
      .filter(([x1, y1, x2, y2]) =>
        lineRuns(x1, y1, x2, y2, LAYOUT).some(
          (r) => segDist(pt.x, pt.y, r.x1, r.y1, r.x2, r.y2) <= tol,
        ),
      )
      .slice(0, 4);
  }
  hoverTlvs = state.path.tlvs.filter((t) => {
    if (!markerShown(t)) return false;
    const { x, y, w, h } = drawBox(t, LAYOUT);
    const x2 = x + Math.max(w, 10),
      y2 = y + Math.max(h, 10);
    return pt.x >= x - 4 && pt.x <= x2 + 4 && pt.y >= y - 4 && pt.y <= y2 + 4;
  });
  // partner preview: hovering a linked object outlines its counterpart when
  // the destination resolves within the current path
  let partner = null;
  for (const t of hoverTlvs) {
    const d = destOf(t, state.data, state.lvl, state.path);
    if (!d || d.lv !== state.lvl.short || d.pa !== state.path.id) continue;
    const tgt = resolveTarget(d, state.path, GEO);
    if (tgt) {
      partner = tgt;
      break;
    }
  }
  setHighlight(partner);
  // a hovered Slig (or its spawner) shades the pen its own bounds pair pens it into
  const pen = (t) => patrolZone(t, state.path, LAYOUT, state.data.id);
  setPatrol(PENS.on ? (hoverTlvs.map(pen).find(Boolean) ?? null) : null);
  // arrows overlay: spotlight the hovered object's own edges
  setConnFocus(state.show.conn ? (hoverTlvs.find((t) => shownDest(t)) ?? null) : null);
  // wiring overlay: the same, for the hovered object's own drawn wires
  const wiring = state.show.wires ? computeWiring(state.path, state.data.id) : null;
  const wireDrawn = (e) => markerShown(e.src) && markerShown(e.dst);
  setWireFocus(
    wiring
      ? (hoverTlvs.find((t) =>
          wiring.edges.some((e) => (e.src === t || e.dst === t) && wireDrawn(e)),
        ) ?? null)
      : null,
  );
  if (hoverTlvs.length || hoverLines.length) {
    tip.style.display = "block";
    const html =
      hoverTlvs
        .slice(0, 8)
        .map((t) => {
          const about = typeSummary(t.name);
          const ex = fieldEntries(t, fieldPrefsFor(state.data.id))
            .map(([k, v]) => `<span>${esc(k)}=<span class="v">${esc(String(v))}</span></span>`)
            .join(" ");
          // what the sign says, capped: a tooltip has no room for a whole
          // rotation. A board that can only ever run dark says so, since
          // silence would read as the map not knowing
          const says = objectMessages(state.data.id, t);
          const said = (says ?? []).map(
            ({ text, note }) =>
              `<br><span class="said">${note ? `<span class="note">${esc(note)}</span> ` : ""}${esc(`“${text}”`)}</span>`,
          );
          const messages =
            says?.length === 0
              ? `<br><span class="e">${esc(DARK_NOTE)}</span>`
              : said.slice(0, 3).join("") +
                (said.length > 3 ? `<br><span class="e">+${said.length - 3} more</span>` : "");
          const edited = Object.keys(editedFields(t)).sort();
          const d = shownDest(t);
          let follow = "";
          if (state.edit) {
            follow = `<br><span class="f">click to select</span>`;
          } else if (d && isLoopback(t, state.data, state.lvl, state.path)) {
            follow = `<br><span class="f loop">⟳ loops back to itself</span>`;
          } else if (d && !followableDest(t)) {
            follow = `<br><span class="f loop">→ leads to ${esc(`${d.lv} P${d.pa}`)} — not on the map</span>`;
          } else if (d) {
            follow = `<br><span class="f">➜ click to follow to ${esc(`${d.lv} P${d.pa}${d.ca != null ? " C" + d.ca : ""}`)}</span>`;
          }
          // wiring lines describe the drawn wires — a local partner in a
          // hidden category is neither drawn nor named, while a cross-path
          // note names a path rather than a marker — and state only what
          // exists: a shown partner, or the other paths of the level holding
          // one when this path holds none at all. Silence is never a claim,
          // since an id can drive things the wire table has no evidence for
          let wireInfo = "";
          if (wiring) {
            const lines = [];
            const remote = levelWiring(state.lvl, state.data.id);
            const others = (paths) =>
              [...(paths ?? [])].filter((pa) => pa !== state.path.id).map((pa) => "P" + pa);
            const ends = wireEnds(t, state.data.id);
            const wired = (m, id) => (m.get(id) ?? []).filter((o) => o !== t);
            for (const id of ends.out) {
              const local = wired(wiring.cons, id);
              const shown = local.filter(markerShown);
              if (shown.length === 1) lines.push(`sets ${id} → ${shown[0].name}`);
              else if (shown.length) lines.push(`sets ${id} → ${shown.length} objects`);
              else if (!local.length) {
                const paths = others(remote.cons.get(id));
                if (paths.length) lines.push(`sets ${id} — answered in ${paths.join(", ")}`);
              }
            }
            for (const id of ends.in) {
              const local = wired(wiring.prod, id);
              const shown = local.filter(markerShown);
              const names = new Set(shown.map((o) => o.name));
              if (shown.length === 1) lines.push(`answers ${id} ← ${shown[0].name}`);
              else if (names.size === 1)
                lines.push(`answers ${id} ← ${shown.length}× ${[...names][0]}`);
              else if (shown.length) lines.push(`answers ${id} ← ${shown.length} producers`);
              else if (!local.length) {
                const paths = others(remote.prod.get(id));
                if (paths.length) lines.push(`answers ${id} — set in ${paths.join(", ")}`);
              }
            }
            wireInfo = lines
              .map((l) => `<br><span class="f" style="color:${WIRE_COLOR}">↯ ${esc(l)}</span>`)
              .join("");
          }
          return (
            `<div><span class="t">${esc(t.name)}</span> <span class="e">(${t.x1},${t.y1})–(${t.x2},${t.y2})</span>` +
            (offScreen(t, LAYOUT)
              ? `<br><span class="e offscreen">${esc(OFFSCREEN_NOTE)}</span>`
              : "") +
            (edited.length
              ? `<br><span class="e edited">${esc(`${EDITED_NOTE}: ${edited.join(", ")}`)}</span>`
              : "") +
            (about ? `<br><span class="e about">${esc(about)}</span>` : "") +
            messages +
            (ex ? `<br><span class="kv">${ex}</span>` : "") +
            wireInfo +
            follow +
            `</div>`
          );
        })
        .concat(
          hoverLines.map(([x1, y1, x2, y2, t]) => {
            const len = Math.round(Math.hypot(x2 - x1, y2 - y1));
            return (
              `<div><span class="t" style="color:${LINE_COLORS[t] || "#999"}">${LINE_NAMES[t] || "Line type " + t}</span>` +
              ` <span class="e">(${x1},${y1})→(${x2},${y2}) · ${formatDist(len)}</span></div>`
            );
          }),
        )
        .join("<hr>") +
      (hoverTlvs.length > 8 ? `<div class="e">+${hoverTlvs.length - 8} more…</div>` : "");
    if (html !== tipHtml || tipSpaceW !== cv.clientWidth || tipSpaceH !== cv.clientHeight) {
      tip.innerHTML = html;
      tipHtml = html;
      tipSpaceW = cv.clientWidth;
      tipSpaceH = cv.clientHeight;
      tip.style.left = "0px"; // the width it wraps to given the whole canvas to grow into
      tipW = tip.offsetWidth;
      tipH = tip.offsetHeight;
    }
    const below = mouse.y + 16;
    tip.style.left = Math.max(6, Math.min(mouse.x + 16, cv.clientWidth - tipW - 10)) + "px";
    tip.style.top =
      (below + tipH > cv.clientHeight ? Math.max(6, mouse.y - tipH - 12) : below) + "px";
    if (!panning)
      cv.style.cursor = modeCursor() || (hoverTlvs.some((t) => followableDest(t)) ? "pointer" : "");
  } else {
    tip.style.display = "none";
    if (!panning) cv.style.cursor = modeCursor();
  }
  const wx = wX(pt.x),
    wy = wY(pt.y);
  hud.textContent = `world x ${Math.round(wx)}  y ${Math.round(wy)}  ·  grid ${gX(wx).toFixed(1)}, ${gY(wy).toFixed(1)}  ·  zoom ${state.cam.z.toFixed(2)}`;
}
