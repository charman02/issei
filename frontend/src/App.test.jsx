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
