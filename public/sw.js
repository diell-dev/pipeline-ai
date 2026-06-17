/**
 * Pipeline AI — App shell service worker (Phase M4.3)
 *
 * Minimal hand-rolled SW. We do NOT use next-pwa / Workbox because
 * next-pwa does not have a stable release targeting Next 15/16 — the
 * official package caps at Next 13. A 100-line vanilla SW gets us the
 * offline-shell experience without a major dependency.
 *
 * Strategy:
 *   - HTML navigations  → network-first, fallback to cached shell, then
 *                         /offline-fallback inline HTML if the shell
 *                         hasn't been visited yet
 *   - Static assets     → stale-while-revalidate (JS, CSS, fonts, images
 *                         under /_next/static/, /icon, /apple-icon)
 *   - API + Supabase    → never cached, always pass through
 *
 * Versioned cache names so a redeploy nukes the old shell. Bump
 * `CACHE_VERSION` when the shell layout changes meaningfully.
 *
 * IMPORTANT: we never cache user data or API responses. The offline state
 * is read-only — if you're offline and you haven't loaded /dashboard yet,
 * you get the inline offline fallback. If you have loaded it, you get the
 * shell (which will then fail to fetch its own data and show the existing
 * skeleton states — that's acceptable; out of scope to build full offline
 * data sync for the mobile uplift).
 */

const CACHE_VERSION = 'v1'
const RUNTIME_CACHE = `pipeline-runtime-${CACHE_VERSION}`
const SHELL_CACHE = `pipeline-shell-${CACHE_VERSION}`

// Inline offline fallback HTML — embedded so the SW can serve it before
// the user has cached anything. Kept intentionally minimal; matches the
// manifest background color so it doesn't flash white in standalone mode.
const OFFLINE_HTML = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <meta name="theme-color" content="#0f1a2e">
  <title>Offline · Pipeline AI</title>
  <style>
    html,body{margin:0;height:100%;background:#0f1a2e;color:#e2e8f0;font-family:ui-sans-serif,system-ui,-apple-system,"Segoe UI",Roboto,sans-serif}
    .wrap{min-height:100%;display:flex;align-items:center;justify-content:center;padding:24px;text-align:center}
    .card{max-width:360px}
    .badge{display:inline-flex;align-items:center;justify-content:center;width:48px;height:48px;border-radius:12px;background:#1e293b;margin-bottom:16px;font-size:24px}
    h1{font-size:18px;margin:0 0 8px;font-weight:600}
    p{font-size:14px;margin:0;color:#94a3b8;line-height:1.5}
    button{margin-top:20px;background:#fff;color:#0f1a2e;border:0;border-radius:8px;padding:10px 20px;font-size:14px;font-weight:600;cursor:pointer}
  </style>
</head>
<body>
  <div class="wrap">
    <div class="card">
      <div class="badge">P</div>
      <h1>You're offline</h1>
      <p>Pipeline AI needs a connection to load your jobs, invoices, and clients. Reconnect and try again.</p>
      <button onclick="location.reload()">Retry</button>
    </div>
  </div>
</body>
</html>`

self.addEventListener('install', (event) => {
  // Pre-stash the offline fallback under a stable URL so navigation
  // requests can match it even when the user has never hit /offline.
  event.waitUntil(
    caches.open(SHELL_CACHE).then((cache) =>
      cache.put(
        new Request('/__offline-fallback', { mode: 'navigate' }),
        new Response(OFFLINE_HTML, {
          status: 200,
          headers: { 'Content-Type': 'text/html; charset=utf-8' },
        })
      )
    )
  )
  self.skipWaiting()
})

self.addEventListener('activate', (event) => {
  // Sweep old cache versions on activation.
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys
            .filter((k) => k !== RUNTIME_CACHE && k !== SHELL_CACHE)
            .map((k) => caches.delete(k))
        )
      )
      .then(() => self.clients.claim())
  )
})

self.addEventListener('fetch', (event) => {
  const req = event.request
  const url = new URL(req.url)

  // Only handle same-origin GETs.
  if (req.method !== 'GET' || url.origin !== self.location.origin) return

  // Never cache API or Supabase calls.
  if (url.pathname.startsWith('/api/')) return

  // Navigations → network-first, fall back to cached shell, then offline.
  if (req.mode === 'navigate') {
    event.respondWith(
      fetch(req)
        .then((res) => {
          // Cache successful HTML responses so we have a shell to fall
          // back to on subsequent offline visits.
          if (res && res.ok && res.headers.get('content-type')?.includes('text/html')) {
            const copy = res.clone()
            caches.open(SHELL_CACHE).then((cache) => cache.put(req, copy))
          }
          return res
        })
        .catch(() =>
          caches.match(req).then(
            (cached) =>
              cached ||
              caches.match('/__offline-fallback').then(
                (offline) =>
                  offline ||
                  new Response(OFFLINE_HTML, {
                    status: 200,
                    headers: { 'Content-Type': 'text/html; charset=utf-8' },
                  })
              )
          )
        )
    )
    return
  }

  // Static assets → stale-while-revalidate.
  const isStatic =
    url.pathname.startsWith('/_next/static/') ||
    url.pathname.startsWith('/icon') ||
    url.pathname.startsWith('/apple-icon') ||
    url.pathname === '/favicon.ico' ||
    /\.(?:js|css|woff2?|ttf|otf|svg|png|jpg|jpeg|gif|webp|avif)$/.test(url.pathname)

  if (!isStatic) return

  event.respondWith(
    caches.open(RUNTIME_CACHE).then((cache) =>
      cache.match(req).then((cached) => {
        const network = fetch(req)
          .then((res) => {
            if (res && res.ok) cache.put(req, res.clone())
            return res
          })
          .catch(() => cached)
        return cached || network
      })
    )
  )
})
