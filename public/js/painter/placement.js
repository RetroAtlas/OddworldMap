// Where what is drawn of an object lies on the map: the camera it is drawn in, the rect a
// frame fills about its point, the part of a box its camera shows, the box about the whole
// sprite, and the one a wire or an arrow ends in.
// Importable in bare Node: no DOM.

import { poseAt } from "../engine/motion.js";
import { drawX, drawY } from "../model/geometry.js";
import { drawBox } from "../model/model.js";
import { drawnAs } from "./kept.js";

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

// the camera a record standing at a point is drawn in: the one it names, else the point's own
export const cameraOf = (r, { x, y }, layout) =>
  r.camAt ? cameraAt(layout, r.camAt.x, r.camAt.y) : cameraAt(layout, Math.trunc(x), Math.trunc(y));

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

// the rect frames fill about their point on average, by area: it stands still while an
// animation plays through them, and a blank frame, a texel wide, has next to no say in it
function meanRect(frames, r, flip, ae) {
  const mean = { x: 0, y: 0, w: 0, h: 0 };
  let area = 0;
  for (const frame of frames) {
    const rect = frameRect(frame, r, flip, ae);
    const part = rect.w * rect.h;
    area += part;
    for (const k in mean) mean[k] += part * rect[k];
  }
  if (!area) return null;
  for (const k in mean) mean[k] /= area;
  return mean;
}

// the frames of its animation a record may show
function framesOf(r, { anim, seen }) {
  if (r.frozen) return [anim.frames[r.frame]];
  return seen ? anim.frames.filter(seen) : anim.frames;
}

// the box about an object's sprite, its records in the poses handed in, or null where none of
// it shows. It stands still while an animation plays and goes where the records go; a tiled
// record and one standing apart are no part of it, and a creature on patrol between two
// screens keeps the box it would be drawn in
export function bodyBox(recs, poseOf, layout, ae) {
  let body = null;
  for (const r of recs) {
    const pose = r.tile || r.apart ? null : poseOf(r);
    const rect = pose && meanRect(framesOf(r, pose), r, pose.flip, ae);
    if (!rect) continue;
    const cam = cameraOf(r, pose, layout);
    const [px, py] = pixelAt(cam, pose.x, pose.y);
    const box = { x: px + rect.x, y: py + rect.y, w: rect.w, h: rect.h };
    const shown = clipBox(box, cam, layout) ?? (pose.moved ? box : null);
    if (shown) body = body ? joinBoxes(body, shown) : shown;
  }
  return body;
}

// the ticks an object is drawn at: the carried one stands in its first frame
export const ticksOf = ({ scene, held }, t) =>
  t === held?.to ? [0, 0] : [scene.tick, scene.patrolAt];

// the box a wire or an arrow ends in the middle of: the one about the object's sprite where
// that is what is drawn of it, else its marker's
export function endBox(f, t) {
  const { data, layout, scene, art } = f;
  if (scene && drawnAs(t, scene.sprites, art) === "sprite") {
    const poseOf = (r) => poseAt(r, scene.set, ...ticksOf(f, t));
    const body = bodyBox(scene.sprites.get(t), poseOf, layout, data.id === "AE");
    if (body) return body;
  }
  return drawBox(t, layout);
}
