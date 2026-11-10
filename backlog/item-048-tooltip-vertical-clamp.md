# 48. The tooltip has no vertical clamp

**Status:** shipped 2026-07-26 · **Effort:** tiny (viewer, bug) · **Where:** anywhere, viewer-only · **Filed:** 2026-07-24/25 review

## Symptom

Hover an object in the lower part of the map with several objects stacked, or with "show more object fields" on, and the tooltip is cut off at the bottom of the window. `html, body { overflow: hidden }` in [css/main.css](../public/css/main.css), so there is no scroll to recover it. The tooltip is tallest exactly when it carries the most information.

## Cause

Three defects in three lines of [js/interaction.js](../public/js/chrome/interaction.js):

```js
const px = Math.min(mouse.x + 16, cv.clientWidth - (TIP_MAX_W + 10));
tip.style.left = px + "px";
tip.style.top = mouse.y + 16 + "px";
```

`top` is never clamped; the horizontal clamp uses `TIP_MAX_W` (340 px, the CSS max) instead of the rendered width, so a narrow tooltip near the right edge jumps further left than it needs to; and `Math.min` has no lower bound, so below ~350 px of canvas width `cv.clientWidth - 350` goes negative and the tooltip starts off the left edge.

## Sketch

Measure after setting `innerHTML` — the element is already `display: block` at that point, so `offsetWidth`/`offsetHeight` are valid — and flip rather than clamp on the vertical axis, since a tooltip pinned to the bottom edge covers the thing you are hovering:

```js
tip.style.display = "block";
tip.innerHTML = …;                                    // set content first: the clamp needs real dimensions
const tw = tip.offsetWidth, th = tip.offsetHeight;
const left = Math.max(6, Math.min(mouse.x + 16, cv.clientWidth - tw - 10));
const below = mouse.y + 16;
const top = below + th > cv.clientHeight ? Math.max(6, mouse.y - th - 12) : below;
tip.style.left = left + "px";
tip.style.top = top + "px";
```

## Found while doing it

**Reset `left` before measuring.** An absolutely positioned element's shrink-to-fit width is limited by the distance from its `left` to the containing block's right edge, so measuring at the previous frame's position squeezes the tooltip — and it then stays narrow near the right edge.

## Watch out

Reading `offsetWidth`/`offsetHeight` right after an `innerHTML` write forces a synchronous layout, and this runs on every `pointermove` through `updateHover`. In practice the tooltip subtree is small and this is one reflow per move, but if a profile shows it, cache the measurement and re-measure only when the HTML string actually changed. Do not pre-empt that optimisation without a measurement.

The CSS `--tip-max-w` token still owns the tooltip's visual maximum, but the shipped placement code no longer reads it: measuring the rendered width made the `TIP_MAX_W` constant and its `cssVar` import unnecessary, so both were removed.

## Verify

Desktop, window ~600 px tall: hover a Slig near the bottom edge with "show more object fields" on — the tooltip flips above the cursor and stays fully visible. Narrow the window to ~320 px: the tooltip never starts left of 6 px. Hover an 8-object stack — the `+N more…` case — at the bottom, still fully visible.

## Shipped

*Keep the hover tooltip inside the window* (`0f38e7e`) resets `left` before measuring, measures and caches the rendered dimensions whenever the content or canvas size changes, flips above the pointer when there is no room below, and clamps horizontally against the real width. A CSS max-height protects the last edge case. Shipped with a `changelog.json` entry tagged `fixed`.
