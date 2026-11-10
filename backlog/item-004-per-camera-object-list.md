# 4. Per-camera object list

**Status:** shipped 2026-07-19 · **Effort:** medium · **Where:** anywhere, viewer-only

## What and why

A click that found nothing followable did nothing at all, and on a touch screen — where there is no hover — there was no way to ask what is on a screen. The list is the answer to both, and it is what touch has *instead* of a tooltip.

## Decided

**It opens only when the click finds nothing to follow**, so it never competes with a door.

**It survives a same-path re-selection.** A row click jumps the view, which re-fires selection; without the guard the panel would close itself on every jump it caused.

## Shipped

[js/campanel.js](../public/js/panels/campanel.js): click or tap a screen with nothing followable to list its objects grouped by category. Rows outline on hover through render's `setHighlight` and jump on click.
