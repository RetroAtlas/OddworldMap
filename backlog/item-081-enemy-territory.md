# 81. Enemy territory rendering

**Status:** shipped 2026-08-09 · **Effort:** small-medium (viewer) · **Where:** anywhere · **Filed:** 2026-08-07 feature-ideation sweep

## Why

The invisible walls that pen enemies in are in the data and on the map, but unreadable: `SligBoundLeft` / `SligBoundRight` (186 + 175 in AO), `EnemyStopper` (156 AO, 150 AE) and `ScrabNoFall` all land in the Meta bucket, off by default, and when switched on they render as anonymous grey boxes indistinguishable from `ShadowZone`s. "How far can that Slig chase me?" is exactly the question a route reader is asking, and the answer is sitting in the default-off pile wearing a disguise.

## Sketch

- Phase 1 is a *reading*, not new data: draw the bound types as what they are — a vertical barrier line spanning the marker's height (or the camera's, where the marker is a sliver), dashed, in the enemy category's colour, with a small left/right tick for the side it blocks. Visibility rides the Enemies category toggle rather than adding a new one: the barriers are enemy semantics.
- The types stay in their current category buckets for filtering and search; only their rendering specializes. The tooltip already names them.
- Phase 2, only if wanted: infer a patrol band per Slig — the span between the nearest facing bound pair in its camera row — and shade it faintly on hover. That is an engine-behaviour claim, not a data dump.

## Watch out

- Phase 2's pairing rule must come from the decomp, not from eyeballing: which bound stops which enemy kind (`EnemyStopper` carries fields; `SligPersist` is a different concern entirely), and whether bounds act path-wide or per camera. Do not ship a shaded band on a guess — a wrong band is worse than no band, and [71](item-071-mudokon-rescue-census.md) is the standing example of a field that did not mean what it looked like.
- AO and AE name and split these types differently; match by name per game and keep the drawing rule shared.

## Shipped

_The pens enemies patrol are on the map_: barrier posts for SligBound/ScrabBound/EnemyStopper/MovingBombStopper (dashed, enemy colour, a foot pointing into the pen), and the hover pen for Sligs and SligSpawners — both phases at once, because the decomp settled what the sketch could only guess at.

Where the sketch was wrong, read from `Slig.cpp` before building:

- The pairing is **by id**, not "the nearest facing pair in the camera row": a slig's `slig_bound_persist_id` matches its bounds' id (named `slig_id` in AO, `slig_bound_persist_id` in AE) over a camera window of ±2 cells in AO and ±3 in AE. The zone is the x-span between the pair's top-left corners; it has no y component at all. The viewer honours only a unique pair, and skips the seven AE pairs whose right bound sits left of the left one — 149 of AO's 186 penned sligs and 267 of AE's 323 get a pen; the engine's last-match-wins on duplicates is not worth imitating.
- `ScrabNoFall` is not a barrier: its markers are wide zones (median 125 units), so it stayed a nav box. `MovingBombStopper` and the Scrab bounds joined instead — but Scrab bounds ship no ids, so scrabs get posts and no pen.
- `EnemyStopper` carries a `stop_direction` field (left / right / both), so its foot comes from the data rather than the name.
- `markerShown` in [js/config.js](../public/js/config.js) became the one marker-visibility rule (drawing, hover, ruler snapping), so a barrier shown by the Enemies toggle is also hoverable and snappable — drawn and pointable stay the same set.

- The whole treatment sits behind the "Enemy patrol pens" Display toggle (`p` — initially shipped as a Settings row, but a lens you flip mid-reading is Display ink), **off by default**: hundreds of posts are clutter for anyone not reading patrol ranges. Pens off, barriers are the plain meta boxes they always were.
- The posts stand on each stamp's top-left x — the boundary the engine actually enforces, and the edge the pen band is built from, so posts and band always meet; a centred post would stand half a stamp off the band on both sides. Snapping follows the line too.

## Grown since filing

**The pen takes the engine's last match, 2026-10-08.** The patrols ([94](item-094-live-map.md)) walk a Slig between the last bound of each side that shares its id, which is the engine's own pick: Slig.cpp's scan overwrites the zone on every match, and every path lists its objects in camera order. A pen kept to a unique pair showed nothing for the 29 Sligs and spawners with a duplicate, though the patrolling ones among them walk between definite posts, so the pen reads the same pick (`sligBounds` in [js/model.js](../public/js/model.js)) and is drawn wherever the pair stands, another Slig's pair included; a side with no bound or a pair inside out still pens nothing. 163 of AO's 186 penned sligs and 282 of AE's 323 get a pen, counted by `patrolZone` over the shipped data on that date.
