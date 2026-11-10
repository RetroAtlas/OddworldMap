# 89. What the packed layout still misreports

**Status:** shipped 2026-08-31 — the counting half last; the lines 2026-08-15, the marker boxes 2026-08-18 · **Effort:** small (viewer) · **Where:** anywhere, no disc · **Filed:** 2026-08-14, out of the camera-window work

## What it is

Both games address cameras on a grid coarser than the screen, and the map lays the screens edge to edge, folding the slack between windows out of existence. Objects authored in that slack now say so: a marker draws solid where it covers screen and dotted where it does not. Two surfaces still speak as though the slack were not there.

**Collision lines.** 2385 of AO's 5790 line endpoints sit in the slack, and 665 of AE's 13290. A floor line drawn across a gap is one continuous stroke that silently skips 656 world units, and the ruler measuring along it reports the packed distance rather than the real one. `worldLen` says so in [js/state.js](../public/js/data/state.js), and that is the whole of the disclosure.

**Per-screen counts.** The screen list and the numbers panel bucket a marker by its drawn centre, so one folded onto a neighbour is counted there: 619 of AO's 5623 markers are tallied under a screen they cover no part of, against 2 of AE's 10602. Of AO's, 457 cover screen in some other cell and 162 cover none anywhere. Reproduce by bucketing each marker under `cellAt(markerCentre(t))` and asking whether `screenRuns` puts any of its on-screen coverage in that cell. Pin the boundary or the answer moves: a column is half-open at the top, so a run `[a, b]` covers column `c` when it overlaps `[c·W, (c+1)·W)` in positive length, or when `a === b` and that point falls inside. Sampling a run by its upper endpoint instead floors into the next column and drops the cell the marker really covers. A marker whose centre lands in the slack is counted under no screen at all and is not in the figure, which is a separate 415. The row carries an `offscreen` tag where nothing of it is on screen at all, but the header count and the By-the-numbers screen tier still count it where it landed.

**A marker box framed by its own two ends.** A span reaching into the slack can have its ends fall in different cells, and then neither its size nor its position survives: a span lying wholly in the slack folds to less than nothing and the degenerate-rect guard draws a 10px stub, while one straddling a screen's top or left edge keeps a plausible size but sits away from the screen it covers, so the solid clip lands outside the box and the dotting comes back inverted. 24 markers of the first kind, 280 axes of the second, almost all AE. This is the same defect `lineRuns` fixed for lines, and takes the same remedy: frame the box by the screen it covers. Unlike the two above it is a plain defect rather than a question, and it predates the marking work.

## Decided: the packing itself stays

The slack is not level the player ever occupies. A camera change teleports the character across it with the within-cell offset preserved (`VOnPathTransition_401470` in AO, `vOnPathTransition_408320` in AE), so nothing walks it and the games render none of it. Folding it away is a truthful compaction, not a lie, and the map is far more readable for it.

**Ruled out: laying the screens out at their true world pitch as the default.** Measured 2026-08-14 over the shipped data: AO's largest path, `C1 P1`, goes from 3680x2400 draw units to 10240x4800, 5.6x the area, nearly all of it empty. AE barely moves, 1.1x, its slack being 7x20 against AO's 656x240. A default that makes Oddysee five times emptier to browse buys back space no one can stand in.

It shipped as a Display toggle instead, off by default. See *Shipped: the spacing toggle* below.

## Sketch

The two halves want different answers and should not be bundled into one change.

- **Lines**: the marker treatment ported over, a stroke that dots across the folded gap. The complication markers do not have is that a line is not a rect, so the split is per-segment rather than a clip, and `screenRuns` in [js/model.js](../public/js/model/model.js) answers about spans rather than points. Whether the ruler should then report the true distance is a separate question with a worse answer than it looks: the honest number counts ground nobody can cross.
- **Counts**: bucket by coverage rather than by drawn centre, so a marker is counted under each screen it actually covers, or under none. That is a change to `inCell` in [js/census.js](../public/js/data/census.js) and the matching rule in [js/campanel.js](../public/js/campanel.js), which CLAUDE.md requires to agree. It also makes a straddling marker countable twice, which is either right or a new lie depending on what the count is for.

## Watch out

The counting rule is load-bearing for two surfaces that are pinned against each other, and the screen list is the touch device's only inspection surface. Changing what a screen holds changes what a phone user is shown, so the tag and the count should end up saying the same thing rather than a third one.

## Shipped: the lines 2026-08-15, the marker boxes 2026-08-18

`lineRuns` in [js/model.js](../public/js/model/model.js), in *Collision lines dot where they leave the screen*, `87e4f57`. A line is cut wherever it crosses a window edge on either axis, each piece drawn solid or dotted by whether its midpoint is on screen. 1740 of AO's 2895 lines are dotted somewhere, and 812 of AE's 6645.

Three things the sketch guessed at turned out differently.

**A piece in the slack has to be framed by the screen it touches, not by its own ends.** AO's slack straddles a cell boundary, so a piece framed end by end is transformed under two different cells and comes back reversed, drawn backwards across most of a screen. It affected 43 AO pieces and 75 AE ones. What settles it is that the slack has no draw position of its own: a piece there is drawn rather than located, so the only frame with any claim is the one belonging to the screen it hangs off.

**Diagonals needed no special case.** The sketch worried that a line is not a rect, so the split could not be a clip. True, but the transform is a *translation* within a window, so a diagonal maps exactly and stays straight as long as the cut lands on the window edge rather than on a lerp of the drawn endpoints. The 43 AO and 105 AE diagonals that cross slack come out exact, and the general algorithm was no harder than the axis-aligned one it would have replaced.

**A line crossing the slack whole needs nothing dotted**, and the fold that says so has to be read off the neighbouring spans rather than off the points bounding it. A line ending exactly on a window edge touches that screen at one point and covers none of it, so what it leaves is an overhang; asking the endpoint instead collapses 352 AE lines' overhangs into nothing. The merge that follows also keeps a background line's dash pattern from restarting mid-line.

The marker boxes went with them, in *A marker box in the slack keeps its own extent*, `c060c2a`, and then *Frame a marker box by the screen it covers, not by its own ends*, `9a4b65d`, three days later. `drawSpan` gives a box the leading overhang, the screen it covers and the trailing overhang, framed by that screen. It is the same rule `lineRuns` follows, and stating it once for both is what makes it a rule rather than a pair of guards: what lies in the slack has no draw position of its own, so it answers to the frame of the screen it hangs off.

Every surface anchored on the box reads the same helper, `drawBox`, or its centre. A wire, a hover test, a highlight ring or a screen tally derived from the ends separately agrees with the box only while nothing folds, which is why it read as correct for as long as it did.

The rule has two halves and each is worth getting wrong on its own. Frame the box by its own two ends and it walks off the screen it covers, so the solid clip lands outside it and the dotting comes back inverted: 280 axes, all but two of them AE. Take its width by summing the screens under it and it comes up a slack short per boundary crossed once the layout is spaced, where that slack is canvas rather than folded away: 1433 AE markers and 2 AO. The drawn distance between the span's first and last on-screen point answers both at either pitch.

That second one is invisible packed, which is what the sweeps running at both pitches is for. A rule that collapses the slack unconditionally is exactly right until the slack is given draw space, and `lineRuns` had already been taught the same lesson.

The sweep that pins it calls the same helper the renderer does. An invariant test that reimplements the thing it checks passes whatever the shipped code does, which is the failure mode worth avoiding here: the defect it guards was invisible for as long as it was because nothing ever asked whether a drawn box pointed the right way.

## Shipped: the spacing toggle, 2026-08-15

"Gaps between screens", off by default, in *Spread the screens onto the grid the games address them on*, `e4dffbd`. `setSpacing` in [js/state.js](../public/js/data/state.js) swaps the pitch for the cell's own, and `setPitch` in [js/navigate.js](../public/js/navigation/navigate.js) carries the view, the ruler and the route across it.

It cost far less than the estimate, because three things the sketch expected to pay for were already true. The transform degenerates to `dX(wx) = wx - winX` rather than needing a second one. `col * CELL_W` is where the window's corner lands at either pitch, so the artwork needed only its drawn *size* corrected from the cell to the window, which is a no-op packed. And permalinks needed nothing at all: coordinates were already world, and zoom is px per world unit inside a screen in both, so a link means the same place at the same magnification either way. That last one is the world-coordinate change paying for itself.

The one part that did need building is the round trip, because it is the only place a bug could stand a user's own work: a route plotted, the pitch flipped, the waypoints landing somewhere else. It is pinned both ways in `tests/unit/state.test.js` and checked end to end in the browser, where packed to spaced and back returns the permalink byte for byte.

**Ruled out: making the ruler report the true distance.** Left measuring the packed distance. The number it gives is the distance along the map as drawn, and the alternative charges for ground the engine teleports across. Dotting the lines makes the fold visible, which makes that behaviour discoverable rather than more wrong, so the case for changing it got weaker rather than stronger.

## Shipped: the counts, 2026-08-31

In *Bucket a screen's objects by the cell they are authored in*, with the tap rule beside it in *A tap on an object opens the screen it belongs to*. The verdict is a third answer the sketch never weighed: not the drawn centre and not coverage but the world cell. A screen is a cell — the camera window plus the slack around it — and an object belongs to the cell its authored top-left sits in, which is `tlvCell`, the same cell rule destination resolution has always used. Every marker resolves to exactly one cell, so the double-counting fork the sketch worried over never existed to need a verdict.

Re-measured 2026-08-30 against the shipped helpers, the swap moves 631 of AO's 5623 markers and 869 of AE's 10602, and gives the 415 whose drawn centre lands outside the grid the home they never had — a different predicate from the figure above, which counts markers listed under a screen they cover no part of. Not one of AO's 111 DeathDrops was filed under its own screen; 108 now are. The count also stops moving with the pitch: the old rule re-bucketed 631 AO markers whenever the spacing toggle flipped, where `tlvCell` reads only world units.

The tag and the count now say the same thing, which is what the *Watch out* asked for: a row is filed under the screen its object belongs to, and `offscreen` says why nothing of it is visible there.

What the rule costs is stated rather than smoothed over. An object authored in a cell holding no camera — 6 in AO, 387 in AE, every AE DeathDrop among them — belongs to a cell that is no screen, so no screen lists it; search, the tooltip and the numbers panel still reach it, and most were unlistable before too, their drawn centre landing in the same empty cell.

The tap rode along because the counting change would otherwise have broken it: tapping a marker opens the screen it belongs to rather than the screen under the finger, the whole point of the tap being to inspect the object, and falls back to the screen clicked when the object's cell holds no camera. That retires the rule that any click dismisses on the void — a click carrying no object still does, but one landing on a marker drawn over the slack now answers, which spaced out is the only way touch can inspect one.
