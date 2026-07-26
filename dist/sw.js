/*
 * Kill-switch for the OLD PWA service worker.
 *
 * The previous HLViewer build registered a workbox service worker on this
 * origin. A browser that still has it installed keeps serving the old cached
 * app no matter what nginx points at, so simply changing the document root is
 * not enough. This file takes over the same URL, wipes every cache the old
 * worker left, unregisters itself and reloads the open tabs onto the new build.
 *
 * The new frontend has no service worker of its own — this exists purely to
 * undo the previous one. It can be deleted once no client can still be running
 * the old build (safe rule of thumb: after everyone has opened the app once).
 */
self.addEventListener('install', () => self.skipWaiting())

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys()
      await Promise.all(keys.map((key) => caches.delete(key)))
      await self.registration.unregister()
      const windows = await self.clients.matchAll({ type: 'window' })
      windows.forEach((client) => client.navigate(client.url))
    })(),
  )
})

// Never answer from a cache: everything goes to the network while this runs.
self.addEventListener('fetch', () => {})
