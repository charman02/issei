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
        {/* A FIXED two-line slot for the title. Two cards side by side used to fall out of
            alignment as soon as one dish name wrapped: the photos stayed level (they're at the
            top of each cell) but the byline under a two-line title sat a line lower than its
            neighbour's, so the text blocks read as misaligned.
            `min-h` reserves both lines whether or not the name needs them, and `line-clamp-2`
            stops a very long name taking a third and reintroducing the problem. The photo boxes
            never move — only the title fills more of a space that was already there. */}
        <p className="font-display font-black text-[19px] leading-[1.04] text-ink line-clamp-2 min-h-[calc(2*1.04*19px)]">
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
