// Query parsing for the search box: tokenise into OR-of-AND groups so terms
// match independently across the "name + fields" blob (they need not be
// adjacent). Space = AND, comma or the word "or" = OR; a bare "and"/"or" is an
// operator wherever it sits and never a term.

// "Mudokon state=chisle" -> [["mudokon", "state=chisle"]]; "Slig, Slog" and
// "Slig or Slog" -> [["slig"], ["slog"]]. Only whitespace-delimited and/or are
// operators, so substrings like "hand" are untouched; "=" is never split, so
// field=value stays one term.
export function parseQuery(q) {
  return q
    .toLowerCase()
    .split(/\s*,\s*|\s+or\s+/)
    .map((g) => g.split(/\s+/).filter((term) => term && term !== "and" && term !== "or"))
    .filter((g) => g.length);
}

// the distinct terms across every group; never empty strings, so substring
// scans over them can't stall
export const queryTerms = (groups) => [...new Set(groups.flat())];

// the AND-within-OR shape over any per-term test
export const matchesBy = (groups, has) => groups.some((g) => g.every((term) => has(term)));

// text (the already-lowercased blob) matches when any group's terms all appear
export const matchesQuery = (text, groups) => matchesBy(groups, (term) => text.includes(term));

// best (lowest) name-match rank across the terms: exact, prefix, substring, else 3
export function rankFor(name, terms) {
  const n = name.toLowerCase();
  let best = 3;
  for (const term of terms) {
    const r = n === term ? 0 : n.startsWith(term) ? 1 : n.includes(term) ? 2 : 3;
    if (r < best) best = r;
  }
  return best;
}
