# 105. Purge the edge's copies of the code after each deploy

**Status:** open · the step is written to skip until the zone id and a purge token are repository secrets · **Effort:** small: one step in the deploy job, two secrets, one deploy watched · **Where:** `.github/workflows/ci.yml`, the Cloudflare dashboard for the token and the zone id, the repository's secrets · **Filed:** 2026-11-11, from the two deploys of 2026-11-10 that left visitors a page half from each deploy, and two reviews of [104](item-104-stylesheet-partials.md) that asked for the purge

## What and why

`oddworldmap.com` is proxied by Cloudflare in front of GitHub Pages. Pages sends every file with `max-age=600`, and the site has no say over its headers ([43](item-043-cam-artwork-caching.md) met the same wall when Pages re-stamped every validator on each deploy), and Cloudflare's edge keeps the files whose extensions it caches by default, `.js`, `.css` and `.png` among them, for that long, each from the moment it was last fetched, while HTML and `.json` pass through to the origin every time (`cf-cache-status` MISS and HIT on the first three and none on the others, measured 2026-11-02). The viewer is ES modules with no build step, so `index.html`, the nine stylesheet partials and the 83 modules are asked for by stable names, and a deploy that changes several of them is seen by a visitor as whichever mix the edge holds: a fresh `main.js` beside a stale module that still exports the names it imports links and misbehaves silently, which [CLAUDE.md](../CLAUDE.md#traps-that-reach-every-area) records as the trap behind any viewer bug the tests cannot reproduce; one that no longer exports them fails to link and leaves the map blank; a stale partial drops its rules. The window is up to ten minutes after a deploy, longer in effect since each file expires on its own clock, and a visitor who meets it leaves rather than reports it. On 2026-11-10 two deploys changed many files at once, the stylesheet cut into partials ([104](item-104-stylesheet-partials.md)) and every module moved into a folder ([102](item-102-modules-in-folders.md)), and the live page broke for visitors in that window; Development Mode, switched on by hand for its three hours, was the remedy. Until the same day the zone's Browser Cache TTL overrode the origin with four hours (clients were told `max-age=14400`), so a browser kept the mix far longer than the edge did; the zone respects the origin's headers now, which closes the browser's side to the same 600 s. The edge's side is what this item closes: a purge of the code files from the deploy job, as soon as the deploy is live.

The service worker adds no window of its own: its app shell is network-first ([83](item-083-offline-app-shell.md)), and the artwork it caches is keyed by a name that changes only on a rebuild.

## Decided

- The purge is a step at the end of the `deploy` job, after `actions/deploy-pages` has reported the deployment live, never before: a purge made while the old files are still served refills the edge with them the moment a visitor arrives. It carries `continue-on-error: true`, since the deploy it follows is already live and the purge is the remedy for the window, not a gate on the site; a failed purge leaves the window as it is today and says so in the job's summary.
- One call to `POST https://api.cloudflare.com/client/v4/zones/<zone>/purge_cache` per thirty URLs, the API's limit per call, with `files` listing every `.js` and `.css` file under `public/` at the deployed commit, built from `git ls-files` and the host in `public/CNAME`: about 93 files and four calls, a second or two of the job. Every one every time, since the list is short and a diff against the last deployed commit would need the deployments API as a second source to trust for the saving of three calls.
- The token is an API token with the one permission Zone, Cache Purge, Purge, scoped to the one zone; it and the zone id are the repository secrets `CF_ZONE_ID` and `CF_PURGE_TOKEN`, read into the step's environment, and the step skips with a notice when either is empty, so a fork or a clone without them deploys as the workflow does today. Secrets never reach a pull request from a fork, and the deploy job runs on `main` alone.
- The artwork stays at the edge. The cameras and masks change only on a rebuild, and a rebuilt one shown from the edge for its last minutes is the old picture, which breaks nothing; the sprite sheets and the release art carry their pixels in their names and never change under a name. A purge of everything would drop the roughly 350 MB of artwork from every edge, to be fetched from Pages again as visitors arrive, which is the one cost the edge exists to save.
- [CLAUDE.md](../CLAUDE.md#build--verify)'s bullet on the deploy gains the sentence when the step lands: the deploy ends by purging the edge's copies of the code, and skips that without the secrets.

## Ruled out

- A cache rule on the zone that bypasses the edge for `.js` and `.css`: it would close the window with no secret and no step, but in the dashboard, where no commit records it and no test reads it, and it gives up the edge for the files every visit loads; the purge keeps the edge serving them between deploys and lives in the workflow beside the deploy it answers.
- Hashed file names for the modules and the partials: a build step, which the viewer has none of on purpose, and a rewrite of every path the tests, the docs and this folder name.
- A shorter `max-age`: Pages fixes it at 600 and offers no header of the site's own.
- Purging only the files the deploy changed, and the changed artwork with them: the diff base is the last successful deployment's commit, read off the deployments API; what it would add over the fixed list is the changed cameras of a rebuild, a few times a year, drawn old for ten minutes.
- Waiting it out: ten minutes of a broken page for whoever arrives, twice on 2026-11-10, and nothing that says it happened.

## Sketch

In the `deploy` job, after the `actions/deploy-pages` step, a step named for what it does with `continue-on-error: true` and `env` carrying the two secrets: if either is empty, write a notice to the step summary and exit zero; otherwise build the URL list, `https://<CNAME>/<path>` for each `.js` and `.css` file `git ls-files public` names, post it in batches of thirty with `authorization: Bearer <token>`, and fail the step on any answer whose `success` is false, with the body in the log. The step summary names the count purged and the batch results. The token is minted in the dashboard under My Profile, API Tokens, with the single permission above and the zone as its one resource; the zone id is on the zone's overview page.

## Verify

- The first deploy with the secrets in place: the step summary lists four batches and the count, and a `curl -sI https://oddworldmap.com/js/main.js` run as it finishes answers `cf-cache-status: MISS` where a request a minute earlier answered HIT, the body then matching the tree.
- A deploy that changes one module: a fetch of it through the edge right after the step matches the tree, where before the item it matched the tree only once its 600 s had run out.
- A run of the workflow without the secrets, which a fork has: the step is skipped with its notice and the deploy is green.

## Watch out

- The seconds between the deployment going live and the purge still serve the mix to whoever fetches then; nothing on the site's side closes that, and it is seconds against ten minutes.
- A browser that fetched a module in the window keeps it for its own 600 s; the purge reaches the edge, not the visitor's cache, and the one remedy there is the reload the visitor makes once the file has expired. The worker's shell is network-first and follows at once.
- A purge by URL purges the URL as the visitor asks for it: no query string, the apex host, `https`. A file served under another name, `index.html` for `/`, is not on the list because the edge does not cache it.
- The limits are the API's and move with it: thirty URLs a call today, and a rate limit on purges per day on some plans. The step treats a refused call as a failed step, which the summary shows and the next deploy repeats.
