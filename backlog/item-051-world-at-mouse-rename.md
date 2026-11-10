# 51. `worldAtMouse()` returns draw space, not world space

**Status:** shipped 2026-07-26 · **Effort:** tiny (viewer, rename) · **Where:** anywhere, viewer-only · **Filed:** 2026-07-24/25 review

## Symptom

No user-visible defect. [js/interaction.js](../public/js/interaction.js)'s `worldAtMouse` returns `{x: cam.x + mouse.x / cam.z, …}` — draw space, not world space. Its consumers are all correct: `state.ruler` (documented draw-space in [js/state.js](../public/js/data/state.js)), `addRoutePoint`, `openCamPanel` → `cellAt`, and the hover rect comparisons against `dX(t.x1)`. The single place that wants real world units converts explicitly on the next line, `wX(w.x)` in the HUD write.

## Why it matters

The name is the only thing that lies, and it lies precisely at the seam where this project's geometry bugs live — the AO cell margin and AE scaling asymmetry that [CLAUDE.md](../CLAUDE.md) devotes a whole section to. The next person to add a feature that needs true world coordinates will reach for the function whose name promises them.

## Sketch

Rename to `drawAtMouse()`. Five call sites plus the definition, all in one module. While there, the local `const w = worldAtMouse()` inside `updateHover` is also misleadingly named — `d` or `pt` reads better next to the `wX(w.x)` conversion.

## Watch out

Do not "fix" it the other way by making the function return world coordinates: every consumer is correct as-is, and converting would break the ruler, the route and the cam panel at once.

## Verify

`npm run lint` and a click-through of ruler, route, cam panel and hover. Pure rename, no behaviour change.

## Shipped

As sketched, in *Rename worldAtMouse to drawAtMouse* (`1b967d0`) — the definition, its five call sites and `updateHover`'s local, which took `pt`.

## Ships with

Nothing — internal. No changelog entry.
