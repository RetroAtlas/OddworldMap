// The map's own places as search targets: a level, one path within it, or one
// screen of a path. No DOM, so it stays importable in bare Node.

import { pathDisplayName, pathNickname } from "../model/annotations.js";
import { camIdOf } from "../model/model.js";
import { matchesBy, rankFor } from "../ui/searchquery.js";

// every beginning of a camera name (PVP05C05) that reaches past one part of it
const beginnings = (name, part) =>
  Array.from({ length: name.length - part.length }, (_, i) => name.slice(0, part.length + 1 + i));

// names go into a substring blob the way an object's fields do; the LV/Pn code
// is held as whole tokens, so the "2" in "zulag 2" is not answered by an "R2".
// A camera name's beginnings are tokens beside it, a path's from the level's
// code on and a screen's from its C on, so a term typed toward a name answers
// as far as it has got
function gameCandidates(G) {
  const out = [];
  for (const L of G.levels) {
    out.push({
      G,
      lv: L.short,
      pa: null,
      levelName: L.name,
      code: L.short,
      name: L.name || null,
      text: (L.name || "").toLowerCase(),
      tokens: [L.short.toLowerCase()],
    });
    for (const P of L.paths) {
      const name = pathDisplayName(G.id, L.short, P),
        nickname = pathNickname(G.id, L.short, P),
        section = P.section || null;
      const text = [L.name, name, nickname, section].filter(Boolean).join(" ").toLowerCase();
      const stem = `${L.short}P${String(P.id).padStart(2, "0")}`;
      const tokens = [
        L.short.toLowerCase(),
        "p" + P.id,
        ...beginnings(stem.toLowerCase(), L.short),
      ];
      out.push({
        G,
        lv: L.short,
        pa: P.id,
        levelName: L.name,
        code: `${L.short} P${P.id}`,
        camName: stem, // as far as its screens' names agree
        name,
        nickname,
        section,
        text,
        tokens,
      });
      // by number, as the names run, where the path holds its screens by grid cell
      const screens = (P.cams || [])
        .map((cm) => ({ cam: camIdOf(cm.name), camName: cm.name }))
        .filter((s) => s.cam != null)
        .sort((a, b) => a.cam - b.cam);
      for (const { cam, camName } of screens) {
        const camTokens = [
          ...new Set(["c" + cam, "c" + String(cam).padStart(2, "0")]),
          ...beginnings(camName.toLowerCase(), stem),
        ];
        out.push({
          G,
          lv: L.short,
          pa: P.id,
          levelName: L.name,
          cam,
          code: `${L.short} P${P.id} C${cam}`,
          camName,
          name,
          nickname,
          section,
          text,
          tokens: [...tokens, ...camTokens],
          camTokens,
        });
      }
    }
  }
  return out;
}

// the index holds names and codes, which nothing changes after boot, and names
// its places rather than holding them, so the key needs no invalidation
const candidateCache = new WeakMap();

export function placeCandidates(games) {
  return games.flatMap((G) => {
    let rows = candidateCache.get(G);
    if (!rows) candidateCache.set(G, (rows = gameCandidates(G)));
    return rows;
  });
}

// a path is indexed on its level's name but never ranks on it: that is what the
// level's own row answers, so a level sorts above the paths inside it
const rankPlace = (c, terms) =>
  Math.min(
    ...[c.name, c.nickname, c.section, c.code].filter(Boolean).map((s) => rankFor(s, terms)),
  );

// a row is labelled with its code, or with the camera name where a term
// answered that the code does not hold
const labelFor = (c, terms) =>
  terms.some((term) => c.tokens.includes(term) && !c.code.toLowerCase().includes(term))
    ? c.camName
    : c.code;

// scope and the demo-path setting are the caller's, as they are for objects.
// A screen answers only a query that names one (c3, c03, a cam name from its
// C on): its blob is its path's, so a name query would otherwise drag every
// matching path's whole screen list in
export function matchPlaces(games, groups, terms, current) {
  return placeCandidates(games)
    .filter(
      (c) =>
        (!c.camTokens || c.camTokens.some((t) => terms.includes(t))) &&
        matchesBy(groups, (term) => c.text.includes(term) || c.tokens.includes(term)),
    )
    .map((c) => ({ ...c, rank: rankPlace(c, terms), label: labelFor(c, terms) }))
    .sort((a, b) => a.rank - b.rank || (b.G === current) - (a.G === current));
}
