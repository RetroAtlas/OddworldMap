# 6. Background-plane objects

**Status:** shipped 2026-07-25 · **Effort:** small · **Where:** anywhere, viewer-only once the data landed

## What and why

Objects on the half-scale background plane looked identical to foreground ones, and plane confusion is a real trip-up when reading a route — the collision lines already hinted at the distinction by drawing dashed, but nothing else did.

## Sketch

The item was filed as **background-plane _badges_**: give the objects a subtle badge or dimmer treatment. The plane is derivable from the object's `scale` field (background = half), so decode it in the builder as `extra.plane` and style it in the viewer.

## Findings

**Neither half of the sketch survived, and both were replaced by something already in the repo.**

The badge lost to the dashing: the app has no badges anywhere, so one would have invented a vocabulary, while dimming and dashing extends the cue the collision lines already carry. The item is named after the thing that was ruled out.

The builder-side `extra.plane` became unnecessary — the full-field extraction put `scale` in every gameplay object's `fields` archive, so the plane is derivable in the viewer with no rebuild at all.

**And the raw value cannot be trusted directly.** The per-object scale enums disagree about which number means which plane: `InvisibleSwitch` and `GlukkonSwitch` read 1 as *full*. So `onBackgroundPlane(game, t)` in [js/fields.js](../public/js/model/fields.js) resolves `scale` through the field's game type and tests the resulting *label* for "half", falling back to the plain 1 = half only for an untyped bare-int scale. A viewer that had keyed off the raw 1 would have drawn those two types on the wrong plane.

## Shipped

Objects whose `scale` is half draw at half opacity with a dashed outline. Objects with no scale field — no gameplay type — draw normally.

## 6b. Decode door lock state

Filed as its own sub-item and shipped inside the same arc, so it lives here rather than taking a number of its own.

**What it wanted:** doors carry `start_state`, `door_closed` (AO only) and a gate `switch_id` that the builder did not decode. Reading them lets the viewer tell a permanently-closed scenery door and a switch-gated one apart from a live transition.

**The engine detail, verified against the disc and `Door.cpp`:** a closed door's destination fields are never dereferenced, which is why the self-loop placeholders are harmless in-game — AO `R1 P18 C20` is the example, `door_closed=1` with a switch id of 1 that `Door::ctor` discards as wired to nothing.

**How it landed:** the decode arrived with the full-field extraction and the generated `DoorStates` labels (open / closed / hub door closed / closing, with AO's `door_closed` as true/false), so a door's lock state and switch gate already read as words in tooltips and search with no separate viewer work. Visually distinguishing closed and gated doors *on the map* was never built — a possible future polish, not part of 6b.
