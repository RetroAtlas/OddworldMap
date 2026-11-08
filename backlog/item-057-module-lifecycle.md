# 57. One module lifecycle: explicit `init()` everywhere

**Status:** open · **Effort:** medium (viewer refactor) · **Where:** anywhere, viewer-only · **Filed:** 2026-07-24/25 review

## The question asked: which convention is best?

Explicit `init()` for every module that touches the DOM, reads settings or registers listeners; leaf modules stay side-effect-free as they already are. Reasons, in the order that they matter here:

1. **The repo already asserts half of this rule and can then assert all of it.** [tests/unit/imports.test.js](../tests/unit/imports.test.js) enforces "no DOM at import time" for the leaf modules, and CLAUDE.md calls that guard the regression guard for the whole suite. Today the rule is "leaf modules are pure, UI modules are not", which is a rule with an exception list. After the change it is one rule — *import defines, `init` acts* — and the test can be widened to cover every module.
2. **The current boot order is a load-bearing accident.** `import "./sidebar.js"` in [js/main.js](../public/js/main.js) is hoisted, so `sidebar.js` runs `getViewSnapshot()` → `getSettings()` **before** `initSettings()` executes. It works only because `getSettings()` is lazily memoised. Nothing states that dependency; nothing tests it; any future module that reads settings eagerly at import breaks in a way lint and the DOM-free tests cannot see.
3. **Ordering becomes reviewable.** `main.js` already carries two ordering comments in prose — "before the path buttons build their labels", "before any tooltip/search prettifies". Those constraints deserve to be a call list, not comments attached to imports whose execution order is invisible.
4. **It is the precondition for [69](item-069-browser-smoke-tests.md).** A browser test wants to build a document and then call `initX()`. Modules that fire on import can only be tested by importing them into an already-correct document, which is most of why it looks expensive today.

The alternative — everything self-wires at import — is internally consistent but loses (2), (3) and (4), and would mean deleting a test that has already earned its keep.

## Current state, for the person doing this

Counted 2026-08-26 over the 43 modules in [public/js](../public/js), and cheap to recount: a module self-wires if it registers a listener or touches the DOM at import.

**Explicit `init`: 2.** `settings`, `fieldpanel`.

**Self-wiring at import: 19.** `a11y`, `about`, `anchortip`, `campanel`, `export`, `graphview`, `interaction`, `minimap`, `navigate`, `numbers`, `offline`, `place`, `render`, `route`, `search`, `shuffle`, `sidebar`, `typecard`, `whatsnew`.

**Pure leaves, no change needed: 20**, of which [tests/unit/imports.test.js](../tests/unit/imports.test.js) covers 17. Its eighteenth entry is `settings`, which qualifies by keeping its DOM inside `initSettings()`: the shape this item wants everywhere. `dialog` and `icons` are DOM-free today and could join that list without any of this work. `toast` is DOM-free in its own body but imports `dom.js`, so it cannot join until the exception below is settled; that is the one place the exception costs coverage rather than only churn.

`main.js` is the entry point and already does what this item asks of everything else: two `init` calls, then the data setters behind one `Promise.all`.

## The one sanctioned exception: `js/dom.js`

It resolves every static element with `getElementById` at import time. That is safe because the module script is at the end of `<body>`, and making it lazy would churn every call site for no benefit. Keep it, and document it in CLAUDE.md as *the* import-time DOM access — one named exception is a convention; an unstated exception list is the current problem.

## Sketch

One module per commit, each mechanical: wrap each self-wiring module's top-level statements in an exported `initX()`, call them from `main.js` in an explicit commented order, and widen `imports.test.js` to cover every module and assert each exports its `init`.

Boot is two phases, and a flat call list hides that the second waits on a fetch. Synchronously: the `init` calls. Once the sidecars land: `setAnnotations` / `setFieldTypes` / `setEnumLabels` / `setGlossary` / `setTypeInfo` / `setMessages`, then `addGame(...)`, `resize()` and `applyHash()`.

Only two orderings inside the first phase are real, and both are worth a comment rather than a convention. `initSettings()` precedes `initSidebar()`, which reads the view snapshot through it. And everything seeding draw state precedes the first `draw()`, which the second phase triggers: `initSidebar()` populates `state.show` and `PENS.on`, `initInteraction()` sets `menu-open` before the first paint. Every other surface can init in any order after those.

## Watch out

**`main.js` does not import `campanel`, `route` or `place`.** They are reached through `interaction.js`, which imports them for the functions it calls. An explicit call list in `main.js` needs those three imported there, which is the one place the split is not a pure wrap-and-move.

**Module-level `const` DOM references** in `campanel.js`, `route.js`, `fieldpanel.js` and `place.js` can stay as they are: they go through `dom.js`, the sanctioned exception. Only the listener registration and DOM mutation needs to move into `init`. Moving the consts too is churn for nothing.

**`sidebar.js` does the most work at import** of any module here: it reads the view snapshot, mutates `CATS[].on`, builds the filter checkboxes, seeds `state.show` from the HTML `checked` attributes, and sets `PENS.on` from it. All of that must move wholesale into `initSidebar()`, ahead of the first `draw()`.

**`dom.js`'s `COLOR` block** reads CSS custom properties at import, a `getComputedStyle` call rather than a DOM mutation, and sits under the one sanctioned exception above beside the element lookups, so it stays where it is.

**`whatsnew.js` calls `init()` at import already**, and it is `async`. Export it instead of self-calling; `main.js` should not await it, since the panel appearing late is fine and already how it behaves.

## Verify

`npm test` with the widened import test, `npm run lint`, then a click-through of the surface each self-wiring module above owns, plus embed mode and a cold load with a permalink. This is the item where a browser smoke test would pay for itself — if [69](item-069-browser-smoke-tests.md) gets un-deferred, doing it *before* this is the better order.

## Ships with

A CLAUDE.md edit — it says "`js/main.js` is the boot entry", which extends to stating the convention and the `dom.js` exception. No changelog entry.
