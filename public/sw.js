/* Minimal dependency-free service worker: cache-falling-back-to-network for GET requests, so the
   app shell + assets work offline after the first visit. (No build-time precache list — runtime
   caching keeps this hand-rolled and filename-agnostic.) Scope = the directory it's served from. */
const CACHE = 'setcore-v1'

self.addEventListener('install', () => {
  self.skipWaiting()
})

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim()),
  )
})

self.addEventListener('fetch', (e) => {
  const req = e.request
  if (req.method !== 'GET') return
  e.respondWith(
    caches.open(CACHE).then((cache) =>
      cache.match(req).then((hit) => {
        const net = fetch(req)
          .then((res) => {
            if (res && res.ok && res.type === 'basic') cache.put(req, res.clone())
            return res
          })
          .catch(() => hit)
        return hit || net
      }),
    ),
  )
})
