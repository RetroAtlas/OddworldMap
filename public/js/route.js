// Route planner: waypoint editing, the distance readout bar and the route's
// lifecycle. A route is a list of per-path segments {lv, pa, pts}; a follow
// taken while the planner is armed seams two segments together, so a route can
// walk through doors and wells. The polylines render in render.js whenever
// state.route has segments; state.show.route only gates editing, so a shared
// route link opens visible with click-to-follow still live.

import { MAX_ROUTE_PTS } from "./config.js";
import { formatDist } from "./util.js";
import { $ } from "./dom.js";
import { GEO, LAYOUT, routeTotal, state } from "./state.js";
import { markerCentre, resolveTarget } from "./model.js";
import { scheduleDraw } from "./render.js";
import { scheduleHash } from "./navigate.js";

const bar = $("routeBar"),
  stats = $("routeStats"),
  undoBtn = $("routeUndo"),
  clearBtn = $("routeClear");

const last = () => state.route?.[state.route.length - 1];
const onSeg = (s) => !!s && state.lvl?.short === s.lv && state.path?.id === s.pa;
const countPts = () => state.route?.reduce((n, s) => n + s.pts.length, 0) ?? 0;

// user edits announce themselves and serialize into the hash; applyHash sets
// state.route directly and dispatches the event itself
function edited(push) {
  window.dispatchEvent(new CustomEvent("route-changed"));
  scheduleHash(push);
}

export function addRoutePoint(pt) {
  if (!state.path) return;
  const p = { x: Math.round(pt.x), y: Math.round(pt.y) }; // ints, so the hash round-trips exactly
  if (countPts() >= MAX_ROUTE_PTS) return; // parser cap; unreachable by hand
  let s = last();
  // no segment yet for the path in hand: undoing across a seam leaves one behind
  if (!onSeg(s))
    (state.route ??= []).push((s = { lv: state.lvl.short, pa: state.path.id, pts: [] }));
  const prev = s.pts.at(-1);
  if (prev && prev.x === p.x && prev.y === p.y) return; // double-click: no zero-length leg
  s.pts.push(p);
  edited(false);
}

// a follow taken while armed: close the segment at the followed object, and
// open the next one where the ride lands — the caller navigates in between
export function routeSeam(at, d) {
  addRoutePoint(at);
  if (countPts() >= MAX_ROUTE_PTS) return; // a full route stops growing; the ride still happens
  (state.route ??= []).push({ lv: d.lv, pa: d.pa, pts: [] });
  edited(false);
}

// after the follow: anchor the new segment on the arrival partner, where one
// resolves — an unresolved arrival waits for the first click instead
export function routeArrive(d) {
  const s = last();
  if (!s || !onSeg(s) || s.pts.length) return;
  if (countPts() >= MAX_ROUTE_PTS) return;
  const g = resolveTarget(d, state.path, GEO);
  if (!g) return;
  const [cx, cy] = markerCentre(g, LAYOUT);
  s.pts.push({ x: Math.round(cx), y: Math.round(cy) });
  edited(false);
}

export function undoRoutePoint() {
  if (!state.route) return;
  last().pts.pop();
  while (state.route.length && !last().pts.length) state.route.pop(); // an emptied segment takes its seam with it
  if (!state.route.length) state.route = null;
  edited(false);
}

function clearRoute() {
  if (!state.route) return;
  state.route = null;
  edited(true); // a push: the previous history entry keeps the route, so Back restores it
}

undoBtn.onclick = undoRoutePoint;
clearBtn.onclick = clearRoute;

// one sync point for every mutation source (edits, mode toggle, applyHash)
window.addEventListener("route-changed", () => {
  bar.hidden = !(state.show.route || state.route);
  undoBtn.disabled = clearBtn.disabled = !state.route;
  const n = countPts();
  // distinct paths, not segments: a same-path door pair seams two segments
  // without leaving the path
  const paths = new Set(state.route?.map((s) => `${s.lv}/${s.pa}`)).size;
  const across = paths > 1 ? ` across ${paths} paths` : "";
  const total = state.route?.reduce((sum, s) => sum + routeTotal(s.pts), 0) ?? 0;
  stats.textContent = n
    ? `${n} pt${n === 1 ? "" : "s"}${across} · ${formatDist(total)}`
    : "click the map to add waypoints";
  scheduleDraw();
});

// a route lives while you stand on any of its segments' paths — the person a
// link was shared with can walk it, by button, door or the back button —
// and clears only when the selection wanders somewhere the route never
// visits. The armed follow appends its destination segment before
// navigating, so a seam into fresh territory passes the rule too.
window.addEventListener("selection-changed", () => {
  if (state.route && !state.route.some(onSeg)) {
    // no hash write: the selection's own push serializes the cleared state
    // (its debounced timer runs after this synchronous listener)
    state.route = null;
    window.dispatchEvent(new CustomEvent("route-changed"));
  }
});
