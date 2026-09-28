// DOM-free interpretation of the decoded map data: TLV destinations,
// entry-path analysis, view math and the permalink format. Kept importable in
// bare Node for the unit tests.

import { clamp } from "./util.js";
import {
  ZOOM_MIN,
  ZOOM_MAX,
  FOCUS_ZOOM_MIN,
  FOCUS_ZOOM_MAX,
  FOCUS_SCREENS,
  MAX_ROUTE_PTS,
  EXPORT_MAX_PX,
  EXPORT_MAX_DIM,
  BARRIERS,
  PENS,
  markerShown,
  WIRES,
  DOOR_GATE,
  HUB_FIELDS,
} from "./config.js";
import { isDemoPath } from "./demo.js";
import { drawAt } from "./geometry.js";
import { GEO, LAYOUT, state, CELL_W, CELL_H, dX, dY, wX, wY } from "./state.js";

export function computeEntryPaths(data, geo = data.geometry) {
  const entries = {};
  const add = (lv, pa) => (entries[lv] ??= new Set()).add(pa);
  for (const L of data.levels)
    for (const P of L.paths)
      for (const t of P.tlvs) {
        const e = t.extra || {};
        const [target, altTarget] = pairTargets(t);
        // a dead destination must not badge a real path
        const arrival = (lv, pa, ca, tgt) => {
          if (!lv || lv === L.short || !pathIn(data, lv, pa)) return;
          if (destTrusted({ lv, pa, ca, target: tgt }, L, data, geo)) add(lv, pa);
        };
        arrival(e.to_level, e.to_path, e.to_cam, target);
        arrival(e.alt_level, e.alt_path, e.alt_cam, altTarget);
        if (t.name === "AbeStart") add(L.short, P.id); // game start / re-entry
      }
  return entries;
}

// the paired object each of a TLV's two destinations lands on, or null where a
// destination names none. Pair number 0 is a number like any other (the
// placeholder ~250 doors and teleporters share — the engine's arrival hunt finds
// the 0-numbered partner). Express wells name the well each ride lands on;
// either well type answers to the id (and the games name local wells
// differently), so that target carries no name
function pairTargets(t) {
  const e = t.extra || {};
  let target = null,
    altTarget = null;
  if (e["target_door#"] != null)
    target = { name: "Door", field: "door#", value: e["target_door#"] };
  else if (e["target_tp#"] != null)
    target = { name: "Teleporter", field: "tp#", value: e["target_tp#"] };
  else if (t.name === "BirdPortal" && e.portal === "travel") target = { name: "BirdPortalExit" };
  if (e["target_well#"] != null) target = { field: "well#", value: e["target_well#"] };
  if (e["alt_target_well#"] != null) altTarget = { field: "well#", value: e["alt_target_well#"] };
  return [target, altTarget];
}

// the level a destination names, or null where the data has no such level
const levelIn = (data, lv) => data?.levels.find((l) => l.short === lv) || null;

// the path a destination names, or null where the data has no such path
export const pathIn = (data, lv, pa) => levelIn(data, lv)?.paths.find((p) => p.id === pa) || null;

// the address a side the designers never pointed anywhere keeps, every field as
// it was born: a real screen holding whatever placeholder answers to it, so only
// the shape of the address gives it away
const unedited = (d, data) =>
  d.pa === 1 && d.ca === 1 && d.target.value === 0 && levelIn(data, d.lv)?.id === 1;

// the object a destination pairs with, or null where nothing answers to it
function targetAt(d, lvl = state.lvl, data = state.data, geo = GEO, path = null) {
  if (!d || !d.target) return null;
  if (d.lv !== lvl.short && unedited(d, data)) return null;
  const P = path && d.lv === lvl.short && d.pa === path.id ? path : pathIn(data, d.lv, d.pa);
  return P ? resolveTarget(d, P, geo) : null;
}

// whether a destination's named partner is there to be found. Asked across
// levels only: within one, resolveTarget is camera-bounded and misses pairings
// that are merely unnumbered, so an unresolved partner is no evidence. A link
// naming no partner has nothing to check and is trusted wherever it points.
export function destTrusted(d, lvl = state.lvl, data = state.data, geo = GEO) {
  if (!d || !d.target) return true;
  if (!pathIn(data, d.lv, d.pa)) return false;
  return d.lv === lvl.short || targetAt(d, lvl, data, geo) != null;
}

// where a door/portal/well leads: prefers a destination that lands on a partner
// object, then one that differs from the current level+path
export function destOf(t, lvl = state.lvl, path = state.path, geo = GEO, data = state.data) {
  const e = t.extra || {};
  // hand stones show other cameras rather than transitioning; follow the first
  // view. AO stones carry full level/path/camera triples; AE ones bare camera
  // ids within their own path, where the camera must still exist — a few
  // stones view cameras the shipped path no longer has, and get no follow
  if (e.view1_cam != null) {
    if (e.view1_level != null && e.view1_path != null)
      return { lv: e.view1_level, pa: e.view1_path, ca: e.view1_cam, target: null };
    return lvl && path && camCell(path, e.view1_cam) != null
      ? { lv: lvl.short, pa: path.id, ca: e.view1_cam, target: null }
      : null;
  }
  // paired objects land on their counterpart within the destination camera
  const [target, altTarget] = pairTargets(t);
  const mk = (lv, pa, ca, tgt) => (lv != null && pa != null ? { lv, pa, ca, target: tgt } : null);
  const a = mk(e.to_level, e.to_path, e.to_cam, target);
  const b = mk(e.alt_level, e.alt_path, e.alt_cam, altTarget);
  // the state the game honours is the one that lands on another object, and it
  // wins whichever side it sits on and whatever camera it names
  const lands = (d) => {
    if (!d || !lvl) return false;
    const g = targetAt(d, lvl, data, geo, path);
    return g != null && g !== t;
  };
  // failing that, a destination goes nowhere when it is untargeted and points
  // at the current path, or is a well's bounce-back naming the well's own
  // camera — a door pair or a well ride to another camera of the same path is
  // a real transition
  const bounce = (d) =>
    lvl &&
    path &&
    d.lv === lvl.short &&
    d.pa === path.id &&
    (d.target != null && d.target.field === "well#"
      ? camCell(path, d.ca) != null && camCell(path, d.ca) === tlvCell(t, path, geo)
      : d.target == null);
  const differs = (d) => d && !bounce(d);
  if (lands(a)) return a;
  if (lands(b)) return b;
  if (differs(a)) return a;
  if (differs(b)) return b;
  const d = a || b;
  // a well whose every state bounces is a launcher (it exits within its own
  // screen), not self-referencing scenery: the follow keeps no pairing
  return d && d.target != null && d.target.field === "well#" ? { ...d, target: null } : d;
}

// a hand stone's view names no partner, so destTrusted believes it wherever it
// points — unguarded, a sight reads as a way through. Whether the path it names
// is one the map holds stays the caller's question.
export function wayThrough(t, lvl = state.lvl, path = state.path, geo = GEO, data = state.data) {
  if ((t.extra || {}).view1_cam != null) return null;
  const d = destOf(t, lvl, path, geo, data);
  return d && destTrusted(d, lvl, data, geo) ? d : null;
}

// every artwork file a game ships, background and foreground alike: what a
// copy of it held on the device has to hold
export const camFiles = (data) =>
  data.levels
    .flatMap((L) => L.paths)
    .flatMap((P) => P.cams)
    .flatMap((c) => [c.png, c.fg])
    .filter(Boolean);

// the camera id a cam name's C## suffix carries, or null
export const camIdOf = (name) => {
  const m = /C(\d+)$/i.exec(name || "");
  return m ? +m[1] : null;
};

// camera id -> grid cell within a path (cam names end in C##)
export function camCell(path, camId) {
  if (camId == null) return null;
  const suffix = "C" + String(camId).padStart(2, "0");
  const cm = path.cams.find((c) => c.name && c.name.endsWith(suffix));
  return cm ? cm.cell : null;
}

// grid cell containing a TLV's top-left corner (spans can cross cells)
export const tlvCell = (t, path, geo) =>
  Math.floor(t.y1 / geo.worldH) * path.w + Math.floor(t.x1 / geo.worldW);

// the draw-space runs a world span lands on, one per window it reaches into.
// The packing folds the slack out, so a span that crosses it whole comes back
// as touching runs, one that stops inside it leaves a gap, and one that never
// reaches a window comes back with nothing.
function windowRuns(a, b, cell, win, vis, pitch) {
  const runs = [];
  for (let c = Math.floor(a / cell); c <= Math.floor(b / cell); c++) {
    const lo = Math.max(a, c * cell + win),
      hi = Math.min(b, c * cell + win + vis);
    if (lo <= hi) runs.push([drawAt(lo, cell, win, pitch), drawAt(hi, cell, win, pitch)]);
  }
  return runs;
}

// where a marker covers screen, as draw-space x and y runs whose product is
// the part of its rect drawn where the object really is. The rest is slack the
// packing folded away, so it lands on a neighbour's artwork. `whole` is the
// common case of nothing being drawn anywhere the object is not: a marker
// inside one window, and equally one straddling windows, whose runs touch
// because the slack between them takes no draw space at all.
export function screenRuns(t, geo = LAYOUT) {
  const xs = windowRuns(t.x1, t.x2, geo.worldW, geo.winX, geo.visW, geo.cellW),
    ys = windowRuns(t.y1, t.y2, geo.worldH, geo.winY, geo.visH, geo.cellH);
  const covers = (runs, a, b, cell, win, pitch) =>
    runs.reduce((n, [lo, hi]) => n + hi - lo, 0) ===
    drawAt(b, cell, win, pitch) - drawAt(a, cell, win, pitch);
  return {
    xs,
    ys,
    whole:
      !!xs.length &&
      !!ys.length &&
      covers(xs, t.x1, t.x2, geo.worldW, geo.winX, geo.cellW) &&
      covers(ys, t.y1, t.y2, geo.worldH, geo.winY, geo.cellH),
  };
}

// the draw-space span a marker's world span occupies on one axis, as
// [start, length], framed by the screen the span covers rather than by its own
// two ends: the slack has no draw position of its own, so a part of the span
// lying in it hangs off the screen it touches at 1:1. A span covering no screen
// at all keeps its own frame and extent.
function drawSpan(a, b, cell, win, vis, pitch) {
  let lo = null,
    hi = null;
  for (let c = Math.floor(a / cell); c <= Math.floor(b / cell); c++) {
    const l = Math.max(a, c * cell + win),
      h = Math.min(b, c * cell + win + vis);
    if (l > h) continue;
    if (lo === null) lo = l;
    hi = h;
  }
  if (lo === null) return [drawAt(a, cell, win, pitch), b - a];
  // the leading overhang, then the screen it covers measured at the pitch in
  // force, so the slack inside that stretch counts for whatever the layout
  // gives it, then the trailing overhang
  const s = drawAt(lo, cell, win, pitch),
    e = drawAt(hi, cell, win, pitch);
  return [s - (lo - a), lo - a + (e - s) + (b - hi)];
}

// a marker's rect in draw space
export function drawBox(t, geo = LAYOUT) {
  const [x, w] = drawSpan(t.x1, t.x2, geo.worldW, geo.winX, geo.visW, geo.cellW),
    [y, h] = drawSpan(t.y1, t.y2, geo.worldH, geo.winY, geo.visH, geo.cellH);
  return { x, y, w, h };
}

export function markerCentre(t, geo = LAYOUT) {
  const b = drawBox(t, geo);
  return [b.x + b.w / 2, b.y + b.h / 2];
}

// of several markers one point hits, the smallest box: a zone covers the objects
// inside it, and of two alike the one painted last is on top
export function smallestMarker(ts, geo = LAYOUT) {
  let best = null,
    area = Infinity;
  for (const t of ts) {
    const b = drawBox(t, geo);
    const a = Math.max(b.w, 10) * Math.max(b.h, 10);
    if (a <= area) [best, area] = [t, a];
  }
  return best;
}

const inWindow = (v, cell, win, vis) => {
  const off = v - Math.floor(v / cell) * cell;
  return off >= win && off < win + vis;
};

// every point on [a, b] where the span enters or leaves a window, as a fraction
// along it; an axis the span does not travel cuts nothing
function windowCuts(cuts, a, b, cell, win, vis) {
  if (a === b) return;
  for (let c = Math.floor(Math.min(a, b) / cell); c <= Math.floor(Math.max(a, b) / cell); c++)
    for (const edge of [c * cell + win, c * cell + win + vis]) {
      const t = (edge - a) / (b - a);
      if (t > 0 && t < 1) cuts.add(t);
    }
}

// a collision line as draw-space pieces, each flagged for whether it covers
// screen. A piece on screen lies inside one window, where the transform is a
// translation, so it lands exactly and stays straight, diagonals included. A
// piece in the slack takes the frame of the screen it touches: the slack
// straddles a cell boundary in AO, so framing each end by its own cell would
// run the piece backwards.
export function lineRuns(x1, y1, x2, y2, geo = LAYOUT) {
  const cuts = new Set([0, 1]);
  windowCuts(cuts, x1, x2, geo.worldW, geo.winX, geo.visW);
  windowCuts(cuts, y1, y2, geo.worldH, geo.winY, geo.visH);
  const at = (t) => [x1 + t * (x2 - x1), y1 + t * (y2 - y1)];
  const ts = [...cuts].sort((p, q) => p - q);
  const spans = [];
  for (let i = 0; i + 1 < ts.length; i++) {
    const mid = at((ts[i] + ts[i + 1]) / 2);
    const onX = inWindow(mid[0], geo.worldW, geo.winX, geo.visW),
      onY = inWindow(mid[1], geo.worldH, geo.winY, geo.visH);
    spans.push({ a: at(ts[i]), b: at(ts[i + 1]), mid, onX, onY, on: onX && onY });
  }
  // draw space the packing allots the slack between two windows, per axis
  const slackX = geo.cellW - geo.visW,
    slackY = geo.cellH - geo.visH;
  // one cell frames a whole piece, so both ends answer to the same translation
  const frame = ([wx, wy], [fx, fy]) => {
    const cx = Math.floor(fx / geo.worldW),
      cy = Math.floor(fy / geo.worldH);
    return [
      cx * geo.cellW + wx - cx * geo.worldW - geo.winX,
      cy * geo.cellH + wy - cy * geo.worldH - geo.winY,
    ];
  };
  const out = [];
  spans.forEach((s, i) => {
    // the fold between two screens: packed it collapses to nothing, which lets
    // a line crossing it read as the continuous floor it is. Asked of the
    // neighbouring spans rather than the points bounding this one, since a line
    // ending on a window edge covers no screen and leaves an overhang; and only
    // where the packing denies the slack it crosses any draw space
    const fold = !s.on && spans[i - 1]?.on && spans[i + 1]?.on;
    if (fold && (!slackX || s.onX) && (!slackY || s.onY)) return;
    const anchor = s.on ? s.mid : ((spans[i - 1]?.on ? spans[i - 1] : spans[i + 1])?.mid ?? s.mid);
    const [ax, ay] = frame(s.a, anchor),
      [bx, by] = frame(s.b, anchor);
    if (Math.abs(bx - ax) < 1e-6 && Math.abs(by - ay) < 1e-6) return; // a degenerate span
    const prev = out[out.length - 1];
    if (prev && prev.on === s.on) [prev.x2, prev.y2] = [bx, by];
    else out.push({ x1: ax, y1: ay, x2: bx, y2: by, on: s.on });
  });
  return out;
}

// a marker with no part of it on any screen: it stands wholly in the slack the
// game never renders and the player never reaches, so every pixel of it is
// drawn over a neighbour's artwork and the screen it is listed under is not
// one it is on. A marker that merely reaches into the slack says so by the
// part of it that draws dotted, and is not one of these.
export const offScreen = (t, geo = LAYOUT) => {
  const { xs, ys } = screenRuns(t, geo);
  return !xs.length || !ys.length;
};

// grid cell under a draw-space point, or null outside the path's grid —
// the margins must not fold into a neighbouring row's edge cell
export function cellAt(x, y, path) {
  const col = Math.floor(x / CELL_W),
    row = Math.floor(y / CELL_H);
  if (col < 0 || col >= path.w || row < 0 || row >= path.h) return null;
  // a screen is its window, so the slack around one belongs to no cell. Packed
  // there is none of it to land in and this never fires
  if (x - col * CELL_W >= GEO.visW || y - row * CELL_H >= GEO.visH) return null;
  return row * path.w + col;
}

// the draw-space centre of a cell's screen — the window inside it, never the
// cell around it, which spaced apart is a different point
export const cellCentre = (cell, path) => [
  (cell % path.w) * CELL_W + GEO.visW / 2,
  Math.floor(cell / path.w) * CELL_H + GEO.visH / 2,
];

// a whole path as one image: scale 1 for every path either game packs, less
// where the spaced pitch blows one past the budget
export function pathImage(path, geo = LAYOUT, maxPx = EXPORT_MAX_PX, maxDim = EXPORT_MAX_DIM) {
  const w = path.w * geo.cellW,
    h = path.h * geo.cellH;
  const scale = Math.min(1, maxDim / w, maxDim / h, Math.sqrt(maxPx / (w * h)));
  return { w: Math.floor(w * scale), h: Math.floor(h * scale), scale };
}

// the camera whose screen centre is nearest a draw-space point. A path's grid is
// mostly empty — the view's centre sits over no camera at all on half the paths
// in either game — so a point that was not aimed needs a nearest, not a hit
export function nearestCam(x, y, path) {
  let best = null,
    bd = Infinity;
  for (const c of path.cams) {
    const [cx, cy] = cellCentre(c.cell, path);
    const d = (cx - x) ** 2 + (cy - y) ** 2;
    if (d < bd) {
      bd = d;
      best = c;
    }
  }
  return best;
}

// nearest snappable point within tol draw units of pt — a shown object's
// center, or a collision-line endpoint when those are drawn — or null
export function snapTarget(pt, path, tol, lines = false) {
  let best = null,
    bd = tol * tol;
  const consider = (x, y) => {
    const d = (x - pt.x) ** 2 + (y - pt.y) ** 2;
    if (d <= bd) {
      bd = d;
      best = { x, y };
    }
  };
  for (const t of path.tlvs) {
    if (!markerShown(t)) continue;
    // a barrier drawn as a post snaps on its boundary line, not the stamp's middle
    const post = PENS.on && t.name in BARRIERS;
    const [cx, cy] = markerCentre(t);
    consider(post ? dX(t.x1) : cx, cy);
  }
  if (lines)
    for (const [x1, y1, x2, y2] of path.lines) {
      // an end lying in the slack is drawn against the screen its line reaches,
      // so the polyline's own ends are the only ones there to snap to
      const rs = lineRuns(x1, y1, x2, y2);
      if (!rs.length) continue;
      consider(rs[0].x1, rs[0].y1);
      consider(rs.at(-1).x2, rs.at(-1).y2);
    }
  return best;
}

// the pen a Slig or SligSpawner patrols: the x-span between the SligBound pair
// sharing its id, which the engine scans for over a camera window (AO ±2 cells,
// AE ±3 — Slig.cpp's bound loops) and reads by each bound's top-left x. Honoured
// only when exactly one Left and one Right answer in the window: the engine's
// last-match-wins on duplicates is not worth imitating. Scrab bounds ship no
// ids, so scrabs get no pen. Returns a draw-space rect, or null.
const BOUND_WINDOW = { AO: 2, AE: 3 };
export function patrolZone(t, path, geo = GEO, gameId = state.data?.id) {
  if (t.name !== "Slig" && t.name !== "SligSpawner") return null;
  const id = t.fields?.slig_bound_persist_id;
  if (id == null) return null;
  const win = BOUND_WINDOW[gameId] ?? 2;
  const cellOf = (o) => [Math.floor(o.x1 / geo.worldW), Math.floor(o.y1 / geo.worldH)];
  const [tc, tr] = cellOf(t);
  const near = (o) => {
    const [c, r] = cellOf(o);
    return Math.abs(c - tc) <= win && Math.abs(r - tr) <= win;
  };
  // the id lives under a different name per game (AO slig_id, AE the same key
  // the Slig itself carries)
  const idOf = (o) => o.fields?.slig_id ?? o.fields?.slig_bound_persist_id;
  const find = (name) => path.tlvs.filter((o) => o.name === name && idOf(o) === id && near(o));
  const L = find("SligBoundLeft"),
    R = find("SligBoundRight");
  if (L.length !== 1 || R.length !== 1) return null;
  if (R[0].x1 <= L[0].x1) return null; // an inside-out pen is data noise, not a zone
  return {
    x1: dX(L[0].x1),
    x2: dX(R[0].x1),
    y1: dY(Math.min(L[0].y1, R[0].y1, t.y1)),
    y2: dY(Math.max(L[0].y2, R[0].y2, t.y2)),
  };
}

// the paired TLV a destination lands on: door numbers are only unique per
// camera, so match inside the destination camera first, path-wide as a fallback.
// Positional targets get no fallback — a name-only target (no pair number)
// resolves only when the stated camera holds exactly one candidate, and pair
// number 0 (shared by many placeholder doors) only inside the stated camera,
// mirroring the engine's forward hunt from there. A nameless target (well ids)
// accepts any object carrying the field, camera-only again: the engine's well
// arrival scan is bounded to the arrival camera's rect.
export function resolveTarget(d, path, geo) {
  if (!d || !d.target) return null;
  const cell = camCell(path, d.ca);
  const match = (t) =>
    (d.target.name == null || t.name === d.target.name) &&
    (d.target.field == null || (t.extra || {})[d.target.field] === d.target.value);
  const positional = d.target.name == null || d.target.field == null || d.target.value === 0;
  if (positional && cell == null) return null;
  if (d.target.field == null) {
    const hits = path.tlvs.filter((t) => match(t) && tlvCell(t, path, geo) === cell);
    return hits.length === 1 ? hits[0] : null;
  }
  return (
    path.tlvs.find((t) => match(t) && (cell == null || tlvCell(t, path, geo) === cell)) ||
    (positional ? null : path.tlvs.find(match)) ||
    null
  );
}

// a paired object (door, teleporter) whose destination names its own camera and
// resolves back to the object itself; a dangling destination whose path-wide
// fallback merely lands on it doesn't count
export function isLoopback(t, lvl = state.lvl, path = state.path, geo = GEO, data = state.data) {
  if (!lvl || !path) return false;
  const d = destOf(t, lvl, path, geo, data);
  return !!(
    d &&
    d.lv === lvl.short &&
    d.pa === path.id &&
    camCell(path, d.ca) === tlvCell(t, path, geo) &&
    resolveTarget(d, path, geo) === t
  );
}

// consolidated connection edges for the circulation overlay:
//   {src, dst, twoWay} — resolved same-path pair (dst is the partner TLV)
//   {src, cell}        — same-path destination without a resolvable partner
//   {src, label}       — off-path destination, labelled "LV Pn"
// Hand-stone views (sights, not transitions), untrusted destinations and
// loopbacks are skipped; a destination that resolves back to its own source
// (dangling camera plus the path-wide fallback) or names a camera missing from
// the grid yields nothing, and neither does one pointing at the source's own
// camera — launcher wells and bounce-backs exit within their screen and must
// not read as arrows.
export function computeConnections(
  lvl = state.lvl,
  path = state.path,
  geo = GEO,
  data = state.data,
) {
  const edges = [];
  const stubs = [];
  const partner = new Map();
  for (const t of path.tlvs) {
    const d = wayThrough(t, lvl, path, geo, data);
    if (!d || isLoopback(t, lvl, path, geo, data)) continue;
    if (d.lv !== lvl.short || d.pa !== path.id) {
      stubs.push({ src: t, label: `${d.lv} P${d.pa}` });
      continue;
    }
    const g = resolveTarget(d, path, geo);
    if (g && g !== t) {
      partner.set(t, g);
    } else {
      const cell = camCell(path, d.ca);
      if (cell != null && cell !== tlvCell(t, path, geo)) edges.push({ src: t, cell });
    }
  }
  // pairs whose partners resolve to each other merge into one two-way edge;
  // asymmetric chains (stacked double doors, teleporter cycles) stay directed
  const consumed = new Set();
  for (const [t, g] of partner) {
    if (consumed.has(t)) continue;
    if (partner.get(g) === t) {
      edges.push({ src: t, dst: g, twoWay: true });
      consumed.add(g);
    } else {
      edges.push({ src: t, dst: g, twoWay: false });
    }
  }
  return [...edges, ...stubs];
}

const liveId = (v) => Number.isInteger(v) && v >= 2 && v <= 255;
const addEnd = (m, id, t) => {
  if (!liveId(id)) return;
  let list = m.get(id);
  if (!list) m.set(id, (list = []));
  list.push(t);
};

// a path's switch wiring: edges from every producer to every consumer sharing
// a live id, plus the id->object maps behind them. A gate door swaps sides:
// its hub ids are inputs and its own switch id the AND's output alone — the
// gate rewrites that id every frame, so an external feed cannot hold it.
// Edges dedupe by endpoint pair and an object never wires to itself.
// Memoized by path identity (paths live as long as their dataset).
const wiringCache = new WeakMap();
export function computeWiring(path, gameId = state.data?.id) {
  let w = wiringCache.get(path);
  if (w && w.gameId === gameId) return w;
  const table = WIRES[gameId] ?? { out: {}, in: {} };
  const prod = new Map();
  const cons = new Map();
  for (const t of path.tlvs) {
    const f = t.fields || {};
    const gate = t.name === "Door" && DOOR_GATE[gameId]?.(t);
    if (gate) {
      addEnd(prod, f.switch_id, t);
      for (const k of HUB_FIELDS) addEnd(cons, f[k], t);
      continue;
    }
    for (const k of table.out[t.name] ?? []) addEnd(prod, f[k], t);
    for (const k of table.in[t.name] ?? []) addEnd(cons, f[k], t);
  }
  const edges = [];
  const seen = new Set();
  const ord = new Map();
  const n = (t) => ord.get(t) ?? (ord.set(t, ord.size), ord.size - 1);
  for (const [id, ps] of prod)
    for (const p of ps)
      for (const c of cons.get(id) ?? []) {
        if (c === p) continue;
        const key = n(p) + ":" + n(c);
        if (!seen.has(key)) {
          seen.add(key);
          edges.push({ src: p, dst: c });
        }
      }
  w = { gameId, edges, prod, cons };
  wiringCache.set(path, w);
  return w;
}

// one object's wired fields: the ids it writes and the ids it answers to
export function wireEnds(t, gameId = state.data?.id) {
  const table = WIRES[gameId] ?? {};
  const f = t.fields || {};
  const ids = (keys) => (keys ?? []).map((k) => f[k]).filter(liveId);
  if (t.name === "Door" && DOOR_GATE[gameId]?.(t))
    return { out: [...new Set(ids(["switch_id"]))], in: [...new Set(ids(HUB_FIELDS))] };
  return {
    out: [...new Set(ids(table.out?.[t.name]))],
    in: [...new Set(ids(table.in?.[t.name]))],
  };
}

// level-wide ends, for the cross-path wiring note: which paths hold a producer
// or consumer of each id — switch state is level-scoped, so an id set in one
// path is heard in every other. Demo paths stay out: a note naming an
// unreachable copy would send the reader somewhere nothing travels.
const levelWiringCache = new WeakMap();
export function levelWiring(lvl, gameId = state.data?.id) {
  let w = levelWiringCache.get(lvl);
  if (w && w.gameId === gameId) return w;
  w = { gameId, prod: new Map(), cons: new Map() };
  const note = (m, id, pa) => {
    let set = m.get(id);
    if (!set) m.set(id, (set = new Set()));
    set.add(pa);
  };
  for (const P of lvl.paths) {
    if (isDemoPath(P)) continue;
    const { prod, cons } = computeWiring(P, gameId);
    for (const id of prod.keys()) note(w.prod, id, P.id);
    for (const id of cons.keys()) note(w.cons, id, P.id);
  }
  levelWiringCache.set(lvl, w);
  return w;
}

// zoom the camera by factor about a fixed canvas point: the world spot under
// (px, py) stays put
export function zoomAt(cam, factor, px, py) {
  const z = clamp(cam.z * factor, ZOOM_MIN, ZOOM_MAX);
  return { x: cam.x + px / cam.z - px / z, y: cam.y + py / cam.z - py / z, z };
}

// a camera and the point at the middle of its viewport, both ways.
export const camCenter = (cam, cw, ch) => ({
  x: cam.x + cw / (2 * cam.z),
  y: cam.y + ch / (2 * cam.z),
  z: cam.z,
});
export const centerCam = (v, cw, ch) => ({
  x: v.x - cw / (2 * v.z),
  y: v.y - ch / (2 * v.z),
  z: v.z,
});

// zoom for jumping to a point: a few screens across, within the focus clamp.
// Screens rather than cells, so it holds still when the pitch around them moves
export const focusZoom = (cw, ch) =>
  clamp(
    Math.min(cw / (FOCUS_SCREENS * GEO.visW), ch / (FOCUS_SCREENS * GEO.visH)),
    FOCUS_ZOOM_MIN,
    FOCUS_ZOOM_MAX,
  );

// - permalinks: #GAME/LEVEL/PATH/cx/cy/zoom[/Name@x1,y1][/graph][/route=…] -
// cx/cy is the view's center, not the corner the renderer works in, so a link
// lands on the same spot whatever the size of the window it opens in. Trailing
// segments are matched by shape, not position, and unknown ones are ignored.
// A route is a list of per-path segments {lv, pa, pts}, and its token is
// "route=nCOUNT;sLV.PA;x,y;…;end": every segment names its path, so no
// waypoint can ever rebind to artwork it was not plotted on. The world graph
// reads as a place of its own, so a bare word carries it.
//
// Every coordinate a link carries is a world coordinate, the object segment's
// included: draw space is a packing of the world that a change of pitch would
// slide under a link, while a world point names a place in the game.
const GRAPH_TOKEN = "graph";

export function formatHash(gameId, levelShort, pathId, view, obj, route, graph) {
  let h = `#${gameId}/${levelShort}/${pathId}/${Math.round(wX(view.x))}/${Math.round(wY(view.y))}/${view.z.toFixed(2)}`;
  if (obj) h += `/${obj.name}@${obj.x1},${obj.y1}`;
  if (graph) h += `/${GRAPH_TOKEN}`;
  const count = route?.reduce((n, s) => n + s.pts.length, 0);
  if (count) {
    const pair = (p) => `${Math.round(wX(p.x))},${Math.round(wY(p.y))}`;
    const body = route.map((s) => [`s${s.lv}.${s.pa}`, ...s.pts.map(pair)].join(";")).join(";");
    h += `/route=n${count};${body};end`;
  }
  return h;
}

// segments from a "route=" payload, as the survivors plus how many of the
// count never arrived: a URL shortened in transit keeps the legs that made it
// rather than losing the route whole. The count comes first so it outlives a
// cut, "sLV.PA" tokens open each segment's run of pairs, and only the trailing
// marker proves the payload complete: a cut inside the final token still reads
// as a well-formed one, so the unproven tail goes unread. Every token ends on
// a letter or digit, past what autolinkers eat off a URL, and the count wears
// the "n" so a pair cannot pass for it. A segment whose points were all cut
// away still arrives, empty, so the seam survives its legs.
function parseRoute(payload) {
  const tokens = payload.split(";");
  const head = /^n(\d+)$/.exec(tokens[0]);
  const total = head ? +head[1] : 0;
  if (total < 1 || total > MAX_ROUTE_PTS) return null;
  const body = tokens.slice(1);
  const complete = body.pop() === "end";
  const segs = [];
  let count = 0;
  for (const token of body) {
    const sm = /^s([a-z0-9]+)\.(\d+)$/i.exec(token);
    if (sm) {
      segs.push({ lv: sm[1].toUpperCase(), pa: +sm[2], pts: [] });
      if (segs.length > MAX_ROUTE_PTS) return null; // markers share the points' sanity cap
      continue;
    }
    const m = /^(-?\d+),(-?\d+)$/.exec(token);
    if (!m || !segs.length) return null; // a pair before any segment is malformed, not cut
    segs[segs.length - 1].pts.push({ x: +m[1], y: +m[2] });
    count++;
  }
  if (complete ? count !== total : count > total) return null;
  return count || segs.length ? { segs, lost: total - count } : null;
}

// the TLV a permalink's object segment names, identified by name and origin
// rather than by a list position a rebuild can reorder. Names compare
// case-insensitively, as the game and level codes do.
export const findTlv = (tlvs, obj) =>
  tlvs.find(
    (t) => t.x1 === obj.x1 && t.y1 === obj.y1 && t.name.toLowerCase() === obj.name.toLowerCase(),
  ) || null;

// the viewer escapes nothing — every delimiter it writes is legal in a fragment
// bare — but share widgets and mail clients percent-encode one anyway. A stray
// % that isn't an escape leaves the fragment as it found it.
function decodeFragment(h) {
  if (!h.includes("%")) return h;
  try {
    return decodeURIComponent(h);
  } catch {
    return h;
  }
}

// the view is all-or-nothing: an incomplete or unreadable trio yields none at
// all, so the caller fits the path rather than centering on a NaN
const finiteView = (x, y, z) =>
  Number.isFinite(x) && Number.isFinite(y) && Number.isFinite(z) && z > 0 ? { x, y, z } : null;

// null for an empty hash; view is the center point plus zoom, null unless all
// three read; obj names a TLV to highlight, identified by name and origin;
// route is a list of segments {lv, pa, pts}, routeLost how many waypoints a
// shortened URL never delivered. Coordinates come back as the link wrote them,
// in world space, which hashToDraw resolves once the link's own game has been
// selected. game/level/path may still come back empty or NaN, which the caller
// resolves against the data.
export function parseHash(hash) {
  const h = decodeFragment(hash.replace(/^#/, ""));
  if (!h) return null;
  const parts = h.split("/");
  const tail = parts.slice(6);
  const om = tail.map((s) => /^(\w+)@(-?\d+),(-?\d+)$/.exec(s)).find(Boolean);
  const level = (parts[1] || "").toUpperCase();
  const path = +parts[2];
  const rt = tail.find((s) => s.startsWith("route="));
  const route = rt ? parseRoute(rt.slice(6)) : null;
  return {
    game: parts[0].toUpperCase(),
    level,
    path,
    view: parts.length >= 6 ? finiteView(+parts[3], +parts[4], +parts[5]) : null,
    obj: om ? { name: om[1], x1: +om[2], y1: +om[3] } : null,
    route: route ? route.segs : null,
    routeLost: route ? route.lost : 0,
    graph: tail.includes(GRAPH_TOKEN),
  };
}

// a parsed permalink's view and route in draw space. The conversion needs the
// link's own geometry, which is not live while parseHash is reading the text:
// applyHash has yet to select the game, and sanitizeLocationHash runs at boot
// with no geometry at all.
export function hashToDraw(p) {
  const at = (x, y) => ({ x: dX(x), y: dY(y) });
  return {
    view: p.view && { ...at(p.view.x, p.view.y), z: p.view.z },
    route: p.route?.map((s) => ({ ...s, pts: s.pts.map((q) => at(q.x, q.y)) })) ?? null,
  };
}
