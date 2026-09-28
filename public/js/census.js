// Counts of picked object types at every granularity of a selection at once:
// one screen (grid cell), the path, the level, the whole game. The level and
// game tiers sum the paths the map lists — demo paths follow their setting —
// and what the hidden paths hold comes back beside the rows, the way search
// reports what it dropped. No DOM.

import { tlvCell } from "./model.js";
import { pathVisible } from "./pathvisible.js";

// the cell an object's top-left corner falls in, never where it is drawn:
// what a screen holds must not move with the pitch
const inCell = (t, P, cell, geo) => tlvCell(t, P, geo) === cell;

// one row per name, in the order given; screen is null when no cell is named
export function census(names, data, lvl, path, cell) {
  const rows = names.map((name) => ({
    name,
    screen: cell == null ? null : 0,
    path: 0,
    level: 0,
    game: 0,
  }));
  const byName = new Map(rows.map((r) => [r.name, r]));
  let demo = 0;
  for (const L of data.levels)
    for (const P of L.paths) {
      const listed = pathVisible(P);
      for (const t of P.tlvs) {
        const r = byName.get(t.name);
        if (!r) continue;
        if (!listed) {
          demo++;
          continue;
        }
        r.game++;
        if (L !== lvl) continue;
        r.level++;
        if (P !== path) continue;
        r.path++;
        if (r.screen != null && inCell(t, P, cell, data.geometry)) r.screen++;
      }
    }
  return { rows, demo };
}
