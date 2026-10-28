// Minimap scrubbing: pointer input on the inset moves the main view. The
// painting itself lives in render.js, at the end of each frame.

import { $, cv } from "./dom.js";
import { state } from "./state.js";
import { centerCam } from "./model.js";
import { draw, minimapScale, settleView } from "./render.js";
import { scheduleHash } from "./navigate.js";

const mm = $("minimap");
let scrubbing = false;

function scrubTo(e) {
  const r = mm.getBoundingClientRect();
  // a mid-drag hide leaves a zero rect: no flinging the view off it
  if (mm.hidden || !r.width) return;
  const s = minimapScale(state.path);
  const v = { x: (e.clientX - r.left) / s, y: (e.clientY - r.top) / s, z: state.cam.z };
  settleView();
  Object.assign(state.cam, centerCam(v, cv.clientWidth, cv.clientHeight));
  draw();
  scheduleHash(false);
}

mm.addEventListener("pointerdown", (e) => {
  if (!state.path) return;
  // a page-zoomed pinch must reach the browser, exactly as #cv yields it
  if (document.body.classList.contains("page-zoomed") && e.pointerType === "touch") return;
  scrubbing = true;
  try {
    mm.setPointerCapture(e.pointerId);
  } catch {
    /* pointer already lifted */
  }
  scrubTo(e);
  e.preventDefault();
});
mm.addEventListener("pointermove", (e) => scrubbing && scrubTo(e));
const endScrub = () => (scrubbing = false);
mm.addEventListener("pointerup", endScrub);
mm.addEventListener("pointercancel", endScrub);
