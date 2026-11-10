# 25. Sort objects and fields by name

**Status:** shipped 2026-07-24 · **Effort:** tiny · **Where:** anywhere, viewer-only

## What and why

Fields in the picker, and so in the tooltip, followed the schema's payload order — which is the order the game's struct happens to declare them in, and means nothing to a reader. With many fields per type, alphabetical is far easier to scan.

## Sketch

Sort a type's `fields` alphabetically in [js/fieldpanel.js](../public/js/panels/fieldpanel.js) and in the `fieldEntries` output, instead of insertion order.

## Decided

**The object *types* got sorted too**, which the sketch did not ask for: the picker listed them in CATS category order, and that ordering had no other use on this surface. Alphabetical is what you want when you are looking for a named type in a list.

**The semantic `extra` fields keep their order.** They are navigation facts written in a deliberate sequence — a destination reads as level, path, camera — and alphabetising them would scramble a sentence into a set.

## Shipped

The Fields picker lists object types alphabetically, and each type's fields sort alphabetically in the picker, the tooltips and the screen list.
