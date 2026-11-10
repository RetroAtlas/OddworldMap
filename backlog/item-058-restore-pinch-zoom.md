# 58. Restore pinch-zoom of the page chrome

**Status:** shipped 2026-07-27 · **Effort:** tiny as filed; the real fix was not · **Where:** anywhere, but verify on real devices · **Filed:** 2026-07-24/25 review

## Symptom

[index.html](../public/index.html) set `maximum-scale=1, user-scalable=no`. That fails WCAG 2.1 SC 1.4.4 (Resize Text) and is flagged by every automated audit.

## Why it looked like it would cost nothing

The reason this attribute usually exists is to stop the browser hijacking gestures over an interactive canvas — but `#cv` already has `touch-action: none`, which does that job properly and locally. The viewport attribute adds nothing for the map and takes away the ability to zoom the sidebar, the settings dialog, the What's New panel and the tooltips, which is all the text.

## Sketch

One line:

```html
<meta name="viewport" content="width=device-width, initial-scale=1" />
```

## Found while doing it — the one-line version is a trap, and it shipped once and was reverted

That sketch is exactly what landed and was dropped, as *Let the page zoom on touch devices*. **Do not go looking for that commit:** it was never pushed, the `backup/dropped-zoom-on-phone` branch the review recorded it on no longer exists, and the object is now reachable from no ref at all, so it survives only until the next `gc`. Nothing is lost that this entry does not already say, and the reason it was dropped is the point rather than the code.

`touch-action: none` is not only what defends the canvas, it is also the browser's *only* way back out of a page zoom. Zoom the page to read the drawer, and every surface that accepts a pinch is dismissible — the drawer even closes itself on a path pick, and a toast expires on a timer — so the map fills the screen at scale 2 and refuses to give it back.

Resetting the zoom when a panel closes is the wrong shape: it needs a viewport-meta hack on iOS, it cannot cover a transient toast, and it throws away a zoom the user asked for.

**What shipped instead** (*Let the page zoom without trapping the user*, `f1222f7`): [js/interaction.js](../public/js/chrome/interaction.js) watches `visualViewport.scale` and sets `body.page-zoomed`, which relaxes the canvas to `touch-action: pinch-zoom`, suspends the app's own pinch, and skips `setPointerCapture` — capture would keep the gesture from reaching the browser. One finger still pans throughout; at scale 1 the map takes its pinch back.

Two more things the sketch missed: `user-scalable=no` was also suppressing double-tap zoom and the ~300 ms tap delay a zoomable page costs, so `body { touch-action: manipulation }` restores the responsiveness without touching pinch; and the meta gained `minimum-scale=1`, which WCAG does not care about and which removes the pinch-out-below-fit state.

iOS enlarging the page when the under-16px search box takes focus was left alone deliberately — a 16px search box looked wrong, and the escape hatch makes the zoom harmless.

## Watch out

Test two-finger pinch **on the map** on a real iOS device and a real Android device — confirm it still pinch-zooms the canvas and does not zoom the page. Verify rather than assume, because this is the exact fear the attribute was defending against. Also check the bottom-sheet cam panel and the modal overlays at page zoom 200%.

## Ships with

A `changelog.json` entry, tag `improved` ("the page can be zoomed on phones"), plus the README touch-controls bullet and a CLAUDE.md note that `#cv`'s `touch-action` is conditional and why.
