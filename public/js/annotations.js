// Curated names and notes from annotations.json (hand-edited source; see
// docs/curated-data.md). A curated name is a deliberate override — the
// in-game name shows only where no curated one is defined.
// The raw file shape stays contained here — callers get plain lookups.
// Leaf module: no imports, importable in bare Node.

let ann = {};

const cleanString = (v) => (typeof v === "string" && v && v === v.trim() ? v : null);

// copy only known sections with the expected types; anything else is dropped,
// so a missing, garbage or future-shaped file can never break the viewer
export function sanitizeAnnotations(raw) {
  const out = {};
  if (!raw || typeof raw !== "object") return out;
  for (const [game, g] of Object.entries(raw)) {
    if (!g || typeof g !== "object") continue;
    const paths = {};
    for (const [short, byId] of Object.entries(g.paths || {})) {
      if (!byId || typeof byId !== "object") continue;
      for (const [id, v] of Object.entries(byId)) {
        const src = typeof v === "string" ? { name: v } : v;
        const name = cleanString(src?.name),
          note = cleanString(src?.note),
          nickname = cleanString(src?.nickname);
        if (!name && !note && !nickname) continue;
        (paths[short] ??= {})[id] = {
          ...(name && { name }),
          ...(note && { note }),
          ...(nickname && { nickname }),
        };
      }
    }
    out[game] = { paths };
  }
  return out;
}

export function setAnnotations(raw) {
  ann = sanitizeAnnotations(raw);
}

// display name for a path: the curated override, else the disc name, else null
export function pathDisplayName(gameId, levelShort, path) {
  return ann[gameId]?.paths?.[levelShort]?.[String(path.id)]?.name || path.name || null;
}

// a curiosity about a path that its name can't carry, or null
export function pathNote(gameId, levelShort, path) {
  return ann[gameId]?.paths?.[levelShort]?.[String(path.id)]?.note ?? null;
}

// what players call a path, where the map has adopted their name, or null
export function pathNickname(gameId, levelShort, path) {
  return ann[gameId]?.paths?.[levelShort]?.[String(path.id)]?.nickname ?? null;
}
