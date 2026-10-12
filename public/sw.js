const CACHE_NAME = "compass-static-shell-v2";
const SHELL_ASSETS = [
  "/manifest.webmanifest",
  "/offline.html",
  "/compass.svg",
  "/icons/today.svg",
  "/icons/today-active.svg",
  "/icons/home.svg",
  "/icons/home-active.svg",
  "/icons/calendar.svg",
  "/icons/calendar-active.svg",
  "/icons/projects.svg",
  "/icons/projects-active.svg",
  "/icons/nutrition.svg",
  "/icons/finance.svg",
  "/icons/fitness.svg",
  "/icons/goals.svg",
  "/icons/tasks.svg",
  "/icons/routines.svg",
  "/icons/settings.svg",
  "/icons/more.svg",
  "/icons/more-active.svg",
  "/icons/checkmark.svg",
];

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE_NAME).then((cache) => cache.addAll(SHELL_ASSETS)));
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((names) => Promise.all(
      names.filter((name) => name.startsWith("compass-static-shell-") && name !== CACHE_NAME)
        .map((name) => caches.delete(name)),
    )),
  );
  self.clients.claim();
});

self.addEventListener("fetch", (event) => {
  const request = event.request;
  const url = new URL(request.url);
  const staticAsset = url.origin === self.location.origin && (
    url.pathname.startsWith("/_next/static/") || SHELL_ASSETS.includes(url.pathname)
  );
  if (request.method !== "GET" || !staticAsset) return;

  event.respondWith((async () => {
    try {
      const response = await fetch(request);
      if (response.ok) {
        const copy = response.clone();
        void caches.open(CACHE_NAME).then((cache) => cache.put(request, copy));
      }
      return response;
    } catch {
      return await caches.match(request) ?? Response.error();
    }
  })());
});

self.addEventListener("fetch", (event) => {
  const request = event.request;
  const url = new URL(request.url);
  const workspaceRoute = ["/today", "/home", "/calendar", "/projects", "/goals", "/fitness", "/nutrition", "/finances", "/tasks", "/routines", "/history", "/settings", "/more"]
    .some((route) => url.pathname === route || url.pathname.startsWith(`${route}/`));
  if (request.method !== "GET" || request.mode !== "navigate" || url.origin !== self.location.origin || !workspaceRoute) return;

  event.respondWith(fetch(request).catch(async () => {
    const offline = await caches.match("/offline.html");
    return offline ?? Response.error();
  }));
});
