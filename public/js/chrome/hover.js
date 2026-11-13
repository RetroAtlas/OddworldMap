// Hover inspection: the objects and lines under a point of the map, the tooltip that says
// what they are, and the overlays' focus on them.

import { esc, formatDist, segDist } from "../model/util.js";
import { fieldEntries } from "../model/fields.js";
import {
  EDITED_NOTE,
  OFFSCREEN_NOTE,
  PENS,
  LINE_COLORS,
  LINE_NAMES,
  ADDED_NOTE,
  REMOVED_NOTE,
  WIRE_COLOR,
  markerShown,
} from "../config.js";
import { cv, tip, hud } from "../ui/dom.js";
import { state, GEO, LAYOUT, wX, wY, gX, gY } from "../data/state.js";
import { setConnFocus, setHighlight, setPatrol, setWireFocus } from "../painter/render.js";
import { objectShown } from "../painter/spriteart.js";
import { hitBoxes } from "../painter/spritepaint.js";
import {
  computeWiring,
  destOf,
  destTrusted,
  drawBox,
  isLoopback,
  levelWiring,
  lineRuns,
  offScreen,
  pathIn,
  patrolZone,
  resolveTarget,
  wireEnds,
} from "../model/model.js";
import { typeSummary } from "../model/typeinfo.js";
import { DARK_NOTE, objectMessages } from "../model/messages.js";
import { fieldPrefsFor } from "../data/settings.js";
import { editNotes, isAdded, isRemoved, removedObjects } from "../data/edits.js";
import { releaseNote } from "../data/release.js";

let hoverTlvs = [];
export const hovered = () => hoverTlvs;

// an armed tool owns the cursor; hover writes must not overwrite it
export const modeCursor = () =>
  state.edit || state.show.ruler || state.show.route ? "crosshair" : "";

// where an object may be said to lead: destOf's answer, less the links whose
// named partner isn't at the destination to receive them. Deliberately not
// wayThrough, which is this with a hand stone's view excluded as well: that
// guard is the level graph's, and a click is not the level graph — clicking a
// stone follows it to the camera it shows.
const shownDest = (t) => {
  const { data, lvl, path } = state;
  const d = destOf(t, data, lvl, path);
  return d && destTrusted(d, data, lvl) ? d : null;
};

// a destination is followable only when its level AND path are on the map:
// dozens of Exoddus one-way links name a placeholder path their level does not
// hold, and a link naming no partner has nothing for destTrusted to check
export function followableDest(t) {
  const d = shownDest(t);
  return d && pathIn(state.data, d.lv, d.pa) ? d : null;
}

let tipHtml = "",
  tipSpaceW = 0,
  tipSpaceH = 0,
  tipW = 0,
  tipH = 0;

export function updateHover(mouse, panning) {
  if (!state.path) return;
  const pt = { x: state.cam.x + mouse.x / state.cam.z, y: state.cam.y + mouse.y / state.cam.z };
  let hoverLines = [];
  if (state.show.coll) {
    const tol = 6 / state.cam.z;
    // a line is pointed at where it is drawn: the packing bends it at every
    // window edge it crosses, so the straight run between its two ends is
    // ground it may never cover
    hoverLines = state.path.lines
      .filter(([x1, y1, x2, y2]) =>
        lineRuns(x1, y1, x2, y2, LAYOUT).some(
          (r) => segDist(pt.x, pt.y, r.x1, r.y1, r.x2, r.y2) <= tol,
        ),
      )
      .slice(0, 4);
  }
  // each object under the point by the smallest of its boxes the point fell
  // in, ranked what the eye sees first, then the smaller box, then the one
  // placed later (painted on top) among equals
  const under = [];
  state.path.tlvs.forEach((t, i) => {
    if (!objectShown(t)) return;
    let best = null;
    for (const b of hitBoxes(t, LAYOUT)) {
      const w = Math.max(b.w, 10),
        h = Math.max(b.h, 10);
      if (pt.x < b.x - 4 || pt.x > b.x + w + 4 || pt.y < b.y - 4 || pt.y > b.y + h + 4) continue;
      const area = w * h;
      if (!best || (b.drawn && !best.drawn) || (b.drawn === best.drawn && area < best.area))
        best = { drawn: b.drawn, area };
    }
    if (best) under.push({ t, i, ...best });
  });
  // the mode's ghosts after everything standing, at the rects they were removed with
  if (state.edit)
    removedObjects(state.path).forEach((g, i) => {
      if (!markerShown(g)) return;
      const b = drawBox(g, LAYOUT);
      const w = Math.max(b.w, 10),
        h = Math.max(b.h, 10);
      if (pt.x < b.x - 4 || pt.x > b.x + w + 4 || pt.y < b.y - 4 || pt.y > b.y + h + 4) return;
      under.push({ t: g, i: -1 - i, drawn: false, area: Number.MAX_SAFE_INTEGER });
    });
  under.sort((a, b) => b.drawn - a.drawn || a.area - b.area || b.i - a.i);
  hoverTlvs = under.map((u) => u.t);
  // partner preview: hovering a linked object outlines its counterpart when
  // the destination resolves within the current path
  let partner = null;
  for (const t of hoverTlvs) {
    const d = destOf(t, state.data, state.lvl, state.path);
    if (!d || d.lv !== state.lvl.short || d.pa !== state.path.id) continue;
    const tgt = resolveTarget(d, state.path, GEO);
    if (tgt) {
      partner = tgt;
      break;
    }
  }
  setHighlight(partner);
  // a hovered Slig (or its spawner) shades the pen its own bounds pair pens it into
  const pen = (t) => patrolZone(t, state.path, LAYOUT, state.data.id);
  setPatrol(PENS.on ? (hoverTlvs.map(pen).find(Boolean) ?? null) : null);
  // arrows overlay: spotlight the hovered object's own edges
  setConnFocus(state.show.conn ? (hoverTlvs.find((t) => shownDest(t)) ?? null) : null);
  // wiring overlay: the same, for the hovered object's own drawn wires
  const wiring = state.show.wires ? computeWiring(state.path, state.data.id) : null;
  const wireDrawn = (e) => objectShown(e.src) && objectShown(e.dst);
  setWireFocus(
    wiring
      ? (hoverTlvs.find((t) =>
          wiring.edges.some((e) => (e.src === t || e.dst === t) && wireDrawn(e)),
        ) ?? null)
      : null,
  );
  if (hoverTlvs.length || hoverLines.length) {
    tip.style.display = "block";
    const html =
      hoverTlvs
        .slice(0, 8)
        .map((t) => {
          const about = typeSummary(t.name);
          const ex = fieldEntries(t, fieldPrefsFor(state.data.id))
            .map(([k, v]) => `<span>${esc(k)}=<span class="v">${esc(String(v))}</span></span>`)
            .join(" ");
          // what the sign says, capped: a tooltip has no room for a whole
          // rotation. A board that can only ever run dark says so, since
          // silence would read as the map not knowing
          const says = objectMessages(state.data, t, state.path);
          const said = (says ?? []).map(
            ({ text, note }) =>
              `<br><span class="said">${note ? `<span class="note">${esc(note)}</span> ` : ""}${esc(`“${text}”`)}</span>`,
          );
          const messages =
            says?.length === 0
              ? `<br><span class="e">${esc(DARK_NOTE)}</span>`
              : said.slice(0, 3).join("") +
                (said.length > 3 ? `<br><span class="e">+${said.length - 3} more</span>` : "");
          const edited = editNotes(t);
          const released = state.show.release && releaseNote(state.data, t);
          const d = shownDest(t);
          let follow = "";
          if (state.edit) {
            const hint = isRemoved(t)
              ? t === state.sel
                ? "restore it from the panel"
                : "click to select"
              : t === state.sel
                ? "drag to move · ⇧ arrows nudge · Del removes"
                : "click to select";
            follow = `<br><span class="f">${hint}</span>`;
          } else if (d && isLoopback(t, state.data, state.lvl, state.path)) {
            follow = `<br><span class="f loop">⟳ loops back to itself</span>`;
          } else if (d && !followableDest(t)) {
            follow = `<br><span class="f loop">→ leads to ${esc(`${d.lv} P${d.pa}`)} — not on the map</span>`;
          } else if (d) {
            follow = `<br><span class="f">➜ click to follow to ${esc(`${d.lv} P${d.pa}${d.ca != null ? " C" + d.ca : ""}`)}</span>`;
          }
          // wiring lines describe the drawn wires — a local partner in a
          // hidden category is neither drawn nor named, while a cross-path
          // note names a path rather than a marker — and state only what
          // exists: a shown partner, or the other paths of the level holding
          // one when this path holds none at all. Silence is never a claim,
          // since an id can drive things the wire table has no evidence for
          let wireInfo = "";
          if (wiring) {
            const lines = [];
            const remote = levelWiring(state.lvl, state.data.id);
            const others = (paths) =>
              [...(paths ?? [])].filter((pa) => pa !== state.path.id).map((pa) => "P" + pa);
            const ends = wireEnds(t, state.data.id);
            const wired = (m, id) => (m.get(id) ?? []).filter((o) => o !== t);
            for (const id of ends.out) {
              const local = wired(wiring.cons, id);
              const shown = local.filter(objectShown);
              if (shown.length === 1) lines.push(`sets ${id} → ${shown[0].name}`);
              else if (shown.length) lines.push(`sets ${id} → ${shown.length} objects`);
              else if (!local.length) {
                const paths = others(remote.cons.get(id));
                if (paths.length) lines.push(`sets ${id} — answered in ${paths.join(", ")}`);
              }
            }
            for (const id of ends.in) {
              const local = wired(wiring.prod, id);
              const shown = local.filter(objectShown);
              const names = new Set(shown.map((o) => o.name));
              if (shown.length === 1) lines.push(`answers ${id} ← ${shown[0].name}`);
              else if (names.size === 1)
                lines.push(`answers ${id} ← ${shown.length}× ${[...names][0]}`);
              else if (shown.length) lines.push(`answers ${id} ← ${shown.length} producers`);
              else if (!local.length) {
                const paths = others(remote.prod.get(id));
                if (paths.length) lines.push(`answers ${id} — set in ${paths.join(", ")}`);
              }
            }
            wireInfo = lines
              .map((l) => `<br><span class="f" style="color:${WIRE_COLOR}">↯ ${esc(l)}</span>`)
              .join("");
          }
          return (
            `<div><span class="t">${esc(t.name)}</span> <span class="e">(${t.x1},${t.y1})–(${t.x2},${t.y2})</span>` +
            (offScreen(t, LAYOUT)
              ? `<br><span class="e offscreen">${esc(OFFSCREEN_NOTE)}</span>`
              : "") +
            (isRemoved(t) ? `<br><span class="e edited">${esc(REMOVED_NOTE)}</span>` : "") +
            (isAdded(t)
              ? `<br><span class="e edited">${esc(ADDED_NOTE)}</span>`
              : edited.length
                ? `<br><span class="e edited">${esc(`${EDITED_NOTE}: ${edited.join(", ")}`)}</span>`
                : "") +
            (released ? `<br><span class="e released">${esc(released)}</span>` : "") +
            (about ? `<br><span class="e about">${esc(about)}</span>` : "") +
            messages +
            (ex ? `<br><span class="kv">${ex}</span>` : "") +
            wireInfo +
            follow +
            `</div>`
          );
        })
        .concat(
          hoverLines.map(([x1, y1, x2, y2, t]) => {
            const len = Math.round(Math.hypot(x2 - x1, y2 - y1));
            return (
              `<div><span class="t" style="color:${LINE_COLORS[t] || "#999"}">${LINE_NAMES[t] || "Line type " + t}</span>` +
              ` <span class="e">(${x1},${y1})→(${x2},${y2}) · ${formatDist(len)}</span></div>`
            );
          }),
        )
        .join("<hr>") +
      (hoverTlvs.length > 8 ? `<div class="e">+${hoverTlvs.length - 8} more…</div>` : "");
    if (html !== tipHtml || tipSpaceW !== cv.clientWidth || tipSpaceH !== cv.clientHeight) {
      tip.innerHTML = html;
      tipHtml = html;
      tipSpaceW = cv.clientWidth;
      tipSpaceH = cv.clientHeight;
      tip.style.left = "0px"; // the width it wraps to given the whole canvas to grow into
      tipW = tip.offsetWidth;
      tipH = tip.offsetHeight;
    }
    const below = mouse.y + 16;
    tip.style.left = Math.max(6, Math.min(mouse.x + 16, cv.clientWidth - tipW - 10)) + "px";
    tip.style.top =
      (below + tipH > cv.clientHeight ? Math.max(6, mouse.y - tipH - 12) : below) + "px";
    if (!panning)
      cv.style.cursor =
        state.edit && hoverTlvs[0] === state.sel && !isRemoved(state.sel)
          ? "move"
          : modeCursor() || (hoverTlvs.some((t) => followableDest(t)) ? "pointer" : "");
  } else {
    tip.style.display = "none";
    if (!panning) cv.style.cursor = modeCursor();
  }
  const wx = wX(pt.x),
    wy = wY(pt.y);
  hud.textContent = `world x ${Math.round(wx)}  y ${Math.round(wy)}  ·  grid ${gX(wx).toFixed(1)}, ${gY(wy).toFixed(1)}  ·  zoom ${state.cam.z.toFixed(2)}`;
}

// nothing is pointed at
export function clearHover() {
  hoverTlvs = [];
  tip.style.display = "none";
}
