import { useEffect, useState } from 'react'
import client from '../api/client'

// WHO AM I — one owner for the signed-in user, because having several was a live bug.
//
// The cached `issei_user` in localStorage is what the app displays identity from: your name,
// your email, your avatar. It used to be read and written directly from a dozen places, and
// two of them drifted:
//
//   - The "add a profile photo" strip on Home stayed after a photo was added.
//   - The You page kept showing the monogram while the avatar on the user's OWN post card was
//     correct — because a post card renders `author_photo_url` straight from the API, and the
//     You page rendered the cache. That asymmetry is the whole diagnosis: the server knew, the
//     cache didn't, and nothing reconciled them.
//
// Two fixes, both here rather than per screen:
//
// 1. `reconcile()` fetches GET /auth/me once per app session and merges the result in, so the
//    cache can never sit indefinitely behind the server. Anything the cache is missing or has
//    stale gets corrected on the next load, whatever caused the drift.
//
// 2. Every write MERGES over a FRESH read (`patchUser`), never over a value captured in a
//    closure. That was the second hazard: `setItem('issei_user', {...user, email})` from a
//    component that mounted before an avatar upload would silently write the old photo_url
//    back. Callers can no longer make that mistake, because they don't pass the whole object.
//
// Reads that only want `id` (ownership checks) or `profile_visibility` (a create-form default)
// can keep using localStorage directly — an id never changes, and a stale visibility default
// picks a wrong radio button rather than showing false information about a person. This module
// is for the identity that a human LOOKS at.

const KEY = 'issei_user'
const listeners = new Set()

export function readUser() {
  try {
    return JSON.parse(localStorage.getItem(KEY) || '{}') || {}
  } catch {
    // A corrupted value must not white-screen the app. Treat it as signed-out-shaped and let
    // the 401 handler deal with the token.
    return {}
  }
}

function emit(next) {
  listeners.forEach((fn) => fn(next))
}

// Merge a partial update over the CURRENT stored value. The fresh read is the point.
export function patchUser(patch) {
  const next = { ...readUser(), ...patch }
  localStorage.setItem(KEY, JSON.stringify(next))
  emit(next)
  return next
}

// Wholesale replace — only for login, where there is no prior user to preserve.
export function setUser(user) {
  localStorage.setItem(KEY, JSON.stringify(user))
  emit(user)
  return user
}

export function clearUser() {
  localStorage.removeItem(KEY)
  emit({})
}

export function subscribe(fn) {
  listeners.add(fn)
  return () => listeners.delete(fn)
}

// The cached user, re-rendering the caller when it changes anywhere in the app.
export function useCurrentUser() {
  const [user, setLocal] = useState(readUser)
  useEffect(() => subscribe(setLocal), [])
  return user
}

// Bring the cache in line with the server. Called once on app start; deliberately silent on
// failure — being offline or mid-401 is not a reason to blank someone's own name, and the
// cached value is the right fallback.
export async function reconcile() {
  try {
    const { data } = await client.get('/auth/me')
    patchUser(data)
    return data
  } catch {
    return null
  }
}
