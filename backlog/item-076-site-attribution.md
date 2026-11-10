# 76. Say whose map this is

**Status:** shipped 2026-07-30 · **Effort:** small (viewer) · **Where:** anywhere — viewer-only

## What and why

Nothing in the app said whose map this was. An unofficial fan project has to say it is one, and a map built on someone else's reverse-engineering has to credit the work it stands on. The missing surface therefore had one job: carry the unofficial/trademark/no-affiliation notice, the AliveTeam credit and a link to this map's source.

## Decided

**A dialog.** A corner icon button with only a `title` was ruled out because a `title` says nothing on touch — the same reason [31](item-031-settings-overlay-polish.md)'s default marker is not one — and because the map's corner already holds three buttons, which [72](item-072-copy-embed-code-button.md) had already used as grounds for refusing a fourth. The dialog won on what it can carry instead: a title, room for three paragraphs, and the two links beside them.

**Static markup rather than built by the module**, so the notice is in the page source with scripting off and for anything crawling the site; that ruled out What's New's build-from-a-feed shape.

**Deliberately not `.chrome`.** An embed, inside someone else's page, is where a reader can least tell whose map this is, so the notice has to survive one — and the sidebar it opens from is present in an embed, only closed.

**No licence stated, deliberately** — three kinds of content under three claims means one line of terms in the app would claim all three, and the source link reaches the repository where the licence file is. [68](item-068-repo-licensing.md) is where that decision gets revisited.

## Findings

**"Too much text to sit on the landing page" was a false premise.** Measured in the running site, the sidebar already scrolls: 1016px of content in 900px at 1440×900, so `#sbFooter` is below the fold and its `margin-top: auto` never engages. Footer prose would not have been on the landing page at all.

**Two dialogs cannot open together** because the full-screen overlay blocks every other opener and the focus trap swallows keydown in the capture phase — confirmed by `?` and `i` both doing nothing while About is open. A stacking tier is not what enforces this: the sidebar's `z-index` exists only inside the narrow media query.

## Shipped

The **About this map** dialog ([js/about.js](../public/js/panels/about.js)), opened from the sidebar footer beside "Send feedback": the unofficial/trademark/no-affiliation notice as its own paragraph, then the AliveTeam and alive_reversing credit and the source repo link. The fourth dialog on the `.overlay`/`.dialog` + `trapDialogKeys` pattern.

One shared-code change: `trapDialogKeys` counted `button, input`, so the dialog's two links would have been unreachable by keyboard. It counts `a[href]` now, inert for the other three dialogs, which hold no links.
