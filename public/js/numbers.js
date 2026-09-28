// By the numbers: a floating panel counting picked object types at every
// granularity at once — the screen under the view center, the path, the
// level, the game — re-derived as the selection and the view move.

import { $, cv, narrowMQ } from "./dom.js";
import { esc } from "./util.js";
import { LAYOUT, state } from "./state.js";
import { camCenter, cellAt } from "./model.js";
import { census } from "./census.js";
import { toggleMenu } from "./interaction.js";

const panel = $("numbersPanel"),
  body = $("numbersBody"),
  filter = $("numbersFilter"),
  typesBox = $("numbersTypes");

const MAX_PICKED = 6; // rows the table stays readable at
const picked = new Set();

const typesCache = new WeakMap(); // dataset -> its type names, sorted
function typeNames(G) {
  let names = typesCache.get(G);
  if (!names) {
    const set = new Set();
    for (const L of G.levels) for (const P of L.paths) for (const t of P.tlvs) set.add(t.name);
    typesCache.set(G, (names = [...set].sort()));
  }
  return names;
}

// the screen tier follows the view's center, not the pointer
function centerCell() {
  const c = camCenter(state.cam, cv.clientWidth, cv.clientHeight);
  return cellAt(c.x, c.y, state.path, LAYOUT);
}

let lastCell = null;

function renderCounts() {
  lastCell = state.path ? centerCell() : null;
  if (!picked.size) {
    body.innerHTML = `<div class="np-none">pick up to ${MAX_PICKED} object types below, then browse — the numbers follow</div>`;
    return;
  }
  const names = [...picked].sort();
  const { rows, demo } = census(names, state.data, state.lvl, state.path, lastCell);
  const cells = rows
    .map(
      (r) =>
        `<button class="np-name" title="stop counting ${esc(r.name)}" data-name="${esc(r.name)}">${esc(r.name)}</button>` +
        `<span class="np-n">${r.screen ?? "—"}</span>` +
        `<span class="np-n">${r.path}</span>` +
        `<span class="np-n">${r.level}</span>` +
        `<span class="np-n">${r.game}</span>`,
    )
    .join("");
  body.innerHTML =
    `<div class="np-grid"><span></span><span class="np-h">screen</span><span class="np-h">path</span>` +
    `<span class="np-h">level</span><span class="np-h">game</span>${cells}</div>` +
    (demo
      ? `<div class="np-demo">demo paths hold ${demo} more (hidden by the demo setting)</div>`
      : "");
  for (const b of body.querySelectorAll(".np-name"))
    b.onclick = () => {
      picked.delete(b.dataset.name);
      renderAll();
    };
}

function syncLimit() {
  const full = picked.size >= MAX_PICKED;
  for (const box of typesBox.querySelectorAll("input")) box.disabled = full && !box.checked;
}

function renderTypes() {
  const q = filter.value.trim().toLowerCase();
  typesBox.innerHTML = "";
  for (const n of typeNames(state.data)) {
    if (q && !n.toLowerCase().includes(q)) continue;
    const label = document.createElement("label");
    label.className = "checkrow";
    const box = document.createElement("input");
    box.type = "checkbox";
    box.autocomplete = "off";
    box.checked = picked.has(n);
    box.onchange = () => {
      if (box.checked && picked.size >= MAX_PICKED) {
        box.checked = false; // the table is full; unpick something first
        return;
      }
      if (box.checked) picked.add(n);
      else picked.delete(n);
      syncLimit();
      renderCounts();
    };
    label.append(box, ` ${n}`);
    typesBox.appendChild(label);
  }
  syncLimit();
}

function renderAll() {
  renderTypes();
  renderCounts();
}

function openNumbers() {
  if (!state.path) return;
  panel.hidden = false;
  window.dispatchEvent(new CustomEvent("float-opened", { detail: { id: "numbersPanel" } }));
  renderAll();
}

const closeNumbers = () => {
  panel.hidden = true;
};

$("numbersBtn").onclick = () => {
  openNumbers();
  if (narrowMQ.matches) toggleMenu(false); // reveal the panel the way picking a path does
};
$("numbersClose").onclick = closeNumbers;
filter.addEventListener("input", renderTypes);

// the type list is per game, so a game switch rebuilds the picker too
window.addEventListener("selection-changed", () => {
  if (panel.hidden) return;
  if (!state.path) {
    closeNumbers();
    return;
  }
  renderAll();
});

// pan/zoom settle: only the screen column can have moved
window.addEventListener("view-changed", () => {
  if (panel.hidden || !state.path) return;
  if (centerCell() !== lastCell) renderCounts();
});

window.addEventListener("settings-changed", (e) => {
  if (e.detail?.key === "demoPaths" && !panel.hidden) renderCounts();
});

window.addEventListener("data-changed", () => {
  if (!panel.hidden && state.path) renderCounts();
});

// narrow screens hold one floating panel at a time — two bottom sheets stack —
// and the edit panel takes this corner at every width
window.addEventListener("float-opened", (e) => {
  if (e.detail.id === "editPanel" || (narrowMQ.matches && e.detail.id !== "numbersPanel"))
    closeNumbers();
});

// the world graph stands over the map this describes, and it is unusable and
// out of date by the time the mode closes
window.addEventListener("graph-changed", () => {
  if (state.graph) closeNumbers();
});

window.addEventListener("keydown", (e) => {
  if (e.key === "Escape" && !panel.hidden && !e.target.matches?.("input, textarea, select"))
    closeNumbers();
});
