# 61. Export the whole path, not the viewport

**Status:** shipped 2026-08-23 · **Effort:** medium (viewer, product) · **Where:** anywhere, but test the size limits on a real iPhone · **Filed:** 2026-07-24/25 review

## What the current button actually does

`cv.toBlob` in [js/sidebar.js](../public/js/chrome/sidebar.js) copies **the pixels currently on screen**. So "Export view as PNG" is a screenshot: cropped to the window, at whatever zoom happens to be set, at `devicePixelRatio` scaling, including whatever slivers of neighbouring screens are visible and excluding everything scrolled out of frame. To get a whole level today you must zoom out until it fits — which downsamples 368×240 artwork until the objects are unreadable — and you still get window letterboxing around it.

## What is proposed instead

A second export that renders the **entire current path** into an offscreen canvas at 1:1 and downloads that: `path.w * CELL_W` × `path.h * CELL_H` pixels, every camera laid edge to edge at native artwork resolution, with the overlays the user currently has enabled drawn on top. No window, no crop, no zoom loss. For AO R1 P15, 12×3 cells, that is a 4416×720 PNG containing all 20 screens.

## Why it is worth building

This is the artifact people actually want from a map site — the thing that gets posted to a wiki, a forum thread or a speedrun guide, printed, or annotated in an image editor, with the site's URL implicitly attached to it. The viewport screenshot is a debugging aid by comparison. It also composes with everything already built: the route planner's polyline and per-leg labels appear on it, as do the connection arrows and the foreground masks.

## Sketch

1. **Parameterise the renderer.** `draw()` in [js/render.js](../public/js/painter/render.js) uses the module-level `ctx`/`cv` and reads `state.cam` directly. Extract the body into `paint(ctx, cam, width, height, dpr)` and reduce `draw()` to a call with the live values. Mechanical.
2. **Preload the artwork.** `img()` is lazy and `draw()` skips images that are not `complete` — fine for an interactive canvas that repaints, fatal for a one-shot export, where you would silently get holes. Add a helper that resolves when every `png` (and `fg`, if `show.fg`) of `path.cams` has loaded, and await it before painting. Same for `tintedImg`, which returns `null` until its source is loaded.
3. **Paint and download.** Create the offscreen canvas at full path size, paint at `z = 1`, `toBlob`, reuse the download helper with [49](item-049-png-export-revoke-race.md)'s deferred revoke.
4. **UI.** Two buttons — "Export view" and "Export whole path" — is the clearest and avoids a mode.

## Watch out — canvas size limits, the real constraint

Largest paths, measured from the shipped data:

| path | cells | pixels | megapixels | RGBA backing store | cams |
| --- | --- | --- | --- | --- | --- |
| AE MI P4 | 12×14 | 4416×3360 | 14.8 | 59 MB | 37 |
| AE MI P1 | 15×9 | 5520×2160 | 11.9 | 48 MB | 31 |
| AE BA P5 | 13×10 | 4784×2400 | 11.5 | 46 MB | 24 |
| median path | — | — | 1.8 | 7 MB | — |

The median is trivial; the tail is not. Historical iOS Safari caps canvas area near 16.8 MP **and** a single dimension at 4096 px — AE MI P1 is 5520 px wide and would fail there. Modern Safari has raised both, but this must be tested on a real device. Design for the failure: compute the target size, and if it exceeds a configured budget, scale down to fit and say so in a toast rather than downloading a blank image. `toBlob` calling back with `null` is the existing signal that this happened.

**Label sizes are zoom-relative.** Every font and line width in `paint` is divided by `cam.z` so it stays constant in *screen* pixels. At `z = 1` on a 4416 px-wide image, an 11 px object label is nearly invisible. Decide deliberately: pass an explicit label scale for the export path, or accept small labels as correct-at-1:1. Recommendation: a `labelScale` defaulting to 1, set to ~2 for export. Do not "fix" it by exporting at `z = 2` — that doubles the memory and interpolates the artwork.

**`imageSmoothingEnabled`** is set from `cam.z < 1`; at `z = 1` it is off, which is right for pixel-exact art. Confirm rather than assume after the refactor.

**Transient overlays must not render.** `flash` and `highlight` are hover and navigation affordances and would bake a stray ring or dashed outline into a shared image. Skip both in the export paint. The route and ruler *should* render — the route is promised in the README, and the ruler is a deliberate annotation.

**Filename.** Distinguish the two exports so a folder of them is intelligible.

**File size.** A 15 MP PNG of photographic-ish MDEC art will land in the multi-megabyte range. Fine for an explicit download, but disable the button and show a toast while it runs.

## Verify

Export AO R1 P15 and confirm 4416×720 with all 20 screens present and no missing tiles — that is what the preload step is being tested for. Export AE MI P4 on desktop Chrome, Firefox, Safari and a real iPhone, and record what actually happens on iOS in the commit message. Toggle collision, foreground and connection arrows on and re-export. Plot a route and confirm it and its leg labels appear.

## Shipped

**The size budget exists for the spaced pitch, which the table above does not measure.** Packed, the largest path in either game is the 14.8 MP `AE MI P4` and nothing needs scaling at all. "Gaps between screens" lays AO's screens at the cell's own 1024×480 pitch instead, which takes the Credits path to 10240×4800 — 49.2 MP, 197 MB of backing store — and fourteen AO paths past what a canvas is asked for. The export follows the pitch that is on screen rather than always packing, an image that disagrees with the map it was taken from being worth less than a scaled one, and `pathImage` is where the two bounds are answered.

**The frame is the cell grid, and what the packed layout draws beyond it is cropped.** 248 AO markers and 527 collision-line pieces fall outside a packed export, and not one of them covers a screen: every one is the hollow dotted treatment the map paints to disown ground the games never render. Spaced, where that ground is canvas of its own, it is 0 markers and 2 pieces, and AE loses no markers at either pitch. A margin wide enough to take AO's overhang in would spend the 1:1 promise on the largest packed path, the overhang reaching 269 px past a marker box and 313 px past a collision line (`D1 P3` holds both maxima) where a uniform margin of 121 px is already enough to put `AE MI P4` past the area bound, at 4658×3602. So the frame stays the grid the minimap and the grid overlay already draw. A top-row marker's label, drawn three pixels above its box, is sliced by the image's top edge as it is by the window's.

**Three things move under a one-shot paint.** `paint` draws the path that is standing while the canvas is sized for the one whose artwork was preloaded, so the identity check sits immediately before the paint with nothing awaiting in between: a held `]` autorepeats through the window listener with the button disabled, and thirty milliseconds is enough to paint `R1 P16` into a canvas cut for `R1 P15`. `preloadPath` gives up asking `show.fg` for the same reason and waits for every mask whatever the toggle says, the masks being a percent of the artwork's bytes. `artworkReady` is asked in that same stretch, waiting not being sufficient: a load that failed reports itself complete with no width, and the image cache's own eviction can drop this path while another selection passes through. And the filename is read before the encode rather than after, an encode at this size being long enough for the place it names to move.

**`flash` and `highlight` are not the whole list of transients, and are not the ones that would have shown.** A hover spotlight dims everything it is *not* focused on, a wire to 0.12 alpha and an arrow to 0.15, so exporting with the pointer resting on a wired object would have baked in a near-invisible overlay rather than a stray ring; a hovered Slig's shaded pen is the third. `paint`'s `transients` flag answers for all five at once, and the ruler and the route render as the sketch promised.

**A `null` from `toBlob` is not the only way this fails.** A canvas past a browser's limit ignores what is drawn into it, or quietly clamps the size it was asked for, and a blank canvas encodes to a perfectly valid multi-megabyte PNG — exactly the blank download the *Watch out* above is about. `sizedCanvas` paints one pixel and reads it back before the real paint runs, quartering the area and halving the side until one sticks or the side falls under 1024.

**[49](item-049-png-export-revoke-race.md) asked for its revoke to move into whatever shared download helper this item introduced**, and it has: one `exportUrl` in [js/export.js](../public/js/chrome/export.js), released when the next export of either kind replaces it.

**No label scale, and the running signal is the button rather than a toast.** At 1:1 an 11 px label sits on a 368 px screen exactly as it does at 100% zoom in the browser; doubling it would draw labels larger than the map ever draws them, and at fit-to-window sizes the artwork is illegible anyway, so bigger labels rescue nothing. `imageSmoothingEnabled` needed no change either — off at scale 1 for the pixel art, on when the budget forces a downscale, which is what it was already saying. And a toast is fixed at three seconds, which would leave it standing long after the 207 ms `AE MI P4` takes; `Rendering…` on the disabled button starts and ends with the work.

**Both exports name themselves**, `oddworld-ao-R1-P15-view.png` and `-full.png`. The bare name the viewport export used to take belongs to neither.

**Measured.** `AO R1 P15` exports 4416×720 and is pixel-identical to its twenty cam PNGs tiled edge to edge; `AE MI P4` exports 4416×3360 in 207 ms as a 7.4 MB PNG; `AO C1 P1` spaced scales to 58%, at 5982×2804. Both bounds and the packed-at-1:1 promise are swept over every path at both pitches in `tests/unit/map-data.test.js`.

**iOS is the one thing this could not check.** The probe is what it is designed for and the two bounds in [js/config.js](../public/js/config.js) are there to be retuned, but what a real iPhone does with a 14.8 MP canvas is still unrecorded.

## Ships with

README and a `changelog.json` entry, tag `new`.
