// A path as a relive_api v4 document, the AliveTeam level editor's format —
// the page's half of tools/oddmap/relive.py, reading the same caches through
// the relive_export_* sidecar so the two implementations answer alike.
// No DOM, so it stays importable in bare Node.

import { filedAt, filedCell } from "./model.js";

// a path's objects by the cell whose camera lists them
export function bucketCells(gameId, path, geometry) {
  const cells = new Map();
  for (const t of path.tlvs) {
    const cell = filedCell(t, path, geometry, gameId);
    if (!(cell >= 0 && cell < path.w * path.h)) {
      const { x, y } = filedAt(t, gameId);
      throw new Error(`${t.name} at ${x},${y} lands outside the grid`);
    }
    if (!cells.has(cell)) cells.set(cell, []);
    cells.get(cell).push(t);
  }
  return cells;
}

// the digit formula relive derives an id from an 8-char camera name with
export const cameraId = (name) =>
  1000 * (name.charCodeAt(3) - 48) +
  100 * (name.charCodeAt(4) - 48) +
  10 * (name.charCodeAt(6) - 48) +
  (name.charCodeAt(7) - 48);

// a stored s16 word (with its neighbour for the 4-byte widths) as the property's
// own width; a missing high word sign-extends
export function widenValue(lo, hi, type, size) {
  if (size === 4) {
    if (hi === undefined) hi = lo < 0 ? -1 : 0;
    const v = ((lo & 0xffff) | ((hi & 0xffff) << 16)) >>> 0;
    return type !== "Uint32" && v >= 2 ** 31 ? v - 2 ** 32 : v;
  }
  if (size === 1) return lo & 0xff;
  return type === "UInt16" ? lo & 0xffff : lo;
}

function propertyValue(literal, prop, words, side, manifest) {
  const lo = words.get(prop.word);
  const fallback = side.fallbacks[literal]?.[prop.name];
  let v;
  if (lo === undefined) {
    if (fallback === undefined) {
      manifest.missing.add(`${literal}.${prop.name}`);
      return undefined;
    }
    manifest.fallbacks.add(`${literal}.${prop.name}`);
    v = fallback;
  } else {
    if (fallback !== undefined)
      throw new Error(`spent export fallback: ${literal}.${prop.name} is archived now`);
    v = widenValue(
      lo,
      prop.size === 4 ? words.get(prop.word + 1) : undefined,
      prop.type,
      prop.size,
    );
  }
  if (!prop.enum) return v;
  const labels = side.schema.enums[prop.type];
  const label = labels[String(v)] ?? (prop.size === 2 ? labels[String(v & 0xffff)] : undefined);
  if (label === undefined)
    throw new Error(`${literal}.${prop.name}: value ${v} has no ${prop.type} label`);
  return label;
}

function mapObject(t, side, counters, manifest) {
  const s = side.schema.structures[String(t.t)];
  counters[s.name] = (counters[s.name] || 0) + 1;
  const w = t.x2 - t.x1,
    h = t.y2 - t.y1;
  // relive aborts an export on a negative size
  if (w < 0 || h < 0) throw new Error(`${s.name} at ${t.x1},${t.y1}: negative size ${w}x${h}`);
  const props = { xpos: t.x1, ypos: t.y1, width: w, height: h };
  const fields = t.fields || {};
  const words = new Map();
  for (const [word, name] of side.layouts[String(t.t)] || [])
    if (name in fields) words.set(word, fields[name]);
  for (const prop of s.properties) {
    const v = propertyValue(s.name, prop, words, side, manifest);
    if (v !== undefined) props[prop.name] = v;
  }
  return {
    name: `${s.name}_${counters[s.name]}`,
    object_structures_type: s.name,
    properties: props,
  };
}

// the per-game `schema` root key the editor reads: identical for every path
function schemaBlob(side) {
  const byName = {};
  for (const s of Object.values(side.schema.structures)) byName[s.name] = s;
  const structures = side.schema.structure_order.map((literal) => ({
    name: literal,
    enum_and_basic_type_properties: [
      ...side.base_properties,
      ...byName[literal].properties.map((p) => {
        const d = { Type: p.type, Visible: p.visible, name: p.name };
        if ("id_str" in p) d.Identity_string = p.id_str;
        return d;
      }),
    ],
  }));
  return {
    object_structure_property_basic_types: side.basic_types,
    object_structure_property_enums: Object.entries(side.enum_values).map(([name, values]) => ({
      name,
      values,
    })),
    object_structures: structures,
  };
}

// relive_api hardcodes Oddysee's mud counts and reads Exoddus' from the level
// table, and only Exoddus stores an Abe start per path
function mapScalars(gameId, side, level, path) {
  if (gameId === "AO") return { abe: [0, 0], muds: [0, 99, 75, 50] };
  const [abeX, abeY] = side.abe[level.short][String(path.id)];
  const inPath = level.id < side.muds_in_level.length ? side.muds_in_level[level.id] : 0;
  return { abe: [abeX, abeY], muds: [inPath, 300, 20, 255] };
}

// one path as a v4 document, plus the manifest of what the archive could not
// supply: a written file missing a property aborts relive's importer outright,
// so a document with anything in `missing` must not be offered as whole
export function exportPath(gameId, geometry, level, path, side) {
  const manifest = { missing: new Set(), fallbacks: new Set() };
  const counters = {};
  const named = new Map(path.cams.map((c) => [c.cell, c.name]));
  const buckets = bucketCells(gameId, path, geometry);
  const cells = [...new Set([...named.keys(), ...buckets.keys()])].sort((a, b) => a - b);
  const cameras = cells.map((cell) => {
    const name = named.get(cell) || "";
    return {
      name,
      x: cell % path.w,
      y: Math.floor(cell / path.w),
      id: name ? cameraId(name) : 0,
      map_objects: (buckets.get(cell) || []).map((t) => mapObject(t, side, counters, manifest)),
    };
  });

  const linkNames = side.schema.collision_structure.slice(5).map((r) => r.name);
  const rows = side.links.paths[level.short][String(path.id)];
  if (rows.length !== path.lines.length)
    throw new Error(
      `${level.short} P${path.id}: ${rows.length} link rows for ${path.lines.length} lines`,
    );
  const items = path.lines.map(([x1, y1, x2, y2, ltype], i) => {
    const label = side.schema.enums.Enum_LineTypes[String(ltype)];
    if (label === undefined) throw new Error(`collision type ${ltype} has no Enum_LineTypes label`);
    const item = { x1, y1, x2, y2, Type: label };
    // the cache keys are norm()ed display strings, as the properties are
    const byKey = Object.fromEntries(side.links.columns.map((c, j) => [c, rows[i][j]]));
    for (const n of linkNames) item[n] = byKey[norm(n)];
    return item;
  });

  const { abe, muds } = mapScalars(gameId, side, level, path);
  const doc = {
    api_version: 4,
    game: gameId,
    map: {
      path_bnd: `${level.short}PATH.BND`,
      path_id: path.id,
      x_size: path.w,
      y_size: path.h,
      x_grid_size: geometry.worldW,
      y_grid_size: geometry.worldH,
      abe_start_xpos: abe[0],
      abe_start_ypos: abe[1],
      num_muds_in_path: muds[0],
      total_muds: muds[1],
      num_muds_for_bad_ending: muds[2],
      num_muds_for_good_ending: muds[3],
      lcdscreen_messages: [],
      hintfly_messages: [],
      collisions: {
        structure: side.schema.collision_structure.map((r) => ({
          Type: r.type,
          Visible: true,
          name: r.name,
        })),
        items,
      },
      cameras,
    },
    schema: schemaBlob(side),
  };
  return { doc, manifest };
}

// a display string down to the archive's key, the same reduction the builder's
// schema parser applies
export const norm = (label) =>
  label
    .replace(/\([^)]*\)/g, "")
    .replace(/'/g, "")
    .replace(/[^A-Za-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .toLowerCase();

// the document as one byte string the builder's `canonical` also produces: keys
// sorted, no whitespace, and every value an int or an ASCII string
export function canonical(v) {
  if (Array.isArray(v)) return `[${v.map(canonical).join(",")}]`;
  if (v !== null && typeof v === "object")
    return `{${Object.keys(v)
      .sort()
      .map((k) => `${JSON.stringify(k)}:${canonical(v[k])}`)
      .join(",")}}`;
  return JSON.stringify(v);
}
