# 74. SVG close glyph

**Status:** deferred — accepted as-is after a look on Android, which is already the worst case · **Effort:** tiny · **Where:** anywhere — viewer-only · **Filed:** 2026-08-01 review, triaged 2026-08-02

## What and why

The close buttons draw a text `×`, so their ink is a font metric, and [21](item-021-css-design-inheritance.md)'s font work made that metric platform-dependent. Moving the controls onto the page font grew the glyph on macOS, where the browser's control font and the page's stack resolve to different faces, and the batch compensated by dropping the glyph's font-size (24→21px on the dialogs, 18→16px on the screen list, *Restore the close glyph's old size along with its centring*, `0c9af3a`). The compensation is unconditional but the growth it cancels is not: on a platform where the two stacks resolve to the *same* face — Android and Linux both land on one — there was no growth, so the reduction lands raw and the glyph renders ~12% smaller than before the batch, with the `top: -0.04em` nudge overshooting by under a pixel. Ink only; the 24px and 18px boxes, and so every header height and hit target, are identical everywhere (measured 2026-08-01, computed-style diff of both trees).

The platform-unconditional fix is to take font metrics out of the equation: render the close buttons from `CLOSE_SVG` in [js/icons.js](../public/js/ui/icons.js) — the exact glyph the menu button already draws — sized explicitly in the shared `.closebtn` rule at its two scales. Stroke-based like every other icon here, pixel-identical on every platform, and arguably crisper than any font's `×`.

## Deferred because

The shrunken rendering was looked at on Android and judged fine — and Android *is* a same-face platform, so that look was the worst case, not a platform the defect misses. ~1.7px of ink on a small glyph inside an unchanged hit target is below the threshold of a problem; the swap is an upgrade path, not a repair. Revisit if the glyph ever bothers on a non-mac screen.

## Watch out

- The About dialog's close button lives in static markup by design (the dialog must read with scripting off), so its SVG is pasted inline rather than injected — the one duplication the swap costs. The other close buttons can go either way; matching About keeps them greppable as one pattern.
- `.closebtn` serves two sizes (the dialogs' and the screen list's smaller one), so the SVG needs a size per surface where the font-size difference does that today.
- Retire the font-size compensation and the `-0.04em` nudge in the same commit — they exist only to steer the font metric the SVG removes.
