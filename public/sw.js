const CACHE_NAME = "surfscape-shell-2026-07-23-v";
const CACHE_PREFIX = "surfscape-shell-";
const scopeUrl = new URL(self.registration.scope);
const scoped = (path) => new URL(path, scopeUrl).href;
const CORE_ASSETS = [
  scoped("./"),
  scoped("./manifest.webmanifest"),
  scoped("./icons/surfscape-180.png"),
  scoped("./icons/surfscape-192.png"),
  scoped("./icons/surfscape-512.png"),
  scoped("./icons/surfscape-maskable-512.png"),
  scoped("./models/beach-visitor-premium.glb"),
  scoped("./models/surf-van-premium.glb"),
  scoped("./models/surfer-premium.glb"),
  scoped("./textures/neoprene-premium.webp"),
  scoped("./textures/sand-premium.webp"),
];

async function installShell() {
  const cache = await caches.open(CACHE_NAME);
  await cache.addAll(CORE_ASSETS);
  const shell = await cache.match(scoped("./"));
  if (!shell) return;
  const html = await shell.text();
  const linkedAssets = Array.from(html.matchAll(/(?:src|href)="([^"]+)"/g), (match) => match[1])
    .map((value) => new URL(value, scopeUrl))
    .filter((url) => url.origin === scopeUrl.origin && url.pathname.includes("/_next/static/"))
    .map((url) => url.href);
  await Promise.all(linkedAssets.map(async (url) => {
    try {
      const response = await fetch(url);
      if (response.ok) await cache.put(url, response);
    } catch {
      // One optional chunk should not prevent the installed game from updating.
    }
  }));
}

self.addEventListener("install", (event) => {
  event.waitUntil(
    installShell().then(() => self.skipWaiting()),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(
        keys
          .filter((key) => key.startsWith(CACHE_PREFIX) && key !== CACHE_NAME)
          .map((key) => caches.delete(key)),
      ))
      .then(() => self.clients.claim()),
  );
});

async function remember(request, response) {
  if (!(response.ok || response.type === "opaque")) return response;
  const cache = await caches.open(CACHE_NAME);
  await cache.put(request, response.clone());
  return response;
}

async function cacheFirst(request) {
  const cached = await caches.match(request);
  if (cached) return cached;
  return remember(request, await fetch(request));
}

async function networkFirst(request, fallback) {
  try {
    return await remember(request, await fetch(request));
  } catch {
    return (await caches.match(request))
      ?? (fallback ? await caches.match(fallback) : undefined)
      ?? Response.error();
  }
}

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET" || request.headers.has("range")) return;
  const url = new URL(request.url);
  const local = url.origin === scopeUrl.origin;
  const staticAsset = local && (
    url.pathname.includes("/_next/static/")
    || url.pathname.includes("/models/")
    || url.pathname.includes("/textures/")
    || url.pathname.includes("/icons/")
    || /\.(?:css|js|woff2?|png|jpe?g|webp|svg|glb)$/i.test(url.pathname)
  );
  const marineData = url.hostname === "marine-api.open-meteo.com"
    || url.hostname === "api.open-meteo.com";
  const mapTile = url.hostname === "tile.openstreetmap.org";

  if (request.mode === "navigate") {
    event.respondWith(networkFirst(request, scoped("./")));
  } else if (staticAsset || mapTile) {
    event.respondWith(cacheFirst(request));
  } else if (marineData) {
    event.respondWith(networkFirst(request));
  }
});
