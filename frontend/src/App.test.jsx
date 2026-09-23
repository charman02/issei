import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import { MemoryRouter, Routes, Route, Navigate, useLocation } from 'react-router-dom'
import { readFileSync } from 'node:fs'
import App from './App'
import { resolve } from 'node:path'

// The routing table itself has no test coverage, and #57 turned /shared into a redirect.
// PublicOnlyRoute sends a just-claimed invite to /shared, so if that redirect's target
// were renamed the highest-intent moment in the product would dead-end — with nothing to
// catch it. This pins the one route whose whole job is to forward.
//
// Rendering App directly would mean mocking every page's API module, so this mounts the
// same <Navigate> declaration and separately asserts App.jsx still declares it — the pair
// fails if either the behavior or the real route string drifts.

function Landed() {
  const loc = useLocation()
  return <div data-testid="landed">{loc.pathname + loc.search}</div>
}

describe('/shared is a redirect to the Kept tab (#57)', () => {
  it('lands on /my-recipes with the kept tab selected', () => {
    render(
      <MemoryRouter initialEntries={['/shared']}>
        <Routes>
          <Route path="/shared" element={<Navigate to="/my-recipes?tab=kept" replace />} />
          <Route path="/my-recipes" element={<Landed />} />
        </Routes>
      </MemoryRouter>,
    )
    expect(screen.getByTestId('landed')).toHaveTextContent('/my-recipes?tab=kept')
  })

  it('App.jsx still declares that exact redirect', () => {
    // vitest runs with cwd = frontend/, and import.meta.url isn't a file: URL under jsdom.
    const src = readFileSync(resolve(process.cwd(), 'src/App.jsx'), 'utf8')
    expect(src).toContain('path="/shared"')
    expect(src).toContain('to="/my-recipes?tab=kept"')
    // And the page it replaced is really gone, not merely unrouted.
    expect(src).not.toContain('SharedWithMe')
  })
})

// A <Route> spliced INSIDE another route's element is valid JSX: it compiles, the build
// passes, and every other test passes — while the page renders BLANK, because React Router
// never matches it. #79's /notifications route shipped that way for a few minutes and only a
// browser caught it. A textual nesting check couldn't see it either (tried; it passed on the
// broken file). The only thing that actually catches it is rendering the real route table.
//
// Page components are stubbed, so this tests ROUTING and nothing else — no API mocking, and
// a page's own behaviour stays covered by its own test file.
vi.mock('./pages/Notifications', () => ({ default: () => <div>INBOX RENDERED</div> }))
vi.mock('./pages/Requests', () => ({ default: () => <div>ASKS RENDERED</div> }))
vi.mock('./pages/Feed', () => ({ default: () => <div>FEED RENDERED</div> }))
vi.mock('./pages/Landing', () => ({ default: () => <div>LANDING RENDERED</div> }))

// `reconcile` is the ONE thing App.jsx does besides route (#97/#90 — it syncs the cached
// identity against the server on start). It has to be mocked here even though this file
// otherwise mocks no APIs: unmocked, rendering <App /> fires a real axios GET at
// VITE_API_URL. In CI nothing is listening so it fails silently and the suite stays green —
// but with a dev server running locally, `test-token` returns 401, the interceptor clears
// localStorage MID-SUITE and calls window.location.assign (jsdom: "Not implemented:
// navigation"). Environment-dependent behaviour in the suite that gates the deploy is the
// same local-green/CI-red trap this repo has already been bitten by once.
vi.mock('./lib/currentUser', () => ({ reconcile: vi.fn(() => Promise.resolve(null)) }))
import { reconcile } from './lib/currentUser'

// Same reasoning for the push layer (#89). Both calls are fire-and-forget wiring that the app
// renders perfectly well without, and jsdom has no service worker at all — so unmocked they are
// no-ops and nothing here could tell whether App.jsx still makes them.
vi.mock('./lib/push', () => ({
  registerServiceWorker: vi.fn(() => Promise.resolve({})),
  reconcileSubscription: vi.fn(() => Promise.resolve(false)),
}))
import { reconcileSubscription, registerServiceWorker } from './lib/push'

// The stale-identity fix (#90) is a single call in App.jsx. Nothing else would notice if it
// were dropped in a refactor: the app renders fine without it, and every symptom (a photo
// nudge that won't go away, a stale avatar on the You page) is invisible to the unit suite.
// This is the file for wiring that compiles but never runs.
describe('the cached identity is reconciled on app start (#90)', () => {
  beforeEach(() => vi.clearAllMocks()) // the spy is module-level; don't inherit the last test's calls
  afterEach(() => localStorage.clear())

  it('calls reconcile when there is a token', async () => {
    localStorage.setItem('issei_token', 'test-token')
    localStorage.setItem('issei_user', JSON.stringify({ id: 1, first_name: 'Me' }))
    render(
      <MemoryRouter initialEntries={['/notifications']}>
        <App />
      </MemoryRouter>,
    )
    await screen.findByText('INBOX RENDERED')
    expect(reconcile).toHaveBeenCalled()
  })

  it('does NOT call reconcile when nobody is signed in', async () => {
    // No token: a signed-out visitor must not fire an authenticated request, and /auth/me
    // would 401 and trip the interceptor's redirect for someone already at /login.
    render(
      <MemoryRouter initialEntries={['/login']}>
        <App />
      </MemoryRouter>,
    )
    expect(reconcile).not.toHaveBeenCalled()
  })
})

describe('the route table actually resolves (#79)', () => {
  beforeEach(() => {
    // ProtectedRoute reads the token; these are protected destinations.
    localStorage.setItem('issei_token', 'test-token')
    localStorage.setItem('issei_user', JSON.stringify({ id: 1, first_name: 'Me' }))
  })
  afterEach(() => localStorage.clear())

  it('/notifications renders the inbox, inside Layout', async () => {
    render(
      <MemoryRouter initialEntries={['/notifications']}>
        <App />
      </MemoryRouter>,
    )
    expect(await screen.findByText('INBOX RENDERED')).toBeInTheDocument()
    // Wrapped in Layout (defined inside App.jsx, so not mockable) — proven by the bottom
    // nav being present: this is a destination you come back from, not a takeover.
    expect(screen.getByLabelText(/kitchen/i)).toBeInTheDocument()
  })

  it('/requests renders the cook’s asks, inside Layout', async () => {
    render(
      <MemoryRouter initialEntries={['/requests']}>
        <App />
      </MemoryRouter>,
    )
    expect(await screen.findByText('ASKS RENDERED')).toBeInTheDocument()
    expect(screen.getByLabelText(/kitchen/i)).toBeInTheDocument()
  })

  it('both are behind auth', async () => {
    localStorage.clear()
    render(
      <MemoryRouter initialEntries={['/requests']}>
        <App />
      </MemoryRouter>,
    )
    // Bounced, not rendered.
    expect(screen.queryByText('ASKS RENDERED')).not.toBeInTheDocument()
  })
})

// `/` serves BOTH audiences (#111): signed in it is Home, signed out it is the public Landing —
// the referral fix, because until #111 every public door but an invite link led to a sign-in form
// that never said what issei is.
//
// THESE RENDER THE REAL ROUTE TABLE, and the first version of them did not — it asserted against
// App.jsx as a STRING, and that is exactly why a ship-blocking defect reached the gate green. The
// original implementation put the ternary inline in the route's `element` prop, which is evaluated
// in App's own body; App never re-executes after mount, so the token was read ONCE at page load and
// frozen. Signing in left you on the marketing page with no way back — Landing has no bottom nav,
// and its "Sign in" link bounces off `PublicOnlyRoute` straight back to Landing.
//
// A source-text check cannot see that, and the comment forty lines above this one already said so
// about a different bug: "A textual nesting check couldn't see it either (tried; it passed on the
// broken file). The only thing that actually catches it is rendering the real route table." Same
// lesson, same file, ignored once. Hence: navigate, don't grep.
describe('`/join` is the referral door, and `/` is the app (#111)', () => {
  // THE PLACEMENT MOVED, on owner review, and the reasoning is worth keeping because two of the three
  // candidates were wrong for concrete reasons rather than taste.
  //
  //   `/` signed-out (where it started) — WRONG: a returning user who types `issei.app` wants the
  //     sign-in form, and making them read a pitch and tap past it every time taxes the people who
  //     already said yes. It also caused a frozen-element bug, since a route element that branches on
  //     localStorage is evaluated once in App's body and App never re-executes.
  //   post-signup (the other candidate) — ALREADY OCCUPIED: `/welcome` has two TEACHING panels that
  //     explain what issei is for, using `RecipeGlimpse` and `IsseiMeaning` — the same two components
  //     the landing page uses. It would have been a duplicate.
  //   `/join` — the share link's address, seen by exactly the audience it was written for.
  afterEach(() => localStorage.clear())

  it('serves the landing page at /join with no account', async () => {
    render(
      <MemoryRouter initialEntries={['/join']}>
        <App />
      </MemoryRouter>,
    )
    expect(await screen.findByText('LANDING RENDERED')).toBeInTheDocument()
  })

  it('serves it to a SIGNED-IN visitor too, rather than bouncing them', async () => {
    // Deliberately not wrapped in a signed-out-only guard: a user who wants to show a friend what
    // issei is should be able to open the page they are about to send, and `TellAFriend` sits two taps
    // away on the Friends page. Bouncing them would make the referral link untestable by the person
    // doing the referring.
    localStorage.setItem('issei_token', 'test-token')
    render(
      <MemoryRouter initialEntries={['/join']}>
        <App />
      </MemoryRouter>,
    )
    expect(await screen.findByText('LANDING RENDERED')).toBeInTheDocument()
  })

  it('does NOT put the landing page on `/` for a signed-out visitor', async () => {
    // The owner's note, and the whole reason for this commit: `issei.app` must go straight to the
    // sign-in form. A returning user should never have to tap past marketing to log in.
    render(
      <MemoryRouter initialEntries={['/']}>
        <App />
      </MemoryRouter>,
    )
    expect(screen.queryByText('LANDING RENDERED')).not.toBeInTheDocument()
    expect(screen.queryByText('FEED RENDERED')).not.toBeInTheDocument()
    // AND the form is actually there. Two absences alone would also be satisfied by deleting the
    // `/` route outright, so the commit's promise — "returning users get the sign-in form" — needs
    // a positive assertion or nothing pins it. `Login` is deliberately not mocked in this file.
    expect(await screen.findByPlaceholderText(/^email$/i)).toBeInTheDocument()
    expect(screen.getByPlaceholderText(/^password$/i)).toBeInTheDocument()
  })

  it('still serves Home, inside Layout, to a signed-in user at `/`', async () => {
    localStorage.setItem('issei_token', 'test-token')
    localStorage.setItem('issei_user', JSON.stringify({ id: 1, first_name: 'Me' }))
    render(
      <MemoryRouter initialEntries={['/']}>
        <App />
      </MemoryRouter>,
    )
    expect(await screen.findByText('FEED RENDERED')).toBeInTheDocument()
    expect(screen.getByLabelText(/kitchen/i)).toBeInTheDocument()
  })
})

// The service worker is registered from App.jsx on every load, and that is the only place it
// happens. Nothing else in the app would notice if the call were dropped in a refactor: every
// screen still works, `enable()` registers on demand, and the only symptom is that
// `pushsubscriptionchange` stops being handled — so a device goes permanently silent after the
// browser rotates its subscription, with nothing to notice it by.
describe('the push service worker is registered on app start (#89)', () => {
  beforeEach(() => vi.clearAllMocks())
  afterEach(() => localStorage.clear())

  it('registers for everyone, signed in or not', async () => {
    // Including an anonymous /invite/:token reader. Safe because this worker does no caching — the
    // usual PWA hazard (a stale bundle served from cache) does not exist here.
    render(
      <MemoryRouter initialEntries={['/login']}>
        <App />
      </MemoryRouter>,
    )
    expect(registerServiceWorker).toHaveBeenCalled()
  })

  it('re-binds the subscription on this device to whoever is signed in', async () => {
    // The shared-phone case: A subscribes, B signs in on the same browser, and the row still says
    // A — so B receives nothing while A's nudges land on the phone B is using.
    localStorage.setItem('issei_token', 'test-token')
    localStorage.setItem('issei_user', JSON.stringify({ id: 1, first_name: 'Me' }))
    render(
      <MemoryRouter initialEntries={['/notifications']}>
        <App />
      </MemoryRouter>,
    )
    await screen.findByText('INBOX RENDERED')
    await vi.waitFor(() => expect(reconcileSubscription).toHaveBeenCalled())
  })

  it('does NOT re-bind for a signed-out visitor', async () => {
    // POST /notifications/subscribe is authenticated; calling it without a token is a guaranteed
    // 401, and the interceptor would bounce someone who is already on /login.
    render(
      <MemoryRouter initialEntries={['/login']}>
        <App />
      </MemoryRouter>,
    )
    await Promise.resolve()
    expect(reconcileSubscription).not.toHaveBeenCalled()
  })
})
