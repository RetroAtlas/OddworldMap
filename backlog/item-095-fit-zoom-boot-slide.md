# 95. A bare link's fit zoom is read off the canvas mid-slide

**Status:** shipped 2026-11-12 · **Effort:** small (one wait in `fitView`, or one more fit) · **Where:** viewer, `navigate.js`

**Filed:** 2026-10-06, found while settling the editing spec for [94](item-094-live-map.md), whose pixel reads disagreed between two paints of one resting view.

## What and why

A link that names a path and no view (`#AE/MI/1`) fits the path to the canvas, and `fitView` reads the canvas width at the instant its first attempt finds a laid-out canvas. On a non-embed boot that instant falls inside the sidebar's slide, which shrinks the canvas over its first fraction of a second, so the width read is whatever the slide had reached. The zoom a fresh visitor lands on drifts with it: over twenty loads of the same link on 2026-10-06 the fit came out anywhere from `z` 0.2185 to 0.2226, and the centre moves with the zoom; no check reproduces the figure, so it is to be measured again before anyone sizes the fix by it. Every later resize keeps the view's centre rather than refitting, so the drift stays until the visitor zooms or fits by hand. Nothing is wrong once the view is placed; the complaint is that the same link does not open the same view twice.

The specs sidestep it: both settle helpers wait for the canvas width to come to rest before the draw they end on, which makes two reads of one resting state agree but leaves the fit itself where the slide put it.

## Sketch

Either `fitView` waits as the specs do, deferring its attempt until the canvas width has held still for a few frames (or until the sidebar's `transitionend`), or the slide's end fits again while no explicit positioning has claimed the view since, which `camToken` already records. The first is simpler and costs a visitor nothing visible, since the slide is what they are watching anyway. A pinned-view link (`#AE/MI/1/x/y/z`) is untouched either way: `centerOn` sets the zoom from the hash and only the corner depends on the canvas, which its centre-keeping resize already corrects.

## Shipped

Landed 2026-11-12, and neither sketch is what shipped: the slide itself came out of the boot. `interaction.js` opens the sidebar on a wide layout with its transition off and the style flushed, and leaves it away on narrow and in an embed, so the box is at its resting width before anything reads it and no view waits on a frame.

Both sketches fail as written. A fit deferred until the width holds still loses to the default boot's own hash write, whose `hashchange` re-applies the link and cancels the waiting fit through `camToken`, leaving the page on the unplaced camera; a second fit at the slide's end resets a view the visitor has wheel-zoomed since, the wheel not bumping `camToken`, on every later toggle of the menu.

Measured 2026-11-12 at 1280×720 over twenty loads each, against a local server: before, `#AE/MI/1` fitted to a box read 1241 to 1274 px wide where it rests at 1030, at `z` 0.2170 to 0.2227 where the fit is 0.1801, and the default boot rested at 0.27 to 0.28 with both ends of its path cut off where the fit is 0.2231; after, both rest on the fit in every load, as they do with a warm cache, behind the service worker and with the dataset held back. The fit read the box mid-slide whenever the boot's last file landed within about 180 ms of the modules running, so a slow connection never met it and a fast one always did.

One slide remains that no toggle starts: a window widened across the 720 px breakpoint with the menu closed runs the stylesheet's own transition, and a fit taken inside it reads the box as it moves.

`tests/browser/smoke.spec.js` holds it: a bare link's path rests fitted to the box beside the sidebar with any slide held at its first frame.
