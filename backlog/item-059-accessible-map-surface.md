# 59. Give the map an accessible surface

**Status:** shipped 2026-08-22 · **Effort:** small-medium (accessibility) · **Where:** anywhere, viewer-only · **Filed:** 2026-07-24/25 review

## Symptom

Two related gaps.

*Assistive tech sees nothing.* `<canvas id="cv">` has no `role`, no accessible name, no `tabindex` and no text alternative. A screen-reader user gets an unlabelled graphic and no indication of what is on it or that anything changed.

*Keyboard users cannot inspect.* Arrow keys pan, `+`/`-` zoom, `[`/`]` cycle paths, and the display toggles have letter keys — but hovering, following a door, and opening the screen list are all pointer-only. Search is the sole keyboard route to an object, and it cannot answer "what is on this screen".

## Sketch, in two commits

*Commit 1 — announce state.* Add a visually-hidden live region and write to it on `selection-changed`:

```html
<div id="a11yStatus" class="sr-only" role="status" aria-live="polite"></div>
```

Content: game, level (full name), path, its curated or in-game name if any, and the object count — "Abe's Oddysee, Rupture Farms, path 15, Before Packaging, 283 objects". Everything needed is already computed for the sidebar. Also give the canvas `role="img"` and an `aria-label` carrying the same summary, so it is not an anonymous graphic when focus lands near it.

*Commit 2 — a keyboard route into a screen.* Bind a key (`l` for "list" is free; check against the existing map, since `g`, `c`, `f`, `a`, `r`, `m`, `i`, `/`, `?`, `[`, `]` are taken) that opens `openCamPanel` for the camera at the **view centre** rather than the pointer. `openCamPanel(x, y, focus)` already takes draw-space coordinates. The panel's rows are already `<button>`s, so once open it is fully navigable and each row jumps. Add the binding to the `?` overlay and the README controls list in the same commit.

## Watch out

**`.sr-only` does not exist in the stylesheet yet.** Add the standard clip-rect pattern rather than `display: none`, which removes it from the accessibility tree, or `visibility: hidden`.

**Do not make the canvas `tabindex="0"` without giving it something to do.** A focusable element that announces nothing on focus is worse than a labelled `role="img"`. If it becomes focusable later — for a roving-focus object cursor, which would be the real fix — that is separate, larger work.

**Announcement volume.** `selection-changed` re-fires for the same path on every pushed hash write. Announcing on every fire would make a screen reader chatter during ordinary browsing. Guard on an actual path change, the way `fieldpanel.js` and `campanel.js` already do.

**The place panel already announces this.** `#placePanel` ([js/place.js](../public/js/panels/place.js)) is a live region carrying game, level, path and its name, so while it is open a global region would say the same thing twice. Make `#a11yStatus` the single announcer — drop the panel's `aria-live` when this lands — rather than gating one on the other. [39](item-039-where-am-i-surface.md) records the same obligation from its side.

## Related, already tracked

[14](item-014-polish-pile.md)'s off-screen tab stops were the third leg of this problem and have since shipped, so that part is done.

## Grown since filing

The By-the-numbers panel ([87](item-087-by-the-numbers.md)) brought two more: its count grid is styled spans carrying no table semantics for a screen reader, and `#numbersBtn` opens a panel without the `aria-expanded` / `aria-controls` pair `#placeBtn` models.

The minimap ([80](item-080-minimap-inset.md)) scrubs by pointer alone, so a keyboard user has the arrow keys but not the jump-anywhere gesture the rectangle offers.

## Verify

VoiceOver on macOS or NVDA on Windows: load the page, tab to the map, switch paths, confirm the announcement fires once per real change and reads sensibly. Then unplug the mouse and try to answer "what is on screen R1 P15 C04" using only the keyboard.

## Ships with

A README controls-list update and a `changelog.json` entry, tag `improved`, for the keyboard binding. The live region alone is arguably invisible to most, but it is still a user-facing capability — an entry is justified.

## Shipped: the announcer and the keyboard's route into a screen, 2026-08-22

`#a11yStatus` and [js/a11y.js](../public/js/chrome/a11y.js), in *The map says where it is, out loud*: a `.sr-only` `role="status"` region on `<body>` naming the game, the level, the path and its name, the object count, and that the path carries a note where it does, with `#cv` taking the same sentence as its `aria-label` under `role="img"`. And `l`, in *A key lists what is on the screen you are looking at*: the screen list opened on the view's centre with focus inside it.

Four things the sketch did not know.

**Aiming at the cell under the view centre would have refused on half the map.** `fitView` frames a path's whole `w × h` grid, and a path's cells are mostly empty — 91 of the 191 shipped paths have a camera under that centre and **100 do not**, and with the screens spaced apart only 8 of Oddysee's 74 do. A key that fails on a coin flip at the exact moment it will be pressed is not a route into anything, so `nearestCam` answers with the closest screen rather than demanding a hit. That disposed of the sketch's toast as well: there is nothing left to report, a path always having a camera somewhere. The click keeps the old rule and still dismisses on the void.

**Dropping the panel's `aria-live` needed something to replace it, and the chip was the wrong something.** `i` is a global key pressed with focus on the body, so with the region gone it announced nothing whatever. Moving focus to `#placeBtn` looked like the answer and was worse than the disease: the chip's own label is rewritten on every selection change, and an accessible name that changes under the focus *is* announced, so parking there would have doubled every step of `[` and `]`. Focus goes onto the panel instead — `tabindex="-1"` and a `role="group"` of its own — which is the same treatment the screen list needed, and the two halves ended up agreeing rather than solving one problem in opposite directions.

**The identity guard the sketch asked for is necessary and not sufficient.** A held `[` or `]` steps a path per autorepeat and every step is a real change of path, so nine announcements queue for one keypress and speak long after the key is up; and `applyHash` reaches a path in another level through that level's first path, so a permalink announced a place nobody chose before the one they asked for. The region settles for 250ms and says where the stepping stopped. Both were measured in a browser, before and after.

**The sentence went into a DOM-free module of its own** — it is the only prose in the app no sighted check can read, and there is no DOM harness here. Its sweep pins that all 191 paths read as one well-formed sentence and, more usefully, that no two read alike: assistive tech does not re-announce a region rewritten with the text it already held, so two paths sharing a sentence would be a move that went unsaid.

Dropping the `aria-live` also spent the deferral [39](item-039-where-am-i-surface.md) had built for it — `syncPlace` needs neither `panel.offsetParent` nor the call from `toggleMenu`, a panel nobody is listening to being safe to fill under cover — and it closed 39's other leftover, the `aria-hidden` note dot, by putting what the dot says into the announced sentence.

**Released rather than carried:** the three under *Grown since filing* arrived here after both symptoms above were answered, and a surface that grew onto an item is not a reason to hold it open. `#numbersBtn`'s missing `aria-expanded`/`aria-controls` pair and the count grid's absent table semantics belong to the By-the-numbers surface and want one commit between them; the minimap's pointer-only scrubbing is a new interaction rather than a label, colliding head-on with arrows that already pan, and belongs with the roving-focus object cursor this item defers rather than bolted onto the end of it. That cursor is also why the *Verify* note above says "tab to the map" and cannot: with `role="img"` and no `tabindex` the canvas is reached by a virtual cursor, which is the deliberate choice, not an oversight.
