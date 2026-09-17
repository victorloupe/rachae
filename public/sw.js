// Service Worker leve para PWA e Cache do Rachaê
const CACHE_NAME = "rachae-app-v1";
const ASSETS_TO_CACHE = [
  "./",
  "./index.html",
  "./cadastro.html",
  "./casa.html",
  "./contas.html",
  "./convidar.html",
  "./dashboard.html",
  "./css/style.css?v=6",
  "./assets/icon.jpg",
  "./assets/LogoSite.jpg",
  "./js/config.js",
  "./js/supabaseClient.js",
  "./js/mockClient.js",
  "./js/instantNav.js",
  "./js/animacoes.js",
  "./js/auth.js",
  "./js/casa.js",
  "./js/contas.js",
  "./js/convidar.js",
  "./js/dashboard.js",
  "./manifest.json"
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return cache.addAll(ASSETS_TO_CACHE).catch((err) => {
        console.warn("[SW] Aviso ao pré-carregar recursos estáticos:", err);
      });
    })
  );
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) => {
      return Promise.all(
        keys.map((key) => {
          if (key !== CACHE_NAME) {
            return caches.delete(key);
          }
        })
      );
    })
  );
  self.clients.claim();
});

self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);

  // Não intercepta chamadas externas (Supabase, CDN do GSAP, etc.) nem métodos POST/PUT/DELETE
  if (url.origin !== self.location.origin || event.request.method !== "GET") {
    return;
  }

  event.respondWith(
    caches.match(event.request).then((cachedResponse) => {
      const fetchPromise = fetch(event.request)
        .then((networkResponse) => {
          if (networkResponse && networkResponse.status === 200) {
            const responseClone = networkResponse.clone();
            caches.open(CACHE_NAME).then((cache) => {
              cache.put(event.request, responseClone);
            });
          }
          return networkResponse;
        })
        .catch(() => cachedResponse);

      return cachedResponse || fetchPromise;
    })
  );
});
