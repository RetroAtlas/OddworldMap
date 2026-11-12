// The view a path opens on. Importable in bare Node: no DOM.

import { ZOOM_MIN } from "../config.js";

const FIT_MARGIN = 200;

// the camera holding a path's whole grid, a margin about it
export function pathFit(path, cw, ch, layout, [ox, oy]) {
  const w = path.w * layout.cellW,
    h = path.h * layout.cellH;
  const z = Math.max(ZOOM_MIN, Math.min(cw / (w + FIT_MARGIN), ch / (h + FIT_MARGIN)));
  return { x: ox - (cw / z - w) / 2, y: oy - (ch / z - h) / 2, z };
}
