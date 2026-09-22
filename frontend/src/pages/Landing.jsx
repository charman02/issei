import { Link } from 'react-router-dom'
import Wordmark from '../components/Wordmark'
import IsseiMeaning from '../components/IsseiMeaning'

// THE COLD ARRIVAL. What a person sees when someone told them about issei and they had no specific
// recipe to open.
//
// WHY THIS EXISTS: until now the app had exactly four public routes — `/login`, `/invite/:token`,
// `/forgot-password`, `/reset-password` — so the ONLY door that explained the product was an invite
// link, which requires an existing user to send one specific recipe. Anyone told "check out
// issei.app" landed on a sign-in form whose copy is entirely form-level ("Add your first name —
// recipes are signed with it", "Open your kitchen"): a screen that asks for a password before
// saying what the password is for. That is completed task #5 ("make the app's purpose clear early")
// reappearing on the one surface a referred person hits FIRST.
//
// THE ORDER OF THE COPY IS LOAD-BEARING AND POSITIONING.md DICTATES IT. The hook is the FEED,
// because that is what a stranger can picture in one second and it is what real users asked to be
// able to say. But POSITIONING's "The feed and the handoff: one product" is explicit that the feed
// is the TOP OF THE FUNNEL and the handoff is the payload — "presence → the ask → the handoff". A
// landing page that stopped at the feed would sell a photo-sharing app and then hand someone a
// recipe app, so the hook resolves into the one-liner immediately and the proof points are all
// about what ARRIVES. Same discipline as `lib/referralMessage.js`, which carries the same two beats
// in the same order.
//
// AND IT DOES NOT OVERSELL. Every claim below is a thing the app does today: amounts preserved
// verbatim, a note on the step it belongs to, and reading a handed-off recipe with no account. No
// voice, no audio, no lineage, no "make it yours" — see POSITIONING's "What NOT to claim", and
// `Landing.test.jsx` fails on any of those words.
export default function Landing() {
  return (
    <div className="min-h-screen bg-cream">
      <div className="max-w-[430px] mx-auto px-[18px] py-10">
        <div className="text-center">
          <Wordmark className="text-[30px]" />
        </div>

        {/* THE HOOK. A stranger can picture this instantly, which the one-liner alone cannot do —
            "someone cooked you something you'd never had" needs them to remember a moment, while
            this asks a question about right now. */}
        <h1 className="font-display font-black text-[30px] leading-[1.12] text-ink mt-8 -rotate-[0.6deg]">
          Curious what your friends are cooking today?
        </h1>

        {/* ...AND THE RESOLUTION, immediately. POSITIONING's one-liner, near-verbatim, because the
            feed is the door and this is the room. */}
        <p className="font-sans text-[16px] leading-relaxed text-ink mt-5">
          Someone cooked you something you&rsquo;d never had before, and you asked for the recipe.{' '}
          <strong className="font-display font-black">
            issei is how they send it to you.
          </strong>
        </p>

        {/* WHAT ARRIVES — three facts, each one a thing the app actually does. These are the
            differentiator; without them this reads like every other recipe app. */}
        <ul className="mt-7 space-y-3.5">
          {[
            [
              'In their measurements, not grams',
              '“A good splash” stays “a good splash.” Nothing gets rounded into a number nobody cooks by.',
            ],
            [
              'The part an ingredient list leaves out',
              'Their note sits on the step it belongs to — the one warning that keeps you from ruining it the first time.',
            ],
            [
              'Read it without making an account',
              'A recipe someone sends you opens from the link. You decide later whether you want a kitchen of your own.',
            ],
          ].map(([heading, body]) => (
            <li
              key={heading}
              className="sticker bg-card px-4 py-3.5 text-left"
            >
              <p className="font-display font-black text-[15px] leading-snug text-ink">
                {heading}
              </p>
              <p className="font-sans text-[13.5px] leading-relaxed text-ink-soft mt-1">
                {body}
              </p>
            </li>
          ))}
        </ul>

        {/* THE ASK. "Open your kitchen" is the same verb signup uses, so the button and the screen
            it leads to agree — a landing page whose CTA renames the act teaches a word the next
            screen does not know. `?tab=signup` lands them on the form rather than sign-in, because
            a person arriving from a referral does not have an account yet. */}
        <Link
          to="/login?tab=signup"
          className="btn-primary !mt-8 block text-center no-underline"
        >
          Open your kitchen
        </Link>

        {/* Sign-in stays reachable in one tap and says so plainly. This page is now what an
            anonymous visitor to `/` gets, so a returning user who simply typed the address must not
            have to hunt — it is one extra tap for them, and the whole product explained for someone
            who has never heard of it. */}
        <p className="font-sans text-[14px] text-center text-ink-soft mt-4">
          Already have an account?{' '}
          <Link to="/login" className="text-terra font-semibold underline">
            Sign in
          </Link>
        </p>

        {/* The name, glossed — the same component the login panel and the invite landing use, so the
            word is explained identically wherever someone meets it first. */}
        <div className="mt-10 pt-6 border-t border-line">
          <IsseiMeaning />
        </div>
      </div>
    </div>
  )
}
