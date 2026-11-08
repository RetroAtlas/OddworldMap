// What each placed object looks like the moment the game constructs it from
// its TLV: the animation it stands in, where its anchor is, its scale, facing,
// colour and draw layer — the constructors' own rules, one per type and game,
// over the archive's fields and the path's collision lines. A rule returns
// draw records; the painter draws them and the motion clock advances them.
// No DOM, so it stays importable in bare Node.

import { onBackgroundPlane } from "./fields.js";
import { rules } from "./spritekit.js";
import "./furniturerules.js";
import "./hazardrules.js";
import "./creaturerules.js";
import "./mudokonrules.js";

// every record a placed object draws, or [] for a type without a sprite
export function spriteDraws(data, lvl, path, t, set) {
  const fn = rules[data.id]?.[t.name];
  if (!fn) return [];
  const c = {
    data,
    game: data.id,
    geo: data.geometry,
    lvl,
    path,
    lines: path.lines,
    links: set.links?.[lvl.short]?.[path.id] ?? null,
    t,
    index: path.tlvs.indexOf(t),
    f: t.fields || {},
    half: onBackgroundPlane(data.id, t),
    yOff: data.id === "AO" ? 5 : 0,
    anims: set.anims,
    font: set.font ?? null,
    abeStart: set.abe?.[lvl.short]?.[path.id],
  };
  return fn(c) || [];
}

export const spriteTypes = (gameId) => Object.keys(rules[gameId] || {});

// the sheet a record's own art is on: its animation's, else its brain's
const BRAIN_SHEETS = {
  lcd: (set) => set.font?.sheet,
  tally: (set) => set.font?.sheet,
  hintfly: (set) => set.anims.HintFly?.frames[0][0],
};
export function ownSheet(set, r) {
  if (r.anim) return set.anims[r.anim]?.frames[0][0] ?? null;
  return BRAIN_SHEETS[r.cycle?.brain]?.(set) ?? null;
}

// the sheets records draw from: each one's own, and the sidecar's shared sheets
// wherever a record runs a brain, the one source of the effects and the text
// drawn beside an object
export function recordSheets(set, recs) {
  const keys = new Set();
  let brain = false;
  for (const r of recs) {
    const k = ownSheet(set, r);
    if (k) keys.add(k);
    if (r.cycle?.kind === "brain") brain = true;
  }
  if (brain) for (const k of set.shared) keys.add(k);
  return [...keys].filter((k) => Object.hasOwn(set.sheets, k)).sort();
}
