# 86. World graph

**Status:** shipped 2026-08-24 · **Effort:** large (viewer, product) · **Where:** anywhere · **Filed:** 2026-08-07 feature-ideation sweep

## Why

Every cross-path and cross-level link is already computed and trusted ([40](item-040-validate-destinations.md)): the entry badges, the stub labels and the follows are all local glimpses of one graph nobody can see whole. A "how the game hangs together" view — every path a node, every door/well/portal/transition an edge — is the metro map of each game: navigation aid, completeness statement and the site's single most shareable artifact. It is derivable entirely from committed data; the work is presentation, not extraction.

## Sketch

- Aggregate: nodes are paths (AO 74; AE 92 with the 25 demo paths hidden per the setting — counted 2026-08-07 from the shipped data), edges are path→path with a count and the set of kinds (door / well / portal / transition), built from the same `destOf` + `destTrusted` walk `computeEntryPaths` does — one pass at boot per game, cached.
- Layout is the hard part and hand-tuning is legitimate: a column per level, in progression order where the transition graph can derive it, paths stacked within their column, edges bundled. [15](item-015-path-buttons-game-order.md) shipped a column whole: `levelOrder` in [js/pathorder.js](../public/js/model/pathorder.js) is the within-level walk in play order, and `levelEntry` says which path a column starts on. What it leaves is the order of the columns themselves, and a hub's spokes, which it lists by path id because nothing in the data ranks them. A force layout will produce spaghetti; don't start there.
- Surface: its own full-canvas mode (the map swaps out, the sidebar stays), not a dialog — the graph *is* a map. Click a node → `jumpToPlace`; hover an edge → the objects it aggregates. Colour edges by kind with the `CONN_COLORS` palette so the two views share a vocabulary.
- Phase 1 could be per-level: the current level's paths and their external stubs, opening from the level heading — smaller layout problem, immediate value, and it exercises the aggregation the full view needs.

## Watch out

- Demo paths sit outside the reachable graph; follow the setting and the entry-path rules rather than inventing reachability of its own.
- Ender levels make the AE graph honest but strange (the same geography appears twice under two ids); label sections the way the path buttons do rather than merging what the game keeps distinct.
- The graph must not contradict the pinned link counts in `tests/unit/map-data.test.js` — those tests are the aggregation's oracle, and a mismatch is a bug in the graph, not in the pins.

## Shipped

The whole graph, not the per-level phase: the layout turned out to be free, so the sketch's "smaller layout problem" bought nothing. `data.levels` is already progression order and `levelOrder` is already the within-column order, which left only the routing to design — and once that was written, one level cost the same as fourteen.

- **The rows are the play-order walk whatever the setting says.** It is the diagram's own geometry rather than a listing preference: summing |row(a) - row(b)| over the 62 and 86 undirected pairs inside a column, on the rows the diagram draws, the walk comes to 125 against the stored order's 181 in Oddysee and 227 against 406 in Exoddus, and leaves one interleaved pair of arcs per game. A diagram laid out on the stored order by default would have been the worse one by default.
- **The columns are `data.levels` order, and the backward edges are drawn backwards.** A minimum-feedback-arc-set search over every column ordering gets both games down to 4 backward crossings against `data.levels`' 6 and 5, and the orderings that manage it are progression nonsense (Paramonia Escape before the temple it escapes). Six lines pointing left is information; a reordered column strip is a second answer to a question the sidebar has already answered.
- **Straight lines lose on the count that matters.** Centre to centre they pass through a box belonging to neither of their ends on 36 of Oddysee's 77 lines and 54 of Exoddus' 97; the lane-packed orthogonal routes do it on none, pinned on both axes. Crossings barely move — 76 to 41 in Oddysee, 27 to 29 in Exoddus — which is why the boxes are what was worth measuring. A tally of boxes rather than of lines is not worth quoting: it moves by one or two with the crossing predicate, which is how three people came to three answers for it. `tests/unit/worldgraph.test.js` sweeps the shipped data for a route that leaves the diagram, crosses a box, bends off-axis or shares a line with another.
- **Nodes are DOM buttons and edges are SVG**, which is what buys the keyboard, the ellipsis, the focus ring and `data-tip` for nothing. At a 190px box no gameplay path's name is cut in either game; thirteen of the demo copies' are, their names carrying the `[Demo] ` mark on top of the name they copy, and the tooltip carries those whole.
- **It rides the hash** as a bare `graph` token in the tail — the item's claim about the artifact being shareable is worth nothing otherwise, and it is what makes the back button close the mode. Older deployed viewers drop an unknown tail token and open the map at the view the link names.
- The aggregation is the same `destOf` + `destTrusted` + `pathIn` walk, so the pinned cross-level follows in `tests/unit/map-data.test.js` are its oracle and the new test expands the graph's crossings back to exactly those strings.

- **An arrowhead marks a one-way link and nothing else.** A head on each end a pair can be travelled towards is 307 of them across the two games, 266 of which say "ordinary"; marking the 41 one-way pairs alone spends the mark on the fact worth a glance. The tooltip states the direction either way.
- **Every edge leaves its box on a line of its own.** Departing at the box's middle put 154 pairs of Oddysee segments and 235 of Exoddus' exactly on top of each other, each pair a stretch of line whose colour was whichever edge painted last. Three quarters of Exoddus' sat at the seven nodes of degree seven and up that the diagram exists to show, while Oddysee's split about evenly with the rest — so the fix is every box's business rather than the hubs'. Spreading the departures across the box's height, up-bound above down-bound, takes both counts to zero and leaves the crossings, the lanes and the diagram's size untouched.

## Ruled out

- **Bundling a hub's spokes into one trunk.** It would take the Scrabanian Temple's Trials hall from eight lanes to two, but the arcs are already laminar — one interleaved pair per game — and once the departures are spread, a fan reads as a fan without it.
- **A drawn marker for Exoddus' two halves.** `{MI, NE, PV, SV}` and `{FD, BA, BW, BR, BM}` share no edge, and it is tempting to caption the seam. But three of the ten Exoddus gutters carry no cross-column edge, so "nothing crosses here" cannot single out the one that matters; the absence of lines is what an absence should look like, and the README says it in words.
- **A dot on a box that carries a note.** The place chip has one, the path buttons do not, and the diagram's face answers to the buttons; the note is in the tooltip.
- **A per-level view of its own.** The current level's column is where the diagram opens, so the phase-1 surface is a scroll position rather than a mode.
- **Reordering rows to cut crossings.** A barycentre sweep saves 14 cross-column crossings in Oddysee and moves 44 of its 74 paths off the row the path buttons list them on. Two surfaces disagreeing about the order of a level's paths is the defect, not the crossings.
- **Wrapping the columns into bands** to fill the 29%/40% of the grid the short columns leave empty. It wraps a third of the cross-level edges across a band boundary and gives up left-to-right-is-progression, which is the column axis's whole content.
- **A Places-group answer for "graph".** The diagram is a view of the map, not a place inside it, and search answers for the places.

## Still open

Edge bundling for the long hauls, and a clickable list of the objects an edge aggregates. Saving the diagram as an image turned out to be a question of its own and is [90](item-090-export-the-world-graph.md).
