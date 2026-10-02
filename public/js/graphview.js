// The world graph on screen: the game drawn as one diagram in place of the map,
// a column per level with its paths stacked in play order and every door, well,
// portal and transition between two of them an edge. A node is a button, so a
// click travels there and the keyboard reaches every path in the game.

import { CONN_COLORS, DEMO_NOTE, EDITED_NOTE, ENTRY_NOTE, GRAPH, KEY_PAN_PX } from "./config.js";
import { $, cv, menuBtn } from "./dom.js";
import { esc } from "./util.js";
import { state } from "./state.js";
import { pathDisplayName, pathNickname, pathNote } from "./annotations.js";
import { hideAnchorTip } from "./anchortip.js";
import { isDemoPath } from "./demo.js";
import { pathEdited } from "./edits.js";
import { marker, wirePath } from "./graphsvg.js";
import { jumpToPlace, scheduleHash } from "./navigate.js";
import { graphLayout, worldGraph } from "./worldgraph.js";

const view = $("graphView"),
  scroller = $("graphScroll"),
  frame = $("graphFrame"),
  plane = $("graphPlane"),
  openBtn = $("graphBtn"),
  fitBtn = $("graphFit");

let fitted = false, // scaled to the window rather than drawn at its own size
  drawn = null, // the dataset the diagram on screen was built from
  laid = null, // its geometry, kept for the fit
  opener = null; // where the keyboard came from

export function toggleGraph(on) {
  const want = on ?? !state.graph;
  if (want === state.graph) return;
  state.graph = want;
  window.dispatchEvent(new CustomEvent("graph-changed"));
  scheduleHash(true);
}

// what a node says beyond its own face, the lines drawn from it included —
// which nothing else on the diagram can be asked in words
function nodeLines(n, links) {
  const id = state.data.id,
    count = n.P.tlvs.length;
  const way = (key, lead) => links[key].length && `${lead} ${links[key].join(", ")}`;
  return [
    `${n.L.name} — ${pathDisplayName(id, n.lv, n.P) || `path ${n.pa}`}`,
    n.P.section,
    pathNickname(id, n.lv, n.P),
    state.entry[n.lv]?.has(n.pa) && ENTRY_NOTE,
    isDemoPath(n.P) && DEMO_NOTE,
    pathEdited(n.P) && EDITED_NOTE,
    `${count} object${count === 1 ? "" : "s"}`,
    way("both", "both ways with"),
    way("to", "leads to"),
    way("from", "reached from"),
    pathNote(id, n.lv, n.P),
  ].filter(Boolean);
}

// each node's partners, split the way the lines are drawn: a two-way pair once,
// a one-way link under the direction it runs
function linksOf(g) {
  const out = new Map([...g.nodes.keys()].map((k) => [k, { both: [], to: [], from: [] }]));
  for (const e of g.edges) {
    const key = e.fwd && e.rev ? "both" : e.fwd ? "to" : "from";
    out.get(e.a)[key].push(e.b);
    out.get(e.b)[key === "both" ? "both" : key === "to" ? "from" : "to"].push(e.a);
  }
  return out;
}

const arrow = (e) => (e.fwd && e.rev ? "↔" : e.fwd ? "→" : "←");

const edgeTip = (e) =>
  `${e.a} ${arrow(e)} ${e.b}\n` +
  Object.keys(e.kinds)
    .sort()
    .map((k) => `${k} ×${e.kinds[k]}`)
    .join(", ");

// the drawn line, plus one fat invisible leg per segment to point at. Per
// segment because a tooltip is placed against its anchor's box, and a route's
// whole box can be most of the diagram; the group is what still lights the
// line entire.
function wire({ e, pts }) {
  const seg = (a, b) => `M${a[0]} ${a[1]} L${b[0]} ${b[1]}`;
  const legs = pts
    .slice(1)
    .map((p, i) => `<path class="gv-hit" d="${seg(pts[i], p)}" data-tip="${esc(edgeTip(e))}"/>`)
    .join("");
  return `<g class="gv-edge">${legs}${wirePath({ e, pts }, ' class="gv-wire"')}</g>`;
}

// a level's paths, grouped so a reader is told which level they are walking
// into before the first of them
function column(c, L, data, links) {
  const boxes = c.nodes
    .map((n) => {
      const { x, y } = L.box(n);
      const lines = nodeLines(n, links.get(n.key));
      const name = pathDisplayName(data.id, n.lv, n.P) || "";
      const entry = state.entry[n.lv]?.has(n.pa) ? " entry" : "";
      return (
        `<button class="gv-node${entry}" data-lv="${esc(n.lv)}" data-pa="${n.pa}"` +
        ` data-tip="${esc(lines.join("\n"))}"` +
        // the face is a code and a name; everything else a reader is told
        ` aria-label="${esc(`${n.lv} P${n.pa}, ${lines.join(", ")}`)}"` +
        ` style="left:${x}px;top:${y}px">` +
        `<span class="gv-pa">P${n.pa}</span>${pathEdited(n.P) ? '<span class="gv-ed" aria-hidden="true">◆</span>' : ""}` +
        `${name ? `<span class="gv-nm">${esc(name)}</span>` : ""}` +
        `</button>`
      );
    })
    .join("");
  const sec = c.sec
    ? `<div class="gv-sec" style="left:${c.x}px;top:${c.sec.y}px" aria-hidden="true">` +
      `${esc(c.sec.label)}</div>`
    : "";
  return (
    `<div class="gv-level" role="group" aria-label="${esc(`${c.L.short} — ${c.L.name}`)}">` +
    `<div class="gv-head" style="left:${c.x}px;top:${L.top - GRAPH.headH}px" aria-hidden="true">` +
    `<b>${esc(c.L.short)}</b> <span>${esc(c.L.name)}</span></div>${sec}${boxes}</div>`
  );
}

function build() {
  const data = state.data;
  const g = worldGraph(data);
  laid = graphLayout(g);
  drawn = data;
  const kinds = [...new Set(g.edges.map((e) => e.kind))].sort();
  // the bar is narrow enough to want the short name the announcer uses
  $("graphTitle").textContent =
    `${data.game.replace(/^Oddworld:\s*/, "")} — ${g.nodes.size} paths, ${g.edges.length} links`;
  $("graphLegend").innerHTML = kinds
    .map(
      (k) =>
        `<span class="gv-key"><i style="background:${CONN_COLORS[k] || "#fff"}"></i>${esc(k)}</span>`,
    )
    .join("");
  plane.style.setProperty("--gv-node-w", `${GRAPH.nodeW}px`);
  plane.style.setProperty("--gv-node-h", `${GRAPH.nodeH}px`);
  plane.style.width = `${laid.w}px`;
  plane.style.height = `${laid.h}px`;
  const links = linksOf(g);
  plane.innerHTML =
    `<svg width="${laid.w}" height="${laid.h}" aria-hidden="true">` +
    `<defs>${kinds.map(marker).join("")}</defs>${laid.routes.map(wire).join("")}</svg>` +
    laid.cols.map((c) => column(c, laid, data, links)).join("");
  applyScale();
}

// the diagram is laid out at its own size; fitting scales the plane and the
// frame it scrolls inside, so the scrollbars answer to what is drawn
function applyScale() {
  const z = fitted
    ? Math.min(1, (scroller.clientWidth - 24) / laid.w, (scroller.clientHeight - 24) / laid.h)
    : 1;
  plane.style.transform = `scale(${z})`;
  // the level codes are counter-scaled back at the fit, or the one view of the
  // whole game says how tangled it is and not which level is which
  plane.style.setProperty("--gv-back", String(1 / z));
  frame.style.width = `${laid.w * z}px`;
  frame.style.height = `${laid.h * z}px`;
  document.body.classList.toggle("graph-fit", fitted);
  fitBtn.textContent = fitted ? "actual size" : "fit";
}

// scrolled to on the way in and merely kept in view afterwards, so stepping the
// paths never leaves the highlight off screen and never yanks the diagram either
function markHere(land) {
  const here = state.path ? `${state.lvl.short}|${state.path.id}` : null;
  let found = false;
  for (const b of plane.querySelectorAll(".gv-node")) {
    const on = `${b.dataset.lv}|${b.dataset.pa}` === here;
    b.classList.toggle("on", on);
    if (!on) continue;
    found = true;
    const at = land ? "center" : "nearest";
    b.scrollIntoView({ block: at, inline: at });
    if (land) b.focus({ preventScroll: true });
  }
  return found;
}

function refresh(land) {
  if (drawn !== state.data) build();
  else applyScale(); // the window may have resized while the mode was away
  // a path revealed for the session — a link into a demo copy with the setting
  // off — is a node the diagram did not have when it was built
  if (!markHere(land) && state.path) {
    build();
    markHere(land);
  }
}

// focus cannot enter an inert subtree at all, and the collapsed drawer is inert,
// so an opener behind one hands the keyboard to the button that opens the drawer
const reachable = (el) => el?.offsetParent && !el.closest("[inert]");

window.addEventListener("graph-changed", () => {
  // hiding a subtree holding the focus drops it to <body>, and the next Tab
  // restarts at the top of the page
  const held = view.contains(document.activeElement);
  const back = [opener, openBtn, menuBtn].find(reachable);
  view.hidden = !state.graph;
  cv.setAttribute("aria-hidden", String(state.graph));
  document.body.classList.toggle("graph", state.graph);
  openBtn.setAttribute("aria-expanded", String(state.graph));
  openBtn.classList.toggle("on", state.graph);
  if (state.graph) {
    opener = document.activeElement;
    refresh(true);
    return;
  }
  opener = null;
  hideAnchorTip(); // a tap on a node shows one and then takes the node away
  if (held) back?.focus();
});
window.addEventListener("selection-changed", () => state.graph && refresh(false));
// the demo copies are nodes like any other while the setting lists them, so the
// flip makes a different diagram — and the one already built is wrong from that
// moment whether or not anyone is looking at it
window.addEventListener("settings-changed", (e) => {
  if (e.detail.key !== "demoPaths") return;
  drawn = null;
  if (!state.graph) return;
  build();
  markHere(false);
});
// an edit can move a transition, and with it an edge or a column's order
window.addEventListener("data-changed", () => {
  drawn = null;
  if (!state.graph) return;
  build();
  markHere(false);
});
window.addEventListener("resize", () => {
  if (state.graph && fitted) applyScale();
});

plane.onclick = (e) => {
  const b = e.target.closest(".gv-node");
  // a drag that ended on a box was a pan, not a click on it. Asked of the
  // pointer's own click (detail counts its presses), so a keyboard Enter on a
  // node is never the one that gets swallowed
  if (!b || (panned && e.detail)) return;
  const L = state.data.levels.find((l) => l.short === b.dataset.lv);
  const P = L?.paths.find((p) => p.id === +b.dataset.pa);
  if (!P) return;
  toggleGraph(false);
  jumpToPlace(state.data, L.short, P.id, null);
};

// Drag to pan, as the map does: a plain mouse can reach the bottom of a diagram
// with the scrollbar and never the right of one, and the horizontal scroll a
// trackpad has is not a gesture a wheel offers. Touch is left to the scroller's
// own panning, which is already one finger.
let drag = null,
  panned = false;
scroller.addEventListener("pointerdown", (e) => {
  panned = false;
  if (e.pointerType === "touch" || e.button !== 0) return;
  drag = { x: e.clientX, y: e.clientY, l: scroller.scrollLeft, t: scroller.scrollTop };
});
window.addEventListener("pointermove", (e) => {
  if (!drag) return;
  const dx = e.clientX - drag.x,
    dy = e.clientY - drag.y;
  if (!panned && Math.hypot(dx, dy) < 4) return; // a click travels a pixel or two
  panned = true;
  scroller.classList.add("panning");
  scroller.scrollLeft = drag.l - dx;
  scroller.scrollTop = drag.t - dy;
});
window.addEventListener("pointerup", () => {
  drag = null;
  scroller.classList.remove("panning");
});

openBtn.onclick = () => toggleGraph();
$("graphClose").onclick = () => toggleGraph(false);
function setFit(on) {
  if (on === fitted) return;
  fitted = on;
  applyScale();
}
fitBtn.onclick = () => setFit(!fitted);

// keys that aim at the map: over a diagram each is a keypress with nothing to
// show for it, so they stop here
const MAP_KEYS = new Set([..."sgawpcfombrile", "Backspace"]);
// the diagram has two sizes, so the map's zoom keys name them
const ZOOM = { "+": false, "=": false, "-": true, _: true };
// driven from here rather than left to the browser: the scroller only answers
// the arrows while it holds the focus, and the bar's own buttons are outside it
const PAN = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] };
window.addEventListener(
  "keydown",
  (e) => {
    if (!state.graph || e.ctrlKey || e.metaKey || e.target.matches?.("input, textarea, select"))
      return;
    // a dialog opened from the sidebar stands over the diagram, and its own trap
    // registers after this one, so Escape has to be left to it
    if (document.querySelector(".overlay.open")) return;
    if (e.key === "Escape") {
      toggleGraph(false);
      // one Escape closes one thing, so it stops here rather than reaching the
      // Escape handlers of surfaces the mode is standing over; the tooltip's own
      // is the one this owes, since it may be showing an edge's
      hideAnchorTip();
      e.stopImmediatePropagation();
      return;
    }
    const pan = PAN[e.key];
    if (pan) {
      scroller.scrollBy({ left: pan[0] * KEY_PAN_PX, top: pan[1] * KEY_PAN_PX });
      e.preventDefault();
    } else if (e.key in ZOOM) {
      setFit(ZOOM[e.key]);
    }
    if (pan || e.key in ZOOM || MAP_KEYS.has(e.key)) e.stopImmediatePropagation();
  },
  { capture: true },
);
