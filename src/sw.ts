/// <reference types="vite-plugin-pwa/client" />
/// <reference types="workbox-sw" />

import { precacheAndRoute, cleanupOutdatedCaches, createHandlerBoundToURL } from 'workbox-precaching';
import { registerRoute, NavigationRoute } from 'workbox-routing';
import { NetworkFirst, CacheFirst, StaleWhileRevalidate } from 'workbox-strategies';
import { ExpirationPlugin } from 'workbox-expiration';

// ExtendableEvent is not exported from workbox-core, define it locally
interface ExtendableEvent extends Event {
  waitUntil(promise: Promise<unknown>): void;
}

// TypeScript doesn't know about self in SW context, but it's available at runtime
declare const self: ServiceWorkerGlobalScope & {
  skipWaiting: () => void;
  clients: {
    claim: () => Promise<void>;
  };
  __WB_MANIFEST: unknown;
  addEventListener: (type: string, listener: EventListener) => void;
};

self.skipWaiting();
self.clients.claim();

cleanupOutdatedCaches();

// Precache manifest is injected by vite-plugin-pwa
precacheAndRoute(self.__WB_MANIFEST);

// Navigation fallback for SPA (denylist privacy/terms/support)
registerRoute(
  new NavigationRoute(
    createHandlerBoundToURL('index.html'),
    {
      denylist: [/^\/(?:privacy|terms|support)\.html$/],
    }
  ));

// API calls: network-first with 10s timeout, fallback to cache
registerRoute(
  ({ url }) => url.pathname.startsWith('/api/'),
  new NetworkFirst({
    cacheName: 'api-cache',
    networkTimeoutSeconds: 10,
    plugins: [
      new ExpirationPlugin({
        maxEntries: 100,
        maxAgeSeconds: 300, // 5 minutes
      }),
    ],
  })
);

// Images: cache-first with 1-day expiration
registerRoute(
  ({ request }) => request.destination === 'image',
  new CacheFirst({
    cacheName: 'image-cache',
    plugins: [
      new ExpirationPlugin({
        maxEntries: 50,
        maxAgeSeconds: 86400, // 1 day
      }),
    ],
  })
);

// Fonts: cache-first, long expiration
registerRoute(
  ({ request }) => request.destination === 'font',
  new CacheFirst({
    cacheName: 'font-cache',
    plugins: [
      new ExpirationPlugin({
        maxEntries: 20,
        maxAgeSeconds: 31536000, // 1 year
      }),
    ],
  })
);

// Static assets (CSS, JS): stale-while-revalidate
registerRoute(
  ({ request }) =>
    request.destination === 'script' ||
    request.destination === 'style' ||
    request.destination === 'worker',
  new StaleWhileRevalidate({
    cacheName: 'static-resource-cache',
    plugins: [
      new ExpirationPlugin({
        maxEntries: 100,
        maxAgeSeconds: 86400, // 1 day
      }),
    ],
  })
);

// Cleanup outdated caches on activation
self.addEventListener('activate', (event: ExtendableEvent) => {
  event.waitUntil(
    caches.keys().then((cacheNames) => {
      const allowedCaches = [
        'api-cache',
        'image-cache',
        'font-cache',
        'static-resource-cache',
        'workbox-precache',
      ];
      return Promise.all(
        cacheNames
          .filter((cacheName) => !allowedCaches.includes(cacheName))
          .map((cacheName) => caches.delete(cacheName))
      );
    })
  );
});