// Cached references to the static DOM and browser-environment handles.

export const $ = (id) => document.getElementById(id);

export const narrowMQ = window.matchMedia("(max-width: 720px)"); // keep in sync with the CSS breakpoint

// one-off reads of stylesheet tokens
export const cssVar = (name) =>
  getComputedStyle(document.documentElement).getPropertyValue(name).trim();

// cvCtx, not ctx: a painter missing its ctx parameter must fail lint, not draw on screen
export const cv = $("cv"),
  cvCtx = cv.getContext("2d");
export const tip = $("tip"),
  hud = $("hud");
export const sidebar = $("sidebar"),
  menuBtn = $("menuBtn"),
  scrim = $("scrim"),
  copyLinkBtn = $("copyLinkBtn"),
  openSiteBtn = $("openSiteBtn");
export const gameBtns = $("gameBtns"),
  levelBtns = $("levelBtns"),
  pathBtns = $("pathBtns");
export const filterBox = $("filterBox");
export const searchInput = $("searchInput"),
  searchResults = $("searchResults"),
  scopeBar = $("scopeBar");
export const toastStack = $("toastStack");
