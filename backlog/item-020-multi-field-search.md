# 20. Multi-field search (AND / OR)

**Status:** shipped 2026-07-24 · **Effort:** small-medium · **Where:** anywhere, viewer-only

## What and why

Search substring-matched the whole "name + fields" string as one blob, so a two-term query failed whenever the terms were not adjacent in it: `Mudokon state=chisle` returned nothing, because `scale=0` sits between the name and `state=` in the full-field index. The natural way to search is two terms — "chiselling mudokons" is `Mudokon state=chisle`, "sligs or slogs" is `Slig, Slog`.

## Sketch

Tokenise the query — **space = AND** (every term must appear somewhere in the text), **comma = OR** (any term), plus a literal `or` — and combine as OR-of-AND groups. `tlvSearchText` already builds the full-field string, so this is query parsing plus the match loop, and a hit's rank is the best rank among its matching terms.

The open question at filing: labels contain spaces, so a space-means-AND rule needed thought. It resolved itself — a label like `job=sit chant` still matches, because its words are AND terms against the same blob, and requiring both is what the reader meant anyway.

Watch out: don't split the `field=value` syntax on `=`, and keep highlighting each matched term in the result row.

## Shipped

Queries tokenise into OR-of-AND groups, each term matched independently against the blob. `=` is never split, so `field=value` stays one term. Rank is the best name-rank among the terms, and `highlight` marks every occurrence of every term, merging overlaps.

The pure parsing and matching — `parseQuery` / `queryTerms` / `matchesQuery` / `rankFor` — lives in a new DOM-free [js/searchquery.js](../public/js/ui/searchquery.js) so it can be unit-tested, which `search.js` itself cannot be in bare Node. The hidden-match append now explains each missing term rather than one.
