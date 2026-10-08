# Backlog

What this map plans, what a review of it found, and what happened to both — one file per item. Most of it is history rather than queue: an item is kept after it ships, because what was decided and what was ruled out are worth more then than before. A working list, not user-facing documentation — [README.md](../README.md) is that, and [CLAUDE.md](../CLAUDE.md) carries the conventions a fresh session should read first and indexes the topic docs under [docs/](../docs/), the format gotchas among them. Each item states why it is worth doing and sketches enough to be picked up cold.

One id space, minted once and never reused or renumbered, numbered from `1` with no gaps. The sequence is emphatically not chronological. `1`–`45` is roughly the order things were thought of; everything after arrived in batches, each a review's findings appended once they had been triaged. A source worth preserving — a review, audit or investigation — is recorded on the item in its **Filed:** line rather than encoded in its number; an organic idea needs no synthetic provenance line. A measurement carries the date it was taken, points at the check that reproduces it, or says plainly that it is stale and must be measured again.

An item earns a file when the gap between finding it and resolving it is long enough for the reasoning to be forgotten, or when the answer is "no". A nit fixed within the hour is a commit message, not an entry here. A review is not a filing queue either: what it finds reaches this folder after it has been triaged and never before, because a review reports everything it notices and most of that is a nit or a question whose answer already exists.

Every item speaks in one voice — its author's — and describes what is, never the rounds that got it there. While the work is still unpushed, a finding that reshapes an item reweaves its text as if always known: an amendment section beside a superseded paragraph is the diff-justification rule breaking out in prose, and no item narrates a dialogue of actors trading questions and corrections. Once history is public an item may grow dated additions — a later finding under *Grown since filing*, a measurement gone stale — but they carry the same voice: name the gap, not the meeting that found it. Drift between sketch and shipped is recorded as fact ("the pairing is by id, not by nearness"), which is the *Shipped* section's whole job; where a finding came from is the **Filed:** line's.

A **Status:** opens with one of the following words and qualifies itself afterwards:

- `open`
- `undecided` (needs a verdict before anyone builds it)
- `deferred` (decided not now)
- `ongoing` (real work with no completion state)
- `shipped` (includes date)
- `retired` (includes date)
- `closed` (rejected, or a premise disproved).

A closed set is what lets the folder be read by state without opening every file. The **Status:** line is the canonical state; body headings describe the shape of the item, not another status system.

A shipped item keeps the file it always had, at the path it always had: the status flips, the outcome is recorded, and everything already there stays — including the sketch, which is what lets the entry say where its own guess turned out wrong, and the *Decided* and *Ruled out* sections, which are worth more after shipping than before. A substantial outcome, or one that resolves a choice the sketch left open, gets a **Shipped** section; a small item whose existing *Decided* or *Findings* section already says exactly what landed does not repeat it for the sake of a heading. A *Sketch* is not that record — it is what was proposed, and an item closing on one alone reads as though it shipped, which [49](item-049-png-export-revoke-race.md) is the reason to say: implementations drift from their sketch, sometimes into the very shape the item warned against, and the drift is the part worth keeping. Nothing moves to a `done/` directory and nothing is renamed: an item's path is its identity, and one that changed on shipping would strand every reference to it. A *retired* item follows the same rule, keeping whatever made it worth writing down; [37](item-037-per-path-notes.md) is the example, retired rather than completed because a backlog entry saying "write more notes" invites forced ones. An item that shipped in halves stays under whichever half is still open, carrying a **Shipped** section for the part that landed.

Item-specific reasoning and cross-references stay inside this folder. An item may cite another committed item, while a commit message, code comment, [CLAUDE.md](../CLAUDE.md) and the [docs/](../docs/) files each state the reasoning they need instead of substituting a backlog pointer for it; nothing committed cites an untracked item. Cite a commit hash only after it is pushed, and name the subject line before then so a rebase cannot stale the record. A subject is written in italics with its hash beside it once it has one, a reference to another item is a link on its number rather than a bare number, and a reference into this repo's own source names the symbol rather than a line — a line number is falsified by the next edit above it, and the test can check a link but not a coordinate. The repository is public, so every item is public writing rather than a private scratch pad — the site itself serves only `public/`, and this folder is not in it.

**Next up** is the one priority ordering. The sections below it are inventories by kind and state, so their bullets do not need reshuffling to express what should happen next.

**Next up**:

- [12. Curated path names](item-012-curated-path-names.md) — a content pass, a sitting at a time.

**Field system:** every gameplay object carries its full field archive, each value transform is write-once and collision-safe and keyed by the field's game type, enum values are generated straight from the decomp, and per-object default visibility is curated. A bare-int field carries the unit it is measured in ([28](item-028-readable-units.md)). The one open branch is upstream label fixes ([29](item-029-decomp-label-sweep.md), ongoing).

**Machine constraint:** a builder change that reads new data off the discs needs a rebuild, which needs the disc images. Batch those for a disc-machine session; one rebuild ships them all. Everything else can be built anywhere.

---

## Map-native features

- [**12.** Curated path names](item-012-curated-path-names.md) — the remaining curation: the still-unnamed AO paths, and one AE name that stands by elimination. _Content pass, anywhere._
- [**29.** Decomp label-correctness sweep](item-029-decomp-label-sweep.md) — confirmed `scale` and `level` misdeclarations, batched into one upstream PR, then a sidecar regen. _Ongoing._
- [**94.** Live map](item-094-live-map.md) — shipped as the game's own view: every object as its sprite, the creatures' brains and patrols on the engine's clock under the no-player reading, the effects, Markers for the rest for the reference view, the pulsing lights, the Scenery filter and what the game shows kept unseen; the map opens with the objects as themselves and the patrols walking. Open: a Fleech's hoist climb, the fall at a line's end, the Elum, the LCD text, the per-layer foreground masks and the drop shadows. _Small to medium; the mask split needs a disc._
- [**96.** A Scrab's pen on hover](item-096-scrab-pens.md) — a Scrab keeps no zone and its bounds carry no id, so it was left with posts and no pen; it turns at the nearest post its probe meets, so its pen is the nearest post of each side on its floor, and every patrolling Scrab that has both walks between them. _Small._

## Code and build

- [**95.** A bare link's fit zoom is read off the canvas mid-slide](item-095-fit-zoom-boot-slide.md) — `fitView` reads the canvas width during the sidebar's boot slide, so the same path link opens at a slightly different zoom each visit; wait for the slide, or fit again when it ends. _Small._
- [**57.** One module lifecycle: explicit `init()`](item-057-module-lifecycle.md) — the current boot order is a load-bearing accident. _Medium._

## Moonshot

- [**11.** Live position tracking](item-011-live-position-tracking.md) — a local bridge feeding Abe's live position to the map while practising. _Large, research first._
- [**42.** Level editor](item-042-level-editor.md) — Phases 1 and 2 shipped: the cross-check agrees with relive_api object for object, and a path saves as the level editor's own JSON. Phase 3's first two slices shipped too: an object's properties edit in the browser as a local sandbox behind a setting, kept on the device and marked wherever they show, every surface following through one data-changed event, with undo and redo per path. Moving, adding and removing objects and the collision lines are the parked slices. _The parked slices large._

## Undecided

Each needs a verdict before anyone builds it.

## Deferred

Decided not now, with the reason recorded.

- [**22.** Level/path music](item-022-level-path-music.md) — technically feasible offline, but it would mean serving copyrighted audio.
- [**74.** SVG close glyph](item-074-svg-close-glyph.md) — the platform-unconditional close button; accepted as-is after a look on Android, the worst case already.

## Closed

Rejected or disproved, kept so they are not re-proposed.

- [**34.** Favicon badge](item-034-favicon-badge.md) — the chin it existed to show clears the disc by one device pixel at tab size; declined after both readings were tried in a real tab.
- [**70.** Dropping the numeric `t` and empty `extra`](item-070-drop-numeric-t.md) — rejected: a data contract, for 18 KB gzipped.
- [**71.** Mudokon rescue census](item-071-mudokon-rescue-census.md) — premise disproved; `rescue_switch_id` is not the rescuable flag.
- [**72.** Copy-embed-code button](item-072-copy-embed-code-button.md) — rejected, and the standing reason the map's corner gains no fourth button.
- [**73.** Repo and artwork size trajectory](item-073-repo-size-trajectory.md) — closed: the current size is the floor.
- [**88.** Object filter presets](item-088-object-filter-presets.md) — rejected: the object filters stay one flat list; whoever wants a preset already knows what to tick.

## Finished

Newest first, and a finished item is worth reading for the same reason an open one is: whether shipped or retired, each records what was decided, what was ruled out and where its own sketch turned out wrong.

- [**92.** The member-type parser's remaining blind spots](item-092-member-type-parser-blind-spots.md) — a `class`-declared data struct, an uppercase member and a dotted ADD reading a sub-struct arm; the sweep walks out from the data structs through every aggregate they declare, so 560 objects over ten types read their values as words, and the union arm [41](item-041-inherited-field-types.md) left raw came with it. _2026-09-19._
- [**93.** SecurityClaw's archive labels sit one word to the left](item-093-securityclaw-layout.md) — `Scale_int` is four bytes wide, so every member name after it numbers one word low; one corrections entry and the rebuild it waited for, and the glossary needed no touch-up because only the words move. _2026-09-05._
- [**90.** Export the world graph as an image](item-090-export-the-world-graph.md) — save svg / save png in the diagram's own bar, both from one serializer: a self-contained SVG built from the same layout the screen draws, and the PNG that string rasterized at twice the screen. The route the sketch ranked first is the one that shipped, and it made the second painter unnecessary. _2026-09-02._
- [**69.** Browser-level smoke tests](item-069-browser-smoke-tests.md) — the six assertions over boot, permalinks, follows, embed mode, search and settings, on the harness [63](item-063-alignment-anchor-diff.md) brought; the round-trip had to assert `viewHash()` reproduction, a plain view hash never being rewritten at all. _2026-09-02._
- [**63.** Automate the alignment anchors as a screenshot diff](item-063-alignment-anchor-diff.md) — the four anchors as a CI gate with no reference images: geometry pinned as hand-verified literals, pixels probed against the committed artwork; a scale error moves the pins at any cell, and the deep-cell anchors carry the pitch class that does cancel at the original anchor's cell (0,0). _2026-09-02._
- [**64.** CI check that the committed sidecars match a re-emit](item-064-sidecar-reemit-check.md) — the enum sweep joined the other parsers' cache discipline, so the emit runs from the committed tree and CI byte-compares all four sidecars; the "emit + cmp" half turned out to already exist as the unittest. _2026-09-02._
- [**67.** Crawlable content for search engines](item-067-crawlable-content.md) — every level has a plain page under `/levels/`, its paths in play order linking into the viewer, and the sitemap names them all; emitted from the committed data by a Node script that reuses the viewer's own modules, and byte-checked against a fresh emit in CI. _2026-09-01._
- [**41.** Type a field a struct inherits](item-041-inherited-field-types.md) — a member resolves through its base chain, so the wells' `scale` reads full/half; an aggregate-valued member stays untyped, a type without labels having no business in the sidecar. _2026-09-01._
- [**89.** What the packed layout still misreports](item-089-packed-layout-untruths.md) — the collision lines, the marker boxes, and last the counts: a screen lists the objects whose corner falls in its cell, the third answer the sketch never weighed, so the tag and the tally finally agree. _2026-08-31._
- [**66.** Add a `404.html`](item-066-404-page.md) — a missing address lands on a page of the map's own with the way back; self-contained, every URL on it root-absolute, since Pages serves it at whatever address was asked. _2026-08-30._
- [**68.** Say what the repo is licensed as](item-068-repo-licensing.md) — `LICENSE` names the holder and carries the same per-tree scope the README publishes, above a verbatim licence body; the `package.json` half evaporated on inspection, the package being private, and GPL-2.0 turned out to be inherited from the vendored decoder rather than chosen. _2026-08-29._
- [**91.** Two builds in one checkout corrupt each other's artwork](item-091-concurrent-build-tmpdir.md) — a scratch directory per run instead of one per checkout; the collision needed each build to have its own directory, not each camera its own filename. _2026-08-28._
- [**56.** Split `build_map.py` into a package](item-056-split-build-map.md) — ten modules, one concern each, with the CLI left holding the build loop; the sketch's own layout had two circular imports in it, and defining the roots once was not enough while the one definition sat a directory too deep. _2026-08-27._
- [**28.** Readable units for raw numeric fields](item-028-readable-units.md): a bare number says what it measures, a timer reading `15 frames ≈ 0.5s`. The seconds tier turned out not to need the emulator the item made its gate; the engine's own clock is in the decomp, and the curated field-to-unit list was mostly already written as glossary prose. _2026-08-26._
- [**5.** LCD marquee text](item-005-lcd-marquee-text.md) — every marquee reads out what it scrolls, and Oddysee's hint flies what they spell; the tables turned out to live in the level overlays rather than the executable, and the decomp's copies are the PC build's, so the discs are still the source. _2026-08-25._
- [**86.** World graph](item-086-world-graph.md) — every path a box, every way between two of them a line: the whole game as one diagram, in place of the map. The layout turned out to be free — `data.levels` order by `levelOrder` — so the per-level phase the sketch offered was never built. _2026-08-24._
- [**53.** Boot on one dataset, hydrate the other](item-053-boot-one-dataset.md) — the map draws on the data of the game you opened, and the other arrives behind it; the sketch's `fetchpriority` advice was wrong, and deleting the second preload is what paid. _2026-08-23._
- [**61.** Export the whole path, not the viewport](item-061-export-whole-path.md) — every screen of a path in one image at the artwork's own resolution; the size budget turned out to be for the spaced pitch, and a blank canvas encodes fine, so the export probes before it paints. _2026-08-23._
- [**59.** Give the map an accessible surface](item-059-accessible-map-surface.md) — a region that says where the map is out loud, and a key that lists the screen you are looking at; the surfaces that grew onto it afterwards released rather than carried. _2026-08-22._
- [**15.** Path buttons in game order](item-015-path-buttons-game-order.md) — a level's paths listed in the order a player meets them: one walk of its own transitions out from the way in, each area kept whole, and the games' own numbering choosing between the branches. _2026-08-21._
- [**79.** Retire the level annotations, keep the off-map clause](item-079-off-map-level-branch.md) — the empty `levels` section and the two schema rules policing it are gone; the tooltip clause stays, a subset build being where it still fires. _2026-08-20._
- [**17.** Field glossary](item-017-field-glossary.md) — every shipped field now resolves a definition, coverage pinned by test; the long tail fell to the decomp research in one sitting, 44 entries to 565. _2026-08-13._
- [**82.** Type encyclopedia cards](item-082-type-encyclopedia.md) — every object type explains itself: one curated paragraph per type, all 139 across both games, the first sentence riding the hover tooltip and the card composing the rest with live counts and field meanings. _2026-08-12._
- [**83.** Offline app shell](item-083-offline-app-shell.md) — the app joins the artwork in the opt-in cache, network-first with an offline fallback, so no stamp and no version skew; the map opens on a plane. _2026-08-11._
- [**84.** Switch wiring overlay](item-084-switch-wiring-overlay.md) — what a lever actually does, drawn: switch-id wires from producers through the logic gates to the doors, drills and walls they drive; the decomp settled the id scope (level-wide) and which of the ninety switch-named fields are real ends. _2026-08-10._
- [**80.** Minimap inset](item-080-minimap-inset.md) — the path's grid in the corner with the viewport on it, painted at the end of every frame; yields its corner to the numbers panel. _2026-08-09._
- [**85.** Cross-path route planner](item-085-cross-path-routes.md) — the planner rides doors and wells mid-plot; one survival rule, a seam that breaks the line, and a link older viewers degrade politely on. _2026-08-09._
- [**81.** Enemy territory rendering](item-081-enemy-territory.md) — barrier posts and the hover pen in one: the decomp settled the pairing the sketch could only guess at, by id rather than by nearness. _2026-08-09._
- [**87.** By the numbers](item-087-by-the-numbers.md) — pick object types, read their counts per screen/path/level/game as you browse; the comparisons the vision sketched stayed out, counting questions being the ones people bring. _2026-08-08._
- [**7.** AO menu level (S1)](item-007-ao-menu-level.md) — the last level joins the map, its grid read off the chunk because the decomp tabulates none. _2026-08-07._
- [**54.** Stamp `sw.js`'s `CACHE_NAME` from the builder](item-054-stamp-cache-name.md) — a content hash of the artwork, so the name moves when a PNG does and holds still when none did. _2026-08-07._
- [**62.** Sweep for diff-justification comments](item-062-diff-justification-comments.md) — nine comments cut across five viewer modules; the tree turned out to be near-compliant, and what it holds instead of diff justifications is restatement. _2026-08-06._
- [**60.** Search should know place names](item-060-search-place-names.md) — a Places group above the objects, and a code matched by whole words so `zulag 2` is not answered by the `R2` a path sits in. _2026-08-06._
- [**75.** A schema layout override can go stale unnoticed](item-075-stale-schema-layout-override.md) — an entry naming a type the game lacks, or one the parser now derives, fails the build; the schema had to be resolved after the type names for the first check to be possible. _2026-08-06._
- [**77.** What a place is known for](item-077-what-a-place-is-known-for.md) — nine Brewery zulags carry the nickname players gave them, each pinned to the fit that licenses adopting it. _2026-08-04._
- [**14.** Polish pile](item-014-polish-pile.md) — three unrelated tiny fixes that landed, and a fourth retired because the only figure sizing it is unreproducible. _2026-08-03._
- [**65.** Trim what the Pages deploy publishes](item-065-trim-pages-deploy.md) — the site moved into `public/` and the deploy uploads that folder alone. _2026-08-03._
- [**78.** A tag row that filters What's New](item-078-whatsnew-tag-row.md) — built from the tags the feed carries, so a fourth needs a colour and a word in a test rather than any code. _2026-08-02._
- [**37.** Per-path notes](item-037-per-path-notes.md) — retired rather than completed: the criteria stay, the quota never existed. _2026-07-30._
- [**21.** CSS design inheritance](item-021-css-design-inheritance.md) — tokens and shared classes, with the accidental font drift fixed *first* so the eight commits after it had a zero-diff oracle. _2026-07-30._
- [**35.** Glossary tooltips on touch](item-035-glossary-tooltips-touch.md) — a definition a phone can reach, then generalised to any element carrying `data-tip`. _2026-07-30._
- [**76.** Say whose map this is](item-076-site-attribution.md) — the About dialog: an unofficial-fan-project notice that survives an embed, the credit it owes, and the source link. _2026-07-30._
- [**30.** AE well base fields](item-030-well-base-fields.md) — a two-line deletion in the schema parser; 266 wells gained four fields and ContinueZone's override retired. _2026-07-29._
- [**38.** Separate a path's section tag from its name](item-038-path-section-tag.md) — thirteen Exoddus names stopped leading with developer jargon, and the override rule needed no weakening. _2026-07-29._
- [**31.** Settings overlay polish](item-031-settings-overlay-polish.md) — three sections, and a mark on every row whose value is not the one it shipped with. _2026-07-29._
- [**36.** Hide the paths only the demos play](item-036-hide-demo-paths.md) — 25 unreachable Exoddus copies behind a setting, derived from a `DemoSpawnPoint` and nothing else. _2026-07-29._
- [**40.** Validate a destination before trusting it](item-040-validate-destinations.md) — the map stopped believing 61 links that named Necrum Mines and never meant it. _2026-07-28._
- [**39.** A surface for "where am I"](item-039-where-am-i-surface.md) — the place chip, and the panel it discloses. _2026-07-28._
- [**33.** Reformat and de-blob the README](item-033-readme-reformat.md) — structure first and blame-ignored, then the real editing as a commit blame should keep. _2026-07-27._
- [**58.** Restore pinch-zoom of the page chrome](item-058-restore-pinch-zoom.md) — the one-line fix shipped once and had to be reverted. _2026-07-27._
- [**46.** The ruler survives a path change](item-046-ruler-survives-path-change.md) — a measurement outlived its path and kept reading. _2026-07-26._
- [**47.** A held flash repaints forever](item-047-held-flash-repaints.md) — an object permalink pulsed at 60 fps until you touched something. _2026-07-26._
- [**48.** The tooltip has no vertical clamp](item-048-tooltip-vertical-clamp.md) — three defects in three lines; it is tallest exactly when it carries the most. _2026-07-26._
- [**49.** PNG export races the object-URL revoke](item-049-png-export-revoke-race.md) — silently no download, on Firefox and Safari. _2026-07-26._
- [**50.** `settings.js` re-implements `persistSettings()`](item-050-persist-settings-duplication.md) — three copies of one write. _2026-07-26._
- [**51.** `worldAtMouse()` returns draw space](item-051-world-at-mouse-rename.md) — the name lies at the seam where the geometry bugs live. _2026-07-26._
- [**52.** Memoize the search index](item-052-memoize-search-index.md) — 16,217 blobs rebuilt per keystroke. _2026-07-26._
- [**55.** Lint and test `tools/` in CI](item-055-lint-and-test-tools.md) — the builder had zero automated coverage of any kind. _2026-07-26._
- [**23.** Curate per-object default fields](item-023-default-object-fields.md) — what each type shows before you ask for more; a bare `state` enum would have mislabelled three of them. _2026-07-25._
- [**6.** Background-plane objects](item-006-background-plane-objects.md) — dimmed and dashed rather than badged, read from the scale's meaning rather than its raw value. Holds 6b. _2026-07-25._
- [**20.** Multi-field search (AND / OR)](item-020-multi-field-search.md) — space means all, comma means any, and `field=value` is never split. _2026-07-24._
- [**27.** Search in the user's value representation](item-027-search-in-user-representation.md) — with raw values on, search matches the raw value too. _2026-07-24._
- [**32.** Dynamic-update listener sweep](item-032-dynamic-update-listeners.md) — an event the picker emits and its own listener deliberately ignores. _2026-07-24._
- [**25.** Sort objects and fields by name](item-025-sort-fields-by-name.md) — alphabetical everywhere except the `extra` fields, which are a sentence rather than a set. _2026-07-24._
- [**19.** Field picker from the tooltip](item-019-field-picker-from-tooltip.md) — the ⚙ went on the screen list, because a hover tooltip cannot host a control you travel to. _2026-07-24._
- [**24.** Eliminate the last `raw=`](item-024-eliminate-the-last-raw.md) — the no-raw guarantee became structural rather than a list to maintain. _2026-07-23._
- [**26.** Value-rendering architecture](item-026-value-rendering-architecture.md) — transforms keyed by the field's game type, so a value's text is written once and shared. _2026-07-23._
- [**45.** Full-field extraction, Phase 3](item-045-field-extraction-phase-3.md) — the allowlist grew to ~80 gameplay types, and `extra` gave up the keys the archive had begun to duplicate. _2026-07-22._
- [**3.** Route planner](item-003-route-planner.md) — waypoints that ride the permalink; the sketched `&route=` would have broken every deployed viewer. _2026-07-21._
- [**16.** Creature states](item-016-creature-states.md) — the hand decode, superseded almost immediately by the archive that made it unnecessary. _2026-07-21._
- [**18.** Per-type field picker](item-018-per-type-field-picker.md) — "show more" hands you a picker instead of a firehose. _2026-07-21._
- [**44.** Full object-field extraction](item-044-full-object-field-extraction.md) — every field of every gameplay object, so the disc is never needed again to surface one. _2026-07-21._
- [**13.** Camera panel mobile-fit and row highlight](item-013-camera-panel-mobile-fit.md) — a bottom sheet with the map still visible, and a tap that opens it scrolled to the object. _2026-07-19._
- [**1.** Connection arrows overlay](item-001-connection-arrows.md) — a path's whole circulation at once, in a per-kind palette. _2026-07-19._
- [**2.** Partner preview](item-002-partner-preview.md) — hovering a door outlines the object you would come out of. _2026-07-19._
- [**4.** Per-camera object list](item-004-per-camera-object-list.md) — what touch has instead of a tooltip. _2026-07-19._
- [**8.** Copy-link button](item-008-copy-link-button.md) — for phones and installed-app mode, where there may be no address bar. _2026-07-19._
- [**9.** Keyboard shortcuts](item-009-keyboard-shortcuts.md) — paths, the display toggles, and `?` for the list of them. _2026-07-19._
- [**10.** Embed mode](item-010-embed-mode.md) — `?embed=1` hides whatever wears `.chrome`, so new furniture opts out by class. _2026-07-19._
- [**43.** Cam artwork caching](item-043-cam-artwork-caching.md) — opt-in cache-first artwork, because Pages re-stamps its validators on every deploy. _2026-07-19._

### Shipped without a file

Four entries that never carried a number and have one sentence each to say. They describe features rather than decisions — there is nothing here a later session could get wrong — so they are said here rather than in a file of their own.

- **Mobile support** — one-finger pan, two-finger pinch-zoom into the canvas, tap-to-follow, and the sidebar collapsing to a drawer under 720px. _2026-07-14._
- **Favicon, social cards, site metadata** — the original Mudokon SVG favicon, OG and Twitter cards, the manifest, robots.txt, the sitemap and CNAME. _2026-07-14._
- **Search improvements** — three batches: context grouping, then scope control, then ranking, highlighting and keyboard navigation. _2026-07-14._
- **PNG optimization** — oxipng folded into the builder and every image losslessly recompressed, 288 MB down to 195 MB, with history rewritten so only optimized blobs ever existed. _Undated: that rewrite is why._
