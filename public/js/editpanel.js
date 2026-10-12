// Edit mode and the property form. With the mode on, a click on a marker
// selects it instead of following it, and this panel lists every field the
// archive holds for the selection as a control writing a delta through the edit
// model; the map follows through data-changed like every other surface.

import { $, cv, narrowMQ, typingIn } from "./dom.js";
import { esc } from "./util.js";
import { GEO, state } from "./state.js";
import { tlvCell } from "./model.js";
import { LIVE_WHEN, fieldHelp, fieldType, valueMap } from "./fields.js";
import { fieldUnit } from "./glossary.js";
import { getSettings } from "./settings.js";
import { GAME_IDS, loadEditorData } from "./data.js";
import {
  applyFieldEdit,
  applyRectEdit,
  canRedo,
  canUndo,
  editNotes,
  editedFields,
  editedRect,
  forgetAll,
  gameEdits,
  hasLevelShort,
  pathEdited,
  pristineOf,
  redoEdit,
  revertPath,
  setLevelShort,
  undoEdit,
} from "./edits.js";
import { toast } from "./toast.js";
import { scheduleDraw } from "./render.js";

const btn = $("editBtn"),
  panel = $("editPanel"),
  title = $("editTitle"),
  body = $("editBody");

let armedFor = null; // the game whose level map the mode holds
let arming = false;
let opener = null; // where focus returns when a panel holding it closes
let selectedAt = null; // the place the selection is on

const here = () => state.path && `${state.data.id}/${state.lvl.short}/${state.path.id}`;

// a destination re-derives through the level map, so the mode holds one for
// the game in hand before an edit can be made
async function arm(gameId) {
  if (!hasLevelShort(gameId)) {
    const side = await loadEditorData(gameId);
    if (!side) return false;
    setLevelShort(gameId, side.level_short);
  }
  armedFor = gameId;
  return true;
}

// the setting arms the mode and never the data: stored edits apply and are
// marked whatever it says
const allowed = () => getSettings().editObjects;

export async function setEditMode(on) {
  if (on === state.edit || arming) return;
  if (on) {
    // an embed is someone else's page, and the graph covers the map
    if (document.body.classList.contains("embed") || state.graph || !state.data || !allowed())
      return;
    arming = true;
    const ok = await arm(state.data.id);
    arming = false;
    if (!allowed()) return;
    if (!ok) {
      toast("editing needs the editor data, which did not load");
      return;
    }
  }
  state.edit = on;
  document.body.classList.toggle("editing", on);
  btn.setAttribute("aria-pressed", String(on));
  cv.style.cursor = on ? "crosshair" : "";
  if (!on) selectObject(null);
  // the surfaces the mode shares the map with answer this, and none is imported
  window.dispatchEvent(new CustomEvent("edit-changed"));
}

function close() {
  // read before the hide: hiding a subtree holding the focus drops it to <body>
  const held = panel.contains(document.activeElement);
  panel.hidden = true;
  state.sel = null;
  selectedAt = null;
  scheduleDraw();
  if (held && opener?.isConnected && opener.offsetParent) opener.focus();
  opener = null;
}

// the object to edit, or null to put the panel away; a keyboard open moves the
// focus onto the panel, which is named by its own title
export function selectObject(t, { focus = false } = {}) {
  if (!t) {
    if (!panel.hidden) close();
    return;
  }
  state.sel = t;
  selectedAt = here();
  render();
  panel.hidden = false;
  window.dispatchEvent(new CustomEvent("float-opened", { detail: { id: "editPanel" } }));
  if (focus) {
    if (!panel.contains(document.activeElement)) opener = document.activeElement;
    panel.focus();
  } else opener = null;
  scheduleDraw();
}

// the trail is the path in hand's, so the keys act with the panel closed too
const here3 = () => [state.data.id, state.lvl.short, state.path.id];
const undoHere = () => state.path && undoEdit(...here3());
const redoHere = () => state.path && redoEdit(...here3());

// a refusal is toasted and the form shows what still stands; a commit that
// goes through re-renders by the swap it causes
function attempt(fn) {
  try {
    fn();
  } catch (e) {
    toast(e.message);
    render();
  }
}
const commit = (field, value) => attempt(() => applyFieldEdit(state.sel, field, value));
const commitRect = (rect) => attempt(() => applyRectEdit(state.sel, rect));

function rectWith(t, key, v) {
  const w = t.x2 - t.x1,
    h = t.y2 - t.y1;
  if (key === "x") return [v, t.y1, v + w, t.y2];
  if (key === "y") return [t.x1, v, t.x2, v + h];
  if (key === "w") return [t.x1, t.y1, t.x1 + v, t.y2];
  return [t.x1, t.y1, t.x2, t.y1 + v];
}

const PLACE_LABELS = { x: "x", y: "y", w: "width", h: "height" };

function placeRow(t, label, words) {
  const row = document.createElement("div");
  row.className = "ep-row";
  const name = document.createElement("span");
  name.className = "ep-name";
  name.textContent = label;
  const val = document.createElement("span");
  val.className = "ep-val ep-place";
  for (const [key, value, min] of words) {
    const el = document.createElement("input");
    el.type = "number";
    el.min = min;
    el.max = 32767;
    el.step = 1;
    el.value = value;
    el.dataset.place = key;
    el.setAttribute("aria-label", PLACE_LABELS[key]);
    el.onchange = () => {
      if (Number.isInteger(el.valueAsNumber)) commitRect(rectWith(t, key, el.valueAsNumber));
      else render();
    };
    val.append(el);
  }
  row.append(name, val);
  body.append(row);
}

function control(t, field, value) {
  const map = valueMap(state.data.id, t.name, field);
  let el;
  if (map) {
    el = document.createElement("select");
    const raw = getSettings().showRawValues;
    for (const [v, label] of Object.entries(map).sort((a, b) => a[0] - b[0])) {
      const o = document.createElement("option");
      o.value = v;
      o.textContent = raw ? `${v} = ${label}` : String(label);
      el.append(o);
    }
    el.value = String(value);
  } else {
    el = document.createElement("input");
    el.type = "number";
    el.min = -32768;
    el.max = 32767;
    el.step = 1;
    el.value = value;
  }
  el.dataset.field = field;
  el.onchange = () => commit(field, map ? +el.value : el.valueAsNumber);
  return el;
}

function linkButton(label, title, onclick) {
  const b = document.createElement("button");
  b.type = "button";
  b.className = "linkbtn";
  b.textContent = label;
  if (title) b.title = title;
  b.onclick = onclick;
  return b;
}
// the ↺ beside a shipped value, named by its title since the glyph says nothing
function putBack(title, onclick) {
  const b = linkButton("↺", title, onclick);
  b.classList.add("ep-back");
  b.setAttribute("aria-label", title);
  return b;
}

function head(label) {
  const h = document.createElement("div");
  h.className = "listhead ep-head";
  h.textContent = label;
  body.append(h);
}

function render() {
  const t = state.sel;
  if (!t) return;
  // the control being worked keeps the keyboard
  const held = document.activeElement?.dataset ?? {};
  const focused = held.field
    ? `[data-field="${CSS.escape(held.field)}"]`
    : held.place
      ? `[data-place="${held.place}"]`
      : null;
  const game = state.data.id;
  const cam = state.path.cams.find((c) => c.cell === tlvCell(t, state.path, GEO));
  const where = `${state.lvl.short} P${state.path.id}${cam ? " · " + cam.name.slice(-3) : ""}`;
  title.innerHTML = `<button type="button" class="linkbtn ep-type">${esc(t.name)}</button> <span class="e">${esc(where)}</span>`;
  title.querySelector(".ep-type").onclick = () =>
    window.dispatchEvent(new CustomEvent("typecard-open", { detail: { type: t.name } }));
  body.innerHTML = "";

  // what the navigation now believes about the object
  const extra = Object.entries(t.extra || {});
  if (extra.length) {
    head("Derived");
    const d = document.createElement("div");
    d.className = "ep-derived e";
    d.textContent = extra.map(([k, v]) => `${k}=${v}`).join("  ");
    body.append(d);
  }

  // where it stands and how big it is, in world units
  head("Place");
  placeRow(t, "position", [
    ["x", t.x1, -32768],
    ["y", t.y1, -32768],
  ]);
  placeRow(t, "size", [
    ["w", t.x2 - t.x1, 0],
    ["h", t.y2 - t.y1, 0],
  ]);
  const was = editedRect(t);
  if (was) {
    const shipped = document.createElement("div");
    shipped.className = "ep-shipped e";
    shipped.textContent = `shipped: ${was[0]},${was[1]} ${was[2] - was[0]}×${was[3] - was[1]}`;
    shipped.append(
      " ",
      putBack("Put it back where it shipped", () => commitRect(was)),
    );
    body.append(shipped);
  }

  const pristine = pristineOf(t);
  const delta = editedFields(t);
  if (!t.fields) {
    const none = document.createElement("div");
    none.className = "ep-none e";
    none.textContent = "This type carries no fields to edit.";
    body.append(none);
    foot();
    return;
  }

  head("Fields");
  for (const k of Object.keys(t.fields).sort((a, b) => a.localeCompare(b))) {
    const row = document.createElement("div");
    row.className = "ep-row";
    const name = document.createElement("span");
    name.className = "ep-name";
    name.textContent = k;
    const tips = [fieldHelp(game, t.name, k)].filter(Boolean);
    const live = LIVE_WHEN[`${t.name}.${k}`];
    if (live && !live(t)) {
      row.classList.add("ep-dead");
      tips.push("The engine does not read it on this placement.");
    }
    if (tips.length) {
      name.classList.add("gloss");
      name.dataset.tip = tips.join("\n");
    }
    const val = document.createElement("span");
    val.className = "ep-val";
    val.append(control(t, k, t.fields[k]));
    const unit = !valueMap(game, t.name, k) && fieldUnit(t.name, k, fieldType(game, t.name, k));
    if (unit) {
      const u = document.createElement("span");
      u.className = "e";
      u.textContent = unit;
      val.append(" ", u);
    }
    row.append(name, val);
    if (k in delta) {
      const was = document.createElement("span");
      was.className = "ep-shipped e";
      was.textContent = `shipped: ${pristine.fields[k]}`;
      was.append(
        " ",
        putBack(`Put ${k} back as shipped`, () => commit(k, pristine.fields[k])),
      );
      row.append(was);
    }
    body.append(row);
  }
  foot();
  if (focused) body.querySelector(focused)?.focus();
}

// the keys the selection answers to, said once for every reader
const KEYS_NOTE = "drag to move · ⇧ arrows nudge";

// what the path carries, by kind, and the steps through it
function foot() {
  const keys = document.createElement("div");
  keys.className = "ep-keys e";
  keys.textContent = KEYS_NOTE;
  body.append(keys);
  let fields = 0,
    moved = 0,
    resized = 0;
  for (const o of state.path.tlvs) {
    fields += Object.keys(editedFields(o)).length;
    const notes = editNotes(o);
    if (notes.includes("moved")) moved++;
    if (notes.includes("resized")) resized++;
  }
  const parts = [];
  if (fields) parts.push(`${fields} field${fields === 1 ? "" : "s"}`);
  if (moved) parts.push(`${moved} moved`);
  if (resized) parts.push(`${resized} resized`);
  const foot = document.createElement("div");
  foot.className = "ep-foot e";
  foot.textContent = parts.length
    ? `${parts.join(", ")} on this path`
    : "nothing edited on this path";
  // the steps stand whether or not the path has edits: a redo follows an undo of everything
  const step = (label, can, act, title) => {
    const b = linkButton(label, title, act);
    b.disabled = !can;
    foot.append(" · ", b);
  };
  step("undo", canUndo(...here3()), undoHere, "Undo the last edit on this path (Ctrl+Z, ⌘Z)");
  step("redo", canRedo(...here3()), redoHere, "Redo (Shift+Ctrl+Z, ⇧⌘Z)");
  if (pathEdited(state.path))
    foot.append(
      " · ",
      linkButton("Revert this path", null, () =>
        revertPath(state.data.id, state.lvl.short, state.path.id),
      ),
    );
  body.append(foot);
}

btn.hidden = !allowed();
btn.onclick = () => setEditMode(!state.edit);
window.addEventListener("settings-changed", (e) => {
  if (e.detail.key !== "editObjects") return;
  btn.hidden = !allowed();
  if (!allowed()) setEditMode(false);
});
$("editClose").onclick = () => selectObject(null);

window.addEventListener("data-changed", () => {
  if (panel.hidden) return;
  if (state.sel) render();
  else selectObject(null);
});

// the selection belongs to its path, and the mode's level map to its game
window.addEventListener("selection-changed", () => {
  if (!panel.hidden && here() !== selectedAt) selectObject(null);
  if (state.edit && state.data && state.data.id !== armedFor)
    arm(state.data.id).then((ok) => {
      if (ok) return;
      toast("editing needs the editor data, which did not load");
      setEditMode(false);
    });
});

window.addEventListener("graph-changed", () => {
  if (state.graph) setEditMode(false);
});

// the numbers panel shares this corner at every width; a bottom sheet shares
// the whole bottom on narrow
window.addEventListener("float-opened", (e) => {
  if (panel.hidden) return;
  if (e.detail.id === "numbersPanel" || (narrowMQ.matches && e.detail.id !== "editPanel"))
    selectObject(null);
});

// a form field keeps its own keys: Escape there is the field's, and the undo
// chord is the browser's own undo of the typing
window.addEventListener("keydown", (e) => {
  const inField = typingIn(e.target);
  if (e.key === "Escape" && !panel.hidden && !inField) selectObject(null);
  if (!state.edit || !state.path || inField || e.altKey || !(e.ctrlKey || e.metaKey)) return;
  const k = e.key.toLowerCase();
  if (k !== "z" && k !== "y") return;
  e.preventDefault();
  if (k === "y" || e.shiftKey) redoHere();
  else undoHere();
});

// the settings row counting what the device holds, with a two-press way to
// forget all of it; the second press is asked for afresh whenever the dialog opens
const editsHeld = $("editsHeld"),
  editsCount = $("editsCount"),
  editsForget = $("editsForget");
let forgetArmed = false;
function renderEditsRow() {
  let objects = 0,
    paths = 0;
  for (const id of GAME_IDS) {
    const n = gameEdits(id);
    objects += n.objects;
    paths += n.paths;
  }
  editsHeld.hidden = !objects;
  editsCount.textContent = `${objects} object${objects === 1 ? "" : "s"} edited on ${paths} path${paths === 1 ? "" : "s"}`;
  editsForget.textContent = "forget all";
  forgetArmed = false;
}
editsForget.onclick = () => {
  if (!forgetArmed) {
    forgetArmed = true;
    editsForget.textContent = "press again to forget";
    return;
  }
  forgetAll();
  renderEditsRow();
};
window.addEventListener("settings-opened", renderEditsRow);
window.addEventListener("data-changed", renderEditsRow);
