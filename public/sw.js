/* Minimal dependency-free service worker. Two strategies (no build-time precache list — runtime
   caching keeps this hand-rolled and filename-agnostic; scope = the directory it's served from):
   • NAVIGATIONS (index.html): network-first, falling back to cache. Cache-first here is a trap —
     a stale index references hashed assets that may already be gone from the server (a broken app
     two deploys out), and users would always run one deploy behind.
   • EVERYTHING ELSE (hashed assets, icons): cache-first with background revalidate — hashed
     filenames make staleness impossible, so the fast path is safe. */
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
  if (req.mode === 'navigate') {
    // network-first: fresh index whenever we're online; the cached copy only serves offline
    e.respondWith(
      caches.open(CACHE).then((cache) =>
        fetch(req)
          .then((res) => {
            if (res && res.ok && res.type === 'basic') cache.put(req, res.clone())
            return res
          })
          .catch(() => cache.match(req).then((hit) => hit || Response.error())),
      ),
    )
    return
  }
  // cache-first with background revalidate for same-origin subresources
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
