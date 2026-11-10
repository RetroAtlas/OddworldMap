# 23. Curate per-object default fields

**Status:** shipped 2026-07-25 · **Effort:** small-medium · **Where:** anywhere, viewer-only

## What and why

With ~80 gameplay types carrying a full `fields` archive, something had to decide what an object shows *by default* — the alternative is either a dev dump or nothing. A `MeatSaw` wants `speed`; a `TrapDoor` wants `switch_id` and `start_state`; a Door wants its lock state.

## Sketch

Go through each type and set the default in [js/fields.js](../public/js/model/fields.js) — global versus `DEFAULT_BY_TYPE`, adding a `Type.start_state` / `Type.state` enum where a value needs prettifying.

## Findings

**A bare `state` enum would have mislabelled three real types, and this was checked rather than assumed.** From a full data scan: `state` is not Mudokon-only. It is carried by **TimedMine** and **Honey** in AO, and by **TimedMine**, **Mudokon** and **CrawlingSlig** in AE — and AO Mudokon carries no `state` field at all, so `Mudokon.state` only ever applies in AE. All the non-Mudokon carriers rendered raw, so there was no regression to find, but it made the trap the `Type.field` scoping closed a live one rather than hypothetical: a bare `state` enum added during this pass would have silently relabelled a mine, a honey trigger and a crawling Slig as Mudokon work states.

This is a distinct axis from [26](item-026-value-rendering-architecture.md). Default *visibility* stays keyed by object type; how a *value* renders is keyed by the field's game type, so the shared-`state` carriers become grouped transform entries there and separate visibility entries here.

## Shipped

`defaultVisible` promoted `start_state` to a global default — it renders per owning type through the existing enums, so a door lock, a hazard on/off and a Slig AI state each read correctly and collision-safely — and the two-entry `DEFAULT_BY_TYPE` stub became a curated table of the gameplay-meaningful state, identity, direction or count field per creature, door, hazard, switch, lift and info type.

Device control-switch ids stay picker-only. Only readable fields — enums, booleans, small counts — plus `MeatSaw`'s `speed` show by default. Every curated field was verified present on its type in the shipped data, so the table cannot name a field that isn't there.
