// sw.js — membuat Finix bisa dipasang di HP dan tetap terbuka saat sinyal jelek.
// Hanya menyimpan file aplikasi. Data keuangan ditangani Firestore (cache offline-nya sendiri).
const VERSI = "finix-v9";
const INTI = [
  "./", "./index.html", "./manifest.webmanifest",
  "./js/app.js", "./js/calc.js", "./js/quotes.js", "./js/features.js", "./js/pockets.js", "./js/savings.js", "./js/export.js", "./js/laporan.js", "./js/nav.js", "./js/firebase-config.js",
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
  const asetStatis = url.hostname === "www.gstatic.com" || url.hostname === "fonts.gstatic.com" || url.hostname === "fonts.googleapis.com" || url.hostname === "cdnjs.cloudflare.com";
  // Login Google, Firestore, dsb. tidak diutak-atik
  if (!mesinSendiri && !asetStatis) return;

  // File aplikasi sendiri: jaringan dulu (update langsung terpakai), cache hanya cadangan saat offline
  if (mesinSendiri) {
    e.respondWith(
      caches.open(VERSI).then(async (cache) => {
        try {
          const res = await fetch(req, { cache: "no-cache" });
          if (res && res.ok) cache.put(req, res.clone());
          return res;
        } catch {
          return (await cache.match(req, { ignoreSearch: true })) || (req.mode === "navigate" ? cache.match("./index.html") : Response.error());
        }
      })
    );
    return;
  }

  // Aset luar (font, Firebase SDK): stale-while-revalidate
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