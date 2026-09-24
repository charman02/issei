import { useState } from 'react'
import { handoffRecipe, requestPassOn } from '../api/sharing'
import { toUserMessage } from '../api/client'
import { shareOrCopy } from '../lib/shareLink'
import { defaultInviteMessage } from '../lib/inviteMessage'

// PASS IT ON (#78) — the other half of keeping, on a recipe you did NOT write.
//
// THE RULE THIS COMPONENT RENDERS: a resharer may never grant more than they could cause by other
// means. The server decides and hands down one word (`pass_on_state`); this file only draws it. Four
// values, and the reason it is one field rather than two booleans is that a client with two booleans
// can render an impossible pair:
//
//   · `allowed` — the recipe is `public` (already in Browse, so a link widens nothing), or the cook
//                 has said yes. Share sheet, straight away.
//   · `ask`     — narrower than public and nobody has asked. One tap sends the cook the question.
//   · `pending` — asked, waiting. Nothing to do but wait, and the copy says so plainly.
//   · null      — you own it (the send screen is a different verb) or the question doesn't apply.
//
// WHAT `ask` DOES NOT MEAN. A DECLINED request also arrives here as `ask`, deliberately, and this is
// the one place in the app where the UI knowingly under-reports state. The asker is never told no:
// the cook said no about a recipe carrying their own family's name, usually to a relative, and
// "Lola declined" on that person's screen turns a quiet boundary into a social event. So the button
// returns to its resting state, a second ask is silently a no-op server-side, and "no" cannot be
// worn down by repetition without ever being announced. Same discipline as a silent block (#85) and
// a report the reported person never hears about (#87).
//
// THE SHARE PATH IS `shareOrCopy`, not `navigator.share` directly — the one place text reaches the
// operating system. It holds three cases that each shipped wrong once: a dismissed share sheet is
// NOT a failure (`AbortError`, and confirming there flashed "Copied ✓" at someone who had just
// decided not to send), a real rejection DOES fall through to the clipboard (Safari's
// `NotAllowedError` outside a gesture), and with no share sheet at all the WHOLE message is copied
// rather than a bare URL.
export default function PassItOn({ recipeId, state, cookName, recipeName }) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [asked, setAsked] = useState(false)
  const [shared, setShared] = useState('')

  if (!state) return null

  // `asked` is local so the confirmation lands the moment the tap resolves, without re-fetching the
  // whole recipe just to watch one word change from "ask" to "pending".
  const waiting = state === 'pending' || asked

  async function passItOn() {
    setError('')
    setShared('')
    setBusy(true)
    try {
      const { data } = await handoffRecipe(recipeId, {})
      // LINK-ONLY, and the server enforces it (a non-owner may not pre-address a grant — #105's
      // `invite_permission` is checked against the sender, so addressing a third party would be a
      // channel straight past a setting someone turned on). So there is no recipient field here by
      // design, not by omission.
      const url = `${window.location.origin}/invite/${data.token}`
      // NOT `defaultInviteMessage`'s "my recipe" wording — it is not this sender's recipe, and the
      // whole point of #78 is that attribution stays pointed at the cook. `asked: true` because the
      // realistic occasion for passing a recipe along is that somebody asked you for it.
      const body = cookName
        ? `${cookName}’s ${recipeName || 'recipe'} — here it is 💛`
        : defaultInviteMessage({ recipeName, asked: true })
      // The MESSAGE AND THE LINK both leave, never a bare URL — the sentence is what makes the
      // link make sense to whoever receives it.
      const outcome = await shareOrCopy({ title: recipeName, text: `${body}\n\n${url}` })
      if (outcome === 'shared') setShared('Sent ✓')
      else if (outcome === 'copied') setShared('Link copied ✓')
      else if (outcome === 'failed')
        setError('Couldn’t open the share sheet or the clipboard. Copy the link from the address bar.')
      // 'cancelled' says NOTHING: they dismissed the sheet, and confirming there reads as "it went
      // anyway". That case is the whole reason `shareOrCopy` returns an outcome rather than setting
      // state itself.
    } catch (err) {
      setError(toUserMessage(err, 'Couldn’t make a link just now. Try again.'))
    } finally {
      setBusy(false)
    }
  }

  async function ask() {
    setError('')
    setBusy(true)
    try {
      await requestPassOn(recipeId)
      setAsked(true)
    } catch (err) {
      setError(toUserMessage(err, 'Couldn’t send that just now. Try again.'))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="mt-4">
      {state === 'allowed' ? (
        <>
          <button
            onClick={passItOn}
            disabled={busy}
            className="w-full inline-flex items-center justify-center gap-2 font-display font-bold text-[15px] rounded-full px-3.5 py-3 border-[2.5px] border-ink bg-cream text-ink shadow-[0_4px_0_#2E3A24] active:translate-y-[3px] active:shadow-[0_1px_0_#2E3A24] transition-transform disabled:opacity-50"
          >
            {/* NOT sticky. The label returns to "Pass it on" so the affordance for a SECOND
                person survives — passing one recipe to two people is the ordinary case, not the
                edge, and a permanent "Sent ✓" reads as terminal on a phone. */}
            {busy ? '…' : 'Pass it on'}
          </button>
          <p className="font-display italic text-[12.5px] text-ink-soft text-center mt-2">
            {/* Says whose it stays, because that is the thing a resharer might otherwise get wrong
                — and "no account needed" is the clause that makes the link worth sending. The
                confirmation lands HERE rather than on the button, so it can be read without
                destroying the control that produced it. */}
            {shared ||
              `Sends a link anyone can open, no account needed. It stays ${
                cookName ? `${cookName}’s` : 'their'
              } recipe.`}
          </p>
        </>
      ) : waiting ? (
        <div className="sticker bg-card p-3 text-left">
          <p className="font-display font-bold text-[14px] text-ink leading-snug">
            Asked {cookName || 'the cook'} ✓
          </p>
          <p className="font-display text-[13px] text-ink-soft leading-snug mt-1">
            {/* Honest about the shape of the wait: there is no deadline and no chase, and the app
                will not invent one. It also does not promise a yes. */}
            You’ll get a notification if they say yes. Until then this one is theirs to share.
          </p>
        </div>
      ) : (
        <>
          <button
            onClick={ask}
            disabled={busy}
            className="w-full inline-flex items-center justify-center gap-2 font-display font-bold text-[15px] rounded-full px-3.5 py-3 border-[2.5px] border-ink bg-cream text-ink shadow-[0_4px_0_#2E3A24] active:translate-y-[3px] active:shadow-[0_1px_0_#2E3A24] transition-transform disabled:opacity-50"
          >
            {busy ? '…' : `Ask ${cookName || 'the cook'} if you can pass it on`}
          </button>
          <p className="font-display italic text-[12.5px] text-ink-soft text-center mt-2">
            {/* WHY there is a question at all, in one line. Without it this reads as the app being
                officious; with it, it reads as the cook's recipe being the cook's to share. */}
            They chose who can see this one, so it’s theirs to open up.
          </p>
        </>
      )}
      {error && (
        <p className="mt-2 text-center">
          <span className="error-pill">{error}</span>
        </p>
      )}
    </div>
  )
}
