# 21. CSS design inheritance

**Status:** shipped 2026-07-30 · **Effort:** medium (refactor), in ten commits · **Where:** anywhere — viewer-only

## What and why

`css/main.css` re-stated similar treatments across components instead of sharing them, so the design drifted and each new surface re-defined its look. The cost was measurable rather than aesthetic: adding the About dialog meant editing **nine** separate selector lists that each named the existing three dialogs as peers, plus a standalone width rule. A fifth would have cost ten. Two tooltips wrote the same panel surface independently, and ten `z-index` declarations across seven tiers said nowhere what a tier meant.

## Decided

**The drift fix went first, before any shared class existed.** That is the part worth keeping. The audit's opening finding was not a duplication but a measurement: seven controls rendered in the browser's default control font because `font: inherit` had been written on some rules and not others. Fixing that *first* gave the eight commits after it a zero-diff oracle, and is what made the rest reviewable — and it stopped an accidental defect from shaping the abstraction, since two shared classes had otherwise been drafted with exclusions that existed only to preserve the drift.

**A category reset, not eleven added declarations.** `button, input, select, textarea { font-family: inherit }` beside the `*` rule: the drift happened by omission one rule at a time, so the fix belongs to the category rather than to today's members — the same seam argument as delegating the anchored tooltip on `[data-tip]`.

**`font-family`, never the `font` shorthand.** Measured: the shorthand also resets size, weight and line-height, which would take the level buttons from 12px to 13px and the close glyph's box from 18×24 to 12×19.

**Three outcomes, and choosing between them is what keeps this from being indirection for its own sake:** a *token* where one value must agree across components that are otherwise unalike; a *shared class* where a whole treatment recurs; and *leave it alone* where the repetition is two numbers coinciding. No radius or spacing scale was hoisted — `5/6/8px` are readable as they are.

**A shared class carries only what every member already declares.** `.linkbtn` therefore declares no font at all: `.h2tools`' pair inherits weight 700 from the heading it sits in, while the route bar's keeps the UA `line-height: normal`, so any `font` shorthand on the class breaks one of them.

## Findings

**The family-only fix costs one pixel in the whole application.** Nine to eleven elements change size, all by +1px of height, all of them the 11px controls (the four scope buttons and the four search "show more" rows) where the page font's normal line-height is a pixel taller than the UA font's — plus the two containers that follow. Everything else in the diff is that pixel propagating.

**A zero-tolerance oracle needs one exception, and it is not a defect.** A font-family change also moves text metrics: a span inside a screen-list row shifts 0.02px in width. Sub-pixel deltas want their own reported-but-not-failing bucket, or the commit fails its own check on exactly the thing it is supposed to do. Report rather than ignore, so a real 0.4px shift cannot hide behind the tolerance.

**The nine selector lists are the risk, and a missed one is silent** — an unstyled close button, or a dialog that keeps its desktop width on a phone. Verified after the fact that all nine gained their `#about` peer: overlay base, overlay open state, panel base, panel open state, close button, close hover, the reduced-motion group, and *two* groups inside the narrow media query.

**Moving the dialog state off `body` is the change a style oracle cannot see.** `body.<name>-open` became `.open` on the overlay across four modules; computed styles in the open state would match even if a transition broke. Verified separately: zero surviving readers of the old classes anywhere in `js/`, `css/`, `index.html` or `sw.js`; all four dialogs open and close by close button, Escape and backdrop, each returning focus to its own opener; and mutual exclusion still holds, with `?` behind an open dialog swallowed by the trap's capture-phase `stopImmediatePropagation` rather than by any stacking tier.

**One regression, caught by eye rather than by the oracle, and it is why `.closebtn` carries a magic number.** The close × dropped visibly: the page font's multiplication sign is larger than Arial's — 11.75px of ink against 10.25px — and sits lower in its line box, 0.88px below the heading's optical centre where Arial sat 1.63px above it. A `<button>` centres its own content whatever the height, padding, line-height or `align-content` say, so nothing about the box can fix it and the glyph itself has to be nudged: `top: -0.04em`, proportional so the screen list's 18px close is corrected by the same rule. A computed-style oracle cannot see this, because the box never moved.

**One behavioural commit, flagged as such:** `#tip` moved above the map overlays. It had been recorded as inert on the grounds that an overlay captures the pointer before it can cover the tooltip — but that only holds while the *cursor* is inside the overlay, and the tooltip's box is placed 16px down-right of the cursor and can be 340px wide, so it reaches onto an overlay from outside it. A live defect, not a latent one, and it ships with a changelog entry.

## Shipped

Ten commits. The stylesheet went 1230 to 1137 lines, 183 rules to 179, and mentions of a dialog by name fell from 57 to 13, so a fifth dialog now costs no CSS unless its width differs.

Verified by computed style **plus box geometry over every element across 44 states** at 1440×900 and 390×844: default, the Fields picker, all four dialogs, both tooltips, the screen list, the place panel, the route bar armed and disabled, a toast, embed mode, hover and keyboard-focus states, reduced motion. The harness was self-checked against two captures of the *unchanged* site before being trusted, which caught a real flaw in it — Chrome enumerates custom properties in an unstable order, so an index-keyed comparison was matching `--line` against `--sidebar-w`.

**Left undone deliberately:** the four dialog modules still duplicate their open/close/backdrop/trap wiring, which a `bindDialog` in [js/dialog.js](../public/js/ui/dialog.js) would collapse. That is a JS concern rather than this one's, and it is the obvious next step for anyone who finds the duplication.
