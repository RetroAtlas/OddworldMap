// What an object is drawn as, decided off the live state and the sprite art it is
// handed: the connection edges of the standing path, the set kept on the map to point
// at while the markers are off, and the one rule that says sprite, marker, unseen or
// nothing

import { CATS, KEPT_UNSEEN, PENS, barrierDir, catOf, markerShown } from "./config.js";
import { computeConnections, computeWiring, destOf, destTrusted } from "./model/model.js";
import { spriteTypes } from "./sprites.js";
import { state } from "./state.js";

const ruled = {};
const hasRule = (game, name) => (ruled[game] ??= new Set(spriteTypes(game))).has(name);
// connection edges, computed lazily and keyed by path object identity —
// selection-changed alone won't do: it re-fires for the same path on every
// pushed hash write
let connCache = { path: null, edges: null };
export const connections = (data, lvl, path) => {
  if (connCache.path !== path) connCache = { path, edges: computeConnections(data, lvl, path) };
  return connCache.edges;
};
let keptCache = { path: null, conn: null, wires: null, filters: null, set: null };
export function kept(t) {
  const { data, lvl, path } = state;
  const conn = !!state.show.conn,
    wires = !!state.show.wires;
  const filters = CATS.map((c) => (c.on ? 1 : 0)).join("") + (PENS.on ? "p" : "");
  if (
    keptCache.path !== path ||
    keptCache.conn !== conn ||
    keptCache.wires !== wires ||
    keptCache.filters !== filters
  ) {
    const follows = (o) => {
      const d = destOf(o, data, lvl, path);
      return d && destTrusted(d, data, lvl);
    };
    const set = new Set(path.tlvs.filter((o) => KEPT_UNSEEN.includes(o.name) || follows(o)));
    if (conn)
      for (const e of connections(data, lvl, path)) if (e.dst && catOf(e.src).on) set.add(e.dst);
    if (wires)
      for (const e of computeWiring(path, data.id).edges)
        if (markerShown(e.src) && markerShown(e.dst)) {
          set.add(e.src);
          set.add(e.dst);
        }
    keptCache = { path, conn, wires, filters, set };
  }
  return keptCache.set.has(t);
}
export function resetKept() {
  keptCache = { path: null, conn: null, wires: null, filters: null, set: null };
  connCache = { path: null, edges: null };
}
// what an object is drawn as: its sprite, its marker, unseen (there to point
// at, nothing to paint) or nothing. A type the rules know stays present when
// its own state draws nothing, an open door included
export function drawnAs(t, sprites, art) {
  if (!markerShown(t)) return null;
  if (PENS.on && barrierDir(t) !== null) return "marker";
  if (!state.show.objects) return "marker";
  // the editor's click needs a box for everything it may edit
  const markers = state.show.markers || state.edit;
  if (hasRule(state.data.id, t.name)) {
    if (!sprites) return art.failed ? "marker" : null;
    if (!sprites.has(t)) return markers ? "marker" : "unseen";
    // a sprite still on its way leaves its object there to point at, boxed for the editor
    if (!art.drawn) return state.edit ? "marker" : "unseen";
    return sprites.get(t).some(art.lost) ? "marker" : "sprite";
  }
  if (markers) return "marker";
  return kept(t) ? "unseen" : null;
}
