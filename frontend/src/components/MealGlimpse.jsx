import Wordmark from './Wordmark'

// A miniature, non-interactive sample of a MEAL POST — the other half of the pitch, and the half
// `RecipeGlimpse` could not carry alone.
//
// Why it exists: `RecipeGlimpse` shows what ARRIVES (an amount left in the cook's words, a note on
// the step it belongs to). It cannot show the ASK, which is the act that makes arriving happen — the
// app's fourth first-class verb and the one thing no other recipe app has. Together they render the
// whole mechanic as a picture: somebody posts a dish, you ask, the recipe comes. Described in prose
// that took three paragraphs; shown, it takes two cards.
//
// THE DISH AND THE COOK MUST MATCH `RecipeGlimpse` — Auntie Ling's braised pork belly, in both. The
// first version showed Ana's Sinigang here and Auntie Ling's pork belly below, which does not read
// as one sequence at all: the page says "you ask, they answer, this is what arrives" and then shows
// a different dish from a different person arriving. That is a broken demonstration, not an
// inconsistency. `RecipeGlimpse` is the one to match against because it is shared with `Welcome`.
//
// DELIBERATELY NOT `PostCard`, following the precedent `RecipeGlimpse` sets in its own comment: "this
// is a fixed illustration, not a second recipe renderer, and coupling it to the real reading surface
// would let a layout change there silently reshape the pitch." The live card also wants a post object,
// a router and an authenticated viewer, none of which a public landing page has.
//
// THE PHOTO IS A COLOUR FIELD WITH THE MARK ON IT, and that is not a placeholder standing in for a
// real image we failed to ship — it is exactly what `CoverImage` renders for a recipe with no photo,
// so the sample uses the app's own idiom rather than inventing a fake photograph. An invented stock
// photo of somebody else's dinner would be the one dishonest pixel on the page.
//
// The "Ask for the recipe" control is `aria-hidden` and not a button: it is the thing being shown,
// not offered. A real control here would be a dead end for someone with no account yet, and a screen
// reader announcing a button that does nothing is worse than silence.
export default function MealGlimpse({ className = '' }) {
  return (
    <figure className={`sticker bg-card p-0 m-0 overflow-hidden ${className}`}>
      {/* The "photo" — the same mark-on-colour treatment a photo-less cover gets in the real app. */}
      <div className="relative h-[124px] bg-peach border-b-[2.5px] border-ink flex items-center justify-center">
        <Wordmark size="sm" bare className="opacity-30" />
      </div>

      <div className="px-4 py-3">
        {/* THE ONE DELIBERATE DEVIATION FROM THE REAL POST SURFACE, and a docs gate is right that it
            is one: `PostCard` renders its author as an avatar plus a plain ink name, and plum is
            reserved app-wide for a RECIPE's byline (`origin_attribution`) rather than a post's
            author. It is kept anyway, because what round 3 fixed was that the two sample cards must
            read as ONE sequence — the same dish, the same cook — and matching the byline idiom is
            part of what makes them read that way rather than as two unrelated pictures. Tightening
            this toward `PostCard` would weaken the thing the round-3 fix bought. Everything else
            here is verbatim real: "Ask for the recipe" is `PostCard`'s own label, and the control
            appears exactly where it does on a post whose recipe you cannot read. */}
        <p className="text-[12.5px] leading-none">
          <span className="font-sans text-ink-soft/80">from </span>
          <span className="font-display font-bold italic text-plum">Auntie Ling</span>
        </p>
        <p className="font-display font-black text-[18px] leading-tight text-ink mt-1">
          Braised pork belly
        </p>

        {/* THE ASK. `bg-saffron text-ink` and the exact label, matching `PostCard.jsx`'s live control
            rather than approximating it — the first version used `bg-terra text-cream`, which would
            have taught a stranger to look for a terra pill and hand them a saffron one after signup.
            A ship gate caught it. Not interactive; see the note above. */}
        <span
          aria-hidden="true"
          className="inline-block mt-2.5 font-display font-bold text-[13px] text-ink bg-saffron border-2 border-ink rounded-full px-3.5 py-1.5 leading-tight shadow-[0_2px_0_#2E3A24]"
        >
          Ask for the recipe
        </span>
      </div>

      {/* AN ACCESSIBLE NAME, because without one a screen reader announces this card's contents as
          though they were real content in the app rather than an illustration — and the decorative
          `Wordmark` in the photo field reads out a stray "issei." mid-card. `sr-only` so it costs
          nothing visually. A ship gate found this, and it matters here more than on `/welcome`
          because this is the first PUBLIC surface either sample has appeared on. */}
      <figcaption className="sr-only">
        An example of a meal someone shared on issei.
      </figcaption>
    </figure>
  )
}
