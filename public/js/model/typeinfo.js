// Curated plain-English object-type meanings from glossary_types.json: one paragraph
// per type name, game-agnostic — where the games differ, the prose says so.
// The first sentence is the summary, carried alone where space is tight.
// Leaf module: no imports, importable in bare Node.

let info = {};
let summaries = {};

// keep only string->string entries of the known section; anything else is
// dropped, so a missing, garbage or future-shaped file can never break the viewer
export function sanitizeTypeInfo(raw) {
  const out = {};
  const src = raw && typeof raw === "object" ? raw.types : null;
  if (!src || typeof src !== "object") return out;
  for (const [k, v] of Object.entries(src)) if (typeof v === "string" && v) out[k] = v;
  return out;
}

export function setTypeInfo(raw) {
  info = sanitizeTypeInfo(raw);
  summaries = {};
}

// the whole curated paragraph, or null
export function typeProse(name) {
  return info[name] ?? null;
}

// the paragraph's first sentence, or null
export function typeSummary(name) {
  let s = summaries[name];
  if (s === undefined) {
    const prose = info[name];
    s = summaries[name] = prose ? (prose.match(/^.*?[.!?](?=\s|$)/s)?.[0] ?? prose) : null;
  }
  return s;
}
