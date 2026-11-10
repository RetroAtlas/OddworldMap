# 50. `settings.js` re-implements `persistSettings()`

**Status:** shipped 2026-07-26 · **Effort:** tiny (viewer, cleanup) · **Where:** anywhere, viewer-only · **Filed:** 2026-07-24/25 review

## Symptom

Three copies of "write the settings object to localStorage" in [js/settings.js](../public/js/data/settings.js): `persistSettings`, the intended helper; one inside `bind`; and one in the show-more binding. If the storage key, the serialisation or a migration step ever changes, two of the three are easy to miss.

## Sketch

Replace both inline `store.set(SETTINGS_KEY, JSON.stringify(s))` calls with `persistSettings()`. Note that `persistSettings` calls `getSettings()`, which returns the same memoised object `initSettings` holds as `s`, so the behaviour is identical — verify that identity holds rather than assuming it.

## Watch out

`store` and `SETTINGS_KEY` stay module-private; nothing else should reach for them. If after this change `store.set` has only one caller for that key, that is the point — resist inlining it back.

## Verify

`npm test`, which covers the sanitizers. Manually: toggle each setting, reload, confirm each persisted.

## Shipped

As sketched, in *Write settings through persistSettings() only* (`ce34ea2`). The identity the sketch asked to be verified rather than assumed holds, so `persistSettings()` is now the sole writer of the settings key; `store` keeps its other two keys and stays module-private.

## Ships with

Nothing — internal, invisible to players. No changelog entry.
