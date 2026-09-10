import { getVapidKey, subscribePush, unsubscribePush } from '../api/notifications'

// WEB PUSH, THE CLIENT HALF (#89).
//
// Everything that talks to the browser's push machinery lives here so that no component has to
// know about `PushManager`, base64url keys, or the four different reasons a device can't receive
// a notification. A page asks two questions — "can this device do it?" and "is it on?" — and
// calls `enable()` / `disable()`.
//
// THE PLATFORM FACT THAT SHAPES ALL OF IT: on iOS, `window.PushManager` does not exist in Safari
// at all. It appears only once the site has been added to the home screen and is running as an
// installed app. So a plain "your browser doesn't support notifications" message is WRONG for the
// majority of this app's users — the truthful answer is "add issei to your home screen first, then
// this works." `pushAvailability()` distinguishes those two cases, because they have different
// remedies and telling an iPhone user their phone can't do it is both false and a dead end.

const SW_URL = '/sw.js'
const API_BASE = import.meta.env.VITE_API_URL || 'http://localhost:8000'

// The VAPID public key arrives as base64url text and `pushManager.subscribe` wants raw bytes.
// Not decorative: passing the string through unconverted throws
// "applicationServerKey must contain a valid P-256 public key".
export function urlBase64ToUint8Array(base64) {
  const padding = '='.repeat((4 - (base64.length % 4)) % 4)
  const normalized = (base64 + padding).replace(/-/g, '+').replace(/_/g, '/')
  const raw = atob(normalized)
  const out = new Uint8Array(raw.length)
  for (let i = 0; i < raw.length; i += 1) out[i] = raw.charCodeAt(i)
  return out
}

// Running as an installed app rather than in a browser tab. `display-mode: standalone` is the
// standard signal; `navigator.standalone` is the iOS-only one, which predates it and is still the
// only one older iOS reports.
export function isStandalone() {
  try {
    if (window.navigator.standalone) return true
    return window.matchMedia('(display-mode: standalone)').matches
  } catch {
    return false
  }
}

export function isIos() {
  const ua = navigator.userAgent || ''
  // iPadOS 13+ reports itself as a Mac, so the touch check is the only way to tell an iPad from a
  // desktop Safari — and it matters, because an iPad has the same install-first requirement.
  return /iPad|iPhone|iPod/.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1)
}

// One of four states, each with a different thing to say to the person:
//
//   'ready'          — the APIs exist; we can ask for permission.
//   'install-first'  — iOS in a browser tab. Not unsupported: unavailable UNTIL installed.
//   'unsupported'    — genuinely no push (a desktop browser without it, a private window).
//   'insecure'       — not on HTTPS/localhost, so service workers are blocked outright. Its own
//                      case because it's the one a developer hits and would otherwise misread as
//                      'unsupported' and go hunting in the wrong place.
export function pushAvailability() {
  if (!window.isSecureContext) return 'insecure'
  const has =
    'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window
  if (has) return 'ready'
  if (isIos() && !isStandalone()) return 'install-first'
  return 'unsupported'
}

export function permissionState() {
  try {
    return Notification.permission // 'default' | 'granted' | 'denied'
  } catch {
    return 'default'
  }
}

// Register the worker, passing the API base in the query string.
//
// The query string is how the worker learns where the API lives: it's a `public/` file, so Vite
// copies it verbatim and never substitutes an env variable into it, and `pushsubscriptionchange`
// fires with no page to ask. The browser persists the full script URL with the registration, so
// the value survives a cold worker start. See the long note at the top of `public/sw.js`.
//
// `?api=` does NOT narrow the scope — scope comes from the path — but it does mean changing the
// API URL registers a new worker, which is correct.
export async function registerServiceWorker() {
  if (!('serviceWorker' in navigator) || !window.isSecureContext) return null
  try {
    return await navigator.serviceWorker.register(
      `${SW_URL}?api=${encodeURIComponent(API_BASE)}`,
      { scope: '/' },
    )
  } catch {
    // A failed registration must never break the app. Push is an enhancement; the app it enhances
    // works entirely without it.
    return null
  }
}

// Is THIS device subscribed? Asks the browser, not our own state — the browser is the only thing
// that knows, and a row on the server for a subscription this browser has since dropped would
// make a switch read "on" for a device that receives nothing.
export async function isSubscribedHere() {
  if (pushAvailability() !== 'ready') return false
  try {
    const reg = await navigator.serviceWorker.getRegistration('/')
    if (!reg) return false
    return Boolean(await reg.pushManager.getSubscription())
  } catch {
    return false
  }
}

// The server's public key, fetched ONCE per page and cached as a promise.
//
// Two reasons it is prefetched rather than fetched inside `enable()`:
//
// 1. `Notification.requestPermission()` must be reached while the tap's USER ACTIVATION is still
//    live. WebKit's window is a few seconds; this app's own axios client allows 45 SECONDS because
//    the API can cold-start (see api/client.js). An awaited round trip between the tap and the
//    prompt therefore means Safari can refuse the prompt outright on exactly the platform this
//    whole feature exists for. Prefetching keeps the ordering below (key first, prompt second)
//    without paying for it at tap time.
// 2. The ordering itself is not negotiable: subscribing against an empty key mints a subscription
//    the browser reports as a success and no push service can ever deliver to, so an unconfigured
//    deploy would leave a switch reading "on" with nothing arriving.
//
// A rejected fetch is NOT cached — the next call retries, because "offline for one second" must
// not disable notifications for the rest of the session.
let keyPromise = null
export function primeVapidKey() {
  if (!keyPromise) {
    // Started inside a `then` so a synchronous throw becomes a REJECTION. Callers prefetch with
    // `primeVapidKey().catch(() => {})`, and a sync throw would sail straight past that and break
    // the render it was fired from.
    keyPromise = Promise.resolve()
      .then(() => getVapidKey())
      .then(
        (res) => res.data,
        (err) => {
          keyPromise = null
          throw err
        },
      )
  }
  return keyPromise
}

// Drop the cached key. Exists for tests, and named so nobody mistakes it for product behaviour:
// module state that survives between test cases is how a "server has no keys" case silently poisons
// every later assertion in the same file. Harmless in the app, where nothing calls it.
export function resetVapidKeyCache() {
  keyPromise = null
}

// Turn notifications on for this device. Returns { ok } or { ok: false, reason, message }.
//
// It returns a reason rather than throwing because every failure here is a THING TO SAY, not an
// exception: a person who declined the browser prompt, an iPhone that isn't installed yet, a
// server with no keys configured. Each needs different copy, and a caller that only gets an Error
// has to parse a message to tell them apart. NOTHING in here throws — `requestPermission()` can
// reject (Safari does, with NotAllowedError, when activation has expired), and a throw would leave
// both callers' `setBusy(false)` unreached: a switch disabled forever, or a button stuck on
// "Turning on…", with no error shown and no way back but a reload.
export async function enable() {
  const availability = pushAvailability()
  if (availability !== 'ready') {
    return {
      ok: false,
      reason: availability,
      message:
        availability === 'install-first'
          ? 'Add issei to your home screen first, then turn this on from there.'
          : "This browser can’t do notifications.",
    }
  }

  let key = ''
  try {
    const data = await primeVapidKey()
    if (!data.configured || !data.public_key) {
      return {
        ok: false,
        reason: 'unconfigured',
        message: "Notifications aren’t switched on for issei yet.",
      }
    }
    key = data.public_key
  } catch {
    return { ok: false, reason: 'offline', message: "Couldn’t reach issei. Try again." }
  }

  let permission
  try {
    permission = await Notification.requestPermission()
  } catch {
    // Safari rejects this when it isn't called under a live user activation. Reported as
    // retryable, because it is — the next tap usually lands inside the window.
    return {
      ok: false,
      reason: 'dismissed',
      message: 'Notifications stay off until you allow them. Try once more?',
    }
  }
  if (permission !== 'granted') {
    return {
      ok: false,
      reason: permission === 'denied' ? 'denied' : 'dismissed',
      // 'denied' is close to permanent and only the browser's own settings can undo it, so the
      // copy has to point there rather than implying another tap will do it.
      message:
        permission === 'denied'
          ? 'Notifications are blocked for issei in your browser settings.'
          : 'Notifications stay off until you allow them.',
    }
  }

  try {
    // REGISTER, THEN WAIT FOR ACTIVATION. `register()` resolves as soon as the registration
    // exists — `registration.active` is still null while the worker installs — and
    // `pushManager.subscribe()` on a registration with no active worker rejects with
    // "Registration failed - no active Service Worker". So `ready` is awaited unconditionally
    // rather than as a fallback: an `||` here can never fire, because `register()` returns a
    // truthy registration in exactly the un-activated state that needs the wait. The case is a
    // first visit on a slow connection where someone taps the nudge before the worker script has
    // even been fetched.
    await registerServiceWorker()
    const reg = await navigator.serviceWorker.ready
    const sub =
      (await reg.pushManager.getSubscription()) ||
      (await reg.pushManager.subscribe({
        // Required to be true by every browser: a push MUST result in a visible notification.
        // There is no silent-push option to leave off.
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(key),
      }))
    const json = sub.toJSON()
    await subscribePush({
      endpoint: json.endpoint,
      p256dh: json.keys.p256dh,
      auth: json.keys.auth,
      user_agent: navigator.userAgent?.slice(0, 300) || null,
    })
    return { ok: true }
  } catch {
    return { ok: false, reason: 'failed', message: "Couldn’t turn on notifications." }
  }
}

// Re-assert that the subscription this browser holds belongs to the CURRENT account.
//
// The case this exists for is the one the backend explicitly designed `POST /subscribe` around: a
// shared phone. Person A subscribes; person B signs in on the same browser. The browser still holds
// A's subscription object, so `isSubscribedHere()` is true and the switch reads "on" — while the
// server row still carries A's `user_id`. B receives nothing, A's nudges land on the phone B is
// using, and if B toggles off, the DELETE (scoped to B) removes nothing while the browser drops the
// subscription, orphaning A's row behind an endpoint only a 404/410 will ever prune.
//
// `POST /subscribe` is idempotent on the endpoint and MOVES ownership, so re-sending what the
// browser already has is enough to fix it. Called once per app start for a signed-in user;
// deliberately silent, and a no-op when this device has no subscription (the overwhelmingly common
// case, so it costs nothing).
export async function reconcileSubscription() {
  try {
    const reg = await navigator.serviceWorker.getRegistration('/')
    const sub = reg && (await reg.pushManager.getSubscription())
    if (!sub) return false
    const json = sub.toJSON()
    await subscribePush({
      endpoint: json.endpoint,
      p256dh: json.keys.p256dh,
      auth: json.keys.auth,
      user_agent: navigator.userAgent?.slice(0, 300) || null,
    })
    return true
  } catch {
    return false
  }
}

// Turn them off for this device.
//
// SERVER FIRST, then the browser. If the local `unsubscribe()` succeeded and the DELETE failed, the
// row would survive with keys the browser has thrown away — and every send to it would fail with a
// code that deliberately ISN'T treated as dead (only 404/410 prune), so it would sit there
// forever. Dropping the row first means the worst case is a browser subscription nobody pushes to,
// which is inert.
export async function disable() {
  try {
    const reg = await navigator.serviceWorker.getRegistration('/')
    const sub = reg && (await reg.pushManager.getSubscription())
    if (!sub) return { ok: true }
    const json = sub.toJSON()
    await unsubscribePush({
      endpoint: json.endpoint,
      p256dh: json.keys.p256dh,
      auth: json.keys.auth,
    })
    await sub.unsubscribe()
    return { ok: true }
  } catch {
    return { ok: false, reason: 'failed', message: "Couldn’t turn off notifications." }
  }
}

// The zone the scheduler needs, e.g. "Asia/Manila". Sent on login and signup rather than only from
// a settings screen: the daily prompt fires at a fixed hour in the RECIPIENT'S local time, so a
// user who never opens settings would otherwise never be due at all.
export function localTimezone() {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || null
  } catch {
    return null
  }
}
