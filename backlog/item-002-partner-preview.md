# 2. Partner preview

**Status:** shipped 2026-07-19 · **Effort:** small · **Where:** anywhere, viewer-only

## What and why

Hovering a door told you where it led in words. Outlining the object you would actually come out of answers the same question in place, without a jump.

## Decided

**Reuse the screen list's highlight slot** rather than inventing a second outline mechanism — the two never want to be shown at once.

**Off-path pairs stay unmarked.** There is nothing on screen to outline, and drawing something anyway would claim a partner is here when it is not.

**An object resolving to itself outlines itself**, which falls out of the outline code knowing nothing about loopbacks and is the honest rendering of what the data says.

## Shipped

Hovering a linked object outlines its same-path counterpart through `destOf` / `resolveTarget` in [js/model.js](../public/js/model/model.js).
