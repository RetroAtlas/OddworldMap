// The site's JSON payloads and when each is fetched: first paint waits on the
// game the link names, and the other arrives behind it.
// No DOM, so it stays importable in bare Node.

import { parseHash } from "./model.js";
import { applyStoredEdits, hasStoredEdits, reportUnapplied, setLevelShort } from "./edits.js";
import { armFieldData } from "./fields.js";

// the games in canonical order; the first is what a visit boots on when
// nothing names one
export const GAME_FILES = { AO: "map_data_ao.json", AE: "map_data_ae.json" };
export const GAME_IDS = Object.keys(GAME_FILES);
export const knownGame = (id) => Object.hasOwn(GAME_FILES, id);

export async function loadJson(file, init) {
  try {
    // no-cache revalidates (ETag/304) so rebuilds still show up immediately,
    // but an unchanged file is not re-downloaded
    const r = await fetch(file, { cache: "no-cache", ...init });
    if (r.ok) return await r.json();
  } catch {
    /* tolerate a missing file */
  }
  return null;
}

// read from the hash text alone: a parse costs nothing, and the answer is needed
// before there is any geometry to resolve the rest of the link against
export function bootGame(hash, stored) {
  for (const h of [hash, stored]) {
    const id = h ? parseHash(h)?.game : null;
    if (id && knownGame(id)) return id;
  }
  return GAME_IDS[0];
}

const started = new Map(),
  settled = new Set();

// one fetch per dataset however many callers ask, so a permalink into a game
// still in flight awaits that fetch rather than starting a second. `low` drops
// the game the visitor is not looking at out of the default high priority, so it
// cannot push ahead of the opening screen's artwork, which is low itself.
export function loadGame(id, low) {
  let p = started.get(id);
  if (!p)
    started.set(
      id,
      (p = loadJson(GAME_FILES[id], low ? { priority: "low" } : null)
        .then((d) => (d && d.levels && d.levels.length ? d : null))
        .then((d) => withStoredEdits(d, low))
        .finally(() => settled.add(id))),
    );
  return p;
}

// the deltas saved on this device apply before anything sees the dataset: every
// dataset passes through here, so none reaches the page un-applied. The level
// map they derive destinations through rides the editor sidecar, and the field
// tables they are validated against are awaited too, or a delta a rebuild
// un-labelled would slip through whenever the dataset outran the boot's own
// fetch of them. A table that did not load validates against nothing, so it
// refuses like a missing sidecar: nothing applies and the page is told
async function withStoredEdits(d, low) {
  if (!d || !hasStoredEdits(d.id)) return d;
  const [side, fd] = await Promise.all([loadEditorData(d.id, low), loadFieldSidecars(d.id, low)]);
  if (side && fd.fieldTypes && fd.enumLabels) {
    setLevelShort(d.id, side.level_short);
    armFieldData(d.id, fd.fieldTypes, fd.enumLabels);
    applyStoredEdits(d);
  } else reportUnapplied(d.id);
  return d;
}

// the field-type and enum-label pair, one fetch per game shared between the
// boot's own use and the validation above
const fieldSidecars = new Map();
export function loadFieldSidecars(id, low) {
  let p = fieldSidecars.get(id);
  if (!p) {
    const opts = low ? { priority: "low" } : null;
    p = Promise.all([
      loadJson(`field_types_${id.toLowerCase()}.json`, opts),
      loadJson(`enum_labels_${id.toLowerCase()}.json`, opts),
    ]).then(([fieldTypes, enumLabels]) => ({ fieldTypes, enumLabels }));
    fieldSidecars.set(id, p);
  }
  return p;
}

// the games that have neither landed nor been given up on
export const pendingGames = () => GAME_IDS.filter((id) => !settled.has(id));

// the editor data is a viewer surface nobody uses until they ask for it, so it
// is fetched on the first use rather than at boot; one fetch per game however
// many uses follow, and a fetch that came back with nothing is forgotten so the
// next ask is a real retry rather than the first failure repeating.
const editorData = new Map();
export function loadEditorData(id, low) {
  let p = editorData.get(id);
  if (!p) {
    p = loadJson(`relive_export_${id.toLowerCase()}.json`, low ? { priority: "low" } : null).then(
      (d) => {
        if (!d) editorData.delete(id);
        return d;
      },
    );
    editorData.set(id, p);
  }
  return p;
}

// the sprite sheets and their animation table are fetched on the first ask, which a
// view opening with the objects shown makes at boot; one fetch per game, a failed
// one forgotten so the next ask retries
const spriteData = new Map();
export function loadSprites(id, low) {
  let p = spriteData.get(id);
  if (!p) {
    p = loadJson(`sprites_${id.toLowerCase()}.json`, low ? { priority: "low" } : null).then((d) => {
      if (!d || !Array.isArray(d.sheets) || !d.anims) {
        spriteData.delete(id);
        return null;
      }
      return d;
    });
    spriteData.set(id, p);
  }
  return p;
}
