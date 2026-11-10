# 3. Route planner

**Status:** shipped 2026-07-21 · **Effort:** medium-large · **Where:** anywhere, viewer-only

## What and why

The ruler's big sibling: click waypoints to build a polyline, get per-leg and cumulative distance in world units and grid squares, encoded in the URL hash so a route is shareable like a permalink. The feature speedrunners would bookmark, and entirely client-side.

## Sketch

A "Route" mode toggle, mutually exclusive with the ruler the way the ruler is with follow-clicks; waypoints as `#…&route=x1,y1;x2,y2;…` appended to the existing hash scheme; undo on Backspace and a clear; labels per leg; the existing 25-unit grid conversion for the readouts.

Watch out: the hash already carries `GAME/LEVEL/path/x/y/zoom` — extend it without breaking old links, and keep `applyHash` in [js/navigate.js](../public/js/navigation/navigate.js) tolerant.

## Findings

**The sketched `&route=` would have broken every deployed viewer, and the watch-out is what caught it.** An older viewer parsing `…/zoom&route=…` reads the zoom segment as `NaN`, so a shared link would have landed people on a broken view rather than simply ignoring the part they could not use. Trailing segments are matched by shape instead, which an old viewer skips silently.

The payload parses all-or-nothing with a 512-point cap, so a URL a chat app has truncated fails visibly rather than quietly opening a shorter route than the one that was shared.

## Decided

**Route data is independent of route mode**, diverging from the ruler, which clears on disarm. A shared link opens with the route visible, follow-clicks live and no mode armed — because the recipient wants to read the route, not edit it.

**Edits rewrite the hash silently; clear pushes a history entry**, so the browser Back button restores a route you cleared by accident but does not step through every waypoint you placed.

**A path switch clears the route**, guarded on path identity against the hash-write loop's same-path re-fires.

## Shipped

A "Route planner" display toggle (`r`): clicks become waypoints on a solid accent polyline with a ringed start, per-leg length labels (skipped under 60 screen pixels), and a top-centre bar totalling world units and grid squares with undo and clear buttons — the touch affordance, with Backspace for keyboards. Waypoints are draw-space like the ruler's, so legs sum across cells.

Rode in with a standalone fix: the ruler's crosshair no longer snaps back on the first mouse move.
