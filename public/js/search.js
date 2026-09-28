// Global TLV search: scope bar, grouped results, keyboard navigation.

import { esc, extrasText } from "./util.js";
import { fieldEntries } from "./fields.js";
import { objectMessages } from "./messages.js";
import { parseQuery, queryTerms, matchesQuery, rankFor } from "./searchquery.js";
import { matchPlaces } from "./placesearch.js";
import { pendingGames } from "./data.js";
import { searchInput, searchResults, scopeBar } from "./dom.js";
import { pathVisible } from "./pathvisible.js";
import { state } from "./state.js";
import { fieldPrefsFor, getSettings } from "./settings.js";
import { jumpToPlace, jumpToTlv } from "./navigate.js";
import { pathIn } from "./model.js";
import { editedFields } from "./edits.js";
import { EDITED_NOTE } from "./config.js";
import { toggleMenu } from "./interaction.js";

const HIT_CAP = 1500,
  GROUP_MAX = 8;
let searchTimer = null;
let searchScope = "all"; // all | game | level | path (relative to the current selection)

// one cache per representation: the blob varies only with the raw flag (a TLV's
// game is fixed), so a WeakMap key needs no invalidation as datasets come and go
const searchTextCache = { raw: new WeakMap(), pretty: new WeakMap() };

// search matches the full field set regardless of the user's display prefs, so
// any field is findable even when it isn't shown by default. The game keys each
// value transform by the field's per-game type; raw follows the display setting
// so a query matches whichever representation the user sees (raw ints or words).
// A sign's own words join the blob, so a remembered slogan finds the board.
function tlvSearchText(t, game, raw) {
  const cache = raw ? searchTextCache.raw : searchTextCache.pretty;
  let s = cache.get(t);
  if (s === undefined) {
    const says = (objectMessages(game, t) ?? []).map((m) => m.text).join(" ");
    s = (t.name + " " + extrasText(t, " ", { mode: "all", game, raw }) + " " + says).toLowerCase();
    cache.set(t, s);
  }
  return s;
}

function scopeAccepts(h) {
  if (searchScope === "game") return h.G === state.data;
  if (searchScope === "level") return h.G === state.data && h.L === state.lvl;
  if (searchScope === "path") return h.G === state.data && h.L === state.lvl && h.P === state.path;
  return true;
}

function placeInScope(c) {
  if (searchScope === "game") return c.G === state.data;
  if (searchScope === "level") return c.G === state.data && c.lv === state.lvl.short;
  return searchScope !== "path"; // the one place in path scope is where you stand
}

function scopeLabel() {
  return {
    all: "everywhere",
    game: state.data.id,
    level: `${state.data.id} · ${state.lvl.short}`,
    path: `${state.data.id} · ${state.lvl.short} P${state.path.id}`,
  }[searchScope];
}

function updateScopeBar() {
  if (!state.data || !state.lvl || !state.path) return;
  scopeBar.innerHTML = "";
  for (const [key, label] of [
    ["all", "All"],
    ["game", state.data.id],
    ["level", state.lvl.short],
    ["path", "P" + state.path.id],
  ]) {
    const b = document.createElement("button");
    b.textContent = label;
    if (searchScope === key) b.classList.add("on");
    b.onclick = () => {
      searchScope = key;
      updateScopeBar();
      runSearch(searchInput.value);
    };
    scopeBar.appendChild(b);
  }
}
window.addEventListener("selection-changed", updateScopeBar);

// mark every occurrence of every term, merging overlaps, escaping each segment
function highlight(text, terms) {
  const lower = text.toLowerCase();
  const ranges = [];
  for (const term of terms) {
    if (!term) continue; // indexOf("") would never advance
    for (let i = lower.indexOf(term); i >= 0; i = lower.indexOf(term, i + term.length))
      ranges.push([i, i + term.length]);
  }
  if (!ranges.length) return esc(text);
  ranges.sort((a, b) => a[0] - b[0]);
  const merged = [];
  for (const [s, e] of ranges) {
    const last = merged[merged.length - 1];
    if (last && s <= last[1]) last[1] = Math.max(last[1], e);
    else merged.push([s, e]);
  }
  let out = "",
    pos = 0;
  for (const [s, e] of merged) {
    out += esc(text.slice(pos, s)) + "<mark>" + esc(text.slice(s, e)) + "</mark>";
    pos = e;
  }
  return out + esc(text.slice(pos));
}

function hitButton(h, terms) {
  const b = document.createElement("button");
  b.className = "rowbtn hit";
  let ex = extrasText(h.t, " ", fieldPrefsFor(h.G.id));
  // the index matches every field but the row shows only the visible ones; a
  // hit on a hidden field would look inexplicable, so append what matched
  const visible = `${h.t.name} ${ex}`.toLowerCase();
  const missing = terms.filter((term) => !visible.includes(term));
  if (missing.length) {
    const matched = fieldEntries(h.t, {
      mode: "all",
      game: h.G.id,
      raw: getSettings().showRawValues,
    })
      .map(([k, v]) => `${k}=${v}`)
      .filter((s) => missing.some((term) => s.toLowerCase().includes(term)));
    if (matched.length) ex += (ex ? " " : "") + matched.join(" ");
  }
  b.innerHTML =
    `<span class="loc">${h.L.short} P${h.P.id}</span> ${highlight(h.t.name, terms)}` +
    (Object.keys(editedFields(h.t)).length
      ? ` <span class="ex edited">${esc(EDITED_NOTE)}</span>`
      : "") +
    (ex ? ` <span class="ex">${highlight(ex, terms)}</span>` : "");
  b.onclick = () => jumpToTlv(h.G, h.L, h.P, h.t);
  return b;
}

function placeButton(c, terms) {
  const b = document.createElement("button");
  b.className = "rowbtn hit";
  // the code answers whole terms only, so marking every term inside it would
  // claim a match the query never made
  const codeTerms = terms.filter((term) => c.tokens.includes(term));
  const ex = [c.pa != null && c.levelName, c.nickname, c.section].filter(Boolean).join(" · ");
  b.innerHTML =
    `<span class="loc">${c.G.id} · ${highlight(c.code, codeTerms)}</span>` +
    (c.name ? ` ${highlight(c.name, terms)}` : "") +
    (ex ? ` <span class="ex">${highlight(ex, terms)}</span>` : "");
  b.onclick = () => jumpToPlace(c.G, c.lv, c.pa, c.cam);
  return b;
}

function renderGroup(label, rows, make) {
  const head = document.createElement("div");
  head.className = "listhead shead";
  head.innerHTML = `<span>${label}</span><span>${rows.length}</span>`;
  searchResults.appendChild(head);
  rows.slice(0, GROUP_MAX).forEach((r) => searchResults.appendChild(make(r)));
  if (rows.length <= GROUP_MAX) return;
  const rest = rows.slice(GROUP_MAX);
  const btn = document.createElement("button");
  btn.className = "showmore";
  btn.textContent = `show ${rest.length} more`;
  btn.onclick = () => {
    rest.forEach((r) => searchResults.insertBefore(make(r), btn));
    btn.remove();
  };
  searchResults.appendChild(btn);
}

function runSearch(q) {
  searchResults.innerHTML = "";
  q = q.trim();
  if (q.length < 2) {
    searchScope = "all";
    updateScopeBar();
    return;
  }

  const orGroups = parseQuery(q);
  const terms = queryTerms(orGroups);
  const raw = getSettings().showRawValues;
  const hits = [];
  let hidden = 0; // matches on paths the demo setting keeps out of the map
  outer: for (const G of state.games)
    for (const L of G.levels)
      for (const P of L.paths) {
        const shown = pathVisible(P);
        for (const t of P.tlvs)
          if (matchesQuery(tlvSearchText(t, G.id, raw), orGroups)) {
            const h = { G, L, P, t };
            if (!scopeAccepts(h)) continue;
            if (!shown) {
              hidden++;
              continue;
            }
            hits.push(h);
            if (hits.length >= HIT_CAP) break outer;
          }
      }

  const places = [];
  for (const c of matchPlaces(state.games, orGroups, terms, state.data)) {
    if (!placeInScope(c)) continue;
    if (c.pa != null && !pathVisible(pathIn(c.G, c.lv, c.pa))) {
      hidden++;
      continue;
    }
    places.push(c);
  }

  // group by context: current path, then current level, then per game
  const groups = [];
  const byKey = {};
  const group = (key, label) =>
    byKey[key] || (byKey[key] = groups[groups.push({ label, hits: [] }) - 1]);
  if (state.path) group("p", `${state.data.id} · ${state.lvl.short} P${state.path.id}`);
  if (state.lvl) group("l", `${state.data.id} · ${state.lvl.short}`);
  for (const G of [state.data, ...state.games.filter((G) => G !== state.data)])
    group("g" + G.id, G.id);
  for (const h of hits) {
    if (h.G === state.data && h.L === state.lvl && h.P === state.path) group("p").hits.push(h);
    else if (h.G === state.data && h.L === state.lvl) group("l").hits.push(h);
    else group("g" + h.G.id).hits.push(h);
  }

  if (places.length) renderGroup("Places", places, (c) => placeButton(c, terms));

  for (const g of groups) {
    if (!g.hits.length) continue;
    g.hits.sort((a, b) => rankFor(a.t.name, terms) - rankFor(b.t.name, terms));
    renderGroup(g.label, g.hits, (h) => hitButton(h, terms));
  }

  const more = document.createElement("div");
  more.className = "more";
  const perGame = state.games
    .map((G) => `${G.id} ${hits.filter((h) => h.G === G).length}`)
    .join(" · ");
  // the Places heading carries its own count, so this one stays about objects,
  // and has to say so where places are the only thing on screen
  const none = places.length ? "no object hits" : "no hits";
  const summary = hits.length
    ? `${hits.length}${hits.length >= HIT_CAP ? "+" : ""} hit${hits.length === 1 ? "" : "s"}` +
      (searchScope === "all" ? ` — ${perGame}` : ` in ${scopeLabel()}`)
    : searchScope === "all"
      ? none
      : `${none} in ${scopeLabel()}`;
  // named only where a pending game is in scope: a scoped search is confined to
  // the game in hand, which has landed by definition
  const waiting = searchScope === "all" ? pendingGames() : [];
  // a hit the map won't take you to would look like a hit gone missing
  more.textContent =
    summary +
    (waiting.length ? ` — ${waiting.join(", ")} still loading` : "") +
    (hidden ? ` — ${hidden} hidden in demo paths` : "") +
    (searchScope === "all" ? "" : " — ");
  if (searchScope !== "all") {
    const widen = document.createElement("span");
    widen.className = "widen";
    widen.textContent = "search everywhere";
    widen.onclick = () => {
      searchScope = "all";
      updateScopeBar();
      runSearch(searchInput.value);
    };
    more.appendChild(widen);
  }
  searchResults.appendChild(more);
}

searchInput.addEventListener("input", () => {
  clearTimeout(searchTimer);
  searchTimer = setTimeout(() => runSearch(searchInput.value), 160);
});

// a dataset landing behind the boot one brings hits of its own, which the
// summary has been promising were still coming. The boot game is announced
// before anything is selected, and runSearch groups its hits around a selection
window.addEventListener("games-changed", () => {
  if (state.path && searchInput.value.trim().length >= 2) runSearch(searchInput.value);
});
// an edit stands a path as new objects, whose text the index has yet to read
window.addEventListener("data-changed", () => {
  if (state.path && searchInput.value.trim().length >= 2) runSearch(searchInput.value);
});

// field-display settings change what result rows show or how values render (raw
// vs prettified, the show-more mode, per-type picks), and the demo setting which
// paths are searched at all; re-render an active search
window.addEventListener("settings-changed", (e) => {
  const key = e.detail?.key;
  if (
    (key === "rawValues" || key === "fieldPrefs" || key === "fieldPicks" || key === "demoPaths") &&
    searchInput.value.trim().length >= 2
  )
    runSearch(searchInput.value);
});

// keyboard: "/" focuses search, Esc clears, arrows walk results, Enter jumps
let activeHit = -1;
function visibleHits() {
  return [...searchResults.querySelectorAll(".hit")];
}
function setActiveHit(i) {
  const hits = visibleHits();
  hits.forEach((b) => b.classList.remove("active"));
  activeHit = Math.max(-1, Math.min(i, hits.length - 1));
  if (activeHit >= 0) {
    hits[activeHit].classList.add("active");
    hits[activeHit].scrollIntoView({ block: "nearest" });
  }
}
window.addEventListener("keydown", (e) => {
  if (e.key === "/" && document.activeElement !== searchInput) {
    e.preventDefault();
    toggleMenu(true);
    searchInput.focus();
    searchInput.select();
    return;
  }
  if (document.activeElement !== searchInput) return;
  if (e.key === "Escape") {
    searchInput.value = "";
    runSearch("");
    searchInput.blur();
    setActiveHit(-1);
  } else if (e.key === "ArrowDown") {
    e.preventDefault();
    setActiveHit(activeHit + 1);
  } else if (e.key === "ArrowUp") {
    e.preventDefault();
    setActiveHit(activeHit - 1);
  } else if (e.key === "Enter") {
    const hits = visibleHits();
    (hits[activeHit] || hits[0])?.click();
  } else {
    activeHit = -1;
  }
});
