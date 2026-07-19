import { useState } from 'react'
import { isImprecise, impreciseLabel } from '../lib/measures'
import Wordmark from './Wordmark'

// The recipe "body" — the part that is always readable, whether the plant is a
// seed or in full fruit (R2 living-plant spec; editorial layout from v6's
// recipePanel()). Growth is the *soul* accruing; the body is here from day one.
//
// Renders: cover photo (or a cream <Wordmark> fallback when there's no photo),
// the story in Caveat if present, an Ingredients section (amounts in bold
// Cormorant serif; imprecise/unmeasured amounts get a small plum "their way"
// pill — imprecise measures are TRUTH, celebrated, never normalized), and a Steps
// section with clean green Cormorant serif numerals (CSS counter, option F:
// no circle, no period — see .r2-steps in index.css).

// A small botanical leaf marker for the section headers.
function LeafMark() {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      aria-hidden="true"
      className="w-4 h-4 flex-shrink-0"
    >
      <path d="M20 4C10 5 5 10 4 20c10-1 15-6 16-16Z" fill="#5C7A3F" />
      <path
        d="M6 18C9 13 13 9 18 6"
        stroke="#3B5228"
        strokeWidth="1.4"
        strokeLinecap="round"
      />
    </svg>
  )
}

// Cormorant section header with a leaf marker and a growth-green rule fading out.
function SecHead({ children }) {
  return (
    <div className="flex items-center gap-2.5 mt-5 mb-2.5">
      <LeafMark />
      <h4 className="font-serif font-semibold text-[20px] text-ink m-0 tracking-[0.2px] whitespace-nowrap">
        {children}
      </h4>
      <span className="flex-1 h-0.5 rounded-[2px] bg-gradient-to-r from-growth to-growth/[0.18]" />
    </div>
  )
}

export default function RecipeBody({ recipe }) {
  // Cooking mode: default OFF (rich — story + their words woven in, the product
  // thesis). Toggling ON strips to clean ingredients + numbered steps for a
  // distraction-free cook. Rich-by-default honors the soul; one tap = focus.
  const [cooking, setCooking] = useState(false)

  // Direct-FK ingredients + sectioned ingredients, merged and ordered by position.
  const allIngredients = [
    ...(recipe.ingredients || []),
    ...(recipe.ingredient_sections || []).flatMap((s) =>
      s.ingredients.map((ing) => ({ ...ing, sectionName: s.name })),
    ),
  ].sort((a, b) => a.position - b.position)

  const sortedSteps = [...(recipe.steps || [])].sort(
    (a, b) => a.position - b.position,
  )

  // Byline: the recorded origin person, else the recipe's own author/keeper.
  const originName = (recipe.origin_attribution || '').split('·')[0].trim()
  const byline = originName
    ? `from ${originName}`
    : recipe.author_full_name
      ? `kept by ${recipe.author_full_name}`
      : null

  return (
    <div className="mt-1.5">
      {/* Cooking-mode toggle — a quiet segmented control. Rich by default. */}
      <div className="flex justify-center mb-3">
        <div className="inline-flex rounded-full border border-line bg-paper/70 p-0.5 text-[12px] font-sans font-bold">
          <button
            onClick={() => setCooking(false)}
            aria-pressed={!cooking}
            className={
              'px-3.5 py-1.5 rounded-full transition ' +
              (!cooking ? 'bg-card text-ink shadow-sm' : 'text-ink-soft')
            }
          >
            The whole story
          </button>
          <button
            onClick={() => setCooking(true)}
            aria-pressed={cooking}
            className={
              'px-3.5 py-1.5 rounded-full transition ' +
              (cooking ? 'bg-growth text-white shadow-sm' : 'text-ink-soft')
            }
          >
            Cooking mode
          </button>
        </div>
      </div>

      {/* Cover photo (or the cream Wordmark fallback). Hidden in cooking mode. */}
      {!cooking && (
      <div className="relative w-full h-[168px] rounded-2xl overflow-hidden border border-line mb-1.5 mt-0.5 bg-paper shadow-[0_8px_18px_-12px_rgba(46,58,36,.5)]">
        {recipe.cover_photo_url ? (
          <img
            src={recipe.cover_photo_url}
            alt=""
            className="w-full h-full object-cover block"
          />
        ) : (
          <div className="absolute inset-0 flex items-center justify-center">
            <Wordmark muted className="text-6xl" />
          </div>
        )}
      </div>
      )}

      {/* Byline + cuisine — whose recipe this is, and what kind. Icons match
          the page header (plum heart for the person, bowl glyph for cuisine).
          Hidden in cooking mode. */}
      {!cooking && (byline || recipe.cuisine) && (
        <div className="flex items-center justify-center gap-[9px] flex-wrap mt-3 mb-1">
          {byline && (
            <span className="inline-flex items-center gap-[5px] font-sans text-[12.5px] font-bold tracking-[0.2px] text-plum">
              <svg viewBox="0 0 24 24" fill="none" aria-hidden="true" className="w-[13px] h-[13px]">
                <path
                  d="M12 20s-7-4.6-7-9.4A3.6 3.6 0 0 1 12 8a3.6 3.6 0 0 1 7 2.6C19 15.4 12 20 12 20Z"
                  fill="#8A3D5A"
                />
              </svg>
              {byline}
            </span>
          )}
          {byline && recipe.cuisine && (
            <span className="w-px h-[13px] bg-line inline-block" />
          )}
          {recipe.cuisine && (
            <span className="inline-flex items-center gap-1 text-[11.5px] font-semibold tracking-[0.55px] uppercase text-ink-soft">
              <svg viewBox="0 0 24 24" fill="none" aria-hidden="true" className="w-3 h-3 opacity-85">
                <path d="M4 12h16M4 12a8 8 0 0 0 16 0M3.5 12h17M6 20h12" stroke="#4A5540" strokeWidth="1.6" strokeLinecap="round" />
                <path d="M10 4c0 1.4-1 2-1 3.2M14 4c0 1.4-1 2-1 3.2" stroke="#4A5540" strokeWidth="1.5" strokeLinecap="round" />
              </svg>
              {recipe.cuisine}
            </span>
          )}
        </div>
      )}

      {/* Their words — the story, in Caveat. Hidden in cooking mode. */}
      {!cooking && recipe.story && (
        <p className="font-hand text-[23px] leading-[1.2] text-plum text-center mx-1 mt-3 mb-3 whitespace-pre-line">
          {recipe.story}
        </p>
      )}

      <SecHead>Ingredients</SecHead>
      <ul className="list-none m-0 p-0">
        {allIngredients.map((ing, idx) => (
          <li
            key={ing.id ?? idx}
            className="flex items-baseline justify-between gap-2 py-2 text-[14.5px] text-ink border-b border-dashed border-line last:border-b-0"
          >
            <span className="text-ink">{ing.name}</span>
            <span className="flex items-baseline flex-wrap justify-end gap-1.5 text-right flex-shrink-0 font-serif font-bold text-base text-ink">
              {ing.quantity_text}
              {isImprecise(ing) && (
                <span className="font-sans font-bold text-[10.5px] tracking-[0.4px] lowercase text-plum bg-plum/10 border border-plum/[0.28] rounded-full px-2 py-0.5 leading-tight whitespace-nowrap">
                  {impreciseLabel(ing)}
                </span>
              )}
            </span>
          </li>
        ))}
      </ul>

      <SecHead>Steps</SecHead>
      <ol className="r2-steps">
        {sortedSteps.map((step, idx) => (
          <li
            key={step.id ?? idx}
            className="relative text-[14.5px] text-ink leading-[1.5] py-2.5 pl-9 border-b border-dashed border-line last:border-b-0"
          >
            {step.content}
            {/* The person's words for THIS step — a secondary aside, deliberately
                distinct from the headline story: a quiet plum-bordered italic
                serif note. Hidden in cooking mode. */}
            {!cooking && step.voice_note && step.voice_note.trim() && (
              <span className="block border-l-2 border-plum/40 pl-2.5 mt-2 font-serif italic text-[13.5px] leading-[1.35] text-ink-soft">
                &ldquo;{step.voice_note.trim()}&rdquo;
              </span>
            )}
          </li>
        ))}
      </ol>
    </div>
  )
}
