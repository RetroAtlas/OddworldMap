# 53. Boot on one dataset, hydrate the other

**Status:** shipped 2026-08-23 · **Effort:** small-medium (viewer, performance) · **Where:** anywhere, viewer-only · **Filed:** 2026-07-24/25 review

## Symptom

[js/main.js](../public/js/main.js) `Promise.all`s seven files before anything is drawn. Measured payloads at the review:

| file | raw | gzip |
| --- | --- | --- |
| `map_data_ao.json` | 2.12 MB | 172 KB |
| `map_data_ae.json` | 4.74 MB | 345 KB |
| the five sidecars combined | 46 KB | 7.8 KB |

So first paint waits on **~517 KB gzipped / 6.9 MB raw**, and the visitor is looking at one game. On 4G that is roughly a three-second blank canvas where it could be one.

## Sketch

Decide the boot game *before* awaiting, then await only it.

1. Parse `location.hash` (`parseHash` is already pure and importable) and, failing that, `storedLocationHash()`, to get a target game id. Fall back to AO.
2. `await` that dataset plus the sidecars, which are tiny, then run the existing `initGames`/`resize`/`applyHash` sequence with a one-element `games` array.
3. When the second dataset resolves, push it into `state.games`, append its game button via the existing `initGames` loop, and re-run an active search.

## Watch out

**`initGames` is currently once-only.** [js/navigate.js](../public/js/navigation/navigate.js) assigns `state.games = games` and appends buttons. Make it additive, or split an `addGame(G)` out of it. `markOn` uses `dataset.key`, so a later-appended button highlights correctly with no change.

**Search assumes both games are loaded.** `runSearch` iterates `state.games`, the group scaffolding builds a group per game up front, and the summary line prints a per-game hit count. With one game loaded these silently narrow. Re-run an active search when the second dataset lands, and consider a note in the summary while it is still in flight. This is the part that will feel broken if skipped — a user who searches in the first 800 ms gets AO-only results with no indication.

**A hash naming the un-booted game.** If the URL is `#AE/MI/1/…`, AE *is* the boot dataset by step 1, so that resolves itself. But `applyHash` also runs from the `hashchange` listener — paste an AE link while only AO is loaded and `state.games.find` returns undefined, so the hash is silently rejected. Guard it: if the hash names a known-but-unloaded game, await it first. Keep a module-level promise per game so this is an await, not a second fetch.

**The preloads compete.** [index.html](../public/index.html) preloads both datasets. Leaving both means the AE download contends with the AO one on the critical path, undoing much of the win on slow links. Add `fetchpriority="low"` to the second, or make it conditional. Do not simply delete them — they exist to start the download during HTML parse rather than after the module graph resolves.

**`loadOne` swallows failures**, returning `null` on any error. Today a total failure is caught by the "Map data failed to load" branch. With a lazy second dataset, a failed AE fetch must not leave a dead AE button in the sidebar — either do not append the button until the data lands, which is the recommendation, or mark it disabled.

## Verify

DevTools → Network → throttle to "Slow 4G", hard reload with an empty hash: the map must draw after ~172 KB, not ~517 KB. Then confirm the AE button appears a moment later, an AE permalink pasted while on AO resolves, and a search typed during the gap re-runs and picks up AE hits.

## Ships with

A `changelog.json` entry, tag `improved` — this one is squarely user-visible.

## Shipped

[js/data.js](../public/js/data/data.js) is the new home for which datasets there are and when each is fetched: `bootGame` reads the game out of the link's own text, `loadGame` memoizes one promise per dataset, and `pendingGames` is what lets a surface say a wait is still on. `initGames` became `addGame`, called once per dataset.

**The measured payloads had moved since filing, and so had the advice.** Re-measured 2026-08-23 (gzip): `map_data_ao.json` 172 KB, `map_data_ae.json` 345 KB, and the sidecars **45 KB** rather than 7.8 — the two glossaries arrived after this item was written and are 36 KB of that. They stay on the critical path all the same: they feed the very first hover tooltip, which has no re-render to catch up with, and they are dwarfed by the 345 KB the change is actually about. `changelog.json` is a 22 KB boot fetch too, requested at import time by [js/whatsnew.js](../public/js/panels/whatsnew.js) for the newest-entry dot, and is the one remaining candidate for the same treatment.

**First paint, measured** — median of three runs, ±0.1 s, a local gzip-serving harness under Chrome CDP throttling, first paint being the frame where `state.path` is set. The absolute seconds are the harness's rather than the deployed site's, whose gzip is fatter, so treat the ratios as the finding:

| entry point | today | shipped | no preload at all |
| --- | --- | --- | --- |
| slow 4G (400 kbps / 400 ms), hashless | 15.8 s | **8.8 s** | 10.2 s |
| slow 4G, `#AE` permalink | 15.8 s | 15.9 s | 13.8 s |
| regular 4G (1.6 Mbps / 150 ms), hashless | 4.1 s | **2.5 s** | 3.1 s |
| regular 4G, `#AE` permalink | 4.1 s | 4.3 s | 3.9 s |

**The sketch's advice on the preloads was the one thing it got wrong**, and only measurement said so. `fetchpriority="low"` on the second preload is not the lever: what pays is deleting it outright, which is not the "do not simply delete them" the sketch warns against, because the survivor is the dataset a hashless visit boots. The preload is genuinely consumed by the `cache: "no-cache"` fetch — one network request per file, initiator `parser`, no "preloaded but not used" warning — so it is worth keeping: dropping it too costs the hashless visit 1.4 s of its 7.0. The reason it buys so little is that a saturated pipe transfers the same bytes whatever their order, so a preload wins the module graph's latency and nothing more.

That leaves an asymmetry the static tag cannot fix: a visit booting Exoddus, by permalink or by a remembered location, pulls Oddysee's 172 KB at high priority while first paint waits on the 345 KB it actually needs, and gains nothing from the change. Dropping both preloads would hand that visit 2.0 s and take 1.4 s off every hashless one, which is the better trade only if more than 40% of visits boot Exoddus. Only an inline classic script can preload the right one — a module in `<head>` cannot, `data.js` reaching eleven modules at depth four, so it starts no earlier than `main.js` does — and that script would restate the hash's game rule outside `parseHash`. Left undone, with the numbers above as the reason to revisit it.

**What the gap costs, and who answers for it.** `addGame` dispatches `games-changed`, and the three surfaces that read more than the current game answer it: search re-runs an active query, an open type card re-renders its per-game counts (putting the reader's scroll position and the keyboard back), and the offline panel gains a row. The event fires for a dataset that *failed* as well, or a search rendered during the gap would promise a wait that had already ended for good. Shuffle needs nothing — a random jump is random either way. Nothing else in the viewer reads past the current game.

**Two defects the sketch did not foresee**, both found by review before shipping:

- The remembered-location fallback read "the stored hash names the game this boot did not fetch" as "its level or path no longer exists", and *deleted the remembered location*. `applyHash` is now async and waits for a dataset the hash names, which is also what the sketch asked for on the `hashchange` path — one mechanism serves both callers.
- That wait needed the view writes held across it. A debounced `writeHash` firing mid-await replaces the very link being answered, and `replaceState` leaves no `hashchange` behind to recover it, so the pasted link vanished silently. The hold is `awaitingGame`, and a hash that changed during the wait is left to the newer link's own handler.

The game buttons are appended as their datasets land rather than in a canonical order, so a visit arriving on an Exoddus link leads with Exoddus. That order reaches the search summary's per-game tally, the type card's census line and the offline rows as well; leading with the game the visitor came for is right in all four, and it is what keeps `addGame` from having to insert into an order.
