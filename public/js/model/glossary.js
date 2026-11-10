// Curated plain-English field meanings from glossary_fields.json, resolved in three
// tiers so a field is defined once at the broadest level that fits:
//   byType["Type.field"]   — one object type's own meaning (wins)
//   byGameType["GameType"] — every object whose field has that game type (the
//                            group; Slig/SligSpawner/SligGetPants share one)
//   byField["field"]       — same meaning wherever the name appears (globals)
// The units section repeats those tiers, so the unit a value is measured in sits
// in the same file as the sentence asserting it and at the same specificity.
// The caller supplies the field's game type (from field_types), so this module
// needs no other. Leaf module: no imports, importable in bare Node.

const emptyTiers = () => ({ byType: {}, byGameType: {}, byField: {} });

let gloss = { ...emptyTiers(), units: emptyTiers() };

// keep only string->string entries in each known tier; anything else is
// dropped, so a missing, garbage or future-shaped file can never break the viewer
function sanitizeTiers(raw) {
  const out = emptyTiers();
  if (!raw || typeof raw !== "object") return out;
  for (const section of ["byType", "byGameType", "byField"]) {
    const src = raw[section];
    if (!src || typeof src !== "object") continue;
    for (const [k, v] of Object.entries(src)) if (typeof v === "string" && v) out[section][k] = v;
  }
  return out;
}

export function sanitizeGlossary(raw) {
  return { ...sanitizeTiers(raw), units: sanitizeTiers(raw && raw.units) };
}

export function setGlossary(raw) {
  gloss = sanitizeGlossary(raw);
}

const resolveTier = (tiers, type, field, gameType) =>
  tiers.byType[`${type}.${field}`] ??
  (gameType ? tiers.byGameType[gameType] : undefined) ??
  tiers.byField[field] ??
  null;

// the meaning for a field, most-specific tier first, or null
export function glossaryProse(type, field, gameType) {
  return resolveTier(gloss, type, field, gameType);
}

// the unit a field's value is measured in, or null. The vocabulary belongs to
// the renderer, so a word it doesn't format leaves the value raw.
export function fieldUnit(type, field, gameType) {
  return resolveTier(gloss.units, type, field, gameType);
}
