# 44. Full object-field extraction (engine and creatures)

**Status:** shipped 2026-07-21 · **Effort:** large · **Where:** disc machine (builder plus a rebuild)

Never filed as an idea before it was built — it was done rather than planned, and took its number afterwards.

## What and why

[16](item-016-creature-states.md) decoded creature states by hand, one field at a time, and every further field meant another disc session. Extracting *everything* raw inverts that: the builder emits the complete archive once, the viewer decides what to show, and **the disc is never needed again to surface or relabel a field.** That is the whole point of the change.

## Decided

**The builder emits, the viewer displays.** Values are stored raw as s16 with their dev names; which fields show and how their values read are viewer decisions.

**One indirection for the display question.** `visibleFields(type, prefs)` in [js/fields.js](../public/js/model/fields.js) is the single place that answers it, so default, "Show more fields" and a future per-type picker are just which set it returns — which is what let [18](item-018-per-type-field-picker.md) be a small change rather than a rework.

**Search always resolves the full set**, whatever the display prefs say, so a field you have hidden is still findable.

**The two-bucket contract** — derived semantic `extra` for what navigation reads, the complete raw `fields` archive for everything else — is documented in [CLAUDE.md](../CLAUDE.md), because the difference is not obvious from either bucket alone.

## Findings

`parse_object_schema` reads the relive_api CTOR blocks into a `tools/data/objects_{ao,ae}.json` cache, and it was validated against the disc *and* against the hand-decoded creatures as ground truth — [16](item-016-creature-states.md)'s work became the oracle for the machinery that superseded it.

## Shipped

Every field of a gameplay object lands in `t.fields`; `extrasText` renders `extra` plus the admitted `fields`, prettified. So `shoot_on_sight_delay` — 0 meaning it shoots the instant it sees Abe, with no "FREEZE!" warning — and every other AI and timing field reached the map at once.

This superseded [16](item-016-creature-states.md)'s builder-side enum decode: job, state, emotion and start_state now live raw in `fields` and are prettified viewer-side.
