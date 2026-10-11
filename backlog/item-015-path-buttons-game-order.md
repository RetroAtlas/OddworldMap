# 15. Path buttons in game order

**Status:** shipped 2026-08-21 · **Effort:** small (a setting) · **Where:** anywhere, viewer-only

## What and why

Path buttons sort by id, which has little to do with walking a level: the Stock Yards store their entrance last, and R2 shows Zulag 2/4/3/3… before Zulag 1.

## Sketch

A setting to sort them by in-game progression where derivable: entry paths first, then a walk of the transition graph (`computeConnections`/`computeEntryPaths` already know the edges); fall back to id order for paths the graph can't order.

Both preconditions this needed have cleared: [40](item-040-validate-destinations.md) made the entry sets sound to sort by, and the Exoddus names are in. Curated names grouping identically (all "Zulag 3 — …" adjacent) may still get most of the value cheaper — but [38](item-038-path-section-tag.md) moved the ender tag out of the name into `section`, so for those thirteen the grouping key is the section, not a prefix on the name.

## Shipped

**The walk, with the curated names deciding its branches rather than replacing it.** `levelOrder` in [js/pathorder.js](../public/js/pathorder.js) walks a level's own trusted transitions out from one elected way in and lists each path where the walk first meets it. "Paths in play order" in Settings, off by default, routed through `visiblePaths`, which is the one place a level's path order is decided. `orderPaths` sorts only what it is handed by that whole-level order, so the demo setting can change what is listed and never what the order is.

**The area is the unit the walk moves in.** An area is a path's name with the `[Demo] ` mark and anything after a colon dropped, which pools a secret area, a sub-room and a demo copy with the area they name; a path the discs never named is an area of one. An area is finished before the walk leaves it, and that is what holds Zulag 1's five paths together where the way on out of it sits two rooms in with a dead end still unvisited behind it — a plain depth-first walk leaves for Zulag 2 and comes back for the dead end afterwards.

**Branches are chosen by the run the level counts itself in** — the numbered run naming the most of its areas, so the Brewery counts in zulags rather than in its three hubs, and numbers never compare across runs. The branch whose number comes soonest goes first, and that is the whole of the hub structure: FeeCo's unnumbered corridor precedes the terminal beside it because terminal 3 is behind it, and the Brewery's hub 2 waits for the five zulags hub 1 serves instead of jumping the queue on its own number 2. A branch reaching no number at all is a pocket off the route, looked into before the walk moves on, which is the Mudomo Vault's third room. Only then the lowest path id.

**Inside an area, the same walk again, and the pocket rule with it.** A path you can only come back from goes before one that carries you on, and a way out of the level carries on like any other: Rupture Farms Return looks into Zulag 1's Boom Machine room on the way past, while its Zulag 4 exit to the Board Room waits for the two rooms that unlock it. Those, with Zulags 2 and 3, are the only four places in either game where an area offers the walk a choice at all, and the two hubs' spokes fall to the path id — deliberately not the door layout, which no two published routes read the same way. What the walk misses inside an area follows it: a sub-area behind its parent, a demo copy behind both.

**An Exoddus ender half at the tail is the one thing that outranks the walk.** [38](item-038-path-section-tag.md)'s `section` says which half of a level a path belongs to, and an ender is a later visit, so its paths sit at the level's tail in the order the walk met them. The cost is exactly one inversion across both games: Bonewerkz' `Executive Office` carries no section and is reachable only through the ender's own approach, so it is listed ahead of the path that reaches it. Pinned as the only one.

**Twelve of the 25 levels come back exactly as they ship.** Five of them have paths to order: Rupture Farms, Monsaic Lines, Paramonia and Scrabania are chains the discs already store in walking order, each path one transition further in than the last, and Exoddus' credits are two paths with no link between them. The other seven hold a single path each. Nothing needs a guard against being reordered: the walk either has something to say or hands back what it was given.

**The decomp agrees where it speaks.** `AliveLibAO/MainMenu.cpp`'s `sLevelList_4D0300` gives Rupture Farms Return four rows, Rescue Zulag 1 to 4 in order, each naming a representative path: 19, 1, 13, 14. Those are exactly the four area heads the walk produces, in that order. Exoddus has no equivalent — `gPerLvlData_561700` is one row per level and per ender, giving each level's entry path and nothing about the order inside it.

**Read back against published routes, level by level (2026-08-21).** Six Exoddus levels have a documented route detailed enough to compare path for path — the Mines, Necrum, both vaults, the Slig Barracks and the Brewery — and the walk matches all six exactly, the Mudomo Vault's pocket included. Every remaining disagreement is inside an area or is the ender tail, never the order of the areas themselves: FeeCo's and Bonewerkz' ender halves, which the tail move is deliberately overriding, and the spokes of the two temples' hubs and of Rupture Farms Return's Zulags 2 and 3, where the routes disagree with each other as well — the two fullest Oddysee walkthroughs give Zulag 2's three doors in opposite orders.

## Ruled out

**Grouping by the names alone.** A key over the curated names — the run a name belongs to, its numbers compared as numbers, the section as a tail group, a colon marking a sub-area — wins the only contest that can be scored, and is rejected anyway. Over the 559 pairs of same-level paths, demo copies counted in, whose names sit in one numbered run, it puts none the wrong way round, against 242 for the order the discs store, 153 for a plain string sort of the names and 1 for the walk. It could hardly do otherwise — a sort by number inside a run cannot invert a pair inside that run, and the tail group never enters into it, no sectioned path in either game carrying a number at all — so the score says only that the numbering was obeyed. Hoist a level's way in to the head, as any usable order must, and the key gives up that 1 as well: Bonewerkz' `Entrance and Annex 2` ahead of `Annex 1`, the same pair the walk gives up and for the same reason. What decides it is that the numbering is not the question. The key has nothing to say about the seventeen levels whose areas carry no numbers — the Stock Yards keep their entrance last, both temples keep their hub last, and Necrum keeps an order nobody walks — and where it does fire it files the unnumbered areas alphabetically, which puts the Mines' Boiler Room ahead of Tunnel 1's own secret area and the Slig Barracks' hub behind every block it opens.

**"Entry paths first."** `computeEntryPaths` is the wrong set to start the walk from, not merely a loose one — it carries later levels' return legs and start markers that are not entrances. A walk multi-sourced on it reads Rupture Farms as `15, 20, 16, 19, 18`; sourced on arrivals alone, exactly backwards.

**The id-order fallback for what the walk cannot reach.** Unneeded: the 25 Exoddus demo paths and `CR P2` are the only unreachable paths (counted 2026-08-21), and 22 of the demos name an area a reachable path also names, so the walk places them without ever travelling to them. The other three — the Mines' `[Demo] Tunnel 5: Blind Mudokons`, FeeCo's `[Demo] Baggage Claim` and Bonewerkz' `[Demo] Glukkon` — are areas of their own and land by the rule any untravelled area does: a numbered one slots into its run, the rest go to the tail. `CR P2` is a second credits path with no name and no links, and lands where the disc keeps it.

**The directed skeleton.** The obvious way to find a direction in the graph, and it is an artifact: the within-level transitions are 98% reciprocated in AO (120 of 122) and 77% in AE (136 of 177), and of the 43 edges with no reciprocal, 23 leave a demo path — nothing enters one, so its exit can never be reciprocated — while 9 of the remaining 20 point back at a path the walk has already listed. A topological order over what is left puts 245 of the 559 numbered pairs the wrong way round, worse than the order the discs store (measured 2026-08-21).

## Findings

**The door reading order is not a tie-break.** Taking a path's ways out in the order it stores them is the tempting way to break a tie, and it is noise: it swings the Brewery between 10 and 45 inversions of the game's own numbering depending on which variant of the walk reads it, with nothing in the data to choose between them. Numbering first and path id last is stable, and both are visible on the button.

**Do not reach for Exoddus' `LCDStatusBoard.zulag_number` as an authority for the area numbers.** Reading `LCDStatusBoard.cpp` end to end: it is written once in the ctor and read only as an index into the rescue tally, and nothing renders it. In the Brewery it is simply the path id, and it contradicts the curated names on `BR P3`, `P4`, `P5` and `P12` at least.

**Twenty names mark their sequel with a Roman numeral and carry no Arabic digit**, so no run ever forms over them. That is why the Stock Yards can come back in the order the doors run rather than the order the names count: Abe crosses the yards one way on the way out and the other on the way back, so `E2` lists Free-Fire Zone IV, III, II, which is the order he walks them.

## Ships with

The setting's README bullets, a `changelog.json` entry tagged `improved`, and a [CLAUDE.md](../CLAUDE.md) group under *Viewer surfaces* recording the seam, the walk's three tie-breaks and the entrance election.

## Grown since filing

**On by default, 2026-10-11.** The order a player meets a level's paths in is the order the game plays them, so it is what the buttons show unless the setting is turned off.
