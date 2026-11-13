// Pointer input on the map (mouse, touch, pen), its keys, and the menu toggle.

import { onBackgroundPlane } from "../model/fields.js";
import { gridSize } from "../engine/collide.js";
import { hideAnchorTip } from "../ui/anchortip.js";
import { KEY_PAN_PX, KEY_ZOOM_STEP, PAGE_ZOOM_MIN } from "../config.js";
import {
  $,
  cv,
  tip,
  sidebar,
  menuBtn,
  scrim,
  copyLinkBtn,
  openSiteBtn,
  narrowMQ,
  embedded,
  typingIn,
} from "../ui/dom.js";
import { toast } from "../ui/toast.js";
import { state, GEO, LAYOUT, wX, wY } from "../data/state.js";
import {
  draw,
  setConnFocus,
  setHighlight,
  setCarried,
  setPatrol,
  setWireFocus,
  settleView,
} from "../painter/render.js";
import { scheduleDraw } from "../ui/redraw.js";
import { objectShown } from "../painter/spriteart.js";
import { camCenter, isLoopback, markerCentre, snapTarget, zoomAt } from "../model/model.js";
import {
  cyclePath,
  flushHash,
  navigateToDest,
  objectHash,
  scheduleHash,
  viewHash,
} from "../navigation/navigate.js";
import { clearHover, followableDest, hovered, modeCursor, readout, updateHover } from "./hover.js";
import { toggleShow } from "./sidebar.js";
import { lightCap } from "../ui/keycap.js";
import { getSettings } from "../data/settings.js";
import { focusCamPanel, openCamPanel, openCamPanelNear } from "../panels/campanel.js";
import { togglePlace } from "../panels/place.js";
import { openAddPicker, selectObject, setEditMode } from "../panels/editpanel.js";
import {
  applyRectEdit,
  currentOf,
  fitRect,
  isAdded,
  isEdited,
  isRemoved,
  snapRect,
} from "../data/edits.js";
import { toggleGraph } from "../panels/graphview.js";
import { addRoutePoint, routeArrive, routeSeam, undoRoutePoint } from "../navigation/route.js";
import { closeDialog, openDialog, trapDialogKeys } from "../ui/dialog.js";
import { HAMBURGER_SVG, CLOSE_SVG, LINK_SVG, EXTERNAL_SVG } from "../ui/icons.js";

const mouse = { x: 0, y: 0 };
let onMap = false; // the pointer is over the canvas
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
  if (!open) hideAnchorTip(); // a tap that closes the drawer takes its own anchor off-screen
  sidebar.inert = !open; // sliding it off-screen leaves its controls focusable
}
let keyInput = false; // the last input was a key rather than a pointer
function toggleMenu(open) {
  const was = document.body.classList.contains("menu-open");
  document.body.classList.toggle("menu-open", open ?? !was);
  syncMenu();
  // a close hands the focus on once the dispatch is through, where the drawer
  // still holds it (inert blurs a control it keeps only later) or where the last
  // input was a key and the focus is on the body, dropped there by a panel
  // rebuilding its controls on the same event; a tap leaves a focus outside the
  // drawer where it put it, and a close before any input moves nothing
  if (was && !document.body.classList.contains("menu-open"))
    queueMicrotask(() => {
      const a = document.activeElement;
      if (document.body.classList.contains("menu-open")) return;
      if (sidebar.contains(a) || (a === document.body && keyInput)) menuBtn.focus();
    });
}

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

// a slip within this many pixels is a click; past it the press is a drag
const slip = (e) => (e.pointerType === "mouse" ? 4 : 6);

// the selection carried by the pointer
let moving = null;
function cancelMove() {
  if (!moving) return;
  moving.cancelled = true;
  moving.preview = null;
  setCarried(null);
  cv.style.cursor = modeCursor();
}

function onPointerDown(e) {
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
    panMoved = false;
    // a press on the selection carries it, by the click's own ranking; anywhere else pans
    if (
      state.edit &&
      state.sel &&
      !isRemoved(state.sel) &&
      (e.pointerType !== "mouse" || e.button === 0)
    ) {
      updateHover(mouse, panning);
      if (hovered()[0] === state.sel) {
        const t = state.sel,
          pt = drawAtMouse();
        moving = {
          t,
          grab: { x: wX(pt.x) - t.x1, y: wY(pt.y) - t.y1 },
          rect: [t.x1, t.y1, t.x2, t.y2],
          start: p,
          moved: false,
          preview: null,
          cancelled: false,
        };
        return;
      }
    }
    panning = true;
    cv.classList.add("panning");
    panStart = { x: p.x, y: p.y, cx: state.cam.x, cy: state.cam.y };
  } else if (pointers.size === 2) {
    cancelMove();
    panning = false;
    measuring = false;
    cv.classList.remove("panning");
    const [a, b] = pointers.values();
    pinchDist = Math.hypot(a.x - b.x, a.y - b.y);
  }
}

function onPointerMove(e) {
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
  if (moving) {
    if (moving.cancelled) return;
    if (Math.abs(p.x - moving.start.x) + Math.abs(p.y - moving.start.y) > slip(e)) {
      if (!moving.moved) tip.style.display = "none";
      moving.moved = true;
    }
    if (moving.moved) {
      const pt = drawAtMouse();
      const [x1, y1, x2, y2] = moving.rect;
      const nx = Math.round(wX(pt.x) - moving.grab.x),
        ny = Math.round(wY(pt.y) - moving.grab.y);
      let rect = [nx, ny, nx + x2 - x1, ny + y2 - y1];
      if (e.shiftKey) rect = snapRect(state.data.id, GEO, moving.t, rect);
      moving.preview = fitRect(state.path, GEO, rect);
      setCarried(moving.preview);
      cv.style.cursor = "grabbing";
    }
    return;
  }
  if (measuring && state.ruler) {
    const pt = snapAtMouse();
    state.ruler.x2 = pt.x;
    state.ruler.y2 = pt.y;
  }
  if (panning) {
    if (Math.abs(p.x - panStart.x) + Math.abs(p.y - panStart.y) > slip(e)) panMoved = true;
    state.cam.x = panStart.cx - (p.x - panStart.x) / state.cam.z;
    state.cam.y = panStart.cy - (p.y - panStart.y) / state.cam.z;
  }
  if (e.pointerType !== "touch" || !panning) updateHover(mouse, panning); // no tooltips under a panning finger
  scheduleDraw();
}

function endPointer(e) {
  if (!pointers.delete(e.pointerId)) return;
  if (moving && !pointers.size) {
    const m = moving;
    moving = null;
    setCarried(null);
    cv.style.cursor = modeCursor();
    panMoved = m.moved || m.cancelled; // no click follows a carried or a let-go press
    if (m.moved && !m.cancelled) {
      if (!m.preview) toast(`${m.t.name} is too big for the path's grid`);
      else
        try {
          applyRectEdit(m.t, m.preview);
        } catch (err) {
          toast(err.message);
        }
    }
  }
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

// nothing is under the pointer: the tooltip goes, with the overlays' focus on
// what it named
function dropHover(lifted) {
  clearHover(lifted);
  cv.style.cursor = modeCursor();
  setHighlight(null);
  setConnFocus(null);
  setWireFocus(null);
  setPatrol(null);
}

// a move in progress is let go before anything else hears Escape
function letGoOnEscape(e) {
  if (!moving || e.key !== "Escape") return;
  cancelMove();
  e.stopImmediatePropagation();
  e.preventDefault();
}

function onClick() {
  if (panMoved || graphHandover || state.show.ruler) return;
  if (state.show.route) {
    updateHover(mouse, panning); // taps arrive without a preceding hover move
    // a followed object seams the route: the segment closes on it, the ride
    // happens, and the next opens where it lands. Hand stones only show a
    // camera and loopbacks travel nowhere, so both stay plain waypoints
    const seam = hovered().find(
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
      navigateToDest(d, seam);
      routeArrive(d);
    } else addRoutePoint(snapAtMouse()); // click-to-add: pan/pinch/wheel gestures stay live
    return;
  }
  updateHover(mouse, panning); // taps arrive without a preceding hover move
  if (state.edit) {
    selectObject(hovered()[0] ?? null);
    return;
  }
  for (const t of hovered()) {
    const d = followableDest(t);
    if (d) {
      navigateToDest(d, t);
      return;
    }
  }
  if (!getSettings().screenList) return;
  const pt = drawAtMouse(); // nothing to follow: list the screen's objects
  openCamPanel(pt.x, pt.y, hovered()[0] ?? null);
}

// right-click (long-press on touch) copies a permalink to the object under
// the pointer; over empty map the native menu stays available
function onContextMenu(e) {
  const r = cv.getBoundingClientRect();
  mouse.x = e.clientX - r.left;
  mouse.y = e.clientY - r.top;
  updateHover(mouse, panning);
  if (!hovered().length) return;
  e.preventDefault();
  const t = hovered()[0];
  const url = location.href.split("#")[0] + objectHash(t);
  // the link names the shipped object, the one a recipient can resolve
  const copied = isAdded(t)
    ? `${t.name} link copied — the ${t.name} exists on this device alone`
    : isEdited(t) || isRemoved(t)
      ? `${t.name} link copied — it opens on the shipped ${t.name}`
      : `${t.name} link copied`;
  (navigator.clipboard?.writeText(url) ?? Promise.reject()).then(
    () => toast(copied),
    () => toast("copy failed"),
  );
}

// the full-site permalink to the current view. viewHash(), not location.href:
// the hash write is debounced and can lag a pan
function fullSiteUrl(exact) {
  const url = new URL(location.href);
  url.searchParams.delete("embed");
  url.hash = state.path ? viewHash(exact) : location.hash;
  return url.href;
}

function onWheel(e) {
  e.preventDefault();
  Object.assign(state.cam, zoomAt(state.cam, Math.exp(-e.deltaY * 0.0015), mouse.x, mouse.y));
  updateHover(mouse, panning);
  scheduleDraw();
  scheduleHash(false);
}

// draw space, not world units; wX/wY convert where world units are wanted
function drawAtMouse() {
  return { x: state.cam.x + mouse.x / state.cam.z, y: state.cam.y + mouse.y / state.cam.z };
}

// measuring points stick to what they are aimed at — a shown object's center,
// or a collision endpoint while those are drawn — within a few screen pixels
function snapAtMouse() {
  const pt = drawAtMouse();
  return snapTarget(pt, state.path, 8 / state.cam.z, LAYOUT, state.show.coll, objectShown) ?? pt;
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
function onKey(e) {
  if (e.ctrlKey || e.metaKey || typingIn(e.target)) return;
  // brackets before the Alt guard: several layouts type them via Option/AltGr
  if (e.key === "[" || e.key === "]") {
    cyclePath(e.key === "]" ? 1 : -1);
    e.preventDefault();
    return;
  }
  const pan = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] }[
    e.key
  ];
  // Alt is let through for the one chord that reads it, the grid-square nudge of a selection
  if (e.altKey && !(pan && e.shiftKey && state.edit && state.sel)) return;
  const show = SHOW_KEY[e.key];
  if (show) {
    lightCap($("toggles"), e);
    if (!e.repeat) toggleShow(show); // a held key autorepeats; the toggle must not
    return;
  }
  // the removal claims the key, whichever handler the window reaches first
  if (
    e.key === "Backspace" &&
    state.route &&
    !e.defaultPrevented &&
    !(state.edit && state.sel && !isRemoved(state.sel))
  ) {
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
  if (e.key === "n") {
    if (!state.edit) return;
    e.preventDefault(); // the letter must not land in the filter the picker focuses
    if (!e.repeat) openAddPicker();
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
  if (pan && moving) return; // the hand has the object
  if (pan && e.shiftKey && state.edit && state.sel && !isRemoved(state.sel)) {
    nudge(pan, e.altKey);
    e.preventDefault();
    return;
  }
  if (pan) {
    state.cam.x += (pan[0] * KEY_PAN_PX) / state.cam.z;
    state.cam.y += (pan[1] * KEY_PAN_PX) / state.cam.z;
  } else if (e.key === "+" || e.key === "=" || e.key === "-" || e.key === "_") {
    const f = e.key === "-" || e.key === "_" ? 1 / KEY_ZOOM_STEP : KEY_ZOOM_STEP;
    settleView();
    Object.assign(state.cam, zoomAt(state.cam, f, cv.clientWidth / 2, cv.clientHeight / 2));
  } else return;
  e.preventDefault();
  // off the map the pointer rests on nothing a key could bring under it
  if (onMap) updateHover(mouse, panning);
  else {
    dropHover(true);
    readout(mouse);
  }
  scheduleDraw();
  scheduleHash(false);
}

// the selection one world unit along, or a grid square with Alt, kept on the
// grid; every press of a run joins the one undo step
function nudge([dx, dy], square) {
  const t = state.sel;
  const u = square ? gridSize(onBackgroundPlane(state.data.id, t)) : 1;
  const rect = fitRect(state.path, GEO, [
    t.x1 + dx * u,
    t.y1 + dy * u,
    t.x2 + dx * u,
    t.y2 + dy * u,
  ]);
  if (!rect) return;
  try {
    applyRectEdit(t, rect, { merge: true });
  } catch (err) {
    toast(err.message);
  }
}

// ---- shortcuts panel (the ? key) -----------------------------------------
const shortcutsOverlay = $("shortcutsOverlay");
function openShortcuts() {
  openDialog(shortcutsOverlay, closeShortcuts);
  $("shortcutsClose").focus();
}
const closeShortcuts = () => closeDialog(shortcutsOverlay);

export function initInteraction() {
  // the boot stands the sidebar open with no slide, so the map's box is at rest
  // before a view is placed by its size; narrow and an embed start with it away
  if (!isNarrow() && !embedded) {
    sidebar.style.transition = "none";
    document.body.classList.add("menu-open");
    void sidebar.offsetWidth;
    sidebar.style.transition = "";
  }
  window.addEventListener("keydown", () => (keyInput = true), true);
  window.addEventListener("pointerdown", () => (keyInput = false), true);
  syncMenu();
  menuBtn.onclick = () => toggleMenu();
  scrim.onclick = () => toggleMenu(false);
  window.addEventListener("menu-toggle", (e) => toggleMenu(e.detail.open));
  // the sidebar's way to the picker; the sheet it opens would land under the drawer on narrow
  $("editAddBtn").onclick = () => {
    if (isNarrow()) toggleMenu(false);
    openAddPicker();
  };
  window.addEventListener("selection-changed", (e) => {
    if (isNarrow() && !e.detail.fromHash) toggleMenu(false); // reveal the map after picking
  });

  // the mode acts on the map, so on narrow the drawer comes off it
  window.addEventListener("edit-changed", () => {
    if (state.edit && isNarrow()) toggleMenu(false);
    else if (!state.edit) cancelMove();
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

  if (vv) {
    vv.addEventListener("resize", syncPageZoom);
    vv.addEventListener("scroll", syncPageZoom);
    syncPageZoom(); // a reload can come back at the scale it left
  }

  cv.addEventListener("pointerdown", onPointerDown);
  cv.addEventListener("pointermove", onPointerMove);
  cv.addEventListener("pointerup", endPointer);
  // a pointer the browser takes away lets the object go where it was
  cv.addEventListener("pointercancel", (e) => {
    cancelMove();
    endPointer(e);
  });

  window.addEventListener("keydown", letGoOnEscape, { capture: true });

  // measurements don't outlive their path
  window.addEventListener("selection-changed", () => {
    if (!state.ruler) return;
    state.ruler = null;
    scheduleDraw();
  });

  // a pointer an overlay uncovers arrives without a move
  cv.addEventListener("pointerenter", (e) => {
    Object.assign(mouse, ptrXY(e));
    onMap = true;
  });
  cv.addEventListener("pointerleave", (e) => {
    if (pointers.size) return; // a captured drag only leaves after release
    onMap = false;
    dropHover(e.pointerType === "touch");
  });

  // the pointed-at objects are the path's old ones after an edit
  window.addEventListener("data-changed", () => {
    clearHover();
    // an object that left the path mid-drag is let go, a swap it survived carries on
    if (moving && !currentOf(moving.t, state.path)) cancelMove();
  });

  cv.addEventListener("click", onClick);
  cv.addEventListener("contextmenu", onContextMenu);

  // the top-right chain button copies the view's permalink — the address bar
  // equivalent, which phones and installed/standalone mode may hide
  copyLinkBtn.innerHTML = LINK_SVG;
  copyLinkBtn.onclick = () => {
    if (!state.path) return;
    (navigator.clipboard?.writeText(fullSiteUrl()) ?? Promise.reject()).then(
      () => toast("link copied"),
      () => toast("copy failed"),
    );
  };

  // in embeds the chain button gives way to this link out to the full site at
  // the same view; the href is seeded at boot (an <a> without one isn't even
  // focusable) and refreshed on pointerdown/click, before navigation reads it
  openSiteBtn.innerHTML = EXTERNAL_SVG;
  openSiteBtn.href = fullSiteUrl(true);
  openSiteBtn.onpointerdown = openSiteBtn.onclick = () => {
    openSiteBtn.href = fullSiteUrl(true);
  };

  cv.addEventListener("wheel", onWheel, { passive: false });

  window.addEventListener("keydown", onKey);

  $("shortcutsClose").onclick = closeShortcuts;
  shortcutsOverlay.onclick = (e) => {
    if (e.target === e.currentTarget) closeShortcuts();
  };
  trapDialogKeys(() => shortcutsOverlay.classList.contains("open"), $("shortcuts"), closeShortcuts);
}
