// Service Worker for MB-500 Offline Quiz Tool - v5 (Native Dropdowns & OCR Text)
const CACHE_NAME = 'mb500-cache-v5';
const ASSETS_TO_CACHE = [
  './',
  './index.html',
  './css/style.css',
  './js/storage.js',
  './js/interactions.js',
  './js/exam.js',
  './js/app.js',
  './manifest.json',
  './data/questions.json',
  './data/topics.json'
];

self.addEventListener('install', (event) => {
  self.skipWaiting();
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return cache.addAll(ASSETS_TO_CACHE).catch(err => {
        console.warn('Cache addAll warning:', err);
      });
    })
  );
});

self.addEventListener('activate', (event) => {
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

// Network First for HTML, CSS, JS; Cache First for Images
self.addEventListener('fetch', (event) => {
  const url = event.request.url;

  // Images: Cache first with network fallback
  if (url.includes('/images/')) {
    event.respondWith(
      caches.match(event.request).then((cached) => {
        if (cached) return cached;
        return fetch(event.request).then((response) => {
          const clone = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(event.request, clone));
          return response;
        });
      })
    );
    return;
  }

  // Code & Data: Network first, fall back to cache
  event.respondWith(
    fetch(event.request)
      .then((networkResponse) => {
        if (networkResponse && networkResponse.status === 200) {
          const responseToCache = networkResponse.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(event.request, responseToCache));
        }
        return networkResponse;
      })
      .catch(() => {
        return caches.match(event.request);
      })
  );
});
