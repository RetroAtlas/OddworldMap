// Where the map is: a chip in the map chrome naming the current level and path,
// and the panel it discloses, which carries what the chip has no room for.

import { DEMO_NOTE, EDITED_NOTE, ENTRY_NOTE } from "./config.js";
import { $, typingIn } from "./dom.js";
import { esc } from "./util.js";
import { state } from "./state.js";
import { pathDisplayName, pathNickname, pathNote } from "./annotations.js";
import { isDemoPath } from "./demo.js";
import { pathEdited, revertPath } from "./edits.js";

const btn = $("placeBtn"),
  panel = $("placePanel"),
  codeEl = $("placeCode"),
  nameEl = $("placeName"),
  editedEl = $("placeEdited");

let shown = null; // the place the open panel describes
const here = () => state.path && `${state.data.id}/${state.lvl.short}/${state.path.id}`;

function fill() {
  const { data, lvl, path } = state;
  const name = pathDisplayName(data.id, lvl.short, path),
    note = pathNote(data.id, lvl.short, path),
    nickname = pathNickname(data.id, lvl.short, path);
  panel.innerHTML =
    `<div class="pl-game">${esc(data.game)}</div>` +
    `<div class="pl-level">${esc(lvl.name)}</div>` +
    (path.section ? `<div class="pl-section">${esc(path.section)}</div>` : "") +
    `<div>Path ${path.id}${name ? ` — ${esc(name)}` : ""}</div>` +
    (nickname ? `<div class="pl-nickname">${esc(nickname)}</div>` : "") +
    (state.entry[lvl.short]?.has(path.id) ? `<div class="pl-entry">${esc(ENTRY_NOTE)}</div>` : "") +
    (isDemoPath(path) ? `<div class="pl-demo">${esc(DEMO_NOTE)}</div>` : "") +
    (pathEdited(path)
      ? `<div class="pl-edited">${esc(EDITED_NOTE)} · <button type="button" class="linkbtn pl-revert">revert this path</button></div>`
      : "") +
    (note ? `<div class="pl-note">${esc(note)}</div>` : "");
  const revert = panel.querySelector(".pl-revert");
  if (revert) revert.onclick = () => revertPath(data.id, lvl.short, path.id);
  shown = here();
}

function setOpen(open) {
  btn.setAttribute("aria-expanded", String(open));
  if (open) {
    panel.hidden = false;
    syncPlace();
    // the prose is what the chip was pressed for, and nothing announces it
    if (panel.offsetParent) panel.focus();
    return;
  }
  const held = panel.contains(document.activeElement);
  panel.hidden = true;
  shown = null;
  if (held) btn.focus();
}

export function togglePlace(open) {
  if (!state.path) return;
  setOpen(open ?? panel.hidden);
}

// a re-selection of the path the panel already describes must not rebuild it:
// the pushed hash rewrite re-fires selection-changed on the same path constantly,
// and a rebuild would throw away the reader's scroll position
function syncPlace() {
  if (!panel.hidden && state.path && here() !== shown) fill();
}

btn.onclick = () => togglePlace();

window.addEventListener("selection-changed", () => {
  const { data, lvl, path } = state;
  if (!path) {
    btn.hidden = true;
    setOpen(false);
    return;
  }
  codeEl.textContent = `${lvl.short} P${path.id}`;
  nameEl.textContent = pathDisplayName(data.id, lvl.short, path) || "";
  btn.classList.toggle("hasnote", !!pathNote(data.id, lvl.short, path));
  editedEl.hidden = !pathEdited(path);
  btn.hidden = false;
  syncPlace();
});

// an edit marks the chip, and can move the entry mark the panel carries
window.addEventListener("data-changed", () => {
  if (!state.path) return;
  editedEl.hidden = !pathEdited(state.path);
  if (!panel.hidden) fill();
});

// the world graph stands over the chip that opens this, and names the place in
// its own boxes
window.addEventListener("graph-changed", () => {
  if (state.graph) togglePlace(false);
});

window.addEventListener("keydown", (e) => {
  if (e.key === "Escape" && !panel.hidden && !typingIn(e.target)) togglePlace(false);
});
