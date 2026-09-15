/* issei's service worker (#89).
 *
 * DELIBERATELY NOT A CACHING SERVICE WORKER. Its whole job is receiving pushes. Adding offline
 * caching here would be a second, much riskier feature wearing the same hat: a stale cached
 * `index.html` serving an old JS bundle against a moved API is the classic PWA failure, and this
 * app has no offline story to speak of anyway (every screen is a fetch). If offline reading ever
 * matters, it gets its own task and its own review — not a quiet addition to this file.
 *
 * It lives in `public/` rather than `src/` because it must be served from the ORIGIN ROOT to have
 * a scope of "/". A service worker's scope cannot be broader than its own path, so
 * `/assets/sw-abc123.js` (where Vite would put it) could only ever control `/assets/`. That also
 * means it is NOT bundled: no imports, no JSX, plain browser JS.
 *
 * There is no versioning or `skipWaiting()` here on purpose. A new worker takes over on the next
 * navigation after all tabs close, which is the browser's default and is correct for a file whose
 * only behaviour is "show what the server pushed" — an eager `skipWaiting()` buys nothing and can
 * swap the worker out mid-push.
 */

/* WHERE THE API URL COMES FROM, AND WHY IT'S IN THE QUERY STRING.
 *
 * This worker has to call the API by absolute URL: `issei.app` and `api.issei.app` are different
 * origins, so a bare `/notifications/...` would hit the frontend host and 404.
 *
 * It cannot read `import.meta.env.VITE_API_URL` — files in `public/` are copied VERBATIM, so
 * Vite's `define` never touches this file and a `__API_URL__` placeholder would ship as the
 * literal string. And it cannot ask the page, because `pushsubscriptionchange` fires with no page
 * open at all.
 *
 * So the registration passes it: `register('/sw.js?api=...')`. The browser persists the full
 * script URL with the registration, which means `self.location.search` is still there when the
 * worker is cold-started weeks later for a push. Scope comes from the PATH, so the query string
 * doesn't narrow it. Changing the API URL changes the script URL, which the browser correctly
 * treats as a new worker.
 */
// Trailing slashes stripped, because this is bare concatenation rather than axios: a
// `VITE_API_URL` ending in "/" would produce `https://api.issei.app//notifications/...`, which
// 404s — silently, inside a worker, on a path no test here can reach.
const API = (
  new URL(self.location.href).searchParams.get('api') || self.location.origin
).replace(/\/+$/, '')

// The VAPID key arrives as base64url text. The spec allows `applicationServerKey` to be a DOMString
// OR a BufferSource, but browsers have historically disagreed, and this file's failure mode is a
// swallowed exception in a worker with no page — so it decodes to bytes exactly as `lib/push.js`
// does. Duplicated rather than imported because a `public/` file cannot import from `src/`; if you
// change one, change both.
function urlBase64ToUint8Array(base64) {
  const padding = '='.repeat((4 - (base64.length % 4)) % 4)
  const normalized = (base64 + padding).replace(/-/g, '+').replace(/_/g, '/')
  const raw = atob(normalized)
  const out = new Uint8Array(raw.length)
  for (let i = 0; i < raw.length; i += 1) out[i] = raw.charCodeAt(i)
  return out
}

// One SHOWN notification per push. The browser requires that a `push` event results in a visible
// notification (Chrome will eventually revoke permission from an app that pushes silently), so
// there is no "handle it quietly" branch here even for the daily prompt.
self.addEventListener('push', (event) => {
  let payload = {}
  try {
    payload = event.data ? event.data.json() : {}
  } catch {
    // A payload we can't parse is still a real push we're obliged to show. Falling through to the
    // defaults below is better than showing nothing and burning permission.
  }
  // `json()` can legitimately return null (the body `null`) or a bare string, and `payload.title`
  // on null THROWS — before showNotification, which is the exact permission-revocation offence the
  // comment above exists to avoid. Not reachable from our own sender today; this is the cheap
  // guarantee that the promise "always shows something" holds for any body at all.
  if (!payload || typeof payload !== 'object') payload = {}

  const title = payload.title || 'issei'
  const options = {
    body: payload.body || '',
    icon: '/icon-192.png',
    badge: '/icon-192.png',
    // `tag` makes this notification REPLACE any earlier one carrying the same tag, instead of
    // stacking. That is wanted for a repeat of one message — the daily prompt sends the constant
    // "daily-prompt" so two unopened days don't become a pile — and actively harmful between two
    // different events.
    //
    // THIS USED TO DEFAULT TO THE CONSTANT `'issei'`, which was a trap: it meant every payload
    // that didn't think about tagging collapsed onto every other one, so "Ben asked for your
    // Adobo" silently replaced "Ana asked for your Adobo" and Ana's ask left no trace on the
    // phone. Every sender now passes an explicit unique tag (`notification-<id>`, `post-<id>`),
    // and the default here is NO tag, so the safe behaviour is what you get by forgetting.
    tag: payload.tag,
    // Where a tap goes. Carried through `data` because `notificationclick` gets the notification,
    // not the original push event.
    data: { url: payload.url || '/' },
  }

  // waitUntil, or the worker can be killed before the notification is actually shown.
  event.waitUntil(self.registration.showNotification(title, options))
})

// A tap should land you in the app you already have open, not open a fourth copy of it.
self.addEventListener('notificationclick', (event) => {
  event.notification.close()
  const target = (event.notification.data && event.notification.data.url) || '/'
  const absolute = new URL(target, self.location.origin).href

  event.waitUntil(
    (async () => {
      const clients = await self.clients.matchAll({
        type: 'window',
        includeUncontrolled: true,
      })
      for (const client of clients) {
        if (!('focus' in client)) continue
        // FOCUS FIRST, navigate best-effort — and that order is the fix for a real dead end.
        // `WindowClient.navigate()` REJECTS with TypeError when the client's active worker isn't
        // this one, and `'navigate' in client` is true either way, so it's no guard at all. Since
        // `includeUncontrolled: true` is what puts uncontrolled windows in this list in the first
        // place, an unhandled rejection here skipped `focus()` AND `openWindow()`: the
        // notification closed and nothing happened. The reachable case is the first session after
        // registration — there is no `clients.claim()`, deliberately — which is the same session
        // someone subscribes in.
        try {
          // Only when it would actually move. Navigating a window already at the target RELOADS
          // it, discarding the scroll position this branch exists to preserve — and the only
          // notification that exists today points at "/", which is the feed.
          if ('navigate' in client && client.url !== absolute) {
            await client.navigate(absolute)
          }
        } catch {
          // Uncontrolled client. Focusing it is still the right outcome; they land in the app.
        }
        return client.focus()
      }
      return self.clients.openWindow(absolute)
    })(),
  )
})

/* The browser rotating a subscription out from under us.
 *
 * THIS IS WHY `POST /notifications/subscribe/rotate` IS UNAUTHENTICATED. This event fires here, in
 * the worker: there is no page, no localStorage, and therefore no JWT — the axios client that
 * attaches the bearer token isn't even loaded, because there is no axios. If the endpoint required
 * auth, a rotation would mean this device silently stops receiving anything, forever, with no
 * signal to either side.
 *
 * So the OLD endpoint is the credential: presenting it proves we held the previous subscription.
 * Same shape as the invite token being the capability.
 */
self.addEventListener('pushsubscriptionchange', (event) => {
  event.waitUntil(
    (async () => {
      // The event is allowed to populate NEITHER subscription — Chrome has shipped it that way —
      // so each half is recovered independently rather than one being inferred from the other.
      // An earlier version derived `oldEndpoint` from the CURRENT subscription when
      // `event.oldSubscription` was absent, which is semantically inverted (that's the new one) and
      // made the re-subscribe branch below unreachable: it would find that same subscription,
      // call it "still valid", and return.
      const oldEndpoint = event.oldSubscription && event.oldSubscription.endpoint
      let fresh = event.newSubscription || (await self.registration.pushManager.getSubscription())

      if (!fresh) {
        // Nothing to send to. Re-subscribe with the server's key — the documented recovery — using
        // the SAME key the page used, decoded to bytes.
        try {
          const res = await fetch(`${API}/notifications/vapid-key`)
          const { public_key: key, configured } = await res.json()
          if (!configured || !key) return
          fresh = await self.registration.pushManager.subscribe({
            userVisibleOnly: true,
            applicationServerKey: urlBase64ToUint8Array(key),
          })
        } catch {
          return
        }
      }

      // No old endpoint means no credential: `POST /subscribe/rotate` identifies the row to replace
      // BY the endpoint it is replacing, and there is no user here to fall back on. Nothing useful
      // to send — the page's own `reconcileSubscription()` picks this device up on the next visit.
      if (!oldEndpoint || oldEndpoint === fresh.endpoint) return

      const json = fresh.toJSON()
      await fetch(`${API}/notifications/subscribe/rotate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          old_endpoint: oldEndpoint,
          subscription: {
            endpoint: json.endpoint,
            p256dh: json.keys.p256dh,
            auth: json.keys.auth,
          },
        }),
      })
    })(),
  )
})
