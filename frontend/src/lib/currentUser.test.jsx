import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, act, waitFor } from '@testing-library/react'

vi.mock('../api/client', () => ({ default: { get: vi.fn() } }))
import client from '../api/client'
import {
  readUser,
  patchUser,
  setUser,
  clearUser,
  useCurrentUser,
  reconcile,
} from './currentUser'

// The identity store exists because two live bugs came from having no single owner of "who am
// I": the Home photo-nudge stayed after a photo was added, and the You page showed a stale
// monogram while the user's OWN post card showed the right avatar. Post cards render server
// data; the You page rendered a cache nobody reconciled.

beforeEach(() => {
  localStorage.clear()
  vi.clearAllMocks()
})

function Probe() {
  const user = useCurrentUser()
  return <span>{user.photo_url || 'no photo'}</span>
}

describe('the identity store', () => {
  it('merges a patch over a FRESH read, not over a stale snapshot', () => {
    // The exact shape of the second bug: a component that mounted BEFORE an avatar upload
    // used to write `{...user, email}` from its own closure, silently reverting photo_url.
    setUser({ id: 1, email: 'a@t.com' })
    const stale = readUser() // what a closure would have captured
    patchUser({ photo_url: 'https://img.test/new.jpg' }) // e.g. an upload elsewhere
    patchUser({ email: 'b@t.com' }) // a later edit, using the store not `stale`

    expect(readUser()).toEqual({
      id: 1,
      email: 'b@t.com',
      photo_url: 'https://img.test/new.jpg',
    })
    expect(stale.photo_url).toBeUndefined() // the snapshot really was stale
  })

  it('re-renders every consumer when the user changes anywhere', async () => {
    setUser({ id: 1 })
    render(<Probe />)
    expect(screen.getByText('no photo')).toBeInTheDocument()

    // Simulates an upload finishing on a different screen.
    act(() => {
      patchUser({ photo_url: 'https://img.test/a.jpg' })
    })
    expect(await screen.findByText('https://img.test/a.jpg')).toBeInTheDocument()
  })

  it('survives a corrupted cache instead of throwing', () => {
    localStorage.setItem('issei_user', '{not json')
    expect(readUser()).toEqual({})
    // JSON.parse on a bad value used to white-screen whichever page read it first.
    expect(() => render(<Probe />)).not.toThrow()
  })

  it('reconcile() pulls the server value in, which is the actual fix', async () => {
    // The cache said no photo; the server knew there was one. Nothing used to close that gap,
    // so the nudge and the You page could stay wrong indefinitely.
    localStorage.setItem('issei_token', 't') // reconcile is for a signed-in caller
    setUser({ id: 1, first_name: 'Ana' })
    client.get.mockResolvedValue({ data: { id: 1, first_name: 'Ana', photo_url: 'https://img.test/server.jpg' } })

    render(<Probe />)
    expect(screen.getByText('no photo')).toBeInTheDocument()
    await act(async () => {
      await reconcile()
    })
    expect(client.get).toHaveBeenCalledWith('/auth/me')
    await waitFor(() =>
      expect(screen.getByText('https://img.test/server.jpg')).toBeInTheDocument(),
    )
  })

  it('reconcile() will not resurrect a user who logged out mid-flight', async () => {
    // Logout is an SPA navigation, so this JS context survives it. A reconcile fired at app
    // start (the client allows 45s, and a cold backend can use it) could otherwise resolve
    // AFTER logout and write that person's name, email and photo back into localStorage — on a
    // shared device, for the next person. So the token is re-checked after the round trip.
    localStorage.setItem('issei_token', 't')
    setUser({ id: 1, first_name: 'Ana' })
    let resolveGet
    client.get.mockReturnValue(new Promise((r) => { resolveGet = r }))
    const pending = reconcile()
    localStorage.removeItem('issei_token') // the user logs out while it's in flight
    resolveGet({ data: { id: 1, first_name: 'Ana', photo_url: 'https://img.test/late.jpg' } })
    await expect(pending).resolves.toBeNull()
    expect(readUser().photo_url).toBeUndefined()
  })

  it('reconcile() failing leaves the cached user alone', async () => {
    // Offline, or mid-401. Blanking someone's own name would be worse than a stale value.
    localStorage.setItem('issei_token', 't')
    setUser({ id: 1, first_name: 'Ana', photo_url: 'https://img.test/cached.jpg' })
    client.get.mockRejectedValue(new Error('offline'))
    await expect(reconcile()).resolves.toBeNull()
    expect(readUser().photo_url).toBe('https://img.test/cached.jpg')
  })

  it('clearUser empties it for logout', () => {
    setUser({ id: 1, first_name: 'Ana' })
    clearUser()
    expect(readUser()).toEqual({})
    expect(localStorage.getItem('issei_user')).toBeNull()
  })
})
