// ============================================================
// Service Worker do Rachaê (PWA) — Cache Resiliente v2
// Estratégia híbrida:
// 1. Network-First com fallback Offline para HTML e Scripts
// 2. Stale-While-Revalidate com ignoreSearch para Estilos e Imagens
// ============================================================

const CACHE_NAME = "rachae-app-v8";

const ASSETS_TO_CACHE = [
  "./",
  "./index.html",
  "./cadastro.html",
  "./casa.html",
  "./contas.html",
  "./convidar.html",
  "./dashboard.html",
  "./css/style.css",
  "./assets/icon.jpg",
  "./assets/LogoSite.jpg",
  "./favicon.ico",
  "./js/config.js",
  "./js/supabaseClient.js",
  "./js/mockClient.js",
  "./js/instantNav.js",
  "./js/animacoes.js",
  "./js/qrcode.min.js",
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
            console.log("[SW] Removendo cache antigo:", key);
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

  // Não intercepta chamadas de outros domínios (Supabase, CDNs externos) nem métodos de mutação (POST/PUT/DELETE)
  if (url.origin !== self.location.origin || event.request.method !== "GET") {
    return;
  }

  const ehNavegacaoOuScriptOuCss =
    event.request.mode === "navigate" ||
    url.pathname.endsWith(".html") ||
    url.pathname.endsWith(".js") ||
    url.pathname.endsWith(".css") ||
    url.pathname === "/" ||
    url.pathname === "";

  if (ehNavegacaoOuScriptOuCss) {
    // ESTRATÉGIA NETWORK-FIRST: Tenta a rede para garantir a versão mais recente após deploy;
    // se falhar (offline ou sem sinal), carrega do cache instantaneamente.
    event.respondWith(
      fetch(event.request)
        .then((networkResponse) => {
          if (networkResponse && networkResponse.status === 200) {
            const responseClone = networkResponse.clone();
            caches.open(CACHE_NAME).then((cache) => {
              cache.put(event.request, responseClone);
            });
          }
          return networkResponse;
        })
        .catch(() => {
          return caches.match(event.request, { ignoreSearch: true }).then((cachedResponse) => {
            if (cachedResponse) return cachedResponse;
            if (event.request.mode === "navigate") {
              return caches.match("./dashboard.html", { ignoreSearch: true });
            }
          });
        })
    );
  } else {
    // ESTRATÉGIA STALE-WHILE-REVALIDATE: Para CSS, imagens e ícones, serve do cache na hora
    // e atualiza em segundo plano para o próximo acesso.
    event.respondWith(
      caches.match(event.request, { ignoreSearch: true }).then((cachedResponse) => {
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
  }
});
