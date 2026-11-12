// The view a path opens on: the whole path where its screens read at that
// size, else one screen of it, as large as the canvas holds. Importable in bare
// Node: no DOM.

import {
  ENTRY_CLEAR,
  ENTRY_ZOOM_MAX,
  FIT_ZOOM_MIN,
  FIT_ZOOM_NARROW,
  MINIMAP_MAX,
  ZOOM_MIN,
} from "../config.js";
import { clamp } from "./util.js";

const FIT_MARGIN = 200;
const STRIP = 0.2; // a screen showing less of a side than this is not in view

// the camera holding a path's whole grid, a margin about it
export function pathFit(path, cw, ch, layout, [ox, oy]) {
  const w = path.w * layout.cellW,
    h = path.h * layout.cellH;
  const z = Math.max(ZOOM_MIN, Math.min(cw / (w + FIT_MARGIN), ch / (h + FIT_MARGIN)));
  return { x: ox - (cw / z - w) / 2, y: oy - (ch / z - h) / 2, z };
}

// draw units to the minimap's pixels: a path's whole grid in its corner box
export const minimapScale = (path, layout) =>
  Math.min(MINIMAP_MAX.w / (path.w * layout.cellW), MINIMAP_MAX.h / (path.h * layout.cellH));

// the zoom one screen is shown at inside what a canvas has clear of its edges
// by `left`, `right`, `top` and `bottom`: whole, at its art's own size at most
const zoomIn = ({ left, right, top, bottom }, cw, ch, geo) =>
  clamp(
    Math.min((cw - left - right) / geo.visW, (ch - top - bottom) / geo.visH),
    ZOOM_MIN,
    ENTRY_ZOOM_MAX,
  );

// that zoom clear of the chip row and the help line, with no minimap to pass
export const screenZoom = (cw, ch, geo) => {
  const { top, side, bottom } = ENTRY_CLEAR;
  return zoomIn({ left: side, right: side, top, bottom }, cw, ch, geo);
};

// what a canvas has clear of the map's furniture for one screen of a path, and
// that zoom there: below the chip row, above the help line, and above or
// beside the minimap, whichever leaves the screen larger
function clearFor(path, cw, ch, layout) {
  const { top, side, bottom, mapRight, mapBottom } = ENTRY_CLEAR;
  const s = minimapScale(path, layout);
  const mapW = Math.round(path.w * layout.cellW * s),
    mapH = Math.round(path.h * layout.cellH * s);
  const above = { left: side, right: side, top, bottom: mapBottom + mapH };
  const beside = { left: side, right: mapRight + mapW, top, bottom };
  const clear = zoomIn(beside, cw, ch, layout) > zoomIn(above, cw, ch, layout) ? beside : above;
  return { clear, z: zoomIn(clear, cw, ch, layout) };
}

// whether a path opens whole: fitted with its screens edge to edge, whatever
// the pitch in force, they come out at the floor or larger, a canvas under two
// screens wide setting the floor higher, or no smaller than one would alone
export const opensWhole = (path, cw, ch, geo) => {
  const fit = pathFit(path, cw, ch, geo, [0, 0]).z;
  const floor = cw < 2 * geo.visW ? FIT_ZOOM_NARROW : FIT_ZOOM_MIN;
  return fit >= floor || fit >= clearFor(path, cw, ch, geo).z;
};

// the camera showing one screen of a path clear of the map's furniture. What
// is clear lies over the path's screens: about the one screen on an axis where
// no other row or column of them would be in view, else about them all where
// they fit it, else stopped at their edge
export function screenView(path, cell, cw, ch, layout) {
  const { clear, z } = clearFor(path, cw, ch, layout);
  const col = (c) => c % path.w,
    row = (c) => Math.floor(c / path.w);
  const cells = path.cams.map((c) => c.cell);
  const spanX = (cw - clear.left - clear.right) / z,
    spanY = (ch - clear.top - clear.bottom) / z;
  // where the stretch starts on an axis: about the one screen, and kept over
  // the path's screens
  const along = (at, of, pitch, vis, span) => {
    const lo = Math.min(...cells.map(of)) * pitch,
      hi = Math.max(...cells.map(of)) * pitch + vis;
    const mid = at * pitch + (vis - span) / 2;
    return { mid, kept: hi - lo <= span ? (lo + hi - span) / 2 : clamp(mid, lo, hi - span) };
  };
  const x = along(col(cell), col, layout.cellW, layout.visW, spanX),
    y = along(row(cell), row, layout.cellH, layout.visH, spanY);
  const over = (from, span, at, vis) =>
    Math.min(at + vis, from + span) - Math.max(at, from) > vis * STRIP;
  const shown = cells.filter(
    (c) =>
      over(x.kept, spanX, col(c) * layout.cellW, layout.visW) &&
      over(y.kept, spanY, row(c) * layout.cellH, layout.visH),
  );
  const lone = (of) => shown.every((c) => of(c) === of(cell));
  return {
    x: (lone(col) ? x.mid : x.kept) - clear.left / z,
    y: (lone(row) ? y.mid : y.kept) - clear.top / z,
    z,
  };
}
