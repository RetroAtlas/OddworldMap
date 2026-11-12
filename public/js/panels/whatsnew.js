// "What's New": a dated changelog panel driven by changelog.json.
// If the feed is missing the button stays hidden.

import { $ } from "../ui/dom.js";
import { esc } from "../model/util.js";
import { NEWSPAPER_SVG } from "../ui/icons.js";
import { closeDialog, openDialog, trapDialogKeys } from "../ui/dialog.js";

const PREVIEW_N = 5; // entries shown before "see all"
const SEEN_KEY = "owm:whatsnew:lastSeen"; // newest date the visitor has opened
const MONTHS = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];

const fmtDate = (iso) => {
  const [y, m, d] = iso.split("-").map(Number);
  return `${MONTHS[m - 1]} ${d}, ${y}`;
};

// a tag's colour is a CSS rule keyed by its name, so the name has to reach a
// class intact; whatever a class can't carry becomes a dash
const tagClass = (tag) => "wn-tag-" + tag.toLowerCase().replace(/[^a-z0-9]+/g, "-");

const labelsOf = (e) => [e.tag, e.flagship && "flagship", e.tiny && "tiny"].filter(Boolean);

// localStorage may be unavailable (private mode, blocked); never let that break the panel
const store = {
  get: () => {
    try {
      return localStorage.getItem(SEEN_KEY);
    } catch {
      return null;
    }
  },
  set: (v) => {
    try {
      localStorage.setItem(SEEN_KEY, v);
    } catch {
      /* ignore */
    }
  },
};

export async function initWhatsNew() {
  let entries;
  try {
    const r = await fetch("changelog.json", { cache: "no-cache" });
    if (!r.ok) return;
    entries = (await r.json()).entries;
  } catch {
    return;
  }
  if (!Array.isArray(entries) || !entries.length) return;

  const btn = $("whatsnewBtn"),
    overlay = $("whatsnewOverlay");
  const body = $("whatsnewBody"),
    filter = $("whatsnewFilter"),
    closeBtn = $("whatsnewClose");
  const newest = entries[0].date;

  // the feed names its own kinds; sorted so the row keeps its order as it grows
  const kinds = [...new Set(entries.map((e) => e.tag).filter(Boolean))].sort();
  const chips = entries.some((e) => e.flagship) ? [...kinds, "flagship"] : kinds;
  const off = new Set(); // switched-off labels; an unlabelled entry answers to none and stays
  let expanded = false;

  const renderFilter = () => {
    filter.innerHTML = chips
      .map(
        (t) =>
          `<button type="button" class="wn-tag ${tagClass(t)} wn-chip" data-tag="${esc(t)}" aria-pressed="${!off.has(t)}">${esc(t)}</button>`,
      )
      .join("");
  };

  const render = () => {
    const matching = entries.filter((e) =>
      e.flagship ? !off.has("flagship") : !e.tag || !off.has(e.tag),
    );
    if (!matching.length) {
      body.innerHTML = `<div class="wn-empty">Nothing to show — turn a tag back on.</div>`;
      return;
    }
    let html = "",
      lastDate = null;
    for (const e of expanded ? matching : matching.slice(0, PREVIEW_N)) {
      if (e.date !== lastDate) {
        html += `<div class="wn-date">${esc(fmtDate(e.date))}</div>`;
        lastDate = e.date;
      }
      const line = labelsOf(e)
        .map((t) => `<span class="wn-tag ${tagClass(t)}">${esc(t)}</span>`)
        .join("");
      const tags = line ? `<div class="wn-tags">${line}</div>` : "";
      const detail = e.detail ? `<div class="wn-detail">${esc(e.detail)}</div>` : "";
      const cls = e.flagship ? "wn-entry wn-flagship" : "wn-entry";
      html += `<div class="${cls}">${tags}<span class="wn-title">${esc(e.title)}</span>${detail}</div>`;
    }
    if (!expanded && matching.length > PREVIEW_N)
      html += `<button class="wn-more" id="whatsnewMore">See all ${matching.length} updates</button>`;
    body.innerHTML = html;
    const more = $("whatsnewMore");
    if (more)
      more.onclick = () => {
        expanded = true;
        render();
      };
  };

  filter.onclick = (e) => {
    const chip = e.target.closest(".wn-chip");
    if (!chip) return;
    const tag = chip.dataset.tag;
    if (off.has(tag)) off.delete(tag);
    else off.add(tag);
    chip.setAttribute("aria-pressed", !off.has(tag)); // in place: rebuilding would drop focus
    render();
  };

  const open = () => {
    off.clear();
    expanded = false;
    renderFilter();
    render();
    openDialog(overlay, close);
    btn.classList.remove("hasnew");
    store.set(newest);
    closeBtn.focus();
  };
  const close = () => {
    closeDialog(overlay);
    btn.focus();
  };

  const seen = store.get();
  if (!seen || newest > seen) btn.classList.add("hasnew");

  btn.onclick = open;
  closeBtn.onclick = close;
  overlay.onclick = (e) => {
    if (e.target === overlay) close();
  };
  trapDialogKeys(() => overlay.classList.contains("open"), $("whatsnew"), close);

  btn.insertAdjacentHTML("afterbegin", NEWSPAPER_SVG);
  btn.hidden = false;
}
