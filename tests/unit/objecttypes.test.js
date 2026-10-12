// The type table over the shipped data: one id per name, the field set the
// relive sidecar's layouts name, and a fresh object shaped like a placed one.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { buildTypeTable, newObject } from "../../public/js/objecttypes.js";

const load = (f) => JSON.parse(readFileSync(new URL(`../../public/${f}`, import.meta.url), "utf8"));

for (const g of ["ao", "ae"]) {
  test(`${g.toUpperCase()}: the table reads one id per type and the archive's own field set`, () => {
    const G = load(`map_data_${g}.json`),
      side = load(`relive_export_${g}.json`);
    const table = buildTypeTable(G.levels);
    const placed = new Map();
    for (const L of G.levels)
      for (const P of L.paths)
        for (const o of P.tlvs) (placed.get(o.name) ?? placed.set(o.name, []).get(o.name)).push(o);
    assert.deepEqual(Object.keys(table).sort(), [...placed.keys()].sort());
    // the most frequent value, the first seen winning a tie
    const modal = (values) => {
      const counts = new Map();
      for (const v of values) counts.set(v, (counts.get(v) ?? 0) + 1);
      return [...counts.entries()].reduce((a, b) => (b[1] > a[1] ? b : a))[0];
    };
    for (const [name, type] of Object.entries(table)) {
      const all = placed.get(name),
        sample = all[0];
      assert.equal(type.t, sample.t, name);
      assert.deepEqual(
        type.size,
        modal(all.map((o) => `${o.x2 - o.x1},${o.y2 - o.y1}`))
          .split(",")
          .map(Number),
        `${name} size`,
      );
      if (sample.fields)
        for (const f of Object.keys(sample.fields))
          assert.equal(type.defaults[f], modal(all.map((o) => o.fields[f])), `${name}.${f}`);
      const layout = side.layouts[String(type.t)];
      if (sample.fields) {
        assert.deepEqual(type.fields.slice().sort(), Object.keys(sample.fields).sort(), name);
        assert.deepEqual(
          type.fields.slice().sort(),
          layout.map((e) => e[1]).sort(),
          `${name}: the archive's words`,
        );
        for (const [f, v] of Object.entries(type.defaults))
          assert.ok(Number.isInteger(v), `${name}.${f} defaults to an integer`);
      } else {
        assert.equal(type.fields, null, name);
        assert.equal(type.defaults, null, name);
        assert.equal(layout?.length ?? 0, 0, `${name} archives no words`);
      }
      assert.ok(type.size[0] >= 0 && type.size[1] >= 0, `${name} has a size`);
    }
  });
}

test("a fresh object takes the type's id, size and defaults, and no fields key for a field-less type", () => {
  const levels = [
    {
      paths: [
        {
          tlvs: [
            { t: 5, name: "Door", x1: 0, y1: 0, x2: 24, y2: 24, fields: { a: 1, b: 2 } },
            { t: 5, name: "Door", x1: 50, y1: 0, x2: 74, y2: 24, fields: { a: 1, b: 3 } },
            { t: 5, name: "Door", x1: 90, y1: 0, x2: 130, y2: 24, fields: { a: 7, b: 3 } },
            { t: 9, name: "Zone", x1: 0, y1: 0, x2: 100, y2: 50 },
          ],
        },
      ],
    },
  ];
  const table = buildTypeTable(levels);
  assert.deepEqual(table.Door, {
    t: 5,
    fields: ["a", "b"],
    size: [24, 24],
    defaults: { a: 1, b: 3 },
  });
  assert.deepEqual(table.Zone, { t: 9, fields: null, size: [100, 50], defaults: null });
  assert.deepEqual(newObject(table, "Door", [10, 20, 34, 44], { b: 9 }), {
    t: 5,
    name: "Door",
    x1: 10,
    y1: 20,
    x2: 34,
    y2: 44,
    fields: { a: 1, b: 9 },
  });
  assert.deepEqual(newObject(table, "Zone", [1, 2, 3, 4]), {
    t: 9,
    name: "Zone",
    x1: 1,
    y1: 2,
    x2: 3,
    y2: 4,
  });
  assert.throws(() => newObject(table, "Slig", [0, 0, 1, 1]), /not a type/);
});
