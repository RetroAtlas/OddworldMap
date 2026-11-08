# 80. Minimap inset

**Status:** shipped 2026-08-09 · **Effort:** medium (viewer) · **Where:** anywhere · **Filed:** 2026-08-07 feature-ideation sweep

## Why

The classic map-viewer affordance this viewer lacks: at one-screen zoom on a big path (AE MI P4 is 12×14 cells, the Brewery runs to 28 paths) there is nothing that says where in the path you are or how much of it lies off-screen. The camera grid names the screen you are on but not the shape of the whole; zooming out to orient and back in to read is the workaround, and it discards the zoom you were working at.

## Sketch

- A small inset in a map corner: the path's cell grid drawn flat (filled cell = has a camera, empty = margin), with a viewport rectangle that tracks `state.cam`. Click or drag inside it to move the view; the rectangle is the handle.
- Flat cells first. Thumbnailing the actual artwork means decoding every cam of the path at once — the eviction cap in [js/spriteart.js](../public/js/spriteart.js) exists because that pressure is real. If art thumbnails ever come, they come as a second pass with their own budget.
- Redraw piggybacks on `draw()` — the inset is a second, tiny projection of the same state, so it can be painted at the end of the same frame rather than on its own loop.
- Hide it when the whole path already fits the window (it would duplicate what the eye sees), and on narrow screens, where its corner does not exist.

## Watch out

- Corner space is contested and [72](item-072-copy-embed-code-button.md) is the standing restraint on new chrome. A minimap is furniture rather than a button, but the same instinct applies: it must earn the pixels it covers. Bottom-right (above `#hud`) was the least-loaded corner when this was filed — the same day, [87](item-087-by-the-numbers.md)'s panel docked exactly there, so the inset must share it: sit above the panel, or yield while one is open.
- Decide embed mode deliberately: an iframe is exactly where orientation help is scarce, so hiding it there (`.chrome`) is probably wrong.

## Shipped

As sketched: flat cells, the viewport rectangle as handle, painting at the end of `draw()` (so it can never lag a pan), hidden when the path fits and on narrow. The corner contest resolved as *yield*: a CSS `:has` rule hides the inset while the numbers panel is open, which costs nothing and never stacks two surfaces. Embeds keep it, deliberately not `.chrome`. The viewport rectangle is drawn unclamped — a view out in the margins really is out there, and the canvas edge clips it honestly. Scrubbing lives in [js/minimap.js](../public/js/minimap.js) through the same exported scale factor the painter uses, so the two can't drift.
