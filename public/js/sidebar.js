// Sidebar controls: category filters, display toggles, feedback link.

import { setEditMode } from "./editpanel.js";
import { CATS, PENS, catOf } from "./config.js";
import { $, cv, filterBox } from "./dom.js";
import { state } from "./state.js";
import { setPitch } from "./navigate.js";
import { draw, syncMotion } from "./render.js";
import { getViewSnapshot, viewChanged } from "./settings.js";
import { toast } from "./toast.js";

// persisted view options (when "remember" is on) override the HTML/config defaults
const snap = getViewSnapshot();

// filters
const catDefaults = new Map(CATS.map((c) => [c.key, c.on])); // config defaults, captured before the snapshot merge
const catUI = new Map(); // category -> its checkbox and count elements
CATS.forEach((c) => {
  if (snap && c.key in snap.cats) c.on = snap.cats[c.key];
  const lab = document.createElement("label");
  lab.className = "checkrow";
  if (c.tip) lab.dataset.tip = c.tip;
  lab.innerHTML = `<span class="sw" style="background:${c.color}"></span>
    <input type="checkbox" autocomplete="off" ${c.on ? "checked" : ""}>
    <span>${c.label}</span><span class="cnt"></span>`;
  const cb = lab.querySelector("input");
  cb.onchange = () => {
    c.on = cb.checked;
    viewChanged();
    draw();
  };
  catUI.set(c, { cb, cnt: lab.querySelector(".cnt") });
  filterBox.appendChild(lab);
});
function setFilters(onFor) {
  CATS.forEach((c) => {
    c.on = onFor(c);
    catUI.get(c).cb.checked = c.on;
  });
  viewChanged();
  draw();
}
$("fAll").onclick = () => setFilters(() => true);
$("fNone").onclick = () => setFilters(() => false);
$("fReset").onclick = () => setFilters((c) => catDefaults.get(c.key));

// display toggles: state.show mirrors the sidebar checkboxes (initial state comes from the HTML)
const showUI = new Map(); // show key -> its checkbox
function syncShow(key, cb) {
  state.show[key] = cb.checked;
  if (key === "pens") PENS.on = cb.checked; // the barrier gate lives in config
  if (key === "spaced") setPitch(cb.checked); // moves every draw coordinate; it redraws itself
  if (key === "objects") {
    syncMotion(); // the clock runs only while the sprites are shown
    syncNeeds();
  }
  if (key === "patrols") syncMotion(); // the patrols count from the turn
  if (key !== "ruler" && key !== "route") return;
  if (cb.checked) {
    setEditMode(false); // one tool owns the click at a time
    const other = key === "ruler" ? "route" : "ruler"; // one measuring tool armed at a time
    const ocb = showUI.get(other);
    if (ocb.checked) {
      ocb.checked = false;
      syncShow(other, ocb);
    }
  }
  if (key === "ruler" && !state.show.ruler) state.ruler = null; // measurements don't outlive the mode
  cv.style.cursor = state.edit || state.show.ruler || state.show.route ? "crosshair" : "";
  if (key === "route") window.dispatchEvent(new CustomEvent("route-changed"));
}
// one tool owns the click at a time, from this side too
window.addEventListener("edit-changed", () => {
  if (!state.edit) return;
  for (const k of ["ruler", "route"]) if (showUI.get(k).checked) toggleShow(k);
});
for (const [key, id] of Object.entries({
  spaced: "tSpaced",
  grid: "tGrid",
  labels: "tLabels",
  conn: "tConn",
  wires: "tWires",
  pens: "tPens",
  coll: "tColl",
  fg: "tFg",
  dim: "tDim",
  objects: "tObjects",
  patrols: "tPatrols",
  ruler: "tRuler",
  route: "tRoute",
})) {
  const cb = $(id);
  if (snap && key in snap.show) cb.checked = snap.show[key];
  state.show[key] = cb.checked;
  cb.onchange = () => {
    syncShow(key, cb);
    viewChanged();
    draw();
  };
  showUI.set(key, cb);
}
PENS.on = state.show.pens; // ahead of the first draw
syncMotion();
// a toggle's wording, without the key badge or the default mark beside it
function nameOf(label) {
  const copy = label.cloneNode(true);
  for (const el of copy.querySelectorAll("kbd, .st-def")) el.remove();
  return copy.textContent.replace(/\s+/g, " ").trim();
}
// a toggle that needs another on is greyed while it is off, its row saying so
export function syncNeeds() {
  for (const box of document.querySelectorAll(
    "#toggles input[data-needs], #toggles label[data-needs] input",
  )) {
    const label = box.closest("label");
    const unmet = label.dataset.needs
      .split(" ")
      .map($)
      .find((need) => !need.checked);
    const where = unmet?.closest("#settings") ? " in Settings" : "";
    const why = unmet
      ? `“${nameOf(label)}” needs “${nameOf(unmet.closest("label"))}” on${where}.`
      : "";
    box.disabled = !!why;
    label.title = why;
  }
}
for (const label of document.querySelectorAll("#toggles label[data-needs]"))
  label.addEventListener("click", () => {
    if (label.querySelector("input").disabled) toast(label.title);
  });
syncNeeds();
window.addEventListener("settings-changed", (e) => {
  if (e.detail?.key === "animate") syncNeeds();
});
// the g/c/f shortcuts flip the same checkboxes the pointer does
export function toggleShow(key) {
  const cb = showUI.get(key);
  if (cb.disabled) {
    toast(cb.closest("label").title);
    return;
  }
  cb.checked = !cb.checked;
  syncShow(key, cb);
  viewChanged();
  draw();
}

// the key badge on a toggle's row lights while its shortcut is held
export function markKeyHeld(key, held) {
  showUI.get(key)?.closest("label").querySelector("kbd")?.classList.toggle("held", held);
}

$("tReset").onclick = () => {
  for (const [key, cb] of showUI) {
    cb.checked = cb.defaultChecked; // the HTML checked attribute is the source of the defaults
    syncShow(key, cb);
  }
  syncNeeds();
  viewChanged();
  draw();
};

// feedback mail: attach the current permalink so reports carry their location
const fb = $("feedbackLink");
fb.onclick = () => {
  const addr = ["feedback", "oddworldmap.com"].join("@");
  fb.href = `mailto:${addr}?subject=${encodeURIComponent("Oddworld Map feedback")}&body=${encodeURIComponent(`\n\nViewing: ${location.href}`)}`;
};

function updateCounts() {
  const counts = {};
  state.path.tlvs.forEach((t) => {
    const c = catOf(t);
    counts[c.key] = (counts[c.key] || 0) + 1;
  });
  CATS.forEach((c) => (catUI.get(c).cnt.textContent = counts[c.key] || ""));
}
window.addEventListener("selection-changed", updateCounts);
