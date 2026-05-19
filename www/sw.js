const CACHE_NAME = 'thermal-feels-like-v1';
const ASSETS = [
  './index.html',
  './style.css',
  './main.js',
  './manifest.json',
  './lib/leaflet.js',
  './lib/leaflet.css',
  './lib/chart.js',
  './app-icon.png',
  './sunny.png',
  './cloudy.png',
  './partly_cloudy.png',
  './rainy.png',
  './moderate_rain_v2.png',
  './light_rain_v2.png',
  './heavy_rain_v2.png',
  './stormy.png',
  './snowy.png',
  './foggy.png'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(ASSETS))
  );
});

self.addEventListener('fetch', (event) => {
  event.respondWith(
    caches.match(event.request).then((response) => {
      return response || fetch(event.request);
    })
  );
});
