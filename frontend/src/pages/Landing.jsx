import { Link } from 'react-router-dom'
import Wordmark from '../components/Wordmark'
import IsseiMeaning from '../components/IsseiMeaning'

// THE COLD ARRIVAL. What a person sees when someone told them about issei and they had no specific
// recipe to open. Until #111 there was no such screen: the app had four public routes and the only
// door that explained the product needed an existing user to send one specific recipe, so anyone
// told "check out issei.app" met a sign-in form that asked for a password before saying what for.
//
// REBUILT after owner review of the first version, and all three notes were right:
//
// 1. THE SUMMARY WAS ONE USE CASE, NOT THE PRODUCT. It led with POSITIONING's one-liner — "someone
//    cooked you something you'd never had before, and you asked for the recipe" — which is the
//    FOUNDING moment and, on a landing page, describes only the side where you RECEIVE. POSITIONING
//    itself licenses the broader frame: §"Why nobody else serves this" says "The feed widened the
//    front door. You no longer have to be mid-handoff to have a reason to open the app… That's an
//    on-ramp, not a redefinition." So the summary now names both sides — seeing, and getting — and
//    still ends on the payload, because §"The feed and the handoff" keeps the handoff as the point.
//
// 2. THE BULLETS WERE GENERIC. Now the three things the owner named: ASKING for a recipe (the app's
//    fourth first-class verb, and the mechanic the whole product turns on), the NOTES ON STEPS, and
//    the MEASUREMENTS AS THE COOK GIVES THEM.
//
// 3. IT WAS A WALL OF BLACK-AND-WHITE TEXT. It used none of the palette — every block was
//    `bg-card` — on an app whose whole identity is saturated colour blocks. Now the hero is peach and
//    each feature card carries its own colour, chosen to MEAN something rather than to decorate:
//    saffron is the person's-knowledge accent everywhere else in the app (the story card, the
//    step-note callout), so the two knowledge features wear it; sage is the affirmative/done colour,
//    which is what a delivered recipe is. Prose is roughly 40% of the first version.
//
// A CLICK-THROUGH was considered and rejected on the app's own evidence: `Welcome.jsx` documents
// "at most two TEACHING panels", because "a third TEACHING panel is a carousel and testers punished
// tap-heavy onboarding" — and that was for people who had ALREADY signed up. A stranger deciding
// whether to sign up at all has less patience, not more, and every "next" tap is a chance to leave.
// Scrolling is free; tapping is a decision.
//
// ONE CLAIM THE OWNER'S NOTE ASKED FOR AND THIS PAGE DELIBERATELY DOES NOT MAKE: "access any of
// their recipes". It is false. `can_view` gives a friend your `public` + `friends` recipes and never
// your `private` ones, and the recipe behind a post reaches someone by ASKING — `POST
// /posts/{id}/request`, which the cook answers, minting a grant. "Ask for the recipe behind any of
// it" is both true and the better sell, because the ask is the product. And "in their words" is a
// BANNED phrase (POSITIONING §"Never claim audio" — seventeen test files assert it) since it implies
// a recording that does not exist; the measurements are typed text, so the copy says whose
// measurements they are without claiming speech.
const FEATURES = [
  {
    // The ask first, because it is the verb that turns looking into having — and the one thing no
    // other recipe app does at all.
    tint: 'bg-saffron',
    heading: 'Ask for any recipe',
    body: 'See something you want to make? Ask. The cook answers, and the whole recipe is yours.',
  },
  {
    tint: 'bg-peach',
    heading: 'Notes on the steps that matter',
    body: 'The warning that keeps you from ruining it the first time, sitting on the step it belongs to.',
  },
  {
    tint: 'bg-sage',
    heading: 'Their measurements, kept',
    body: '“A good splash” stays “a good splash.” Nothing gets rounded into a number nobody actually cooks by.',
  },
]

export default function Landing() {
  return (
    <div className="min-h-screen bg-cream">
      <div className="max-w-app mx-auto px-[18px] py-9">
        <div className="text-center">
          <Wordmark className="text-[30px]" />
        </div>

        {/* THE HERO IS A COLOUR BLOCK, which is the app's whole visual identity and the thing the
            first version was missing. It also does the summary's first job: both sides of the
            product — what you see, and what you get — in one sentence a stranger can picture. */}
        <div className="sticker bg-peach px-5 py-6 mt-7">
          <h1 className="font-display font-black text-[27px] leading-[1.14] text-ink -rotate-[0.5deg]">
            See what your friends are cooking today — and ask for the recipe behind any of it.
          </h1>
        </div>

        {/* ...and what ARRIVES, which is the payload POSITIONING keeps as the point. One sentence,
            not a paragraph. */}
        <p className="font-sans text-[15.5px] leading-relaxed text-ink mt-5">
          They write it down once and it comes straight to you —{' '}
          <strong className="font-display font-black">
            the dish the way they actually make it
          </strong>
          .
        </p>

        {/* The OTHER side of the product, named so this does not read as an app for receiving only.
            Both halves are real routes: the meal composer and the recipe form. */}
        <p className="font-sans text-[15.5px] leading-relaxed text-ink-soft mt-3">
          Post your own, or finally write down the one people keep asking you for.
        </p>

        <ul className="mt-7 space-y-3">
          {FEATURES.map(({ tint, heading, body }) => (
            <li key={heading} className={`sticker ${tint} px-4 py-3.5`}>
              <p className="font-display font-black text-[15.5px] leading-snug text-ink">
                {heading}
              </p>
              <p className="font-sans text-[13.5px] leading-relaxed text-ink mt-1">
                {body}
              </p>
            </li>
          ))}
        </ul>

        {/* "Open your kitchen" is signup's own submit label, so the button and the screen it leads to
            agree — a landing CTA that renamed the act would teach a word the next screen does not
            know. `?tab=signup` lands on the form, because someone arriving from a referral has no
            account yet. */}
        <Link
          to="/login?tab=signup"
          className="btn-primary !mt-7 block text-center no-underline"
        >
          Open your kitchen
        </Link>

        {/* The one promise that answers "why would I bother?" — and it is the capability-token model,
            not a marketing line: `GET /recipes/invite/{token}` returns the whole recipe with no
            account. Placed under the CTA where it lowers the cost of the tap. */}
        <p className="font-sans text-[13px] text-center text-ink-soft mt-2.5">
          A recipe someone sends you opens with no account at all.
        </p>

        {/* Sign-in stays one labelled tap away: this page is what an anonymous visitor to `/` gets,
            so a returning user who just typed the address must not have to hunt. */}
        <p className="font-sans text-[14px] text-center text-ink-soft mt-4">
          Already have an account?{' '}
          <Link to="/login" className="text-terra font-semibold underline">
            Sign in
          </Link>
        </p>

        {/* The name, glossed — the same component the login panel and the invite landing use, so the
            word is explained identically wherever someone meets it first. */}
        <div className="mt-9 pt-6 border-t border-line">
          <IsseiMeaning />
        </div>
      </div>
    </div>
  )
}
