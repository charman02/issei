import { useState } from 'react'
import { shareOrCopy } from '../lib/shareLink'
import { referralShareText } from '../lib/referralMessage'

// "Tell a friend about issei" — the app's only way to share ITSELF rather than one recipe.
//
// WHY IT WAS MISSING AND WHY THAT MATTERS: the invite link is a superb referral mechanism for a
// specific dish — it unfurls as the recipe and needs no account — but it requires the sender to have
// a recipe written and a person in mind for it. There was nothing for "you'd like this app", which
// is what a user actually says out loud, and which real feedback asked for.
//
// IT LIVES ON THE FRIENDS PAGE, under the app-wide directory. That placement is the argument: the
// directory answers "who is already here", and the honest next question when the answer is "not the
// person I cook with" is "so how do I get them here?" Putting it on the You page instead would file
// growing your circle under account settings.
//
// THE CONFIRMATION IS ONLY EVER SHOWN FOR AN OUTCOME THAT HAPPENED. `shareOrCopy` returns
// 'cancelled' for a dismissed share sheet and this component says nothing then — #102 learned that
// flashing "Copied ✓" at someone who just decided not to send reads as though it went anyway. And
// the confirmation names what the clipboard actually holds (the message AND the link, not a bare
// URL), because the sentence is the part that explains the app.
export default function TellAFriend() {
  const [state, setState] = useState(null)

  async function tell() {
    const outcome = await shareOrCopy({
      title: 'issei',
      text: referralShareText(),
    })
    if (outcome === 'cancelled') return
    setState(outcome)
    if (outcome !== 'failed') setTimeout(() => setState(null), 2600)
  }

  return (
    <div className="sticker bg-peach px-4 py-4 mt-8">
      <p className="font-display font-black text-[16px] leading-snug text-ink">
        Know someone who isn&rsquo;t here yet?
      </p>
      {/* Says what the person on the other end will SEE, so the sender knows what they are sending.
          A share button that hides its own payload makes people open it once to check and never
          again. */}
      <p className="font-sans text-[13.5px] leading-relaxed text-ink-soft mt-1">
        Send them issei — the link opens with what it is, so they can decide before signing up.
      </p>
      <button type="button" onClick={tell} className="btn-primary !mt-3.5 w-full">
        {state === 'shared'
          ? 'Sent ✓'
          : state === 'copied'
            ? 'Message copied ✓'
            : 'Tell a friend about issei'}
      </button>
      {state === 'failed' && (
        <p className="error-pill !mt-2.5">
          Could not copy. The link is issei.app — send it however you like.
        </p>
      )}
    </div>
  )
}
