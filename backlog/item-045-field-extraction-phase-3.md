# 45. Full-field extraction, Phase 3 — allowlist expansion

**Status:** shipped 2026-07-22 · **Effort:** medium · **Where:** disc machine (builder plus a rebuild)

A phase of [44](item-044-full-object-field-extraction.md)'s extraction work rather than an idea filed on its own; it took its number afterwards.

## What and why

The extraction machinery covered three creatures. Phase 3 grew `GAMEPLAY_FIELD_TYPES` to the full gameplay set — creatures and spawners, doors and travel, switches and triggers, hazards, LCD and info — roughly 80 types. A Door gained its lock state and eight hub ids, a Switch its wiring, a Mine its setup, all flowing into the picker automatically.

Pure scenery — hoists, edges, zones, bounds, effects — and cosmetic pickups stay out.

## Findings

**Two fixes it could not ship without:**

- The schema parser now spreads the decomp's union-named sequential members. Door's `field_22_hub1..8` are all named `field_22` but are really words 9–16, so the parser advances whenever an offset fails to increase. (The same rule later answered the below-base case in [30](item-030-well-base-fields.md), from the opposite direction.)
- [js/fields.js](../public/js/model/fields.js) scopes enums and default visibility by `Type.field`, because `start_state` is a Slig AI state *and* a Door lock state. A global map would have mislabelled every door.

**The size figures, and why two of them differ.** Phase 3 took AE from 2.7 to 4.3 MB raw, but only about 370 KB gzipped — the keys repeat, so gzip absorbs most of it. The later remaining-region extraction ([24](item-024-eliminate-the-last-raw.md)) took it to 4.74 MB / 344 KB, so a figure elsewhere quoting 4.74 is not disagreeing with this one; it is measuring a later tree.

## Shipped

Absorbed the *data* half of [6](item-006-background-plane-objects.md) — `scale`, prettified full/half — and of 6b, the door lock state. Their viewer styling remained.

**And it forced an extra/fields de-duplication.** The switch, lever and door decodes re-emitted `switch_id` and `action` into `extra`, which the raw `fields` now also carried, so each printed twice. They were dropped from `extra` at the source, making the archive the single copy, and made global defaults in `js/fields.js` with `switch_id` hidden when it is 0 and therefore unwired. The two AE navigation types whose `switch_id` never had a `fields` twin — WellExpress's trigger id and HandStone's `trigger_switch_id` — keep theirs in `extra`.
