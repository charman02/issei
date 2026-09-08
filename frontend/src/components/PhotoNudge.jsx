import { loadPrefs, setPref } from '../lib/prefs'
import { PHOTO_ACCEPT } from '../lib/photoUpload'
import { useAvatarUpload } from '../lib/useAvatarUpload'
import { useCurrentUser } from '../lib/currentUser'
import Avatar from './Avatar'
import Icon from './Icon'

// A one-time, dismissible "add a photo" strip on Home (#84).
//
// WHY IT EXISTS AT ALL, given #77 already prompts: #77's prompt is panel 3 of `Welcome`,
// which fires once per account and only for accounts created AFTER it shipped. Every earlier
// account — the owner's and every first-wave beta tester's — never saw it and never will.
// From the inside that looks like the photo setting is "hiding in settings", which is exactly
// how it was reported.
//
// It is NOT in the signup form, deliberately: the loudest finding from the first round of
// user testing (#1) was that the add-a-recipe flow felt effortful, and signup is the worst
// place in an app to add a step. This asks later, once, where you already are.
//
// Shares Profile's `photoNudgeDismissed` pref key ON PURPOSE. Two nudges for one thing that
// each need dismissing separately is nagging; one dismissal means "stop asking me", wherever
// it was tapped. The pref bag is per-browser rather than per-account (unlike `welcomeSeenBy`),
// which is the right trade here: the cost of a shared phone showing this once to the second
// person is a single dismissible line, whereas a per-account key would need a server field.
//
// Uploading happens INLINE via the same hook the Welcome panel and Profile use — upload,
// PATCH /auth/me, refresh the cached issei_user — so this is one tap, not a trip to Settings.
export default function PhotoNudge({ onDone }) {
  // From the shared store, so adding a photo ANYWHERE (the You page, the Welcome panel, or
  // the inline upload below) removes this strip. Reading localStorage at mount is what left
  // it on screen after the photo was already set.
  const user = useCurrentUser()

  const { onPick, uploading, error, photoUrl } = useAvatarUpload({ onDone })
  const dismissed = !!loadPrefs().photoNudgeDismissed
  // photoUrl reflects a just-finished upload, so the strip removes itself the moment it
  // succeeds rather than waiting for a parent refetch.
  const hasPhoto = Boolean(photoUrl || user.photo_url)

  if (!user.id || hasPhoto || dismissed) return null

  function dismiss() {
    setPref('photoNudgeDismissed', true)
    onDone?.()
  }

  return (
    <div className="px-4 pb-3">
      <div className="sticker bg-card flex items-center gap-3 p-3">
        <Avatar name={user.first_name || '?'} photoUrl={null} size="md" />
        <div className="min-w-0 flex-1">
          <p className="font-display font-bold text-[14px] text-ink leading-snug">
            Add a photo so friends know it&rsquo;s you.
          </p>
          {error ? (
            <p className="mt-1">
              <span className="error-pill">{error}</span>
            </p>
          ) : (
            <label className="mt-1 inline-flex items-center gap-1.5 font-display font-bold text-[13px] text-terra cursor-pointer">
              <input
                type="file"
                accept={PHOTO_ACCEPT}
                onChange={onPick}
                aria-label="Add a profile photo"
                className="sr-only"
              />
              <Icon name="camera" className="w-4 h-4" />
              {uploading ? 'Uploading…' : 'Choose a photo'}
            </label>
          )}
        </div>
        <button
          onClick={dismiss}
          aria-label="Not now"
          className="flex-none w-7 h-7 rounded-full border-2 border-ink bg-cream text-ink flex items-center justify-center"
        >
          <Icon name="close" className="w-3.5 h-3.5" />
        </button>
      </div>
    </div>
  )
}
