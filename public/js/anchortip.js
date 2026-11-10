// A tooltip anchored to the element it explains: anything carrying a data-tip
// attribute gets one, hovered with a mouse and tapped on touch. Delegated from
// the document, so a surface can rebuild its DOM freely and a new consumer is
// one attribute away.

import { $ } from "./ui/dom.js";
import { clamp } from "./model/util.js";

const el = $("anchorTip");
let anchor = null;

const tipAt = (e) => e.target.closest?.("[data-tip]");

// an attribute carries a string and nothing else, so the line break is the
// whole content model: a summary, then detail that reads quieter
function show(target) {
  const text = target.dataset.tip;
  if (!text) return;
  const [summary, ...rest] = text.split("\n");
  el.textContent = "";
  const head = document.createElement("div");
  head.textContent = summary;
  el.append(head);
  if (rest.length) {
    const detail = document.createElement("div");
    detail.className = "detail";
    detail.textContent = rest.join("\n");
    el.append(detail);
  }
  anchor = target;
  el.hidden = false;
  place();
}

function place() {
  const r = anchor.getBoundingClientRect();
  el.style.left = "0px"; // the width it wraps to given the whole viewport to grow into
  const w = el.offsetWidth,
    h = el.offsetHeight;
  const vw = document.documentElement.clientWidth,
    vh = document.documentElement.clientHeight;
  const below = r.bottom + 6;
  el.style.left = clamp(r.left, 6, vw - w - 6) + "px";
  el.style.top = (below + h <= vh - 6 ? below : Math.max(6, r.top - h - 6)) + "px";
}

function hide() {
  if (!anchor) return;
  el.hidden = true;
  anchor = null;
}
// a surface that takes its own anchor away has to say so: a tap shows the
// tooltip and then activates what it sits on, so a control that replaces the
// page it was on would strand one over whatever came next
export { hide as hideAnchorTip };

// a touch fires pointerover before its own tap and pointerout after it, so
// hover has to be the mouse's alone or a tap would flash the tooltip away
document.addEventListener("pointerover", (e) => {
  if (e.pointerType !== "mouse") return;
  const t = tipAt(e);
  if (t) show(t);
});
// leaving is asked of the anchor, not of the attribute: an anchor with element
// children keeps its tooltip while the pointer crosses between them
document.addEventListener("pointerout", (e) => {
  if (e.pointerType === "mouse" && anchor && !anchor.contains(e.relatedTarget)) hide();
});
// the tap coexists with what it activates: nothing is consumed here, so
// whatever the anchor sits inside still gets the click
document.addEventListener("pointerup", (e) => {
  if (e.pointerType === "mouse") return;
  const t = tipAt(e);
  if (t) show(t);
});
document.addEventListener("pointerdown", (e) => {
  if (!tipAt(e)) hide();
});
document.addEventListener("scroll", hide, true); // scroll doesn't bubble: only capture sees a host scroll
window.addEventListener("resize", hide);
window.addEventListener("keydown", (e) => {
  if (e.key === "Escape") hide();
});
