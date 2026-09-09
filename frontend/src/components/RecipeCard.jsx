import CoverImage from './CoverImage'
import { sourceNameOf } from '../lib/sourceName'

// The recipe card in the "Kamala's Recipes" sticker language: the food photo
// sits in a bold ink-outlined frame with a hard offset shadow (a sticker), an
// outlined cuisine tag pinned to the corner, then a chunky Fraunces title and a
// small italic byline beneath. No plant/growth iconography (classic kitchen).
//
// variant: "grid" (fills its cell — two-up rows) | "row" (fixed width, for the
// horizontal-scroll rows on Browse). onClick navigates to the recipe.
export default function RecipeCard({ recipe, onClick, variant = 'grid' }) {
  const widthClass = variant === 'row' ? 'w-[210px] flex-none' : 'w-full'
  // Byline: "from {source}" when we know who the dish came from, otherwise just
  // the name of whoever wrote it down. The old fallback, "kept by {author}", read
  // as jargon in user testing — "kept" is the app's vocabulary, not a reader's —
  // and a bare name under a dish title already reads as attribution. Mirrors the
  // same decision in RecipeBody's byline; keep the two in step.
  const source = sourceNameOf(recipe)
  const byline = source
    ? { verb: 'from', name: source }
    : recipe.author_full_name
      ? { verb: null, name: recipe.author_full_name }
      : null

  return (
    <button
      onClick={onClick}
      className={`${widthClass} group text-left bg-transparent`}
    >
      <div className="relative sticker sticker-press overflow-hidden bg-card">
        <CoverImage
          url={recipe.cover_photo_url}
          size="md"
          recipe={recipe}
          className="w-full h-[150px] object-cover block"
        />
        {/* The cuisine tag is CREAM, not saffron. It used to be saffron, which put
            it in a three-way collision: saffron is documented as the
            person's-knowledge accent (the story card, the per-step note), it's the
            swipe under "Your kitchen" — the very heading these cards sit beneath —
            and a metadata label is the weakest claim of the three. A label naming a
            cuisine isn't knowledge and isn't a section, so it drops out of the
            accent system entirely and just reads as an outlined tag on a photo. */}
        {recipe.cuisine && (
          <span className="absolute top-2 left-2 font-display font-bold uppercase tracking-[0.06em] text-[9.5px] text-ink bg-cream/95 border-2 border-ink px-2 py-0.5 rounded-full">
            {recipe.cuisine}
          </span>
        )}
      </div>
      <div className="px-0.5 pt-2.5">
        {/* The byline sits DIRECTLY under the title, however many lines the title takes.
            This was briefly a fixed two-line slot, so that two cards side by side kept their
            bylines on the same line as each other. It looked worse: a one-line dish name got a
            blank line under it and then the name, which reads as a layout mistake rather than
            as alignment. The photo boxes are in their own block above this one and stay level
            regardless, which was the actual complaint — so the text below is free to be as
            tall as its own title needs.
            `line-clamp-2` stays: a third line would start pushing cards to visibly different
            heights, and two lines is enough for any dish name worth putting on a card. */}
        <p className="font-display font-black text-[19px] leading-[1.04] text-ink line-clamp-2">
          {recipe.name}
        </p>
        {byline && (
          <p className="text-[13px] mt-0.5">
            {byline.verb && (
              <span className="font-sans text-ink-soft/80">{byline.verb} </span>
            )}
            <span className="font-display font-bold italic text-plum">
              {byline.name}
            </span>
          </p>
        )}
      </div>
    </button>
  )
}
