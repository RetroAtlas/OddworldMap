# 102. Lay the viewer's modules out in folders by layer

**Status:** open · **Effort:** a day: one preparatory commit, one event, nine moves by script, two closing commits · **Where:** anywhere · **Filed:** 2026-11-10, from a survey of the viewer's import graph and two dry runs of the series

## What and why

Eighty-two ES modules sit flat in `public/js` (16,896 lines on 2026-11-09, `wc -l public/js/*.js`), and the one thing that says how they relate is [tests/unit/imports.test.js](../tests/unit/imports.test.js), which fails a cycle once one has closed, holds `model.js` from reaching `state.js`, and otherwise lets any module import any other. [CLAUDE.md](../CLAUDE.md)'s topic-doc index groups them by area for a reader, but every area is a vertical slice (the geometry entry names `geometry.js` at the bottom of the graph and `interaction.js` at the top), so a reader opening the directory sees eighty-two names and learns the architecture only by reading imports. Folders by layer put it at the first level, and a table in the imports test, which folder may import from which, fails a dependency that points the wrong way by directory, before it closes a cycle. Kept in view and not designed for: the modules that know nothing of this game's data end up apart from the ones that do, so a viewer shared with another map has its candidates visible; the layout is the whole of that aim here, with no seam or adapter built for it.

The case stands on readability, the layer table and that seam, not on file size: [101](item-101-file-size-caps.md) already says folders are not an answer to size, and nothing here changes a file's length.

## Sketch

A refactor on its own: no behaviour change beyond one window event, no file split, no rename, nothing drawn differently. Every module keeps its content but for the import specifiers that change with its path, every file keeps its name, `git mv` carries the history, and one folder lands per commit with every import, link, doc, test and CLAUDE.md line that names a moved file.

Nine folders beside two root files, the folder graph the real import graph induces acyclic and the table holding on it with no violation, each row naming only the folders its modules reach:

| folder | holds | may import |
| --- | --- | --- |
| `ui/` | `dom`, `dialog`, `toast`, `icons`, `keycap`, `redraw`, `searchquery`: the page's primitives, which know nothing of the map | `ui`, `config.js` |
| `engine/` | `collide`, `patrolkit`, `effects`, `idlebrains`, `lcd`, the ten creature brains, `brains`, `motion`: the game's engine as the viewer runs it | `engine`, `config.js` |
| `model/` | `geometry`, `demo`, `util`, `fields`, `glossary`, `typeinfo`, `annotations`, `extra`, `objecttypes`, `model`, `pathorder`, `messages`, `reliveexport`: what the decoded data means, handed everything it reads | `model`, `engine`, `config.js` |
| `rules/` | `sprites`, `spritekit`, `furniturerules`, `hazardrules`, `creaturerules`, `mudokonrules`: the sprite rules, what each object is drawn as | `rules`, `model`, `engine`, `config.js` |
| `data/` | `state`, `settings`, `pathvisible`, `edits`, `release`, `data`, `census`, `placesearch`, `placesummary`, `worldgraph`, `graphsvg`: the datasets as the visit holds them and what is computed over them | `data`, `model`, `engine`, `ui`, `config.js` |
| `painter/` | `kept`, `screens`, `spriteart`, `spritepaint`, `overlays`, `render`: what paints a canvas | `painter`, `rules`, `data`, `model`, `engine`, `ui`, `config.js` |
| `navigation/` | `navigate`, `route`, `shuffle`, `minimap`: what moves the view | `navigation`, `painter`, `data`, `model`, `engine`, `ui`, `config.js` |
| `panels/` | `campanel`, `editpanel`, `place`, `graphview`, `search`, `fieldpanel`, `numbers`, `typecard`, `anchortip`, `whatsnew`, `about`: what opens beside the map | `panels`, `navigation`, `painter`, `data`, `model`, `ui`, `config.js` |
| `chrome/` | `interaction`, `sidebar`, `a11y`, `export`, `offline`: what frames the map and speaks for it | `chrome`, `panels`, `navigation`, `painter`, `data`, `model`, `engine`, `ui`, `config.js` |
| root | `main.js`, the boot; `config.js`, the tunables and tables every row may name | every folder |

The series, every commit green on its own by the suites and the pixel proof against its parent: the four panels that import the hub for the drawer's toggle ask through a `menu-toggle` window event instead, in a commit of its own, since that import is the one edge that keeps the panels and the hub from being two folders; a preparatory commit teaches the imports test, the sprite test's animation sweep and `npm run pixels` to find a module in a subfolder, the imports test gaining the table with its root row alone; then one folder a commit from the bottom up, `ui`, `engine`, `model`, `rules`, `data`, `painter`, `navigation`, `panels`, `chrome`, each adding its row, the root row narrowing to the folders and `config.js` at the last; then the pure check becomes a walk of the four folders that import in bare Node plus the four pure files outside them.

## Decided

- Folders are layers and the table says what each may import, by `posix.dirname` of the importer and the import, with `config.js` admitted by file name from every row: no folder owns it (a third of its lines are chrome tunables, two thirds the game's tables), and at the root `.prettierignore`'s line and every test import of it stay as they are.
- `settings.js` sits in `data/`: it imports `parseHash` from `model.js` and `CATS` from `config.js` and carries the map's defaults and storage keys, so it is not a primitive, and `edits.js` and `pathvisible.js` import it from the pure band, so it sits no higher than they do. Its `dialog.js` and `icons.js` imports are two of the three edges that make `data` name `ui`; both import in bare Node.
- `state.js` sits in `data/`, so that `model.js` never reaching `state.js`, held by a module test, becomes a folder fact too: `model`'s row has no `data`.
- `collide.js` and `lcd.js` sit in `engine/`: `collide.js` is a port of the engine's own routines and the brains' cluster then imports nothing outside itself but `config.js`; `lcd.js` registers its brains into `patrolkit.js`'s tables at import and imports nothing else.
- `messages.js` sits in `model/`, a table reader beside `annotations.js` and `glossary.js`; its `glyphRun` import from `lcd.js` is the one edge that makes `model` name `engine`, stated in the row rather than hidden by filing the sign reader among the rules.
- `util.js` sits in `model/` (it imports `fieldEntries` from `fields.js`, and `model.js` imports its `clamp`), which is what keeps `anchortip.js` (one `clamp`) and `whatsnew.js` (six `esc`) out of `ui/`.
- `toast.js` sits in `ui/` through the `config.js` allowance, its three timings the only `ui` to `config.js` edge.
- `kept.js` sits in `painter/`: it reads the live state and imports the rules, and its decision is the painter's; it is one of four modules on the pure check that sit outside the four pure folders, with `redraw.js`, `searchquery.js` and `config.js`.
- `navigate.js` has a folder, with `route.js`, `shuffle.js` and `minimap.js`: imported by nine modules and importing the painter, it is a layer between the painter and the chrome, and the three beside it import it while nothing above imports them but `main.js` and `interaction.js`.
- The pure halves of the panels (`census`, `placesearch`, `placesummary`, `worldgraph`, `graphsvg`) sit in `data/`, so the pure-or-DOM line is a folder line and a new pure computation over the dataset has a folder; `placesearch.js` reads no store but imports `searchquery.js`, which `model`'s row does not admit.
- The brains are one folder with the clock, not a `brains/` beside `motion.js` or a subfolder under `brains.js`: `brains.js` gathers them by bare import, the cluster imports nothing outside itself, and the repo's word for it is the engine. The rule modules are a folder of their own, not part of `painter/` though only the painter reaches them: they import in bare Node where the painter does not.
- The rule modules' folder is `rules/`, not `sprites/`: `/sprites/` is the sheet artwork's URL substring, and the offline size estimate, the offline spec and the sheet spec's request count match it anywhere in a URL, so a `js/sprites/` folder had its six module fetches counted as sheets and failed four browser tests in the dry run of 2026-11-09 (`dryrun-A` in the plan's notes).
- The drawer is asked for through `menu-toggle`: `search.js`, `typecard.js`, `fieldpanel.js` and `numbers.js` imported `toggleMenu` from `interaction.js`, the hub that imports five of the panels, so the panels could not stand apart from it without a cycle; the event is the repo's own pattern for two modules that want each other, and `dispatchEvent` runs the listener before the next statement, so a panel still finds the drawer open when it focuses the search box.
- No renames: the bare names are how the docs, the backlog, the test titles and the specs name these modules, `git log --follow` carries a move whole, and the pixel proof finds a module by its name in each tree. The tests stay flat: a unit test is named for what it pins, a spec for its subject, and several span folders.
- The backlog's 84 link targets follow the files, since `backlog.test.js` requires every relative link to resolve; link texts and prose stay as written, a filed item being a record. In the docs, texts and targets both follow.
- The pure check is a walk of `engine/`, `model/`, `rules/` and `data/` plus the four pure files outside them, every one imported in bare Node, the "has exports" clause dropped: the eleven brain modules and the four rule modules register at import and export nothing.

## Ruled out

- A `format/` folder: the discs are read in Python, and what format knowledge remains in JavaScript (destinations, the payload words, the record shape, the code pages, the one writer) is interleaved with the model.
- `sprites/` for the rule modules (the URL collision above), `draw/` for the painter (draw space is the transform's term here) and `motion/` for the engine (it names seventeen modules after the clock, where the repo says the engine).
- Five folders (`ui`, `model`, `engine`, `painter`, `chrome`): the smallest series, but `model` would run from `config.js` to `graphsvg.js` and the first level would say nothing of what navigates, what opens beside the map or what the visit holds.
- A `core/` of `config.js`, `geometry.js` and `collide.js`: it rests on a cycle that exists only in a folder-only checker; the test admits a file by name.
- `config.js` in a folder: it costs `.prettierignore`'s line, eight unit imports, a spec helper's import and five in-page loads for a file whose place a reader then has to learn.
- The pure halves of the panels beside their panels: zero violations too, with a `chrome/` of 21 and a `data/` of six stores, but the pure walk would then need the five by name and a new pure computation over the dataset would have no folder.
- Mirroring the folders under `tests/unit` and `tests/browser`: it doubles the series' churn for no new check.
- Splitting `interaction.js` to free the drawer, or any file split; the three ratcheted modules keep their rows at their new paths.
- A `modulepreload` list in `index.html`, a README per folder, barrels or index files, a `changelog.json` entry.
