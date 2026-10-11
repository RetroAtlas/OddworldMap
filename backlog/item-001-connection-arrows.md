# 1. Connection arrows overlay

**Status:** shipped 2026-07-19 · **Effort:** medium · **Where:** anywhere, viewer-only

## What and why

A path's circulation — which door leads where, which well comes out on which screen — was only readable one object at a time, by hovering each in turn. Drawing the whole graph at once turns a path from a picture into a map you can plan a route across.

## Decided

**A per-kind palette rather than the category colours.** One CATS bucket owns every linking kind, so colouring by category would have made the whole overlay monochrome; `CONN_COLORS` gives doors, wells, portals, teleporters and path transitions each their own.

**Off-path destinations get a stub, not a line to nowhere.** A fixed-45° labelled stub says where the link goes without pretending the target is on screen.

**Hovering an object spotlights its own edges**, which is what keeps a busy path legible once every link is drawn at once.

## Shipped

`computeConnections` in [js/model.js](../public/js/model.js) — unit-tested, consolidating mutual pairs into two-way edges, keeping asymmetric ones directed, and dashing camera-fallback edges — drawn as Bézier arrows in [js/render.js](../public/js/render.js) behind a persisted `tConn` toggle and an `a` shortcut.

## Grown since filing

**A transition's stub points the way it leads, 2026-10-11.** A path transition only ever hands over to the neighbouring screen, so its stub leaves the screen by the edge it sits at, left, right, up or down, which `computeConnections` reads off the dataset's geometry as the stub's `dir`; a transition's marker spans its whole edge zone, so the stub runs out to the marker's edge rather than ending inside it. The fixed 45° stub stays for doors, wells, portals and teleporters, whose far end can be anywhere.
