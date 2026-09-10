import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

const api = vi.hoisted(() => ({
  getVapidKey: vi.fn(),
  subscribePush: vi.fn(),
  unsubscribePush: vi.fn(),
}))
vi.mock('../api/notifications', () => api)

import {
  disable,
  enable,
  isSubscribedHere,
  localTimezone,
  primeVapidKey,
  pushAvailability,
  reconcileSubscription,
  resetVapidKeyCache,
  urlBase64ToUint8Array,
} from './push'

// A base64url VAPID public key — 65 raw bytes, as a real one is.
const KEY = 'BM'.padEnd(87, 'A')

const originalNavigator = { ...global.navigator }

function stubBrowser({
  ua = 'Mozilla/5.0 (Linux; Android 13) Chrome/120',
  secure = true,
  push = true,
  permission = 'granted',
  subscription = null,
  maxTouchPoints = 0,
} = {}) {
  window.isSecureContext = secure
  Object.defineProperty(navigator, 'userAgent', { value: ua, configurable: true })
  Object.defineProperty(navigator, 'maxTouchPoints', {
    value: maxTouchPoints,
    configurable: true,
  })
  delete navigator.standalone
  window.matchMedia = vi.fn(() => ({ matches: false }))

  const pushManager = {
    getSubscription: vi.fn().mockResolvedValue(subscription),
    subscribe: vi.fn().mockResolvedValue({
      toJSON: () => ({
        endpoint: 'https://fcm.googleapis.com/fcm/send/new-one',
        keys: { p256dh: 'p256dh-value', auth: 'auth-value' },
      }),
    }),
  }
  const registration = { pushManager }

  if (push) {
    Object.defineProperty(navigator, 'serviceWorker', {
      configurable: true,
      value: {
        register: vi.fn().mockResolvedValue(registration),
        getRegistration: vi.fn().mockResolvedValue(registration),
        ready: Promise.resolve(registration),
      },
    })
    window.PushManager = function PushManager() {}
    global.Notification = { permission: 'default', requestPermission: vi.fn() }
    window.Notification = global.Notification
    global.Notification.requestPermission.mockResolvedValue(permission)
  } else {
    delete navigator.serviceWorker
    delete window.PushManager
    delete window.Notification
    delete global.Notification
  }
  return { registration, pushManager }
}

beforeEach(() => {
  vi.clearAllMocks()
  // The VAPID key is cached in module state (prefetched so the permission prompt still has user
  // activation). Without this reset, the "server has no keys" case below would poison every later
  // test in this file — which is exactly what it did on the first run.
  resetVapidKeyCache()
  api.getVapidKey.mockResolvedValue({ data: { public_key: KEY, configured: true } })
  api.subscribePush.mockResolvedValue({})
  api.unsubscribePush.mockResolvedValue({})
})

afterEach(() => {
  Object.defineProperty(navigator, 'userAgent', {
    value: originalNavigator.userAgent,
    configurable: true,
  })
})

describe('urlBase64ToUint8Array', () => {
  it('decodes base64url — the - and _ alphabet, and missing padding', () => {
    // A real VAPID key is base64url with the padding stripped. Handed to
    // pushManager.subscribe as a raw string it throws "must contain a valid P-256 public key",
    // and the resulting failure looks like a server problem.
    const bytes = urlBase64ToUint8Array('-_8')
    expect(Array.from(bytes)).toEqual([251, 255])
  })

  it('round-trips a full-length key without throwing', () => {
    expect(urlBase64ToUint8Array(KEY).length).toBeGreaterThan(60)
  })
})

describe('pushAvailability — four states, because each needs different copy', () => {
  it('is "ready" on a browser that has the APIs', () => {
    stubBrowser()
    expect(pushAvailability()).toBe('ready')
  })

  it('is "install-first" on an iPhone in Safari, NOT "unsupported"', () => {
    // THE PLATFORM FACT THIS WHOLE FEATURE TURNS ON: Safari on iOS exposes PushManager only to a
    // site added to the home screen. Reporting "your browser can't do notifications" to an iPhone
    // would be false and a dead end — and iPhones are most of this app's users.
    stubBrowser({ ua: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0) Safari', push: false })
    expect(pushAvailability()).toBe('install-first')
  })

  it('treats an iPad reporting itself as a Mac as an iPad', () => {
    // iPadOS 13+ sends a Macintosh UA. Without the touch-point check an iPad falls into
    // "unsupported", which is the one answer with no way forward.
    stubBrowser({ ua: 'Mozilla/5.0 (Macintosh; Intel Mac OS X) Safari', push: false, maxTouchPoints: 5 })
    expect(pushAvailability()).toBe('install-first')
  })

  it('is "unsupported" on a desktop browser without push', () => {
    stubBrowser({ ua: 'Mozilla/5.0 (Windows NT 10.0) Gecko/20100101 Firefox/60', push: false })
    expect(pushAvailability()).toBe('unsupported')
  })

  it('is "insecure" off HTTPS, rather than blaming the browser', () => {
    stubBrowser({ secure: false })
    expect(pushAvailability()).toBe('insecure')
  })
})

describe('enable', () => {
  it('checks the server key BEFORE spending the permission prompt', async () => {
    // Subscribing against an empty key mints a subscription the browser reports as successful and
    // no push service can ever deliver to. Asking first means an unconfigured deploy doesn't burn
    // the one permission prompt a person gives you.
    stubBrowser()
    api.getVapidKey.mockResolvedValue({ data: { public_key: '', configured: false } })

    const result = await enable()

    expect(result.ok).toBe(false)
    expect(result.reason).toBe('unconfigured')
    expect(Notification.requestPermission).not.toHaveBeenCalled()
    expect(api.subscribePush).not.toHaveBeenCalled()
  })

  it('subscribes and registers the device when permission is granted', async () => {
    const { pushManager } = stubBrowser({ permission: 'granted' })

    const result = await enable()

    expect(result.ok).toBe(true)
    expect(pushManager.subscribe).toHaveBeenCalledWith(
      expect.objectContaining({ userVisibleOnly: true }),
    )
    expect(api.subscribePush).toHaveBeenCalledWith(
      expect.objectContaining({
        endpoint: 'https://fcm.googleapis.com/fcm/send/new-one',
        p256dh: 'p256dh-value',
        auth: 'auth-value',
      }),
    )
  })

  it('reuses an existing browser subscription instead of minting a second', async () => {
    // Two subscriptions for one device means two copies of every notification.
    const existing = {
      toJSON: () => ({
        endpoint: 'https://fcm.googleapis.com/fcm/send/already-here',
        keys: { p256dh: 'p', auth: 'a' },
      }),
    }
    const { pushManager } = stubBrowser({ subscription: existing })

    await enable()

    expect(pushManager.subscribe).not.toHaveBeenCalled()
    expect(api.subscribePush).toHaveBeenCalledWith(
      expect.objectContaining({ endpoint: 'https://fcm.googleapis.com/fcm/send/already-here' }),
    )
  })

  it('distinguishes a denial from a dismissal, and says where to undo a denial', async () => {
    // A denial is close to permanent — only browser settings can undo it — so copy implying
    // another tap will do it is a dead end. A dismissal is genuinely retryable.
    stubBrowser({ permission: 'denied' })
    const denied = await enable()
    expect(denied.reason).toBe('denied')
    expect(denied.message).toMatch(/browser settings/i)

    stubBrowser({ permission: 'default' })
    const dismissed = await enable()
    expect(dismissed.reason).toBe('dismissed')
    expect(api.subscribePush).not.toHaveBeenCalled()
  })

  it('tells an iPhone in Safari to install first, and never asks for permission', async () => {
    stubBrowser({ ua: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0) Safari', push: false })
    const result = await enable()
    expect(result.reason).toBe('install-first')
    expect(result.message).toMatch(/home screen/i)
  })

  it('returns a message instead of throwing when requestPermission REJECTS', async () => {
    // Safari rejects this with NotAllowedError when it isn't called under a live user activation.
    // A throw here escaped `enable()` entirely, and both callers set their busy flag false only on
    // the NEXT line — so the device switch stayed disabled forever and the nudge's button stayed on
    // "Turning on…", with no error shown and no way back but a reload.
    stubBrowser()
    Notification.requestPermission.mockRejectedValue(new Error('NotAllowedError'))

    const result = await enable()

    expect(result.ok).toBe(false)
    expect(result.reason).toBe('dismissed')
    expect(result.message).toMatch(/try once more/i)
  })

  it('waits for the worker to ACTIVATE before subscribing', async () => {
    // `register()` resolves while the worker is still installing (`registration.active` is null),
    // and `pushManager.subscribe()` on that registration rejects with "no active Service Worker".
    // The old code read `register() || await ready`, where the `||` could never fire — `register()`
    // returns a truthy registration in exactly the state that needs the wait. The case is a first
    // visit on a slow connection, tapping the nudge before the script has been fetched.
    const activated = { pushManager: { getSubscription: vi.fn().mockResolvedValue(null), subscribe: vi.fn().mockResolvedValue({ toJSON: () => ({ endpoint: 'https://fcm.googleapis.com/fcm/send/after-activation', keys: { p256dh: 'p', auth: 'a' } }) }) } }
    stubBrowser()
    // A registration that exists but has no usable pushManager yet — as during installation.
    navigator.serviceWorker.register = vi.fn().mockResolvedValue({
      pushManager: {
        getSubscription: vi.fn().mockRejectedValue(new Error('no active Service Worker')),
        subscribe: vi.fn().mockRejectedValue(new Error('no active Service Worker')),
      },
    })
    navigator.serviceWorker.ready = Promise.resolve(activated)

    const result = await enable()

    expect(result.ok).toBe(true)
    expect(activated.pushManager.subscribe).toHaveBeenCalled()
    expect(api.subscribePush).toHaveBeenCalledWith(
      expect.objectContaining({ endpoint: 'https://fcm.googleapis.com/fcm/send/after-activation' }),
    )
  })
})

describe('primeVapidKey', () => {
  it('fetches once and reuses it, so the tap that follows still has user activation', async () => {
    // The point of the cache: an awaited round trip between a tap and
    // `Notification.requestPermission()` can outlast Safari's activation window, and this app's API
    // is allowed 45 seconds because it can cold-start.
    stubBrowser()
    await primeVapidKey()
    await primeVapidKey()
    await enable()
    expect(api.getVapidKey).toHaveBeenCalledTimes(1)
  })

  it('does NOT cache a failure — one bad second must not disable notifications all session', async () => {
    stubBrowser()
    api.getVapidKey.mockRejectedValueOnce(new Error('offline'))
    await expect(primeVapidKey()).rejects.toThrow()

    api.getVapidKey.mockResolvedValue({ data: { public_key: KEY, configured: true } })
    await expect(primeVapidKey()).resolves.toMatchObject({ configured: true })
  })
})

describe('reconcileSubscription', () => {
  it('re-binds an existing subscription to whoever is signed in NOW', async () => {
    // The shared-phone case the backend designed `POST /subscribe` around: A subscribes, B signs in
    // on the same browser. The browser still holds A's subscription, so the switch reads "on" for B
    // while the row still says A — B gets nothing and A's nudges land on the phone B is using.
    // Re-POSTing what the browser has moves ownership, because that route is idempotent on endpoint.
    stubBrowser({
      subscription: {
        toJSON: () => ({
          endpoint: 'https://fcm.googleapis.com/fcm/send/shared-phone',
          keys: { p256dh: 'p', auth: 'a' },
        }),
      },
    })

    expect(await reconcileSubscription()).toBe(true)
    expect(api.subscribePush).toHaveBeenCalledWith(
      expect.objectContaining({ endpoint: 'https://fcm.googleapis.com/fcm/send/shared-phone' }),
    )
  })

  it('does nothing at all when this device has no subscription', async () => {
    // The overwhelmingly common case — it must cost nothing and never create a row.
    stubBrowser({ subscription: null })
    expect(await reconcileSubscription()).toBe(false)
    expect(api.subscribePush).not.toHaveBeenCalled()
  })
})

describe('disable', () => {
  it('drops the server row BEFORE the browser subscription', async () => {
    // Order matters. Unsubscribe locally first and the row survives holding keys the browser has
    // thrown away — and a send to it fails with a code that deliberately ISN'T treated as dead
    // (only 404/410 prune), so it sits there forever. This way the worst case is a browser
    // subscription nobody pushes to, which is inert.
    const order = []
    api.unsubscribePush.mockImplementation(async () => {
      order.push('server')
    })
    const sub = {
      toJSON: () => ({
        endpoint: 'https://fcm.googleapis.com/fcm/send/x',
        keys: { p256dh: 'p', auth: 'a' },
      }),
      unsubscribe: vi.fn(async () => {
        order.push('browser')
      }),
    }
    stubBrowser({ subscription: sub })

    const result = await disable()

    expect(result.ok).toBe(true)
    expect(order).toEqual(['server', 'browser'])
  })

  it('is a no-op success when this device was never subscribed', async () => {
    stubBrowser({ subscription: null })
    expect(await disable()).toEqual({ ok: true })
    expect(api.unsubscribePush).not.toHaveBeenCalled()
  })
})

describe('isSubscribedHere', () => {
  it('asks the BROWSER, which is the only thing that knows', async () => {
    // A server row for a subscription this browser has since dropped would make the switch read
    // "on" for a device that receives nothing.
    stubBrowser({ subscription: { toJSON: () => ({}) } })
    expect(await isSubscribedHere()).toBe(true)

    stubBrowser({ subscription: null })
    expect(await isSubscribedHere()).toBe(false)
  })

  it('is false — never a throw — where push does not exist', async () => {
    stubBrowser({ push: false })
    expect(await isSubscribedHere()).toBe(false)
  })
})

describe('localTimezone', () => {
  it('returns an IANA zone name', () => {
    // The scheduler compares a stored hour against the RECIPIENT'S local clock, so this string is
    // the difference between being nudged at 6pm and never being due at all.
    expect(localTimezone()).toMatch(/^[A-Za-z]+(\/[A-Za-z_+-]+)*$/)
  })
})
