import { useRef, useState } from 'react'
import client, { toUserMessage } from '../api/client'
import { createUploader } from './photoUpload'
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
  const [uploading, setUploading] = useState(false)
  const [error, setError] = useState('')
  // Seeded from the cached user so an already-set photo shows without a fetch.
  const [photoUrl, setPhotoUrl] = useState(() => readUser().photo_url || null)

  async function onPick(e) {
    await uploader.current.upload({
      slot: 'avatar',
      event: e,
      endpoint: '/upload/avatar',
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

  return { onPick, uploading, error, photoUrl }
}
