// What a game places, read off its placed objects alone: per type its numeric
// id, its fields, its most common size and each field's most common value.
// Importable in bare Node: no DOM.

// the most frequent key of a count map, the first seen winning a tie
const mode = (counts) => [...counts.entries()].reduce((a, b) => (b[1] > a[1] ? b : a))[0];

export function buildTypeTable(levels) {
  const seen = new Map();
  for (const L of levels)
    for (const P of L.paths)
      for (const o of P.tlvs) {
        let e = seen.get(o.name);
        if (!e)
          seen.set(
            o.name,
            (e = {
              t: o.t,
              counts: o.fields ? new Map(Object.keys(o.fields).map((f) => [f, new Map()])) : null,
              sizes: new Map(),
            }),
          );
        const size = `${o.x2 - o.x1},${o.y2 - o.y1}`;
        e.sizes.set(size, (e.sizes.get(size) ?? 0) + 1);
        if (e.counts)
          for (const [f, v] of Object.entries(o.fields)) {
            const c = e.counts.get(f);
            if (c) c.set(v, (c.get(v) ?? 0) + 1);
          }
      }
  const table = {};
  for (const [name, e] of seen) {
    const type = {
      t: e.t,
      fields: null,
      size: mode(e.sizes).split(",").map(Number),
      defaults: null,
    };
    if (e.counts) {
      type.fields = [...e.counts.keys()];
      type.defaults = Object.fromEntries([...e.counts].map(([f, c]) => [f, c.size ? mode(c) : 0]));
    }
    table[name] = type;
  }
  return table;
}

// a fresh object of a type at a rect: the type's defaults under the fields
// given, and no `fields` key at all for a type whose placements carry none
export function newObject(table, name, [x1, y1, x2, y2], fields = {}) {
  const type = table[name];
  if (!type) throw new Error(`${name} is not a type the game places`);
  const o = { t: type.t, name, x1, y1, x2, y2 };
  if (type.fields) o.fields = { ...type.defaults, ...fields };
  return o;
}
