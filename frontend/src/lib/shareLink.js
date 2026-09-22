// The ONE place the app hands text and a link to the operating system.
//
// Extracted from `HandoffInvite` (#102) when a second caller appeared — the referral share — rather
// than copied, and the reason is the same one that made `services/media.py` a service: the inline
// version in the first caller did not reach the second, which is exactly how #98 shipped a photo
// field with no host validation. This path has THREE error cases that were each learned by getting
// them wrong, and a second hand-written copy would get them wrong again:
//
//   1. A DISMISSED SHEET IS NOT A FAILURE. Cancelling `navigator.share` rejects with `AbortError`.
//      Treating that as "share didn't work, fall back to the clipboard" flashed "Copied ✓" at
//      someone who had just decided NOT to send — which reads as though it went anyway.
//   2. A REAL REJECTION *DOES* FALL THROUGH. Safari rejects with `NotAllowedError` outside a user
//      gesture, and there the clipboard genuinely is the right answer.
//   3. NO SHARE SHEET AT ALL (every desktop Firefox, some desktop Safari) copies the WHOLE message,
//      not the bare URL — the sentence is the point, and copying only the link throws it away.
//
// Returns an OUTCOME STRING rather than setting any state, so each caller words its own
// confirmation. `HandoffInvite` needs to distinguish "copied the message" from "copied the link"
// because it has two buttons; the referral share has one. A single "Copied ✓" cannot serve both.
//
//   'shared'    the OS took it. Say nothing — the sheet was the feedback.
//   'cancelled' they dismissed the sheet. Say nothing, and DO NOT confirm.
//   'copied'    no sheet, or a real rejection; the full text is on the clipboard.
//   'failed'    the clipboard refused too. The caller must offer manual selection.
export async function shareOrCopy({ title, text }) {
  if (typeof navigator !== 'undefined' && navigator.share) {
    try {
      await navigator.share({ title, text })
      return 'shared'
    } catch (err) {
      if (err && err.name === 'AbortError') return 'cancelled'
      // Anything else is a genuine failure — fall through to the clipboard.
    }
  }
  try {
    await navigator.clipboard.writeText(text)
    return 'copied'
  } catch {
    return 'failed'
  }
}
