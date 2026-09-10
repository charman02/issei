import { describe, it, expect } from 'vitest'
import { readFileSync, existsSync } from 'node:fs'
import { resolve } from 'node:path'

// THE INSTALLABLE SHELL (#89), asserted as files rather than as rendered UI.
//
// None of this is reachable from a component test: the manifest, the icons and the service worker
// are static files served from `public/`, and jsdom neither installs an app nor runs a worker. But
// every one of them fails SILENTLY when it's wrong — a missing icon path just doesn't install, a
// manifest without `display: standalone` opens in a browser tab, and on iOS the whole notification
// feature simply doesn't exist unless the install is a real web app. So the file contents are the
// only thing there is to pin.

const root = resolve(__dirname, '..')
const read = (p) => readFileSync(resolve(root, p), 'utf8')
const manifest = JSON.parse(read('public/manifest.webmanifest'))
const html = read('index.html')
const sw = read('public/sw.js')
// The worker's CODE, with comments removed. Its comments deliberately quote the placeholder token
// that must never appear in the shipped code, which a naive scan of the whole file would flag.
const swCode = sw.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|\s)\/\/.*$/gm, '')

describe('the web manifest', () => {
  it('declares standalone display — otherwise the install opens in a browser tab', () => {
    // And on iOS a bookmark-shaped install is exactly the thing Web Push is NOT granted to.
    expect(manifest.display).toBe('standalone')
    expect(manifest.start_url).toBe('/')
    expect(manifest.scope).toBe('/')
  })

  it('every icon it names actually exists on disk', () => {
    // A 404 icon doesn't error anywhere: the browser silently declines to install, or installs
    // with a blank square.
    expect(manifest.icons.length).toBeGreaterThan(0)
    for (const icon of manifest.icons) {
      expect(existsSync(resolve(root, 'public', icon.src.replace(/^\//, '')))).toBe(true)
    }
  })

  it('ships a MASKABLE icon as well as a plain one', () => {
    // Android crops any icon to its platform shape. A non-maskable icon gets its edges cut off —
    // for a wordmark that means losing part of the mark.
    const purposes = manifest.icons.map((i) => i.purpose)
    expect(purposes).toContain('maskable')
    expect(purposes).toContain('any')
  })

  it('uses the app background as the theme colour, matching tailwind.config cream', () => {
    // The status bar sits directly above the app. A default (white or black) band belongs to no
    // design; `terra` would be wrong too — the accent means "you can tap this".
    expect(manifest.theme_color).toBe('#FBF3E2')
    expect(manifest.background_color).toBe('#FBF3E2')
  })

  it('never claims audio, and matches the positioning one-liner', () => {
    const BANNED = /record|recording|\bvoice\b|audio|in (their|your|his|her)( own)? words|listen/i
    expect(manifest.description).not.toMatch(BANNED)
    expect(manifest.description).toMatch(/asked for the recipe/i)
  })
})

describe('index.html', () => {
  it('links the manifest', () => {
    expect(html).toMatch(/<link rel="manifest" href="\/manifest\.webmanifest"/)
  })

  it('carries the iOS-only tags, which the manifest does not cover', () => {
    // Safari ignores the manifest's icons and its display mode. These are not redundant; without
    // `apple-mobile-web-app-capable` an iOS install is a bookmark, and a bookmark gets no push.
    expect(html).toMatch(/<link rel="apple-touch-icon" href="\/apple-touch-icon\.png"/)
    expect(html).toMatch(/name="apple-mobile-web-app-capable" content="yes"/)
    expect(existsSync(resolve(root, 'public/apple-touch-icon.png'))).toBe(true)
  })

  it('sets theme-color to the same cream as the manifest', () => {
    expect(html).toMatch(/name="theme-color" content="#FBF3E2"/)
  })
})

describe('the service worker', () => {
  it('handles all three events — a missing one is a silent dead end', () => {
    // `push` shows the notification; `notificationclick` is the only thing that makes tapping it
    // do anything; `pushsubscriptionchange` is what keeps a device receiving after the browser
    // rotates its subscription on its own schedule. Without the third, a device goes quiet
    // permanently with nothing to notice it by.
    expect(sw).toMatch(/addEventListener\('push'/)
    expect(sw).toMatch(/addEventListener\('notificationclick'/)
    expect(sw).toMatch(/addEventListener\('pushsubscriptionchange'/)
  })

  it('contains no build-time placeholder — public/ is copied VERBATIM', () => {
    // Vite's `define` does not touch files in `public/`, so a `__API_URL__` here would ship as the
    // literal string and every worker fetch would go to an invalid URL. The API base arrives in the
    // registration's query string instead.
    expect(swCode).not.toMatch(/__[A-Z_]+__/)
    expect(swCode).toMatch(/searchParams\.get\('api'\)/)
  })

  it('does NOT cache anything', () => {
    // Deliberately a push-only worker. A cached index.html serving a stale bundle against a moved
    // API is the classic PWA failure, and this app has no offline story to justify the risk.
    expect(swCode).not.toMatch(/caches\.(open|match|keys)/)
    // Either quote style — a double-quoted 'fetch' listener is the same mistake.
    expect(swCode).not.toMatch(/addEventListener\(['"]fetch['"]/)
  })

  it('always shows a notification for a push it cannot parse', () => {
    // A push that results in no visible notification is a permission-revocation offence in Chrome.
    // The catch must fall through to the defaults, not return. Run over the COMMENT-STRIPPED code:
    // against the raw file, the word "return" appearing in that catch block's own comment would
    // fail this for no reason.
    const pushHandler = swCode.slice(
      swCode.indexOf("addEventListener('push'"),
      swCode.indexOf("addEventListener('notificationclick'"),
    )
    expect(pushHandler).toMatch(/showNotification/)
    expect(pushHandler).toMatch(/catch\s*{/)
    expect(pushHandler).not.toMatch(/catch\s*{[^}]*return/)
    // And a null/non-object payload must be normalised BEFORE any property read, since
    // `payload.title` on null throws ahead of showNotification.
    expect(pushHandler).toMatch(/typeof payload !== 'object'/)
  })

  it('focuses a window even when navigating it is not allowed', () => {
    // `WindowClient.navigate()` rejects for a client this worker doesn't control, and
    // `includeUncontrolled: true` is what puts such clients in the list. An unguarded await there
    // skipped focus() AND openWindow() — the notification closed and nothing happened.
    const clickHandler = swCode.slice(swCode.indexOf("addEventListener('notificationclick'"))
    expect(clickHandler).toMatch(/try\s*{[\s\S]*?navigate\([\s\S]*?}\s*catch/)
    expect(clickHandler).toMatch(/return client\.focus\(\)/)
  })
})
