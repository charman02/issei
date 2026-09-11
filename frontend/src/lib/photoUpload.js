// The pick → HEIC-convert → validate → upload pipeline, shared by every surface that
// takes a photo.
//
// Extracted from RecipeForm when the guided flow needed a photo box too. It is NOT
// copy-pasteable: it carries a per-slot request-sequence ticket and an AbortController
// so that re-picking a photo can't be silently overwritten by the earlier upload
// landing last (on a flaky phone link that's common, and the visible symptom is
// "replacing A with B kept A"). Duplicating that by hand in a second component is how
// the two drift apart and only one of them stays correct.
//
// Keyed by SLOT because "supersedes" is a per-slot relation: with a cover plus N step
// photos, one global counter would make any later pick cancel an earlier one, so
// picking a photo for step 3 would silently kill step 1's upload.

import client, { toUserMessage } from '../api/client'

// Keep in sync with the backend's accepted formats in app/routers/upload.py.
export const ACCEPTED_IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp']
const ACCEPTED_EXTENSIONS = ['.jpg', '.jpeg', '.png', '.webp']
export const MAX_UPLOAD_BYTES = 10 * 1024 * 1024 // 10 MB

// What a file input should accept — HEIC included, since it's converted client-side.
export const PHOTO_ACCEPT =
  'image/jpeg,image/png,image/webp,image/heic,image/heif,.heic,.heif'

function hasAcceptedExtension(filename) {
  const lower = (filename || '').toLowerCase()
  return ACCEPTED_EXTENSIONS.some((ext) => lower.endsWith(ext))
}

// iPhones shoot HEIC/HEIF by default, which the backend rejects. Detect by extension
// or MIME, because browsers often report an empty type for HEIC.
export function isHeic(file) {
  const t = (file.type || '').toLowerCase()
  const n = (file.name || '').toLowerCase()
  return (
    t === 'image/heic' ||
    t === 'image/heif' ||
    n.endsWith('.heic') ||
    n.endsWith('.heif')
  )
}

// Creates the ticket/abort bookkeeping for one component. Held in a ref by the caller
// so it survives re-renders.
export function createUploader() {
  const seqs = new Map()
  const aborts = new Map()

  // Retire a slot's ticket without starting a new upload: an in-flight response for it
  // must no longer be allowed to write (used when a photo is removed, or its whole row
  // is deleted mid-upload).
  function retire(slot) {
    seqs.set(slot, (seqs.get(slot) || 0) + 1)
    aborts.get(slot)?.abort()
  }

  // `frame` is the optional confirm-and-crop step (#103). It receives the CONVERTED, VALIDATED file
  // and returns a File to upload instead — or null to cancel the whole pick.
  //
  // It runs LAST, after HEIC conversion, because an iPhone's HEIC cannot be drawn into a canvas by
  // any browser: framing before the conversion would show a blank preview to the people who most
  // need one. It runs after validation too, so nobody frames a 40 MB file only to be told no.
  async function upload({
    slot,
    event,
    onBusy,
    onError,
    onUrl,
    endpoint = '/upload/recipe-photo',
    frame = null,
  }) {
    let file = event.target.files?.[0]
    if (!file) return
    const input = event.target

    const seq = (seqs.get(slot) || 0) + 1
    seqs.set(slot, seq)
    // Any pick supersedes the one before it FOR THIS SLOT, so drop that request.
    aborts.get(slot)?.abort()
    const controller =
      typeof AbortController === 'function' ? new AbortController() : null
    aborts.set(slot, controller)
    // Superseded picks must not touch state (that's the race) — and must not clear
    // busy or reset the input either, or the newer upload's spinner would vanish
    // while it is still running.
    const isCurrent = () => seqs.get(slot) === seq

    function reject(message) {
      if (!isCurrent()) return
      onError(message)
      onBusy(false)
      input.value = ''
    }

    onError('')
    onBusy(true)

    try {
      if (isHeic(file)) {
        try {
          const { default: heic2any } = await import('heic2any')
          const blob = await heic2any({ blob: file, toType: 'image/jpeg', quality: 0.9 })
          const out = Array.isArray(blob) ? blob[0] : blob
          file = new File([out], file.name.replace(/\.hei[cf]$/i, '.jpg'), {
            type: 'image/jpeg',
          })
        } catch {
          reject("Couldn't read that iPhone photo. Try again, or pick a JPEG.")
          return
        }
      }

      // Validate AFTER conversion, for instant feedback matching the backend. Check
      // both MIME and extension: some browsers report an empty or unexpected type.
      if (!ACCEPTED_IMAGE_TYPES.includes(file.type) && !hasAcceptedExtension(file.name)) {
        reject('Please choose a JPEG, PNG, or WebP image.')
        return
      }
      if (file.size > MAX_UPLOAD_BYTES) {
        reject('That image is too large (max 10 MB).')
        return
      }

      // THE FRAMING STEP (#103). Reported twice by one tester: "hard to adjust the photo to center
      // the subject" and "can't edit profile photo to make sure it looks as u want".
      //
      // Busy goes OFF while a human is looking at their photo — a spinner during an interaction
      // someone is deliberately taking reads as a hang, and the file input has to stay usable if
      // they cancel. It goes back on for the actual upload.
      if (frame) {
        onBusy(false)
        let framed
        try {
          framed = await frame(file)
        } catch {
          // A framer that throws must not eat the pick. Fall through with the original file: an
          // un-cropped upload is a worse photo, not a lost one.
          framed = file
        }
        if (!isCurrent()) return
        if (framed === null) {
          // Cancelled. Not an error — say nothing, reset the input so the same file can be picked
          // again, and leave any existing photo exactly as it was.
          input.value = ''
          return
        }
        file = framed || file
        onBusy(true)
      }

      const formData = new FormData()
      formData.append('file', file)
      const { data } = await client.post(endpoint, formData, {
        headers: { 'Content-Type': 'multipart/form-data' },
        signal: controller?.signal,
      })
      if (!isCurrent()) return // a newer pick owns this slot now
      onUrl(data.url)
    } catch (err) {
      // Includes the abort of a superseded request, which isn't a user-facing failure —
      // isCurrent() filters it out along with any other stale error.
      if (!isCurrent()) return
      onError(toUserMessage(err, 'Photo upload failed. Please try again.'))
    } finally {
      if (isCurrent()) {
        onBusy(false)
        input.value = '' // reset so re-selecting the same file fires onChange again
      }
    }
  }

  return { upload, retire }
}
