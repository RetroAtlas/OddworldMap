# 60. Search should know place names

**Status:** shipped 2026-08-06 · **Effort:** small (viewer, product) · **Where:** anywhere, viewer-only · **Filed:** 2026-07-24/25 review

## Symptom

Searching `monsaic`, `paramonia`, `zulag 2`, `feeco` or `necrum` returns **zero hits**. `tlvSearchText` in [js/search.js](../public/js/search.js) indexes object name plus decoded fields only — level and path names are not in the index at all. Those are the words a player reaches for first, and the sidebar's level and path buttons are the only way to use them.

## Sketch

Add a "Places" group rendered *above* the object groups in `runSearch`:

1. Build the candidate list from `state.games` → levels → paths: for each level, `L.short` and `L.name`; for each path, `pathDisplayName(G.id, L.short, P)` plus the `LV Pn` code form.
2. Match with the existing `matchesQuery` against a lowercased `"<short> <name> <path label>"` blob, and rank with `rankFor`.
3. A hit renders as `AO · L1 P3 — The Chant Gate` and on click selects that path — reuse `selectPath` through a small exported helper rather than duplicating the selection logic.
4. Respect the scope bar: "Places" is meaningless under `path` scope, so hide the group there, or under `level` scope show only that level's paths.

## This gets better for free as annotations land

Reading through `pathDisplayName` ([js/annotations.js](../public/js/model/annotations.js)) means the curated-name-overrides-in-game-name precedence is already handled, and every path name added under [12](item-012-curated-path-names.md) becomes searchable with no further code change. That is the reason to route through `pathDisplayName` rather than reading `P.name` directly.

[77](item-077-what-a-place-is-known-for.md) settled on a `nickname` — the players' name for a place, read by `pathNickname` — and shipped nine of them on the Brewery's zulags. They belong in the same blob as the name, and are the half of this that reaches a player who knows what a place is like but not what it is called: `tear extractors`, `high security` and `industrial machines` are now in the file and findable the moment a Places group exists to hold them. Measured 2026-08-04, before they landed: `tear`, `x-tractor` and `high security` returned nothing, while `slig` alone returns 819 object hits — which is why the Places group has to be counted and capped apart from the objects rather than merged with them.

## Coverage — read the data, not the number below

At the review this recorded AO at 41 of 73 curated and AE at **0 curated, 104 unnamed**, and concluded the feature would be "mostly a level-name search" on Exoddus. **That is no longer true and was the review's most stale figure.** Measured 2026-07-31, AE is at 114 of 117 paths curated, and no AE path carries a disc `name` at all, because [38](item-038-path-section-tag.md) moved the thirteen ender labels into `section`. Recompute from the shipped data before sizing this; [12](item-012-curated-path-names.md) holds the current counts.

## Watch out

**Group ordering and the hit cap.** Places must not consume the `HIT_CAP` budget or the per-group `GROUP_MAX` slots meant for objects; count and cap it separately. There are only ~200 places, so no cap is really needed.

**The summary line** prints a per-game object hit count. Decide whether places count toward "N hits" — the recommendation is no: keep the summary about objects and let the Places group carry its own count in its header, the way the other group headers already do.

**The empty query path.** `runSearch` bails under 2 characters; keep that.

## Verify

`monsaic` → the L1 level and its paths. `zulag 2` → AO R2's four Zulag 2 paths. `slig` → unchanged object behaviour, no Places group. `P3` → sensible, not noise.

## Ships with

A README search bullet update and a `changelog.json` entry, tag `new`.

## Shipped

[js/placesearch.js](../public/js/data/placesearch.js) builds one candidate per level and per path — 214 across both games — and `runSearch` renders the matches as a Places group above the object groups, `jumpToPlace` in [js/navigate.js](../public/js/navigate.js) taking a click on one (a level opens on the first path it lists).

**The sketch's single blob does not work, and it fails quietly.** Matching `"<short> <name> <path label>"` as one lowercased string hands the `2` in `zulag 2` to the `R2` that every Rupture Farms Return path sits in: the query returns all eighteen, and the four the game itself calls Zulag 2 arrive buried among them — the *Verify* line's own case, inverted. A candidate therefore carries two indexes: the names by substring as sketched, and the `LV Pn` code as whole tokens (`["r2", "p1"]`) that answer a term only in full. `matchesBy` in [js/searchquery.js](../public/js/ui/searchquery.js) is the seam, with `matchesQuery` redefined through it so the AND-within-OR semantics stay written once.

A path does index its level's name, so `monsaic` returns L1 *and its paths* — but `rankPlace` leaves that name out, which is what keeps the level's own row above the five it just pulled in.

**Coverage, recomputed 2026-08-06** as this asks: AO is at 41 of 73 curated with 18 more named by the disc (R2's zulags among them), AE at 114 of 117 with no disc name anywhere. Neither game is "mostly a level-name search". [77](item-077-what-a-place-is-known-for.md)'s nine nicknames and [38](item-038-path-section-tag.md)'s thirteen sections came along as predicted — `tear extractors`, `high security` and `ender` all land.

**Two departures from *Watch out*.** The group *is* capped, at the object groups' own `GROUP_MAX` and behind the same "show N more": `brewery` matches 25 places and `trial` 23, which uncapped push the object results the same search is showing off the screen. It still spends nothing the objects were budgeted — separate group, separate slice, separate count. And the summary needed a second empty phrasing after all: a places-only query like `monsaic` printed "no hits" under six rows, so it now reads `no object hits` whenever places are on screen.
