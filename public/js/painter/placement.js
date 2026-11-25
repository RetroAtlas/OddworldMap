// Where what is drawn of an object lies on the map: the camera it is drawn in, the rect a
// frame fills about its point, and the part of a box its camera shows.
// Importable in bare Node: no DOM.

import { drawX, drawY } from "../model/geometry.js";

// a camera's window and coordinates for a world point
export function cameraAt(layout, x, y) {
  const cam = {
    wx: Math.floor(x / layout.worldW) * layout.worldW + layout.winX,
    wy: Math.floor(y / layout.worldH) * layout.worldH + layout.winY,
  };
  cam.dx = drawX(cam.wx, layout);
  cam.dy = drawY(cam.wy, layout);
  return cam;
}

// the pixel of a camera's window a world point falls on, in draw space
export const pixelAt = (cam, x, y) => [
  cam.dx + (Math.trunc(x) - cam.wx),
  cam.dy + (Math.trunc(y) - cam.wy),
];

// the rect a frame fills about its point's pixel, as Animation::vRender places it:
// the frame's own offset scaled, a half-scale frame's y offset a unit less and
// Exoddus's a pixel larger, every rounding a truncation of v + 0.499; a copy of
// another's frame as AnimationUnknown places it, its offset and size scaled and
// truncated toward zero; a bare sprite has its corner at the point and reads no
// offset
export function frameRect(frame, r, flip, ae) {
  const [, , , w, h, xoff, yoff] = frame;
  const s = r.scale;
  if (r.bare) return { x: 0, y: 0, w, h };
  if (r.copy) {
    const dw = Math.trunc(w * s),
      dh = Math.trunc(h * s),
      ox = Math.trunc(xoff * s),
      oy = Math.trunc(yoff * s);
    return { x: flip ? -ox - dw : ox, y: r.flipY ? -oy - dh : oy, w: dw, h: dh };
  }
  const t = (v) => Math.trunc(v + 0.499);
  let fw = w,
    fh = h,
    ox = xoff,
    oy = yoff;
  if (s !== 1) {
    fw *= s;
    fh *= s;
    ox *= s;
    oy = oy * s - 1;
    if (ae && s === 0.5) {
      fw += 1;
      fh += 1;
    }
  }
  return {
    x: flip ? -t(ox) - t(fw) : t(ox),
    y: r.flipY ? -t(oy) - t(fh) : t(oy),
    w: Math.floor(fw - 0.501) + 1,
    h: Math.floor(fh - 0.501) + 1,
  };
}

// the part of a box a camera's window shows, or null where it shows none
export function clipBox(b, cam, layout) {
  const x1 = Math.max(b.x, cam.dx),
    y1 = Math.max(b.y, cam.dy),
    x2 = Math.min(b.x + b.w, cam.dx + layout.visW),
    y2 = Math.min(b.y + b.h, cam.dy + layout.visH);
  return x2 <= x1 || y2 <= y1 ? null : { x: x1, y: y1, w: x2 - x1, h: y2 - y1 };
}

// the box about two
export function joinBoxes(a, b) {
  const x = Math.min(a.x, b.x),
    y = Math.min(a.y, b.y);
  return {
    x,
    y,
    w: Math.max(a.x + a.w, b.x + b.w) - x,
    h: Math.max(a.y + a.h, b.y + b.h) - y,
  };
}
