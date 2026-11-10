# 49. PNG export races the object-URL revoke

**Status:** shipped 2026-07-26 · **Effort:** tiny (viewer, bug) · **Where:** anywhere, viewer-only · **Filed:** 2026-07-24/25 review

## Symptom

"Export view as PNG" can silently produce no download, browser-dependent.

## Cause

In [js/sidebar.js](../public/js/chrome/sidebar.js), `a.click()` is followed on the very next line by `URL.revokeObjectURL(a.href)`. The download is queued, not completed, when `click()` returns. Chrome usually survives it; Firefox and Safari can cancel the transfer. A well-known footgun rather than a subtle race.

## Sketch

Defer the revoke past the current task:

```js
a.click();
setTimeout(() => URL.revokeObjectURL(a.href), 0);
```

## Watch out

Do not "fix" this by never revoking — the blob for a full-viewport canvas is multi-megabyte and would be pinned for the session. A `setTimeout(…, 0)` is enough; there is no need for a long timer.

[61](item-061-export-whole-path.md) touches this same handler. If it lands first, apply the revoke fix inside whatever shared download helper it introduces rather than in two places.

## Verify

Export in Firefox and Safari — the two that actually fail — and confirm the file lands. Chrome is not a useful test for this.

## Shipped

**The sketch's `setTimeout(…, 0)` is not enough, and the reason is the comment that replaced it.** A permission prompt — the browser asking where to save, or whether to allow the download at all — can defer the blob's read indefinitely, so no fixed delay is long enough to be correct. *Release the export blob URL on the next export, not on the click* (`1939f66`) holds the URL in a module-level `exportUrl` in [js/sidebar.js](../public/js/chrome/sidebar.js) and revokes the *previous* one when the next export replaces it, which is timing-free.

**So the *Watch out* above was half right and is worth reading as it stands.** Never revoking was the wrong answer; revoking on the next use is the narrow version of it, and it does leave one blob pinned until the next export or until the tab closes. That is a bounded cost — one canvas, not one per export — and it is what an unconditionally landing download turned out to be worth.

A second commit followed on the same handler, *Report a failed PNG export* (`a9dfb63`, its own `changelog.json` entry tagged `fixed`): `toBlob` calling back with `null` had been silent, and now toasts. [61](item-061-export-whole-path.md) reads that same null as its size-limit signal.

## Ships with

A `changelog.json` entry, tag `fixed`.
