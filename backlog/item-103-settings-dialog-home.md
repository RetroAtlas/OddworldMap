# 103. Give the Settings dialog a home of its own

**Status:** shipped 2026-11-11 · **Effort:** small · **Where:** anywhere · **Filed:** 2026-11-10, from the review of the series that laid the modules out in folders

## What and why

`data/` imports in bare Node, which the pure check holds by directory, but `settings.js` is two things in one file. The first is the store: `SETTINGS_DEFAULTS`, `SHOW_KEYS`, `store`, the sanitizers, `getSettings`, `chooseSetting`, `persistSettings`, `fieldPrefsFor`, the view snapshot and the remembered location, which `edits.js` and `pathvisible.js` import, and which is why the module sits in `data/`. The second is the Settings dialog's wiring: `initSettings` with `markDefault` beside it reads the overlay's rows, marks each away from its default, dispatches `settings-changed`, and gates the offline cache through `applyCacheMap`, `workerRegistered` and `markerReady`. That half is what the chrome does, and it is the reason `data/`'s row names `ui/dialog.js` and `ui/icons.js`.

## Sketch

Cut the dialog's wiring, `markDefault`, `initSettings`, `workerRegistered`, `markerReady`, `applyCacheMap` and `MARKER_CACHE`, which `offline.js` reads beside the registration, into a module of `chrome/` that imports the store, by the file's own sections and verbatim, as the splits of [101](item-101-file-size-caps.md) were cut, but for one export: `initSettings` drops the stored view and the stored location through the module's own `VIEW_KEY` and `LOC_KEY`, and the store exports a clear of the location (`clearStoredLocation`) but none of the view, so it gains one; `displayLabel` stays with the store, a label the navigation and the level pages read; `main.js` calls `initSettings` from the new module and `offline.js` takes the worker's registration from it, and `tests/unit/settings.test.js`'s read of the module's source for its `bind` calls follows the wiring. `data/`'s row then names `ui/searchquery.js` alone among the primitives, for `placesearch.js`; `settings.js` loses the header note that keeps its DOM work out of import time, since nothing left in it touches the page; and the folder's charter, DOM-free, holds in calls as well as at import.

## Decided

- The store stays in `data/` under its name: it is what the sandbox and the path listing import, and the tests read it there.

## Ruled out

- Moving `settings.js` whole into `chrome/`: `edits.js` and `pathvisible.js` import it from the pure band, so `data`'s row would name `chrome`, upward.

## Shipped

Landed 2026-11-11 as sketched: `chrome/settingsdialog.js` holds `MARKER_CACHE`, `markDefault`, `initSettings`, `workerRegistered`, `markerReady` and `applyCacheMap` verbatim but for the two clears, the store gained `clearStoredView` beside `clearStoredLocation`, `main.js` and `offline.js` take the dialog module's exports, `tests/unit/settings.test.js` reads the dialog module for its `bind` calls, and `data/`'s row names `ui/searchquery.js` alone among the primitives.
