// Per-camera object list: clicking a screen with nothing to follow under the
// pointer lists everything on it. Hover doesn't exist on touch devices, so
// this panel is also the mobile way to inspect a screen's objects, and `l`
// the keyboard's only way.

import { esc } from "./util.js";
import { fieldEntries, fieldHelp } from "./fields.js";
import { DARK_NOTE, objectMessages } from "./messages.js";
import { CATS, EDITED_NOTE, OFFSCREEN_NOTE, catOf } from "./config.js";
import { $, narrowMQ } from "./dom.js";
import { GEO, LAYOUT, state } from "./state.js";
import { cellAt, nearestCam, offScreen, tlvCell } from "./model.js";
import { setHighlight } from "./render.js";
import { fieldPrefsFor, getSettings } from "./settings.js";
import { jumpToTlv } from "./navigate.js";
import { currentOf, editedFields } from "./edits.js";
import { selectObject } from "./editpanel.js";

const panel = $("camPanel"),
  title = $("camPanelTitle"),
  body = $("camPanelBody");

let listedAt = null; // the place the open panel was built from
const here = () => state.path && `${state.data.id}/${state.lvl.short}/${state.path.id}`;
let lastOpen = null; // args of the current open, so a settings change can rebuild it
let opener = null; // where focus returns when a panel holding it closes

function closeCamPanel() {
  // read before the hide: hiding a subtree holding the focus drops it to <body>
  const held = panel.contains(document.activeElement);
  panel.hidden = true;
  listedAt = null;
  lastOpen = null;
  setHighlight(null);
  // the opener may be gone or hidden by now (its surface re-rendered or closed)
  if (held && opener?.isConnected && opener.offsetParent) opener.focus();
  opener = null;
}

// the panel is named by its own title, so focus landing on it says which screen
// and how much is on it before the rows do
export function focusCamPanel() {
  if (!panel.contains(document.activeElement)) opener = document.activeElement;
  panel.focus();
}

// (x, y) in draw space: list the camera cell under it, all categories —
// the panel is an inventory of the screen, not a view of the filters.
// A focus object redirects the open to its own screen and gets its row
// marked and scrolled into view, so tapping an object reads as inspecting
// it (touch has no hover tooltip)
export function openCamPanel(x, y, focus = null) {
  const { path } = state;
  if (!path) return;
  const camAt = (cell) => (cell != null && path.cams.find((c) => c.cell === cell)) || null;
  const cam = (focus && camAt(tlvCell(focus, path, GEO))) || camAt(cellAt(x, y, path, LAYOUT));
  if (!cam) {
    closeCamPanel();
    return;
  }
  opener = null; // a pointer brought no focus with it
  list(cam, focus);
}

// the keyboard aims with the one point it has, the view's centre
export function openCamPanelNear(x, y) {
  const { path } = state;
  if (!path) return false;
  const cam = nearestCam(x, y, path, LAYOUT);
  if (!cam) return false;
  list(cam, null);
  return true;
}

function list(cam, focus) {
  const { path } = state,
    cell = cam.cell;
  // the cell an object's top-left corner falls in, never where it is drawn:
  // what a screen holds must not move with the pitch
  const inCell = (t) => tlvCell(t, path, GEO) === cell;
  const byCat = new Map(CATS.map((c) => [c, []]));
  let n = 0;
  for (const t of path.tlvs)
    if (inCell(t)) {
      byCat.get(catOf(t)).push(t);
      n++;
    }

  title.innerHTML = `${esc(cam.name)} <span class="e">· ${n} object${n === 1 ? "" : "s"}</span>`;
  body.innerHTML = "";
  for (const [c, tlvs] of byCat) {
    if (!tlvs.length) continue;
    const head = document.createElement("div");
    head.className = "listhead cp-cat";
    head.innerHTML = `<span class="sw" style="background:${c.color}"></span>${c.label}`;
    body.appendChild(head);
    for (const t of tlvs) {
      const b = document.createElement("button");
      b.className = "rowbtn cp-row";
      if (t === focus) b.classList.add("active");
      const ex = fieldEntries(t, fieldPrefsFor(state.data.id))
        .map(([k, v]) => {
          const help = fieldHelp(state.data.id, t.name, k);
          const kv = esc(`${k}=${v}`);
          return help
            ? `<span class="e gloss" data-tip="${esc(help)}">${kv}</span>`
            : `<span class="e">${kv}</span>`;
        })
        .join(" ");
      const off = offScreen(t, LAYOUT)
        ? ` <span class="e">· <span class="gloss" data-tip="${esc(OFFSCREEN_NOTE)}">offscreen</span></span>`
        : "";
      const changed = Object.keys(editedFields(t)).sort();
      const edited = changed.length
        ? ` <span class="e">· <span class="edited">${esc(`${EDITED_NOTE}: ${changed.join(", ")}`)}</span></span>`
        : "";
      b.innerHTML = esc(t.name) + off + edited + (ex ? " " + ex : "");
      b.onclick = (e) => {
        jumpToTlv(state.data, state.lvl, state.path, t);
        if (state.edit) selectObject(t, { focus: e.detail === 0 }); // Enter counts no presses
      };
      b.onmouseenter = () => setHighlight(t);
      b.onmouseleave = () => setHighlight(null);
      const wrap = document.createElement("div");
      wrap.className = "cp-row-wrap";
      wrap.append(b);
      // with the field picker on, a ⚙ jumps to this type's row in it
      if (t.fields && getSettings().fieldPrefs.mode === "more") {
        const gear = document.createElement("button");
        gear.className = "rowtool";
        gear.type = "button";
        gear.textContent = "⚙";
        gear.title = `Configure ${t.name} fields`;
        gear.setAttribute("aria-label", gear.title);
        gear.onclick = () =>
          window.dispatchEvent(new CustomEvent("reveal-field-type", { detail: { type: t.name } }));
        wrap.append(gear);
      }
      const info = document.createElement("button");
      info.className = "rowtool";
      info.type = "button";
      info.textContent = "ⓘ";
      info.title = `About ${t.name}`;
      info.setAttribute("aria-label", info.title);
      info.onclick = () =>
        window.dispatchEvent(new CustomEvent("typecard-open", { detail: { type: t.name } }));
      wrap.append(info);
      body.appendChild(wrap);
      // the whole rotation, outside the row so a board with a pool doesn't
      // grow the jump-to target
      const says = objectMessages(state.data.id, t);
      if (says) {
        const said = document.createElement("div");
        said.className = "cp-said";
        said.innerHTML = says.length
          ? says
              .map(
                ({ text, note }) =>
                  `<div class="said">${note ? `<span class="note">${esc(note)}</span> ` : ""}${esc(`“${text}”`)}</div>`,
              )
              .join("")
          : `<div class="e">${esc(DARK_NOTE)}</div>`;
        body.appendChild(said);
      }
    }
  }
  if (!n) body.innerHTML = `<div class="cp-none">no objects on this screen</div>`;
  listedAt = here();
  lastOpen = { cam, focus };
  panel.hidden = false;
  window.dispatchEvent(new CustomEvent("float-opened", { detail: { id: "camPanel" } }));
  body.querySelector(".active")?.scrollIntoView({ block: "nearest" }); // after unhide: needs layout
}

// narrow screens hold one floating panel at a time — two bottom sheets stack
window.addEventListener("float-opened", (e) => {
  if (narrowMQ.matches && e.detail.id !== "camPanel" && !panel.hidden) closeCamPanel();
});

// the world graph stands over the map this describes, and it is unusable and
// out of date by the time the mode closes
window.addEventListener("graph-changed", () => {
  if (state.graph) closeCamPanel();
});

$("camPanelClose").onclick = closeCamPanel;
// close when the listed path is gone; same-path re-selections (every pushed
// hash write re-applies the hash) keep the panel, so a row jump doesn't
// yank the list away mid-browse
window.addEventListener("selection-changed", () => {
  if (!panel.hidden && here() !== listedAt) closeCamPanel();
});

// an edit stands the listed path as new objects: the same screen, listed again
window.addEventListener("data-changed", (e) => {
  if (panel.hidden || !lastOpen || listedAt !== `${e.detail.game}/${e.detail.lv}/${e.detail.pa}`)
    return;
  const top = body.scrollTop;
  list(lastOpen.cam, lastOpen.focus && currentOf(lastOpen.focus));
  body.scrollTop = top;
});

// field-display settings change how the listed objects render — raw vs
// prettified values, the ⚙ affordance (mode), and which fields show (per-type
// picks); rebuild the open panel so it doesn't sit stale
window.addEventListener("settings-changed", (e) => {
  const key = e.detail?.key;
  if (
    (key === "rawValues" || key === "fieldPrefs" || key === "fieldPicks") &&
    !panel.hidden &&
    lastOpen
  )
    list(lastOpen.cam, lastOpen.focus);
});

window.addEventListener("keydown", (e) => {
  if (e.key === "Escape" && !panel.hidden && !e.target.matches?.("input, textarea, select"))
    closeCamPanel();
});
