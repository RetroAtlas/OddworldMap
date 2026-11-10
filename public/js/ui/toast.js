// Toasts (transient notices) at the bottom of the map: newest at the bottom of
// the stack, older ones riding above it, the overflow waiting behind a badge.

import { TOAST_MS, TOAST_OUT_MS, TOAST_MAX } from "../config.js";
import { toastStack } from "./dom.js";

const live = []; // oldest first; the DOM runs the other way (newest is prepended)
const queued = [];
let badge = null;

export function toast(msg) {
  // a click-spammable source (the copy buttons) repeating itself says nothing
  // extra: give the standing toast its full time back instead
  const newest = live[live.length - 1];
  if (newest && !newest.retiring && newest.msg === msg) {
    clearTimeout(newest.timer);
    newest.timer = setTimeout(() => retire(newest), TOAST_MS);
    replay(newest.bar);
    return;
  }
  if (live.length >= TOAST_MAX) {
    queued.push(msg);
    updateBadge();
    return;
  }

  const el = document.createElement("div");
  el.className = "toast";
  el.style.setProperty("--toast-ms", `${TOAST_MS}ms`);
  const text = document.createElement("span");
  text.textContent = msg;
  const bar = document.createElement("i");
  bar.className = "toast-bar";
  el.append(text, bar);
  toastStack.prepend(el);

  const entry = { el, bar, msg, timer: null, retiring: false };
  live.push(entry);
  void el.offsetHeight; // commit the pre-transition state so the fade-in plays
  el.classList.add("show");
  entry.timer = setTimeout(() => retire(entry), TOAST_MS);
}

function retire(entry) {
  if (entry.retiring) return;
  entry.retiring = true;
  entry.el.classList.remove("show");
  setTimeout(() => {
    entry.el.remove();
    const i = live.indexOf(entry);
    if (i >= 0) live.splice(i, 1);
    if (queued.length) {
      const next = queued.shift();
      updateBadge();
      toast(next);
    }
  }, TOAST_OUT_MS);
}

// restart the drain from full: an animation only replays once it has been off
// the element for a layout
function replay(bar) {
  bar.style.animation = "none";
  void bar.offsetWidth;
  bar.style.animation = "";
}

function updateBadge() {
  if (!queued.length) {
    badge?.remove();
    badge = null;
    return;
  }
  if (!badge) {
    badge = document.createElement("div");
    badge.className = "toast-more";
    badge.setAttribute("aria-hidden", "true");
    toastStack.appendChild(badge);
  }
  badge.textContent = `+${queued.length} more`;
}
