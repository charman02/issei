// The client-side preferences bag — the same `issei_prefs` object Profile's
// display toggles live in.
//
// Deliberately NOT a second onboarding-only localStorage key: one bag means
// "clear site data" resets every client-side preference together, and there is no
// chance of two keys disagreeing about what a fresh user is. Profile still has
// its own inline reader (it predates this module and isn't ours to refactor); the
// contract between them is the key name and the fact that writes merge.
export const PREFS_KEY = 'issei_prefs'

export function loadPrefs() {
  try {
    return JSON.parse(localStorage.getItem(PREFS_KEY) || '{}')
  } catch {
    // A hand-edited or half-written value shouldn't brick the app; an unreadable
    // bag is treated as an empty one.
    return {}
  }
}

// Read-modify-write against STORAGE, not against a caller's cached copy: Profile
// holds prefs in React state, so writing a stale snapshot back would silently
// revert whichever toggle it was holding.
export function setPref(key, value) {
  const next = { ...loadPrefs(), [key]: value }
  localStorage.setItem(PREFS_KEY, JSON.stringify(next))
  return next
}

// Should motion be suppressed? THE OS SETTING IS THE ONLY SOURCE NOW.
//
// There used to be an in-app "Turn off animations" toggle ORed in here, and it was removed with
// the whole Settings section (2026-09-11): it duplicated a control the operating system already
// owns. Someone who wants stillness sets `prefers-reduced-motion` once and every app on the device
// obeys, which is strictly better than asking them to set it again in one app — and a preference
// stored per-browser doesn't follow them to their other devices, while the OS one does.
//
// Still honoured, and still the right thing to check before any decorative motion (today just
// `SaveCelebration`). A stale `reduceMotion` key may linger in an existing `issei_prefs` bag; it is
// simply ignored, which is correct — the OS answer supersedes it.
export function prefersReducedMotion() {
  try {
    return window.matchMedia('(prefers-reduced-motion: reduce)').matches
  } catch {
    // jsdom and older browsers have no matchMedia. Motion is the safe default here: the animation
    // it gates is a celebration over an already-saved recipe, never load-bearing.
    return false
  }
}
