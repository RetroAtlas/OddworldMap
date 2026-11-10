# 52. Memoize the search index

**Status:** shipped 2026-07-26 · **Effort:** small (viewer, performance) · **Where:** anywhere, viewer-only · **Filed:** 2026-07-24/25 review

## Symptom

Every keystroke past the 160 ms debounce rebuilt the searchable text for all 16,217 TLVs from scratch. Measured in bare Node over the shipped data at the time of the review: 17–30 ms per query (`mud` 30 ms, `slig` 17 ms, `switch_id=70` 18 ms). A mid-range phone is several times slower, so this is a 100–300 ms main-thread block per debounce tick — visible jank while typing, on the surface that is meant to feel instant.

## Cause

`tlvSearchText` in [js/search.js](../public/js/panels/search.js), called inside a four-deep scan. Each call runs `fieldEntries` → `Object.entries(t.fields).sort(localeCompare)` → a `prettify` per field (two object lookups plus a `resolve`) → a `map`/`join` → `toLowerCase`. The `localeCompare` sort in particular is not cheap at this multiplier.

## Sketch

The blob depends only on `(tlv, game, raw)`. `tlv` and `game` are stable for the session; `raw` is a single global boolean. So one cache per representation, keyed by TLV identity:

```js
const indexCache = { raw: new WeakMap(), pretty: new WeakMap() };
```

`WeakMap` means no invalidation is needed when datasets are replaced or a path is dropped. Two maps rather than one keyed by a composite string avoids building a key per lookup, which is the thing being optimised away.

## Watch out — this is the whole trick

The blob must be independent of `fieldPrefs`. It already is: the index deliberately passes `{mode: "all"}` so every field is findable regardless of what the user displays. Do not let a future change thread `prefs` into `tlvSearchText`; if that ever becomes necessary the cache must be keyed by it or dropped. Say so in a comment at the cache — exactly the kind of durable invariant a comment earns its place for.

The `settings-changed` listener re-runs the search on `rawValues`. With two maps that is already correct — the other map is simply used. No cache clearing anywhere.

`hitButton`'s matched-field append calls `fieldEntries` again per rendered row, but only for the ≤8 rows per group actually shown. Leave it; caching there buys nothing.

## Verify

Expect the second and subsequent queries to drop from ~20 ms to ~2 ms — the remaining cost is the substring pass, which is the irreducible part.

## Shipped

As sketched, in *Cache the searchable text per object* (`22c5ccd`) — two `WeakMap`s, one per representation, under the name `searchTextCache` rather than the sketch's `indexCache`. The prefs-independence the whole trick rests on is written in a comment beside them, and `hitButton`'s per-row `fieldEntries` call was left alone. The changelog judgement below resolved as no entry — the commit touches `js/search.js` and nothing else.

## Ships with

No changelog entry — the performance improvement shipped without a player-facing announcement.
