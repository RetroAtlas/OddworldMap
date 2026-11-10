// The marks painted over the map: the labels and edited marks, the ghosts and release
// tags, the wires, the circulation arrows, the highlight and selection, the ruler, the
// route and the follow flash

import {
  CONN_COLORS,
  FLASH_MS,
  PENS,
  WIRE_COLOR,
  barrierDir,
  catOf,
  markerShown,
} from "./config.js";
import { COLOR } from "./ui/dom.js";
import { drawX } from "./geometry.js";
import { connections } from "./kept.js";
import { cellCentre, computeWiring, drawBox, markerCentre } from "./model.js";
import { isRegional } from "./release.js";
import { getSettings } from "./settings.js";
import { objectShown } from "./spriteart.js";
import { standingBox } from "./spritepaint.js";
import { worldLen } from "./state.js";
import { formatDist } from "./util.js";

// filled arrowhead at (tx, ty) pointing along (dx, dy), h long in draw units
function arrowhead(ctx, tx, ty, dx, dy, h) {
  const l = Math.hypot(dx, dy) || 1;
  const ux = dx / l,
    uy = dy / l;
  const bx = tx - h * ux,
    by = ty - h * uy;
  ctx.beginPath();
  ctx.moveTo(tx, ty);
  ctx.lineTo(bx - 0.45 * h * uy, by + 0.45 * h * ux);
  ctx.lineTo(bx + 0.45 * h * uy, by - 0.45 * h * ux);
  ctx.closePath();
  ctx.fill();
}

export const labelled = (t) => !catOf(t).quietLabels || getSettings().labelScenery;

// the label and the edited mark of an object its sprite stands for
export function outline({ ctx, cam }, x, y, w, h, pad, rgb) {
  const p = pad / cam.z;
  ctx.strokeStyle = `rgb(${rgb})`;
  ctx.lineWidth = 1.5 / cam.z;
  ctx.setLineDash([]);
  ctx.strokeRect(x - p, y - p, w + 2 * p, h + 2 * p);
}

export function paintMarkerNotes(f, t, label, edited, released) {
  const { ctx, cam, layout } = f;
  const box = standingBox(t, layout);
  if (!box) return;
  const w = Math.max(box.w, 10),
    h = Math.max(box.h, 10);
  if (edited) outline(f, box.x, box.y, w, h, 3, COLOR.editRgb);
  if (released) outline(f, box.x, box.y, w, h, edited ? 6 : 3, COLOR.releaseRgb);
  if (label) {
    ctx.fillStyle = catOf(t).color;
    ctx.fillText(t.name, box.x, box.y - 3 / cam.z);
  }
}

// the objects removed from the path, where they last stood; the mode alone shows them
export function paintGhosts(f, ghosts) {
  const { ctx, cam, layout } = f;
  ctx.strokeStyle = ctx.fillStyle = `rgb(${COLOR.editRgb})`;
  ctx.lineWidth = 1.5 / cam.z;
  ctx.setLineDash([2 / cam.z, 3 / cam.z]);
  ctx.globalAlpha = 0.55;
  ctx.font = `${11 / cam.z}px sans-serif`;
  for (const g of ghosts) {
    if (!markerShown(g)) continue;
    const box = drawBox(g, layout);
    const w = Math.max(box.w, 10),
      h = Math.max(box.h, 10);
    ctx.strokeRect(box.x, box.y, w, h);
    if (f.showLabels && labelled(g)) ctx.fillText(`${g.name} · removed`, box.x, box.y - 3 / cam.z);
  }
  ctx.globalAlpha = 1;
  ctx.setLineDash([]);
}

// the objects the release drops, where the base has them
export function paintReleaseGhosts(f, ghosts) {
  const { ctx, cam, layout, data } = f;
  ctx.strokeStyle = ctx.fillStyle = `rgb(${COLOR.releaseRgb})`;
  ctx.lineWidth = 1.5 / cam.z;
  ctx.setLineDash([2 / cam.z, 3 / cam.z]);
  ctx.globalAlpha = 0.55;
  ctx.font = `${11 / cam.z}px sans-serif`;
  for (const g of ghosts) {
    if (!markerShown(g)) continue;
    const box = drawBox(g, layout);
    ctx.strokeRect(box.x, box.y, Math.max(box.w, 10), Math.max(box.h, 10));
    if (f.showLabels && labelled(g))
      ctx.fillText(`${g.name} · not in ${data.release.name}`, box.x, box.y - 3 / cam.z);
  }
  ctx.globalAlpha = 1;
  ctx.setLineDash([]);
}

// a screen whose picture is the release's own wears its code in a corner
export function paintReleaseTags({ ctx, cam, path, layout, data }) {
  if (layout.visW * cam.z <= 90) return;
  const tag = data.release.code.toUpperCase();
  ctx.font = `600 ${10 / cam.z}px sans-serif`;
  const pad = 4 / cam.z,
    h = 14 / cam.z,
    w = ctx.measureText(tag).width + 2 * pad;
  for (const c of path.cams) {
    if (!isRegional(c)) continue;
    const x = (c.cell % path.w) * layout.cellW + layout.visW - w - pad,
      y = Math.floor(c.cell / path.w) * layout.cellH + pad;
    ctx.fillStyle = `rgba(${COLOR.releaseRgb}, 0.85)`;
    ctx.fillRect(x, y, w, h);
    ctx.fillStyle = COLOR.bg;
    ctx.fillText(tag, x + pad, y + h - 4 / cam.z);
  }
}

// switch wiring: dotted hairlines from each producer to its id's consumers,
// straight and thin so the circulation arrows' solid curves stay a separate
// voice. Hovering a wired object spotlights its own wires and gives them
// arrowheads at the consumer end; an edge hides with either endpoint. A wire
// to a barrier post lands on the post's line, as the ruler's snap does.
export function paintWires({ ctx, cam, data, path, layout, at }, focus) {
  const centre = (t) => {
    const post = PENS.on && barrierDir(t) !== null;
    const [cx, cy] = markerCentre(t, layout);
    return [post ? drawX(t.x1, layout) : cx, cy];
  };
  // the spotlight judges what is drawn: a hovered object whose wires are
  // all hidden must not dim the rest with nothing to show for it
  const drawn = computeWiring(path, data.id).edges.filter(
    (e) => objectShown(e.src) && objectShown(e.dst),
  );
  const focusActive = focus && drawn.some((e) => e.src === focus || e.dst === focus);
  ctx.strokeStyle = ctx.fillStyle = WIRE_COLOR;
  const dash = [2.5 / cam.z, 4.5 / cam.z];
  ctx.setLineDash(dash);
  for (const e of drawn) {
    const focused = focusActive && (e.src === focus || e.dst === focus);
    ctx.globalAlpha = focusActive ? (focused ? 0.95 : 0.12) : 0.5;
    ctx.lineWidth = (focused ? 2.5 : 1.25) / cam.z;
    const [sx, sy] = centre(at(e.src));
    const [tx, ty] = centre(at(e.dst));
    const len = Math.hypot(tx - sx, ty - sy);
    if (len < 1) continue;
    ctx.beginPath();
    ctx.moveTo(sx, sy);
    ctx.lineTo(tx, ty);
    ctx.stroke();
    if (focused) {
      ctx.setLineDash([]);
      arrowhead(ctx, tx, ty, tx - sx, ty - sy, Math.min(10 / cam.z, 0.3 * len));
      ctx.setLineDash(dash);
    }
  }
  ctx.setLineDash([]);
  ctx.globalAlpha = 1;
}

// connection arrows: the path's circulation — curves between resolved
// pairs (double-headed when mutual), dashed to a bare camera, and labelled
// stubs for destinations on other paths
export function paintConnections({ ctx, cam, data, lvl, path, layout, showLabels, at }, focus) {
  const edges = connections(data, lvl, path);
  // focus only dims the rest when the hovered object actually has edges
  const focusActive = focus && edges.some((e) => e.src === focus || e.dst === focus);
  const headLen = 12 / cam.z;
  const stubLen = Math.min(Math.max(56 / cam.z, 60), 150);
  const pad = 8 / cam.z;
  const diagonal = [Math.SQRT1_2, -Math.SQRT1_2];
  ctx.font = `${11 / cam.z}px sans-serif`;
  for (const e of edges) {
    if (!catOf(e.src).on) continue; // hidden markers keep their arrows hidden too
    const focused = focusActive && (e.src === focus || e.dst === focus);
    ctx.globalAlpha = focusActive ? (focused ? 0.95 : 0.15) : 0.65;
    ctx.lineWidth = (focused ? 3 : 2) / cam.z;
    ctx.strokeStyle = ctx.fillStyle = CONN_COLORS[e.src.name] || "#ffffff";
    const [sx, sy] = markerCentre(at(e.src), layout);
    if (e.label !== undefined) {
      // off-path stub, along the direction the graph gives it or a constant
      // diagonal, which reads as "leaves this path" without pretending to know
      // which way an off-path door leads; it runs at least to the marker's edge,
      // since a transition's marker spans its whole edge zone
      const [dx, dy] = e.dir ?? diagonal;
      const b = drawBox(at(e.src), layout);
      const edge = Math.min(
        dx ? b.w / 2 / Math.abs(dx) : Infinity,
        dy ? b.h / 2 / Math.abs(dy) : Infinity,
      );
      const len = Math.max(stubLen, edge);
      const tx = sx + len * dx,
        ty = sy + len * dy;
      ctx.beginPath();
      ctx.moveTo(sx, sy);
      ctx.lineTo(tx, ty);
      ctx.stroke();
      arrowhead(ctx, tx, ty, dx, dy, Math.min(headLen, 0.25 * stubLen));
      if (showLabels) {
        ctx.shadowColor = "rgba(0,0,0,.9)";
        ctx.shadowBlur = 3 / cam.z;
        ctx.textAlign = dx < 0 ? "right" : dx > 0 ? "left" : "center";
        ctx.textBaseline = dy < 0 ? "bottom" : dy > 0 ? "top" : "middle";
        const glyph = dx ? (dx > 0 ? "→" : "←") : dy > 0 ? "↓" : "↑";
        ctx.fillText(`${glyph} ${e.label}`, tx + pad * dx, ty + pad * dy);
        ctx.shadowBlur = 0;
      }
      continue;
    }
    const [tx, ty] = e.dst ? markerCentre(at(e.dst), layout) : cellCentre(e.cell, path, layout);
    const dx = tx - sx,
      dy = ty - sy;
    const len = Math.hypot(dx, dy);
    if (len < 1) continue;
    // control point to the left of travel: near-coincident reversed pairs
    // (stacked double doors) arc apart instead of overlapping
    const k = Math.min(Math.max(0.18 * len, 24), 110);
    const cpx = (sx + tx) / 2 - (dy / len) * k,
      cpy = (sy + ty) / 2 + (dx / len) * k;
    if (!e.dst) ctx.setLineDash([6 / cam.z, 5 / cam.z]); // camera, not exact object
    ctx.beginPath();
    ctx.moveTo(sx, sy);
    ctx.quadraticCurveTo(cpx, cpy, tx, ty);
    ctx.stroke();
    ctx.setLineDash([]);
    const h = Math.min(headLen, 0.25 * len);
    arrowhead(ctx, tx, ty, tx - cpx, ty - cpy, h); // the curve's end tangent is P2 − C
    if (e.twoWay) arrowhead(ctx, sx, sy, sx - cpx, sy - cpy, h);
  }
  ctx.globalAlpha = 1;
  ctx.textAlign = "start";
  ctx.textBaseline = "alphabetic";
}

export function paintHighlight({ ctx, cam, layout }, t) {
  // drawn even when the object's category is toggled off: the outline is
  // what locates a listed object whose marker is hidden
  const box = standingBox(t, layout) ?? drawBox(t, layout);
  const x1 = box.x,
    y1 = box.y;
  const w = Math.max(box.w, 10),
    h = Math.max(box.h, 10);
  const pad = 3 / cam.z;
  ctx.strokeStyle = `rgb(${COLOR.accentRgb})`;
  ctx.lineWidth = 2.5 / cam.z;
  ctx.setLineDash([7 / cam.z, 5 / cam.z]);
  ctx.strokeRect(x1 - pad, y1 - pad, w + 2 * pad, h + 2 * pad);
  ctx.setLineDash([]);
}

export function paintSelection({ ctx, cam, layout }, t) {
  // the object being edited, outlined whether or not its category is on
  const box = standingBox(t, layout) ?? drawBox(t, layout);
  const w = Math.max(box.w, 10),
    h = Math.max(box.h, 10);
  const pad = 5 / cam.z;
  ctx.strokeStyle = `rgb(${COLOR.editRgb})`;
  ctx.lineWidth = 3 / cam.z;
  ctx.setLineDash([]);
  ctx.strokeRect(box.x - pad, box.y - pad, w + 2 * pad, h + 2 * pad);
}

export function paintRuler({ ctx, cam }, ruler) {
  const dx = ruler.x2 - ruler.x1,
    dy = ruler.y2 - ruler.y1;
  ctx.strokeStyle = "#ffffff";
  ctx.lineWidth = 2 / cam.z;
  ctx.setLineDash([6 / cam.z, 5 / cam.z]);
  ctx.beginPath();
  ctx.moveTo(ruler.x1, ruler.y1);
  ctx.lineTo(ruler.x2, ruler.y2);
  ctx.stroke();
  ctx.setLineDash([]);
  for (const [ex, ey] of [
    [ruler.x1, ruler.y1],
    [ruler.x2, ruler.y2],
  ]) {
    ctx.beginPath();
    ctx.arc(ex, ey, 3.5 / cam.z, 0, Math.PI * 2);
    ctx.fillStyle = "#ffffff";
    ctx.fill();
  }
  const label = `${Math.round(worldLen(dx, 0))} × ${Math.round(worldLen(0, dy))} · ${formatDist(worldLen(dx, dy))}`;
  ctx.font = `${13 / cam.z}px sans-serif`;
  const midx = (ruler.x1 + ruler.x2) / 2,
    midy = (ruler.y1 + ruler.y2) / 2 - 10 / cam.z;
  ctx.fillStyle = `rgba(${COLOR.mapBgRgb},.85)`;
  const tw = ctx.measureText(label).width;
  ctx.fillRect(midx - tw / 2 - 5 / cam.z, midy - 13 / cam.z, tw + 10 / cam.z, 18 / cam.z);
  ctx.fillStyle = "#ffffff";
  ctx.fillText(label, midx - tw / 2, midy);
}

// route-planner polylines: solid accent (the ruler stays dashed white), one
// per segment of this path — a seam (a followed door or well) breaks the
// line, since the travel between the halves isn't walked. A ring marks the
// route's start when it is on this path; per-leg lengths label each segment
export function paintRoute({ ctx, cam, lvl, path }, route) {
  const col = `rgb(${COLOR.accentRgb})`;
  ctx.font = `${12 / cam.z}px sans-serif`;
  route.forEach((seg, si) => {
    if (seg.lv !== lvl.short || seg.pa !== path.id) return;
    const pts = seg.pts;
    ctx.strokeStyle = col;
    ctx.fillStyle = col;
    ctx.lineWidth = 2.5 / cam.z;
    if (pts.length > 1) {
      ctx.beginPath();
      ctx.moveTo(pts[0].x, pts[0].y);
      for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i].x, pts[i].y);
      ctx.stroke();
    }
    for (const p of pts) {
      ctx.beginPath();
      ctx.arc(p.x, p.y, 3.5 / cam.z, 0, Math.PI * 2);
      ctx.fill();
    }
    if (si === 0 && pts.length) {
      ctx.lineWidth = 2 / cam.z;
      ctx.beginPath();
      ctx.arc(pts[0].x, pts[0].y, 6.5 / cam.z, 0, Math.PI * 2);
      ctx.stroke();
    }
    for (let i = 1; i < pts.length; i++) {
      const a = pts[i - 1],
        b = pts[i];
      const dx = b.x - a.x,
        dy = b.y - a.y;
      if (Math.hypot(dx, dy) * cam.z < 60) continue; // zoomed out, the labels would drown the route
      const label = formatDist(worldLen(dx, dy));
      const midx = (a.x + b.x) / 2,
        midy = (a.y + b.y) / 2 - 10 / cam.z;
      const tw = ctx.measureText(label).width;
      ctx.fillStyle = `rgba(${COLOR.mapBgRgb},.85)`;
      ctx.fillRect(midx - tw / 2 - 5 / cam.z, midy - 12 / cam.z, tw + 10 / cam.z, 17 / cam.z);
      ctx.fillStyle = "#ffffff";
      ctx.fillText(label, midx - tw / 2, midy);
    }
  });
}

export function paintFlash({ ctx, cam }, ring) {
  const el = performance.now() - ring.t0;
  const a = ring.hold ? 1 : Math.max(0, 1 - el / FLASH_MS);
  ctx.strokeStyle = `rgba(${COLOR.accentRgb},${a})`;
  ctx.lineWidth = 3.5 / cam.z;
  const r = (46 + 10 * Math.sin(el / 110)) / Math.sqrt(cam.z);
  ctx.beginPath();
  ctx.arc(ring.x, ring.y, r, 0, Math.PI * 2);
  ctx.stroke();
}
