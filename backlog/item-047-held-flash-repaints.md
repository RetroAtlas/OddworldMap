# 47. A held flash repaints forever

**Status:** shipped 2026-07-26 · **Effort:** tiny (viewer, bug) · **Where:** anywhere, viewer-only · **Filed:** 2026-07-24/25 review

## Symptom

Open an object permalink — the links right-click produces. The held marker pulses. If you never click, scroll or press a key, `requestAnimationFrame` keeps calling the full-canvas `draw()` at 60 fps **indefinitely**. That is the shared-link-in-a-chat path exactly: someone opens the link, reads the tooltip, leaves the tab open. On a phone it is a battery hole with no visible cause.

## Cause

[js/render.js](../public/js/painter/render.js)'s `animateFlash` releases the hold only when `performance.now() - flash.t0 > FLASH_MS` **and** `flashInteracted`. That flag is set only by `pointerdown`, `wheel` and `keydown`. Moving the mouse is not interaction, so the loop never terminates. Entered from [js/navigate.js](../public/js/navigate.js), `flashAt(fx, fy, true)`.

## The guard was already there

A short guard already prevents an accidental early mouse move from dismissing the marker before the user sees it: `flashInteracted` is only *consulted* after `FLASH_MS` (1600 ms) has elapsed, so an early interaction sets the flag but cannot release the hold. The fix therefore needed exactly two things:

1. Add `pointermove` to the interaction event list.
2. Add a hard cap so the pulse ends on its own: a `FLASH_HOLD_MAX_MS = 30000` in [js/config.js](../public/js/config.js), released in `animateFlash` regardless of interaction.

```js
if (flash.hold) {
  const el = performance.now() - flash.t0;
  if ((el > FLASH_MS && flashInteracted) || el > FLASH_HOLD_MAX_MS) {
    flash.hold = false;
    flash.t0 = performance.now();
  }
}
```

## Overlapping flashes

`flashAt` also started a new `animateFlash` loop without stopping the previous one, so two overlapping flashes ran two rAF loops and doubled the redraws until the flash cleared. They both self-terminated on `if (!flash) return`, so it was a waste rather than a leak. The shipped fix holds the handle and cancels the active animation frame before starting another; it landed in the same commit because it is the same function and class of defect.

## Watch out

The `pointermove` listener is `{capture: true, passive: true}` and sets one boolean, so the cost is negligible — but it fires for the life of the page. Attaching the interaction listeners only while `flash?.hold` is true and detaching on release would be more code for no measurable gain, so the flat listener stayed.

## Verify

Open an object permalink and touch nothing: the pulse must stop within ~30 s and the rAF loop with it. Then reopen and move the mouse after 2 s — the marker fades. Move the mouse *immediately* on load — the marker stays until 1600 ms have passed.

## Shipped

*End the held flash without an interaction* (`3356f04`) took the optional tidy in the same commit as the fix: `pointermove` releases a held marker after its initial guard, the 30-second cap releases one nobody touches, and `flashAt` cancels the active animation frame before starting another. The flat lifetime listeners stayed; attaching and detaching them around each flash would have been more machinery for no measurable gain.

## Ships with

A `changelog.json` entry, tag `fixed`, phrased for players ("the marker on a shared object link now settles instead of pulsing indefinitely") rather than as a rAF story.
