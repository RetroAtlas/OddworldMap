// The objects as the game draws them: the sprite pass with its layers and clips, the
// LCD glyphs and the effects, one frame at a world anchor, a foreground mask, and
// where a drawn object can be pointed at

import { markerShown } from "./config.js";
import { drawX, drawY } from "./geometry.js";
import { drawBox } from "./model.js";
import { resolveEffects, resolveRecord } from "./motion.js";
import { dimmedImg, img } from "./screens.js";
import { drawnAs, paintedSprites, processedFrame } from "./spriteart.js";

// how far each object on patrol has walked from its mark this frame, so its
// label and edited mark can follow it
export const movedBy = new Map();
// the rectangle each object's sprite was last drawn in, clipped to its camera
export const spriteBoxes = new Map();
function noteBox(t, b, cam, layout) {
  const x1 = Math.max(b.x, cam.dx),
    y1 = Math.max(b.y, cam.dy),
    x2 = Math.min(b.x + b.w, cam.dx + layout.visW),
    y2 = Math.min(b.y + b.h, cam.dy + layout.visH);
  if (x2 <= x1 || y2 <= y1) return;
  const u = spriteBoxes.get(t);
  if (!u) {
    spriteBoxes.set(t, { x: x1, y: y1, w: x2 - x1, h: y2 - y1 });
    return;
  }
  const ux2 = Math.max(u.x + u.w, x2),
    uy2 = Math.max(u.y + u.h, y2);
  u.x = Math.min(u.x, x1);
  u.y = Math.min(u.y, y1);
  u.w = ux2 - u.x;
  u.h = uy2 - u.y;
}

// the objects as the game draws them, back to front by layer and, within a
// layer, the later-constructed under the earlier; each clipped to its own
// camera's window, where the game clips too, so a frame reaching past it
// never paints over a neighbouring screen
export function paintSprites(f, sprites, set, tick, patrolAt, dim) {
  const { ctx, data, layout, path } = f;
  movedBy.clear();
  spriteBoxes.clear();
  const recs = [];
  let order = 0;
  for (const [t, list] of sprites) {
    if (!markerShown(t)) continue;
    order++;
    list.forEach((r, k) => recs.push([r, order, k, t]));
  }
  // the carried object stands in its first frame
  const still = (t) => t === f.held?.to;
  // what the brains give off joins the records, on layers of its own
  const fx = [];
  for (const [r, order, k, t] of recs)
    if (r.cycle?.kind === "brain")
      resolveEffects(r, set, still(t) ? 0 : tick, still(t) ? 0 : patrolAt).forEach((e, i) =>
        fx.push([e, order, k + 1 + i / 1000, t, true]),
      );
  recs.push(...fx);
  recs.sort((a, b) => a[0].layer - b[0].layer || b[1] - a[1] || a[2] - b[2]);
  // a foreground mask covers the sprites of every layer below its own and lies
  // under those of its own layer
  const masks = path.cams
    .flatMap((c) => (c.masks ?? []).map(([layer, src]) => [layer, src, c]))
    .sort((a, b) => a[0] - b[0]);
  let m = 0;
  const ae = data.id === "AE";
  for (const [r, , , t, isFx] of recs) {
    for (; m < masks.length && masks[m][0] <= r.layer; m++) paintMask(f, masks[m], dim);
    if (isFx) {
      paintEffect(ctx, layout, set, r, ae, f.view);
      continue;
    }
    const shown = resolveRecord(r, set, still(t) ? 0 : tick, still(t) ? 0 : patrolAt);
    if (!shown) continue;
    const frame = shown.anim.frames[shown.frame];
    const tile = processedFrame(set.sheets[frame[0]], frame, r.semi, shown.rgb);
    if (!tile) continue;
    if (shown.moved && !movedBy.has(t))
      movedBy.set(
        t,
        inScreens(path, layout, shown.x, shown.y) ? [shown.x - r.x, shown.y - r.y] : null,
      );
    const ax = Math.trunc(shown.x);
    const cams = [];
    if (r.tile) {
      const first = Math.floor(r.tile.top / layout.worldH),
        last = Math.floor((r.tile.bottom - 1) / layout.worldH);
      for (let row = first; row <= last; row++)
        cams.push(cameraAt(layout, ax, row * layout.worldH + layout.winY));
    } else if (r.camAt) cams.push(cameraAt(layout, r.camAt.x, r.camAt.y));
    else cams.push(cameraAt(layout, ax, Math.trunc(shown.y)));
    for (const cam of cams) {
      ctx.save();
      ctx.beginPath();
      ctx.rect(cam.dx, cam.dy, layout.visW, layout.visH);
      ctx.clip();
      if (r.tile) {
        // a rope or web: one frame tiled upward from its bottom, cut to its span
        ctx.beginPath();
        ctx.rect(cam.dx, cam.dy + (r.tile.top - cam.wy), layout.visW, r.tile.bottom - r.tile.top);
        ctx.clip();
      }
      if (r.blend === 1) ctx.globalCompositeOperation = "lighter";
      else if (r.blend === 3) {
        ctx.globalCompositeOperation = "lighter";
        ctx.globalAlpha = 0.25 * shown.bright;
      }
      if (r.tile) {
        let yy = shown.y;
        const { top, bottom, step } = r.tile;
        if (yy > bottom) yy = bottom + ((yy - bottom) % step);
        for (; yy >= top - step; yy -= step)
          noteBox(t, drawFrame(ctx, cam, tile, frame, r, shown, ae, shown.x, yy), cam, layout);
      } else
        noteBox(t, drawFrame(ctx, cam, tile, frame, r, shown, ae, shown.x, shown.y), cam, layout);
      ctx.restore();
    }
  }
  for (; m < masks.length; m++) paintMask(f, masks[m], dim);
}

// a camera's window and coordinates for a world point
function cameraAt(layout, x, y) {
  const cam = {
    wx: Math.floor(x / layout.worldW) * layout.worldW + layout.winX,
    wy: Math.floor(y / layout.worldH) * layout.worldH + layout.winY,
  };
  cam.dx = drawX(cam.wx, layout);
  cam.dy = drawY(cam.wy, layout);
  return cam;
}

// the LCD font as the painter draws it: per palette, a sheet per colour channel
// of the glyphs cut alone, every texel that channel of its palette colour, built
// once off the index map when its sheet arrives. A glyph drawn from the three
// additively, each at the factor the engine rolled for that channel, is the
// texel modulated channel by channel, the way a scratch canvas rewritten a glyph
// at a time would be, without the upload every rewrite costs; cut alone, a
// smoothed draw repeats a glyph's own edge rather than the glyph packed beside it
const fontMaps = new WeakMap();
const TILE_SHEET_W = 256;
function fontMap(set) {
  const map = fontMaps.get(set);
  if (map) return map;
  const f = set.font;
  if (!f) return null;
  const im = img(set.sheets[f.sheet]);
  if (!im.complete || !im.naturalWidth) return null;
  const oc = document.createElement("canvas");
  oc.width = f.w;
  oc.height = f.h;
  const octx = oc.getContext("2d");
  if (!octx) return null;
  octx.drawImage(im, 0, 0);
  const idx = octx.getImageData(0, 0, f.w, f.h).data;
  // one tile per distinct glyph rectangle, shelf-packed a texel apart
  const tiles = new Map();
  const rects = [];
  let x = 1,
    y = 1,
    shelf = 0;
  for (const [gx, gy, w, h] of f.glyphs) {
    const key = `${gx},${gy},${w},${h}`;
    let tile = w && h ? tiles.get(key) : null;
    if (w && h && !tile) {
      if (x + w + 1 > TILE_SHEET_W) {
        x = 1;
        y += shelf + 1;
        shelf = 0;
      }
      tile = [x, y, w, h, gx, gy];
      tiles.set(key, tile);
      x += w + 1;
      shelf = Math.max(shelf, h);
    }
    rects.push(tile);
  }
  const tall = y + shelf + 1;
  const sheets = new Map();
  const made = {
    rects,
    sheetsFor(palette) {
      let three = sheets.get(palette);
      if (three) return three;
      three = [0, 5, 10].map((shift) => {
        const c = document.createElement("canvas");
        c.width = TILE_SHEET_W;
        c.height = tall;
        const cctx = c.getContext("2d");
        const id = cctx.createImageData(TILE_SHEET_W, tall);
        for (const [tx, ty, w, h, gx, gy] of tiles.values())
          for (let yy = 0; yy < h; yy++)
            for (let xx = 0; xx < w; xx++) {
              const k = idx[((gy + yy) * f.w + gx + xx) * 4];
              if (!k) continue;
              const o = ((ty + yy) * TILE_SHEET_W + tx + xx) * 4;
              id.data[o + shift / 5] = ((palette[k] >> shift) & 31) << 3;
              id.data[o + 3] = 255;
            }
        cctx.putImageData(id, 0, 0);
        return c;
      });
      sheets.set(palette, three);
      return three;
    },
  };
  fontMaps.set(set, made);
  return made;
}

// a run of glyphs: a screen's clipped to its panel as the game clips it, a
// board's rows unclipped; one whose box lies outside the view is skipped, every
// board on the path being asked every frame
function paintText(ctx, layout, cam, set, e, view) {
  const map = fontMap(set);
  if (!map) return;
  const [bx1, by1, bx2, by2] = e.box;
  const left = cam.dx + (bx1 - cam.wx),
    right = cam.dx + (bx2 - cam.wx),
    top = cam.dy + (by1 - cam.wy),
    bottom = cam.dy + (by2 - cam.wy);
  if (
    view &&
    (left > view.x + view.w || right < view.x || top > view.y + view.h || bottom < view.y)
  )
    return;
  if (e.clip) {
    ctx.beginPath();
    ctx.rect(cam.dx + (e.clip[0] - cam.wx), cam.dy, e.clip[1] - e.clip[0] + 1, layout.visH);
    ctx.clip();
  }
  const sheets = map.sheetsFor(e.palette);
  const py = cam.dy + (e.y - cam.wy);
  for (const { g, x, dy, rgb } of e.run) {
    const tile = map.rects[g];
    if (!tile) continue;
    const [tx, ty, w, h] = tile;
    const dx = cam.dx + (x - cam.wx);
    for (let c = 0; c < 3; c++) {
      // lighter adds the source at its alpha, so a factor past one is a second pass
      for (let a = rgb[c] / 128; a > 0; a -= 1) {
        ctx.globalAlpha = Math.min(1, a);
        ctx.drawImage(sheets[c], tx, ty, w, h, dx, py + dy, w, h);
      }
    }
  }
}

// an effect a brain gave off, drawn additively unless it says otherwise, any
// lines as the engine's gouraud lines, and clipped to the camera it names or
// else the one its point falls in
function paintEffect(ctx, layout, set, e, ae, view) {
  const cam = e.cam
    ? cameraAt(layout, e.cam.x, e.cam.y)
    : cameraAt(layout, Math.trunc(e.x), Math.trunc(e.y));
  ctx.save();
  ctx.beginPath();
  ctx.rect(cam.dx, cam.dy, layout.visW, layout.visH);
  ctx.clip();
  ctx.globalCompositeOperation = e.kind === "sprite" && e.blend === 0 ? "source-over" : "lighter";
  if (e.kind === "sprite") {
    const frame = e.anim.frames[e.frame];
    const tile = processedFrame(set.sheets[frame[0]], frame, e.semi ?? true, e.rgb);
    if (tile) {
      const r = { scale: e.scale, flipY: false, swap: false, copy: !!e.copy };
      drawFrame(ctx, cam, tile, frame, r, { flip: false }, ae, e.x, e.y);
    }
  } else if (e.kind === "text") paintText(ctx, layout, cam, set, e, view);
  else {
    const px = cam.dx + (e.x - cam.wx),
      py = cam.dy + (e.y - cam.wy);
    const segs =
      e.kind === "lines"
        ? e.segs
        : e.burst
          ? Z_BURST
          : [
              [-4, -4, 4, -4],
              [4, -4, -4, 4],
              [-4, 4, 4, 4],
            ];
    const rgb = e.kind === "lines" ? [31, 31, 127] : e.rgb;
    ctx.lineWidth = 1;
    for (const [x0, y0, x1, y1] of segs) {
      const ax = px + x0 * e.scale,
        ay = py + y0 * e.scale,
        bx = px + x1 * e.scale,
        by = py + y1 * e.scale;
      const g = ctx.createLinearGradient(ax, ay, bx, by);
      g.addColorStop(0, `rgb(${rgb.map((v) => Math.trunc(v / 2)).join(",")})`);
      g.addColorStop(1, `rgb(${rgb.join(",")})`);
      ctx.strokeStyle = g;
      ctx.beginPath();
      ctx.moveTo(ax, ay);
      ctx.lineTo(bx, by);
      ctx.stroke();
    }
  }
  ctx.restore();
}
// the six rays of a Z's burst, inner end to outer
const Z_BURST = [
  [-3, -4, -6, -7],
  [3, -4, 6, -7],
  [4, -1, 7, -1],
  [-4, 1, -7, 1],
  [-3, 4, -6, 7],
  [3, 4, 6, 7],
];

// one frame at a world anchor, placed as Animation::vRender places it: the
// frame's own offset scaled, a half-scale frame's y offset a unit less and
// Exoddus's a pixel larger, every rounding a truncation of v + 0.499; a copy
// of another's frame is placed as AnimationUnknown places it, its offset and
// size scaled and truncated toward zero
function drawFrame(ctx, cam, tile, frame, r, shown, ae, wx, wy) {
  const [, , , w, h, xoff, yoff] = frame;
  const s = r.scale;
  const xpos = cam.dx + (Math.trunc(wx) - cam.wx),
    ypos = cam.dy + (Math.trunc(wy) - cam.wy);
  let x0, y0, dw, dh;
  if (r.copy) {
    dw = Math.trunc(w * s);
    dh = Math.trunc(h * s);
    const ox = Math.trunc(xoff * s),
      oy = Math.trunc(yoff * s);
    x0 = shown.flip ? xpos - ox - dw : xpos + ox;
    y0 = r.flipY ? ypos - oy - dh : ypos + oy;
  } else {
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
    dw = Math.floor(fw - 0.501) + 1;
    dh = Math.floor(fh - 0.501) + 1;
    x0 = shown.flip ? xpos - t(ox) - t(fw) : xpos + t(ox);
    y0 = r.flipY ? ypos - t(oy) - t(fh) : ypos + t(oy);
  }
  ctx.save();
  ctx.translate(x0, y0);
  if (shown.flip) {
    ctx.translate(dw, 0);
    ctx.scale(-1, 1);
  }
  if (r.flipY) {
    ctx.translate(0, dh);
    ctx.scale(1, -1);
  }
  if (r.swap) {
    // the texture's axes swapped: the frame stands on its side
    ctx.transform(0, 1, 1, 0, 0, 0);
    ctx.drawImage(tile, 0, 0, dh, dw);
  } else ctx.drawImage(tile, 0, 0, dw, dh);
  ctx.restore();
  return { x: x0, y: y0, w: dw, h: dh };
}

// one layer of a camera's foreground as the game draws it, untinted
function paintMask({ ctx, path, layout }, [, src, c], dim) {
  const im = dim ? dimmedImg(src) : img(src);
  if (!im || (im instanceof Image && !(im.complete && im.naturalWidth))) return;
  const cx = (c.cell % path.w) * layout.cellW,
    cy = Math.floor(c.cell / path.w) * layout.cellH;
  ctx.drawImage(im, cx, cy, layout.visW, layout.visH);
}

// whether a world point lies inside one of the path's screens
function inScreens(path, layout, x, y) {
  const cx = Math.floor(x / layout.worldW),
    cy = Math.floor(y / layout.worldH);
  if (!path.cams.some((c) => c.cell === cy * path.w + cx && c.png)) return false;
  const lx = x - cx * layout.worldW,
    ly = y - cy * layout.worldH;
  return (
    lx >= layout.winX &&
    lx < layout.winX + layout.visW &&
    ly >= layout.winY &&
    ly < layout.winY + layout.visH
  );
}

// the marker's box carried to wherever its creature has walked, or null while
// it stands outside every screen
export function standingBox(t, layout) {
  const box = drawBox(t, layout);
  const walked = movedBy.get(t);
  if (walked === null) return null;
  if (walked) {
    box.x += drawX(t.x1 + walked[0], layout) - drawX(t.x1, layout);
    box.y += drawY(t.y1 + walked[1], layout) - drawY(t.y1, layout);
  }
  return box;
}

// where an object can be pointed at: its marker's box, carried by any walk,
// and the rectangle its sprite was last drawn in, each saying whether it is
// what the eye sees there
export function hitBoxes(t, layout) {
  const boxes = [];
  const b = standingBox(t, layout);
  if (b) boxes.push({ ...b, drawn: drawnAs(t, paintedSprites) === "marker" });
  const s = spriteBoxes.get(t);
  if (s) boxes.push({ ...s, drawn: true });
  return boxes;
}
