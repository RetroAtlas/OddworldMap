// Export: the visible area or the whole path as PNG, the path's objects and
// collision lines as the level editor's JSON, and the world graph as a
// standalone SVG or a PNG rasterized from it.

import { EXPORT_MAX_DIM, EXPORT_MAX_PX } from "./config.js";
import { loadEditorData } from "./data.js";
import { $, cv } from "./dom.js";
import { graphName, graphSvg } from "./graphsvg.js";
import { pathImage } from "./model.js";
import { exportPath } from "./reliveexport.js";
import { pathEdited } from "./edits.js";
import { artworkReady, paint, preloadPath } from "./render.js";
import { LAYOUT, cellOrigin, state } from "./state.js";
import { toast } from "./toast.js";

// a permission prompt can defer the blob's read indefinitely, so the URL lives
// until the next export replaces it
let exportUrl = null;

function download(blob, name) {
  if (!blob) {
    toast("export failed");
    return;
  }
  if (exportUrl) URL.revokeObjectURL(exportUrl);
  exportUrl = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = exportUrl;
  a.download = name;
  a.click();
}

// an export of an edited path says so in its name, as the graph's does of its demo copies
const edited = (path) => (path && pathEdited(path) ? "-edited" : "");
// a release other than the base names itself after the game
const game = (data) => `${data.id.toLowerCase()}${data.release ? "-" + data.release.code : ""}`;
const exportName = (kind) =>
  `oddworld-${game(state.data)}${state.lvl ? "-" + state.lvl.short : ""}${state.path ? "-P" + state.path.id : ""}-${kind}${edited(state.path)}.png`;

$("exportBtn").onclick = () => {
  const name = exportName("view");
  cv.toBlob((blob) => download(blob, name), "image/png");
};

// A canvas past a browser's limit says nothing about it: drawing into one is
// ignored, or the size asked for is quietly clamped, and a blank canvas encodes
// to a perfectly good multi-megabyte PNG. One pixel painted and read back is
// the answer that holds however the refusal arrives.
function sizedCanvas(w, h) {
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  const g = c.width === w && c.height === h ? c.getContext("2d") : null;
  if (g) {
    g.fillStyle = "#fff";
    g.fillRect(0, 0, 1, 1);
    try {
      if (g.getImageData(0, 0, 1, 1).data[3]) return [c, g];
    } catch {
      /* a readback the browser refuses answers neither way */
    }
  }
  c.width = c.height = 0; // a clamped store was still allocated
  return null;
}

const pathBtn = $("exportPathBtn");
const PATH_LABEL = pathBtn.textContent.trim();

pathBtn.onclick = async () => {
  const path = state.path;
  if (!path) return;
  pathBtn.disabled = true;
  pathBtn.textContent = "Rendering…";
  try {
    await preloadPath(path);
    // two frames: the first commits the label, the second paints it before the
    // render takes the thread. A hidden page paints no frames at all, so a timer
    // releases the wait rather than holding the export until the tab is looked at
    await new Promise((r) => {
      requestAnimationFrame(() => requestAnimationFrame(r));
      setTimeout(r, 100);
    });
    // paint draws the path that is standing, into a canvas sized for the one
    // whose artwork was preloaded: both have to still hold, and nothing may
    // come between these and the paint
    if (state.path !== path) {
      toast("export cancelled");
      return;
    }
    if (!artworkReady(path)) {
      toast("export failed: artwork did not load");
      return;
    }
    // read before the encode: at this size the encode is long enough for the
    // place it names to move under it
    const name = exportName("full");
    let im, canvas;
    for (let px = EXPORT_MAX_PX, dim = EXPORT_MAX_DIM; !canvas && dim >= 1024; px /= 4, dim /= 2) {
      im = pathImage(path, LAYOUT, px, dim);
      canvas = sizedCanvas(im.w, im.h);
    }
    if (!canvas) {
      toast("export failed");
      return;
    }
    const [ecv, ectx] = canvas;
    const [ox, oy] = cellOrigin();
    paint(ectx, { x: ox, y: oy, z: im.scale }, im.w, im.h, 1, false);
    if (im.scale < 1) toast(`too large at full size: scaled to ${Math.round(im.scale * 100)}%`);
    const blob = await new Promise((r) => ecv.toBlob(r, "image/png"));
    ecv.width = ecv.height = 0; // the backing store must not wait on the GC
    download(blob, name);
  } finally {
    pathBtn.disabled = false;
    pathBtn.textContent = PATH_LABEL;
  }
};

const jsonBtn = $("exportJsonBtn");
const JSON_LABEL = jsonBtn.textContent.trim();

jsonBtn.onclick = async () => {
  const { data, lvl, path } = state;
  if (!path) return;
  jsonBtn.disabled = true;
  jsonBtn.textContent = "Preparing…";
  try {
    const side = await loadEditorData(data.id);
    if (!side) {
      toast("export failed: the editor data did not load");
      return;
    }
    const { doc, manifest } = exportPath(data.id, data.geometry, lvl, path, side);
    // relive's importer aborts outright on a missing numeric property, so an
    // incomplete document must never be handed over looking whole
    if (manifest.missing.size) {
      toast(`export failed: no archived value for ${[...manifest.missing][0]}`);
      return;
    }
    download(
      new Blob([JSON.stringify(doc, null, 1)], { type: "application/json" }),
      `oddworld-${game(data)}-${lvl.short}-P${path.id}${edited(path)}.json`,
    );
    toast(
      `saved${edited(path) ? " with your edits" : ""} — importing it drops this path's foreground masks`,
    );
  } catch (e) {
    console.error(e);
    toast("export failed");
  } finally {
    jsonBtn.disabled = false;
    jsonBtn.textContent = JSON_LABEL;
  }
};

$("graphSvgBtn").onclick = () => {
  const { svg, demo, edited } = graphSvg(state.data, { entry: state.entry });
  const blob = new Blob([svg], { type: "image/svg+xml;charset=utf-8" });
  download(blob, graphName(state.data.id, demo, edited, "svg", state.data.release?.code));
};

const gPngBtn = $("graphPngBtn");
const GPNG_LABEL = gPngBtn.textContent.trim();

gPngBtn.onclick = async () => {
  gPngBtn.disabled = true;
  gPngBtn.textContent = "rendering…";
  let canvas, sized;
  try {
    // 2x for the pixel densities the file will be read at, the diagram's own
    // size where a canvas that big is refused
    for (const z of [2, 1]) {
      sized = graphSvg(state.data, { entry: state.entry, scale: z });
      canvas = sizedCanvas(sized.w * z, sized.h * z);
      if (canvas) {
        if (z < 2) toast("too large at double size: saved at actual size");
        break;
      }
    }
    if (!canvas) {
      toast("export failed");
      return;
    }
    const name = graphName(
      state.data.id,
      sized.demo,
      sized.edited,
      "png",
      state.data.release?.code,
    );
    const url = URL.createObjectURL(new Blob([sized.svg], { type: "image/svg+xml;charset=utf-8" }));
    const img = new Image();
    try {
      await new Promise((res, rej) => {
        img.onload = res;
        img.onerror = rej;
        img.src = url;
      });
    } finally {
      // the loaded image holds its own copy; only download() needs a URL kept
      URL.revokeObjectURL(url);
    }
    const [ecv, ectx] = canvas;
    ectx.drawImage(img, 0, 0, ecv.width, ecv.height);
    const blob = await new Promise((r) => ecv.toBlob(r, "image/png"));
    ecv.width = ecv.height = 0; // the backing store must not wait on the GC
    download(blob, name);
  } catch {
    if (canvas) canvas[0].width = canvas[0].height = 0;
    toast("export failed");
  } finally {
    gPngBtn.disabled = false;
    gPngBtn.textContent = GPNG_LABEL;
  }
};
