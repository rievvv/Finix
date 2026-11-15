// sw.js — membuat Finix bisa dipasang di HP dan tetap terbuka saat sinyal jelek.
// Hanya menyimpan file aplikasi. Data keuangan ditangani Firestore (cache offline-nya sendiri).
const VERSI = "finix-v3";
const INTI = [
  "./", "./index.html", "./manifest.webmanifest",
  "./js/app.js", "./js/calc.js", "./js/quotes.js", "./js/features.js", "./js/pockets.js", "./js/firebase-config.js",
  "./icons/icon-192.png", "./icons/icon-512.png", "./icons/apple-touch-icon.png",
];

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(VERSI).then((c) => c.addAll(INTI)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys()
      .then((ks) => Promise.all(ks.filter((k) => k !== VERSI).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (e) => {
  const req = e.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  const mesinSendiri = url.origin === self.location.origin;
  const asetStatis = url.hostname === "www.gstatic.com" || url.hostname === "fonts.gstatic.com" || url.hostname === "fonts.googleapis.com";
  // Login Google, Firestore, dsb. tidak diutak-atik
  if (!mesinSendiri && !asetStatis) return;

  // Stale-while-revalidate: tampil cepat dari cache, diperbarui diam-diam di belakang
  e.respondWith(
    caches.open(VERSI).then(async (cache) => {
      const lama = await cache.match(req, { ignoreSearch: mesinSendiri });
      const baru = fetch(req)
        .then((res) => { if (res && (res.ok || res.type === "opaque")) cache.put(req, res.clone()); return res; })
        .catch(() => lama || (req.mode === "navigate" ? cache.match("./index.html") : undefined));
      return lama || baru;
    })
  );
});