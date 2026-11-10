# 18. Per-type field picker

**Status:** shipped 2026-07-21 · **Effort:** medium · **Where:** anywhere, viewer-only

## What and why

Once every gameplay object carried its full field archive, "Show more object fields" flooded every tooltip with dev vocabulary. The setting needed to hand you a picker instead of a firehose.

## Decided

**The panel appears only when the setting is on**, so it costs nothing in clutter to anyone who has not asked for it.

**An explicit empty pick means "show nothing"**, distinct from having no pick at all, which falls back to the defaults. `visibleFields`' "more" mode resolves to the per-type picks or the defaults — the one indirection that keeps default, show-more and the picker as three answers to the same question.

**Edits stay local — no re-render.** A row you are working in would otherwise collapse under its own edit; the next tooltip or panel read picks the change up.

## Shipped

[js/fieldpanel.js](../public/js/panels/fieldpanel.js) renders a "Fields" sidebar section listing the gameplay types on the current path, category-ordered, each a collapsible `<details>` with a checklist of its fields (the defaults pre-checked), an `n / total` count and `all` / `reset` per type. Toggles write `fieldPrefs.byType[type]` and persist.

Verified end-to-end on a no-cache preview port — the browser pane caches modules hard, which is what the `oddmap-nocache` launch config exists for.

Left a follow-up, which became [19](item-019-field-picker-from-tooltip.md): reaching the picker from the object you are looking at.
