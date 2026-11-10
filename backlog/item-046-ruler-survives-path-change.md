# 46. The ruler survives a path change

**Status:** shipped 2026-07-26 · **Effort:** tiny (viewer, bug) · **Where:** anywhere, viewer-only · **Filed:** 2026-07-24/25 review

## Symptom

Arm the ruler, drag a measurement, press `[` or `]`. The measurement stays on screen, at the same draw-space coordinates, now overlaying a different path and measuring nothing. It survives a game switch too, where `setGeometry` changes `SX`/`SY` and the readout becomes actively wrong rather than merely stale.

## Cause

`state.route` has an explicit lifecycle — [js/route.js](../public/js/navigation/route.js) clears it on `selection-changed` with the comment "waypoints don't outlive their path". `state.ruler` has no such listener. Its only clear site is in [js/sidebar.js](../public/js/sidebar.js), on mode-off: "measurements don't outlive the mode". Both comments state the same intent; only one was enforced against path changes.

## Sketch

Add the missing clear, in [js/interaction.js](../public/js/interaction.js) which owns the ruler's pointer lifecycle, or alongside the other `selection-changed` listeners:

```js
window.addEventListener("selection-changed", () => {
  if (state.ruler) { state.ruler = null; scheduleDraw(); }
});
```

## Watch out

`selection-changed` re-fires for the *same* path on every pushed hash write — the trap `js/route.js` and `js/campanel.js` both guard against with a path-identity check. The route guards because clearing on a same-path re-fire would destroy user work mid-browse. The ruler deliberately does not: a follow-click that lands back on the current path is still navigation, so the shipped rule clears the measurement unconditionally.

## Verify

AO R1: arm the ruler with `m`, drag a measurement, press `]` — line gone. Switch AO→AE with a measurement laid out — gone. Follow a door within the same path — gone there too.

## Shipped

*Clear the ruler when the path changes* (`6158571`) chose the unconditional rule: [js/interaction.js](../public/js/interaction.js) discards a measurement on every `selection-changed`, including a same-path re-fire, with no `rulerPath` identity guard. A follow is navigation even when it lands on the current path, so the measurement does not survive it.

## Ships with

A `changelog.json` entry, tag `fixed`. No README change: the ruler bullet already implies per-path scope.
