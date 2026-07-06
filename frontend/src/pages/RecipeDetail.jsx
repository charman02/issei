import { useState, useEffect } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import client from '../api/client'
import Icon from '../components/Icon'
import Wordmark from '../components/Wordmark'

// Section header used inside the recipe body: Fraunces 700 bold label with a
// trailing hairline rule. (Distinct from the uppercase-Inter SectionHeader used
// on Home/Browse.)
function RuleHeader({ children }) {
  return (
    <div className="flex items-center gap-2.5 mt-[19px] mb-2.5">
      <span className="font-serif font-bold text-base text-ink">{children}</span>
      <span className="h-px flex-1 bg-line" />
    </div>
  )
}

export default function RecipeDetail() {
  const { id } = useParams()
  const [recipe, setRecipe] = useState(null)
  const [error, setError] = useState('')
  const navigate = useNavigate()
  const currentUser = JSON.parse(localStorage.getItem('issei_user') || '{}')
  const isOwner = recipe && currentUser.id === recipe.user_id

  useEffect(() => {
    client
      .get(`/recipes/${id}`)
      .then((res) => setRecipe(res.data))
      .catch(() => setError('Recipe not found'))
  }, [id])

  if (error) {
    return (
      <div className="p-6 text-center">
        <p className="text-red-600 mb-4">{error}</p>
        <button onClick={() => navigate('/my-recipes')} className="text-terra text-sm">
          Back to your kitchen
        </button>
      </div>
    )
  }

  if (!recipe) {
    return <div className="p-6 text-center text-ink-soft">Loading…</div>
  }

  // Direct-FK ingredients + sectioned ingredients, merged and ordered by position.
  const allIngredients = [
    ...recipe.ingredients,
    ...recipe.ingredient_sections.flatMap((s) =>
      s.ingredients.map((ing) => ({ ...ing, sectionName: s.name }))
    ),
  ].sort((a, b) => a.position - b.position)

  const sortedSteps = [...recipe.steps].sort((a, b) => a.position - b.position)
  const monogram = (recipe.author_full_name || '?').trim().charAt(0).toUpperCase()

  // Round-circle button overlaid on the hero (cream ground, brown glyph).
  const HeroButton = ({ icon, onClick, label, className }) => (
    <button
      onClick={onClick}
      aria-label={label}
      className={`absolute top-3 w-8 h-8 rounded-full bg-[rgba(247,238,221,0.94)] text-[#5C3A1E] flex items-center justify-center shadow-[0_1px_5px_rgba(0,0,0,0.2)] ${className}`}
    >
      <Icon name={icon} className="w-4 h-4" />
    </button>
  )

  return (
    <div>
      {/* Hero: clean photo (or heirloom placeholder), subtle top gradient, no
          cuisine stamp. Matched cream circle buttons: back left, edit right. */}
      <div className="relative h-[180px] overflow-hidden">
        {recipe.cover_photo_url ? (
          <img src={recipe.cover_photo_url} alt="" className="w-full h-full object-cover" />
        ) : (
          <div className="w-full h-full bg-paper flex items-center justify-center">
            <Wordmark muted className="text-6xl" />
          </div>
        )}
        <div className="absolute inset-0 bg-gradient-to-b from-[rgba(58,42,28,0.22)] to-transparent to-[26%]" />
        <HeroButton icon="back" label="Back" onClick={() => navigate(-1)} className="left-3" />
        {isOwner && (
          <HeroButton
            icon="edit"
            label="Edit recipe"
            onClick={() => navigate(`/recipes/${recipe.id}/edit`)}
            className="right-3"
          />
        )}
      </div>

      <div className="px-[18px] pt-4 pb-6">
        <h1 className="font-serif font-black text-[28px] leading-[1.02] tracking-[-0.01em] text-ink">
          {recipe.name}
        </h1>

        {recipe.author_full_name && (
          <div className="flex items-center gap-2 mt-2.5">
            <span className="w-[26px] h-[26px] rounded-full bg-terra text-white font-serif font-semibold text-xs flex items-center justify-center flex-shrink-0">
              {monogram}
            </span>
            <span className="font-serif italic text-[13.5px] text-ink-soft">
              kept by
              {/* small gap so the italic "y" overhang doesn't collide with the upright name */}
              <span className="not-italic font-semibold text-terra ml-1">{recipe.author_full_name}</span>
            </span>
          </div>
        )}

        {(recipe.servings || recipe.cuisine || recipe.prep_time_minutes) && (
          <div className="flex flex-wrap gap-x-3.5 gap-y-1.5 mt-3 font-serif text-[13px] text-ink-soft">
            {recipe.servings && (
              <span className="flex items-center gap-1.5">
                <Icon name="serves" className="w-3.5 h-3.5 text-terra" />
                Serves {recipe.servings}
              </span>
            )}
            {recipe.cuisine && (
              <span className="flex items-center gap-1.5">
                <Icon name="bowl" className="w-3.5 h-3.5 text-terra" />
                {recipe.cuisine}
              </span>
            )}
            {recipe.prep_time_minutes && (
              <span className="flex items-center gap-1.5">
                <Icon name="clock" className="w-3.5 h-3.5 text-terra" />
                {recipe.prep_time_minutes} min
              </span>
            )}
          </div>
        )}

        {recipe.description && (
          <>
            <RuleHeader>About this dish</RuleHeader>
            <p className="font-serif text-[13.5px] leading-relaxed text-ink-soft">
              {recipe.description}
            </p>
          </>
        )}

        {/* The Story — treatment 5: filled terra header band + warm body panel. */}
        {recipe.story && (
          <div className="mt-[15px] rounded-xl overflow-hidden bg-[#EFDCBB]">
            <div className="bg-terra text-white font-serif italic font-medium text-sm px-[15px] py-[7px]">
              The Story
            </div>
            <div className="px-[15px] py-[13px]">
              <p className="font-serif italic text-[13.5px] leading-relaxed text-ink/85 whitespace-pre-line">
                {recipe.story}
              </p>
            </div>
          </div>
        )}

        <RuleHeader>Ingredients</RuleHeader>
        <div className="font-serif text-[13.5px]">
          {allIngredients.map((ing) => (
            <div key={ing.id} className="flex gap-2.5 py-1">
              <span className="w-20 flex-shrink-0 text-terra font-semibold">
                {ing.quantity_text}
              </span>
              <span className="text-ink">
                {ing.name}
                {ing.notes && <span className="text-ink-soft italic"> — {ing.notes}</span>}
              </span>
            </div>
          ))}
        </div>

        <RuleHeader>Steps</RuleHeader>
        <div>
          {sortedSteps.map((step, idx) => (
            <div key={step.id} className="flex gap-3.5 mb-3.5">
              <span className="font-serif font-black text-2xl leading-[0.9] text-terra w-6 text-center flex-shrink-0">
                {idx + 1}
              </span>
              <p className="font-serif text-[13.5px] leading-[1.55] text-ink pt-0.5">
                {step.content}
              </p>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
