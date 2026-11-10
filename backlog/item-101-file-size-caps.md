# 101. Hold every file to a size

**Status:** shipped 2026-11-08 · **Effort:** small for the test, two days of verbatim splits for the files over it · **Where:** anywhere · **Filed:** 2026-11-09, from a review of the series that landed the caps

## What and why

A file is read whole, by a session as by a reader, and the largest had outgrown a reading: on 2026-11-05 `render.js` was 1,748 lines and `sprites.js` 1,571, twice the next module, and eleven files across the viewer, the specs, the unit tests and the builder's tests were over the caps below. A feature grows a file by its hundreds where a fix moves a line, and nothing stopped the growth: `render.js` had been 788 lines five weeks earlier.

[tests/unit/sizes.test.js](../tests/unit/sizes.test.js) holds every module under `public/js`, every file under `tests/browser` and `tests/unit`, and every Python or JavaScript file under `tools/` to a cap set by its directory, 800 lines for a module or a spec and 1,000 for a unit test or a tool. A file already over its cap stands in the test's table at the next hundred above its size, a row a commit that shrinks the file lowers, none raises, and the commit that brings it within the cap takes out; the test's failures each say which move is due. [docs/testing.md](../docs/testing.md#the-budgets) carries the rule as the suites' reader meets it, and [CLAUDE.md](../CLAUDE.md#conventions) the convention.

## Decided

- The caps list the files that matter. At 1,000 lines for a module the table would have held two rows; at 800 it held five, three of them within 70 lines of the cap. The unit tests and the tools, read by case and by step rather than whole, take 1,000.
- The allowance is the next hundred above a listed file's size, an exact hundred taking the next, so a one-line fix to the file passes and a feature's hundred lines does not. The size itself as the allowance would have made the first one-line change to `interaction.js` a split.
- Three modules stay ratcheted rather than split, [interaction.js](../public/js/interaction.js), [edits.js](../public/js/edits.js) and [model.js](../public/js/model/model.js), each at 900: each is one subject whose sections are not a module's worth today, and a row of 900 brakes it at a feature's size. The row is a tripwire on known work, and the cut for each is named here so that the session that trips it need not find it. `interaction.js` cuts at its hover inspection section, `updateHover` and what follows it, into `hover.js`; the parked collision-lines slice of [42](item-042-level-editor.md) will trip it. `edits.js` cuts at the device store and its guards, `EDITS_KEY`, `sanitizeEdits`, `validValue`, `validDelta`, `validAdded` and `validRect`, into `editstore.js`; that slice or the level maker of [98](item-098-level-maker.md) will trip it. `model.js` cuts at the destinations, `pairTargets`, `destOf`, `destTrusted`, `wayThrough`, `resolveTarget`, `computeEntryPaths`, `isLoopback` and `computeConnections`, into `destinations.js`, the seam `destinations.test.js` already cuts at; the pens of [96](item-096-scrab-pens.md) in `patrolZone` will trip it. The sections were about 220, 140 and 250 lines on 2026-11-09; the symbols are the cut.
- A split follows the sections a file already has, a subject to a file, moving every line verbatim, and no section comment is added to make a cut possible: a comment that heads a single function to prepare a split is not a section. A hand table that outgrows its file is split by what its rows are, never by count alone.

## Ruled out

- ESLint's `max-lines`: it knows one number per glob and no ratchet, so a file over it is a lint error until it is split, and it reaches nothing under `tools/` but the Node files ESLint lints. A unit test holds every kind in one place, with the table and a message that says the move due.
- A pre-commit hook: it runs on one machine and not in CI, and the test runs in both.
- A cap on the tests a spec may hold: a spec is one subject, and the count of its tests says nothing about that; the cap on the file is what stops a spec of several subjects growing.
- Splitting the three ratcheted modules at once: a day's work for the 153 lines the three were over on 2026-11-08, with no feature in flight on any of them; the row holds each until the feature that grows it pays for the split.
- Folders under `public/js` as a way to keep the files small: a folder shortens no file, and sorting the flat one-way tree into layers is a change on its own merits.

## Shipped

The test landed on 2026-11-08 with the table at eleven rows, and the series that followed took eight out: `render.js` into the painter and the modules it draws from and with, `redraw.js`, `screens.js` (its canvas colours in `dom.js`), `spriteart.js`, `spritepaint.js`, `overlays.js` and `kept.js` with a unit test of its own; `sprites.js` into `spritekit.js` and four rule modules, `furniturerules.js`, `hazardrules.js`, `creaturerules.js` and `mudokonrules.js`; the motion and editing specs into five and four specs by what each test proves on the page, with `edithelpers.js` beside them; the motion, model and edits unit tests along the modules and subjects they exercise; and the builder's tests along the package's modules. The three rows left are the ratcheted modules above. Measured 2026-11-09 and cheap to recount with `wc -l`: the largest module is `interaction.js` at 869 lines, `render.js` is 542 and `sprites.js` 65.
