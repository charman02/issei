import { useRef, useState } from 'react'
import client, { toUserMessage } from '../api/client'
import { createUploader } from './photoUpload'
import { usePhotoFramer } from './usePhotoFramer'
import { patchUser, readUser } from './currentUser'

// The pick → upload → save-photo flow, shared by the You page (#33) and the Welcome
// prompt (#77) so the upload/PATCH/cache-refresh logic lives in one place. Reuses the
// race-safe uploader pointed at the avatar endpoint (square face-crop), then PATCHes
// /auth/me with the returned URL and refreshes the cached issei_user so the avatar
// updates everywhere it shows without a reload.
//
// Returns { onPick, uploading, error, photoUrl } — photoUrl reflects the just-saved
// value so a caller (the Welcome panel) can show the new photo immediately, and
// onDone(url) fires after a successful save for callers that want to advance a step.
export function useAvatarUpload({ onDone } = {}) {
  const uploader = useRef(createUploader())
  // The framing step (#103). "Can't edit profile photo to make sure it looks as u want" was one of
  // the two reports that made this a P0 — an avatar was face-gravity centre-cropped server-side with
  // no preview, so a photo where you weren't dead centre came back wrong and the only recourse was
  // uploading a different one.
  const { frame, framerProps, framing } = usePhotoFramer()
  const [uploading, setUploading] = useState(false)
  const [error, setError] = useState('')
  // Seeded from the cached user so an already-set photo shows without a fetch.
  const [photoUrl, setPhotoUrl] = useState(() => readUser().photo_url || null)

  async function onPick(e) {
    await uploader.current.upload({
      slot: 'avatar',
      event: e,
      endpoint: '/upload/avatar',
      // SQUARE, because that is what the endpoint stores (400x400). Sending an already-square image
      // makes the server's `crop: fill` a pure resize and its `gravity: face` a no-op — which is why
      // no backend change was needed for any of this.
      frame: frame('avatar'),
      onBusy: setUploading,
      onError: setError,
      onUrl: async (url) => {
        try {
          const { data } = await client.patch('/auth/me', { photo_url: url })
          // Merge into the cached user (read fresh from storage, not a stale closure,
          // so a concurrent name/email edit isn't clobbered).
          patchUser({ photo_url: data.photo_url })
          setPhotoUrl(data.photo_url)
          onDone?.(data.photo_url)
        } catch (err) {
          setError(toUserMessage(err, 'Could not save your photo. Try again.'))
        }
      },
    })
  }

  // `framerProps` goes on a <PhotoFramer>; `framing` lets a caller hide its own controls while the
  // framer is up. RENDERING IT IS NOT OPTIONAL: `onPick` always passes a `frame` callback, and
  // `photoUpload` awaits the promise it returns, which only `framerProps.onDone`/`onCancel` can
  // settle. A caller that renders no framer therefore leaves the pick hanging forever — busy flag
  // off, nothing on screen, the photo simply never appears — rather than falling back to the old
  // centre-crop. All three consumers (Profile, Welcome, PhotoNudge) render it; a test pins that.
  return { onPick, uploading, error, photoUrl, framerProps, framing }
}
