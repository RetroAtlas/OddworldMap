// The map's spoken half: a status region saying where the selection has landed,
// and the same sentence in the canvas's own name, so a screen reader meets a
// named picture rather than an anonymous graphic.

import { $, cv } from "./dom.js";
import { state } from "./state.js";
import { placeSummary } from "./placesummary.js";

const region = $("a11yStatus");

const SETTLE_MS = 250; // how long the region waits for a run of steps to stop

let announced = null,
  timer = null;

window.addEventListener("selection-changed", () => {
  const { data, lvl, path } = state;
  const at = path && `${data.id}/${data.release?.code ?? ""}/${lvl.short}/${path.id}`;
  if (!path || at === announced) return;
  announced = at;
  const summary = placeSummary(data, lvl, path);
  // a name is not a live region, so this speaks nothing of its own
  cv.setAttribute("aria-label", `Oddworld map: ${summary}`);
  clearTimeout(timer);
  timer = setTimeout(() => (region.textContent = summary), SETTLE_MS);
});

// an edit stands the path as new objects: the name follows, the region stays
// silent, the change having been announced where it was made
window.addEventListener("data-changed", () => {
  const { data, lvl, path } = state;
  if (path) cv.setAttribute("aria-label", `Oddworld map: ${placeSummary(data, lvl, path)}`);
});
