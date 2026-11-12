// The screens as the painter draws from them: the camera images, a patched
// screen composed as one picture, the tinted and dimmed masks, each cached under
// its file

import { scheduleDraw } from "../ui/redraw.js";
import { COLOR } from "../ui/dom.js";
import { showing } from "./artorder.js";

export const images = {}; // png -> Image
export function img(src) {
  if (!images[src]) {
    const im = new Image();
    im.src = src;
    im.onload = im.onerror = scheduleDraw;
    images[src] = im;
  }
  return images[src];
}

// a patched screen as one picture, the base's screen with the release's patches
// drawn over it once every part has arrived, so the base never shows alone, and
// made an image again, since a browser scales a canvas down otherwise than an
// image; held under its first patch, which leaves the cache when the camera's
// files do
export const composed = {};
export function compose(c) {
  const key = c.patches[0][2];
  if (composed[key]) return composed[key];
  const base = img(c.png);
  const parts = c.patches.map(([, , src]) => img(src));
  if (![base, ...parts].every((p) => p.complete && p.naturalWidth)) return null; // retried next draw
  const oc = document.createElement("canvas");
  oc.width = base.naturalWidth;
  oc.height = base.naturalHeight;
  const octx = oc.getContext("2d");
  octx.drawImage(base, 0, 0);
  c.patches.forEach(([x, y], i) => octx.drawImage(parts[i], x, y));
  const entry = { im: new Image(), ready: false };
  entry.done = new Promise((res) => oc.toBlob(res))
    .then((blob) => {
      entry.im.src = URL.createObjectURL(blob);
      return entry.im.decode();
    })
    .then(
      () => {
        entry.ready = true;
      },
      () => {
        if (composed[key] === entry) delete composed[key];
      },
    )
    .finally(() => {
      URL.revokeObjectURL(entry.im.src);
      scheduleDraw();
    });
  composed[key] = entry;
  return entry;
}
export function screenOf(c) {
  if (c.patches) {
    const entry = compose(c);
    return entry?.ready ? entry.im : null;
  }
  const im = img(c.png);
  return im.complete && im.naturalWidth ? im : null;
}

// a camera's files, its screen and a release's patches over it: whether all of
// them have been asked for, and whether all have arrived or failed
const filesOf = (c) => [c.png, ...(c.patches ?? []).map(([, , src]) => src)];
export const asked = (c) => filesOf(c).every((src) => images[src]);
export const arrived = (c) => filesOf(c).every((src) => images[src]?.complete);

// whether every screen showing in a view has arrived or failed
export const viewSettled = (path, layout, view) =>
  path.cams.every((c) => !c.png || !showing(c.cell, path, layout, view) || arrived(c));

export const tintCache = {};
// the foreground masks under Dim: the mask's pixels dimmed the way the screens
// are, but opaque, so a sprite behind a piece of foreground stays hidden
export const dimCache = {};
export function dimmedImg(src) {
  if (dimCache[src]) return dimCache[src];
  const im = img(src);
  if (!im.complete || !im.naturalWidth) return null;
  const oc = document.createElement("canvas");
  oc.width = im.naturalWidth;
  oc.height = im.naturalHeight;
  const octx = oc.getContext("2d");
  octx.drawImage(im, 0, 0);
  octx.globalCompositeOperation = "source-atop";
  octx.globalAlpha = 0.65;
  octx.fillStyle = COLOR.mapBg;
  octx.fillRect(0, 0, oc.width, oc.height);
  dimCache[src] = oc;
  return oc;
}
// a camera's masks tinted as one, so a pixel two layers cover tints once; held
// under its first mask, which leaves the cache when the camera's masks do
export function tintedMasks(c) {
  const key = c.masks[0][1];
  if (tintCache[key]) return tintCache[key];
  const ims = c.masks.map(([, src]) => img(src));
  if (!ims.every((im) => im.complete && im.naturalWidth)) return null; // retried next draw
  const oc = document.createElement("canvas");
  oc.width = ims[0].naturalWidth;
  oc.height = ims[0].naturalHeight;
  const octx = oc.getContext("2d");
  for (const im of ims) octx.drawImage(im, 0, 0);
  octx.globalCompositeOperation = "source-in";
  octx.fillStyle = "#ff4fd8";
  octx.fillRect(0, 0, oc.width, oc.height);
  tintCache[key] = oc;
  return oc;
}
