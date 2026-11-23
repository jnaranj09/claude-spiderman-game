// Service worker: lets the game be installed as an app and played with no connection, once it has loaded once.
//
// Online it changes nothing: the game's own files (this site's html, css and js) are always asked of the network
// first, so a new version shows up exactly as it did without this, and the copy kept here is only what's served
// when the network can't be reached. What never changes is served from the copy at once: three.js, which
// index.html loads from one fixed commit (its address names the commit, so the file behind it can't change).
const SITE = 'spidey-site-v1';   // the game's own files, as last fetched
const FIXED = 'spidey-fixed-v1'; // three.js at its pinned commit, and the fonts

const PINNED = /^https:\/\/cdn\.jsdelivr\.net\/gh\/[^@]+@([0-9a-f]{40})\//;
const FONTS = /^https:\/\/fonts\.(googleapis|gstatic)\.com\//;

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()));

async function keep(cacheName, request, response) {
  // (an opaque answer is one from another site that can't be looked into: kept as it is)
  if (!response || !(response.ok || response.type === 'opaque')) return;
  const cache = await caches.open(cacheName);
  await cache.put(request, response);
  // A new pinned three.js: the files of the commit before it are dropped
  const pin = PINNED.exec(typeof request === 'string' ? request : request.url);
  if (pin) {
    for (const key of await cache.keys()) {
      const other = PINNED.exec(key.url);
      if (other && other[1] !== pin[1]) cache.delete(key);
    }
  }
}

// The game's own files: the network's answer, kept for when there's none
async function siteFile(request) {
  try {
    const response = await fetch(request);
    if (response.ok) keep(SITE, request, response.clone());
    return response;
  } catch (error) {
    const cache = await caches.open(SITE);
    // (the stylesheet is asked for with a version on the end, and the page by more than one address)
    const kept = await cache.match(request, { ignoreSearch: true })
      || (request.mode === 'navigate' && (await cache.match('./', { ignoreSearch: true }) || await cache.match('./index.html', { ignoreSearch: true })));
    if (kept) return kept;
    throw error;
  }
}

// What can't change: the copy, and the network only when there isn't one
async function fixedFile(request) {
  const kept = await caches.match(request);
  if (kept) return kept;
  const response = await fetch(request);
  keep(FIXED, request, response.clone());
  return response;
}

// The fonts: the copy at once, refreshed behind it
async function fontFile(request) {
  const kept = await caches.match(request);
  const fresh = fetch(request).then((response) => { keep(FIXED, request, response.clone()); return response; });
  if (kept) { fresh.catch(() => {}); return kept; }
  return fresh;
}

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;
  if (request.url.startsWith(self.location.origin + '/')) event.respondWith(siteFile(request));
  else if (PINNED.test(request.url)) event.respondWith(fixedFile(request));
  else if (FONTS.test(request.url)) event.respondWith(fontFile(request));
});

// The page, once the game is up, sends the addresses of everything it loaded: on a first visit that was before this
// worker was in charge, so none of it passed through here. Whatever isn't kept yet is fetched again (from the
// browser's own cache, as a rule) and kept, so the very next start can already be without a connection
self.addEventListener('message', (event) => {
  const data = event.data;
  if (!data || data.type !== 'keep' || !Array.isArray(data.urls)) return;
  event.waitUntil((async () => {
    // (and the address an installed app starts from, whichever one the page was first opened by)
    for (const url of new Set([...data.urls, new URL('./', self.location.href).href])) {
      if (typeof url !== 'string') continue;
      const own = url.startsWith(self.location.origin + '/');
      if (!own && !PINNED.test(url) && !FONTS.test(url)) continue;
      const cacheName = own ? SITE : FIXED;
      if (await (await caches.open(cacheName)).match(url)) continue;
      try {
        // (the fonts' stylesheet doesn't let other sites read it: asked for as a page would)
        const response = await fetch(url, /fonts\.googleapis/.test(url) ? { mode: 'no-cors' } : undefined);
        await keep(cacheName, url, response);
      } catch (error) { /* offline already, or gone: nothing to keep */ }
    }
  })());
});
