import { Link } from 'react-router-dom'
import Wordmark from '../components/Wordmark'
import IsseiMeaning from '../components/IsseiMeaning'
import MealGlimpse from '../components/MealGlimpse'
import RecipeGlimpse from '../components/RecipeGlimpse'

// THE COLD ARRIVAL, at `/join`. What a person sees when someone sent them issei rather than one
// specific recipe. Until #111 there was no such screen: the app had four public routes and the only
// door that explained the product needed an existing user to send a particular dish, so anyone told
// "check out issei.app" met a sign-in form that asked for a password before saying what for.
//
// WHY `/join` AND NOT THE SIGNED-OUT FACE OF `/`, which is where this started: a returning user who
// types `issei.app` wants the sign-in form, and making them read a pitch and tap past it every time
// is a tax on the people who already said yes (owner's call, and obviously right in hindsight).
// The share link carries this address, so the page is read by exactly the audience it was written
// for. The one thing that move costs — somebody told the domain OUT LOUD, who arrives at `/login`
// knowing nothing — is closed by a "New to issei? See what it is" line under that form.
//
// AND NOT THE POST-SIGNUP SLOT, the other candidate: `/welcome` already holds it, with two TEACHING
// panels that explain what issei is for using `RecipeGlimpse` and `IsseiMeaning` — the same two
// components this page uses. It would have been a duplicate of a screen that already exists.
// A referred person therefore sees this page once (deciding) and `/welcome` once (learning), which
// is the sequence the owner was right to want and not the same page twice.
//
// REBUILT TWICE ON OWNER REVIEW, and the second round is the one that matters, because it replaced
// an argument with a demonstration.
//
// ROUND 1 fixed three real things: the summary described only the FOUNDING moment (receiving), so it
// now names both sides; the bullets were generic, so they became the three features the product turns
// on; and the page used NONE of the palette on an app built out of colour blocks.
//
// ROUND 2 — "it's still a lot of text; should we split it into pages?" The answer was neither more
// pages nor more prose. THE PAGE WAS AN APP ABOUT FOOD AND RECIPES CONTAINING NEITHER. It asserted
// three features in words; two of those words-cards described exactly what `RecipeGlimpse` already
// SHOWS — the "3 soup spoons / their way" pill and the step-note callout. So the cards were prose
// rebuilding a visual the app already had.
//
// This project had already learned that lesson once, in user testing, and written it down in
// `RecipeGlimpse`'s own docstring: "the login screen already carried a dictionary gloss of 一世, and
// two rounds of user testing still asked 'what's the point of this app?' while looking straight at
// it. A definition describes a category of person — it never shows what the product DOES."
//
// So the middle of this page is now the MECHANIC, shown: a sample meal with an "Ask for the recipe"
// control, one short line of cause and effect, and the recipe that arrives. Post → ask → recipe. The
// three feature claims are gone because the samples make them: the measurements pill and the step
// note are visible in the second card, and the ask is visible in the first.
//
// WHY NOT SPLIT IT INTO PAGES, which was the owner's own suggestion and a reasonable one:
//   · Pagination does not reduce text, it hides the same words behind taps. The complaint was volume.
//   · The app-store onboarding carousel it imitates works on a CAPTIVE audience — you already
//     downloaded, you are committed, "next" is the only way forward. A web visitor has no sunk cost
//     and closes a tab for free, so every tap is a fresh decision to continue.
//   · `Welcome.jsx` documents "at most two TEACHING panels", because "a third TEACHING panel is a
//     carousel and testers punished tap-heavy onboarding" — measured on people who had ALREADY signed
//     up, i.e. a friendlier audience than this one.
//   · And that pattern already exists here, in the right place: `Welcome.jsx` IS issei's post-signup
//     carousel. If issei ever ships to an app store, that is the screen a download would land on.
//
// AT MOST ONE EM DASH IN THE RENDERED COPY, and that is a house rule rather than a preference: two or
// more is a tell that the words were generated rather than written, on the one surface whose whole job
// is to sound like a person recommending something. The page had THREE — the title, the cause-and-
// effect caption, and `IsseiMeaning`'s gloss. The two that went are mine: the title takes a comma
// ("cooking today, and ask for…") and the caption became three beats ("You ask. They answer. This is
// what arrives:"), which is punchier than the dash was anyway. The survivor is `IsseiMeaning`'s,
// deliberately — it is a SHARED component (this page, `InviteLanding`, `Welcome`), its wording is one
// source so the gloss cannot drift between the places someone first meets the word, and rewriting it
// to satisfy a rule about this page would edit two other screens — `InviteLanding` and `Welcome`.
// (An earlier version of this note said "Login", which does not import it at all. A docs gate
// caught that; the reasoning holds, the list was wrong.) A test pins the ceiling.
//
// ONE CLAIM THIS PAGE DELIBERATELY DOES NOT MAKE, though a review asked for it: "access any of their
// recipes". It is false — `can_view` gives a friend your `public` + `friends` recipes and never your
// `private` ones, and the recipe behind a post reaches someone by ASKING (`POST /posts/{id}/request`,
// which the cook answers, minting a grant). "Ask for the recipe behind any of it" is true AND the
// better sell, because the ask is the product. "In their words" stays banned too (POSITIONING §"Never
// claim audio"): the measurements are typed text, so the copy names whose they are without implying
// speech.
export default function Landing() {
  return (
    <div className="min-h-screen bg-cream">
      <div className="max-w-app mx-auto px-[18px] py-9">
        <div className="text-center">
          {/* SCALED, not re-sized with a `text-[…]` class: `Wordmark` already applies `text-[26px]`
              via its own size prop, and a second font-size class of equal specificity only wins on
              Tailwind's emission order — which happens to favour 30px over 26px today and would
              silently lose for anything smaller. `InviteLanding` uses a transform for the same
              reason. A ship gate caught the fragility. */}
          <Wordmark className="scale-[1.15] origin-center" />
        </div>

        {/* THE TITLE. Both sides of the product — what you see, and what you get — in one sentence a
            stranger can picture. BARE, not on a colour block: it is this page's heading, and a
            heading in a sticker competes with the two sample cards below, which are the things that
            should carry the colour. The rotation went with the box for the same reason a tilt reads
            as deliberate on a sticker and as a mistake on plain text. */}
        <h1 className="font-display font-black text-[29px] leading-[1.1] text-ink mt-8">
          See what your friends are cooking today, and ask for the recipe behind any of it.
        </h1>

        {/* THE DEMONSTRATION. Everything the three feature cards used to assert, shown instead —
            which is why there are now two short lines of copy here rather than four paragraphs. */}
        <MealGlimpse className="mt-7" />

        {/* The cause and effect, in one line — the whole mechanic. In DISPLAY weight, not body: it
            sits between two bold sticker cards and the first version's 14.5px sans was overshadowed
            by them, which made the one line that explains the sequence read as filler. */}
        <p className="font-display font-black text-[17px] leading-tight text-ink text-center mt-4 mb-4">
          You ask. They answer. This is what arrives:
        </p>

        {/* ...and the recipe itself, which SHOWS the two things that are genuinely different here:
            an amount left in the cook's own words, and the remark an ingredient list can't hold. No
            claim needed; it is on the screen. */}
        <RecipeGlimpse />

        {/* THE OTHER SIDE, in one line so this does not read as an app for receiving only. Display
            weight for the same reason as the caption above — it follows a strong card and has to
            survive the comparison. Both halves are real routes: the meal composer and the form. */}
        <p className="font-display font-bold text-[16px] leading-snug text-ink mt-7">
          Post your own, or finally write down the one people keep asking you for.
        </p>

        {/* "Open your kitchen" is signup's own submit label, so the button and the screen it leads to
            agree. `?tab=signup` lands on the form, because someone arriving from a referral has no
            account yet. */}
        <Link
          to="/login?tab=signup"
          className="btn-primary !mt-5 block text-center no-underline"
        >
          Open your kitchen
        </Link>

        {/* NO "opens with no account at all" line here, deliberately (owner's call). It is true and
            it is the capability-token model — but it is more text on a page whose whole problem was
            text, and it answers a question this visitor has not asked: they were REFERRED, not sent
            a recipe, so there is no link in their hand for the promise to be about. Someone who
            actually receives one discovers it by opening it, which is the intuitive path. It still
            appears where it earns its place: on the unfurl card (`services/invite_og.py`). */}
        {/* Sign-in stays one labelled tap away. NOT a loop with `Login`'s "New to issei?" link:
            that one exists for somebody who arrived at the form knowing nothing, this one for
            somebody sent the pitch who already has an account. Each points at the screen the
            OTHER audience wants, and neither is a default anyone gets bounced through. */}
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
