// Service worker: offline cache for the whole map, in two buckets with two
// disciplines. Cam artwork is cache-first — GitHub Pages re-stamps every
// file's HTTP validators on deploy, so without this each deploy makes repeat
// visitors re-download all PNGs. The app shell (page, code, data) is
// network-first with the cache as an offline fallback: online loads stay
// exactly as fresh as with no worker, and refresh the fallback as they pass.
// The builder writes this line: it is a content hash of the artwork, so a
// regenerated PNG expires the cache and an unchanged build leaves it alone.
const CACHE_NAME = "cams-3764d0843ada";
// the shell bucket self-refreshes per request, so its name never has to move;
// bumping it is only for retiring an incompatible storage scheme
const SHELL = "shell-v1";
// opt-in marker bucket, created/deleted by the page. Checked per fetch:
// unregistration can't stop a controlling worker until reload, and a
// module flag wouldn't survive an idle-worker restart
const ENABLED = "cams-on";
// has to clear both games' complete artwork (2888 files), which the page can
// ask for outright; a cap under that would evict the download's own head
const MAX_ENTRIES = 4000; // ≈280 MB
const TRIM_SLACK = 50; // hysteresis so trim doesn't scan keys() on every put

self.addEventListener("install", () => self.skipWaiting());

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      for (const name of await caches.keys())
        if (
          (name.startsWith("cams-") && name !== CACHE_NAME && name !== ENABLED) ||
          (name.startsWith("shell-") && name !== SHELL)
        )
          await caches.delete(name);
      await self.clients.claim();
    })(),
  );
});

function isCamRequest(request) {
  if (request.method !== "GET") return false;
  const url = new URL(request.url);
  return url.origin === self.location.origin && /^\/cams\/.+\.png$/.test(url.pathname);
}

// the files the app is made of; the SEO statics (og-image, robots, sitemap)
// never load into the app, so they stay out.
function isShellRequest(request) {
  if (request.method !== "GET") return false;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return false;
  return (
    /^\/(js|css)\//.test(url.pathname) ||
    /^\/[^/]+\.(html|json|svg|webmanifest)$/.test(url.pathname) ||
    /^\/(favicon-96|apple-touch-icon)\.png$/.test(url.pathname)
  );
}

async function trim(cache) {
  const keys = await cache.keys(); // insertion order: oldest first
  if (keys.length <= MAX_ENTRIES + TRIM_SLACK) return;
  for (const key of keys.slice(0, keys.length - MAX_ENTRIES)) await cache.delete(key);
}

async function camResponse(event) {
  let cache = null;
  try {
    if (await caches.has(ENABLED)) {
      cache = await caches.open(CACHE_NAME);
      const hit = await cache.match(event.request);
      if (hit) return hit;
    }
  } catch {
    cache = null;
  }
  const response = await fetch(event.request);
  if (cache && response.ok) {
    try {
      await cache.put(event.request, response.clone());
      event.waitUntil(trim(cache).catch(() => {}));
    } catch {
      /* the response still counts even if it can't be stored */
    }
  }
  return response;
}

// network first, cache as the offline fallback. A navigation to the app page
// stores and matches under one canonical key, so /, /index.html and /?embed=1
// all reach the same shell page offline. The put rides waitUntil so the page
// never waits on the disk write, and a redirected response is never stored:
// a navigation could not replay it.
async function shellResponse(event, key = event.request) {
  let cache = null;
  try {
    if (await caches.has(ENABLED)) cache = await caches.open(SHELL);
  } catch {
    cache = null;
  }
  try {
    const response = await fetch(event.request);
    if (cache && response.ok && !response.redirected)
      event.waitUntil(cache.put(key, response.clone()).catch(() => {}));
    return response;
  } catch (err) {
    const hit = cache && (await cache.match(key, { ignoreSearch: true }));
    if (hit) return hit;
    throw err;
  }
}

// the app page's own paths; a navigation anywhere else on the origin
// (sitemap.xml, robots.txt) must not overwrite the stored shell page
const PAGE_PATHS = [
  new URL("./", self.location).pathname,
  new URL("index.html", self.location).pathname,
];

function isAppNavigation(request) {
  if (request.method !== "GET" || request.mode !== "navigate") return false;
  return PAGE_PATHS.includes(new URL(request.url).pathname);
}

self.addEventListener("fetch", (event) => {
  if (isCamRequest(event.request)) event.respondWith(camResponse(event));
  else if (isAppNavigation(event.request)) event.respondWith(shellResponse(event, "index.html"));
  else if (isShellRequest(event.request)) event.respondWith(shellResponse(event));
});
