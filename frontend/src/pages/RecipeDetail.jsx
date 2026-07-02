import { useState, useEffect } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import client from '../api/client'
import CoverImage from '../components/CoverImage'

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
    return <div className="p-6 text-center text-ink-soft">Loading...</div>
  }

  const allIngredients = [
    ...recipe.ingredients,
    ...recipe.ingredient_sections.flatMap((s) =>
      s.ingredients.map((ing) => ({ ...ing, sectionName: s.name }))
    ),
  ].sort((a, b) => a.position - b.position)

  const sortedSteps = [...recipe.steps].sort((a, b) => a.position - b.position)

  return (
    <div>
      <CoverImage url={recipe.cover_photo_url} size="lg" className="w-full h-48" />

      <div className="px-4 pt-5 pb-6">
        <div className="flex items-start justify-between gap-3">
          <h1 className="font-serif text-2xl font-bold text-ink mb-1">{recipe.name}</h1>
          {isOwner && (
            <button
              onClick={() => navigate(`/recipes/${recipe.id}/edit`)}
              className="flex-shrink-0 text-sm text-terra font-sans font-medium pt-1"
            >
              Edit
            </button>
          )}
        </div>

        {recipe.author_full_name && (
          <p className="text-sm text-ink-soft italic mb-2">kept by {recipe.author_full_name}</p>
        )}

        <div className="flex items-center gap-2 text-sm text-ink-soft mb-5">
          {recipe.servings && <span>Serves {recipe.servings}</span>}
          {recipe.servings && recipe.cuisine && <span>·</span>}
          {recipe.cuisine && <span>{recipe.cuisine}</span>}
          {(recipe.servings || recipe.cuisine) && recipe.prep_time_minutes && <span>·</span>}
          {recipe.prep_time_minutes && <span>{recipe.prep_time_minutes} min</span>}
        </div>

        {recipe.description && (
          <div className="mb-5">
            <h2 className="section-label mb-1">About this dish</h2>
            <p className="text-sm text-ink-soft leading-relaxed">{recipe.description}</p>
          </div>
        )}

        {recipe.story && (
          <div className="story-callout mb-6">
            <h2 className="font-sans text-[12px] uppercase tracking-[0.12em] text-terra mb-1.5">The Story</h2>
            <p className="font-serif text-sm italic text-ink/80 whitespace-pre-line leading-relaxed">
              {recipe.story}
            </p>
          </div>
        )}

        <h2 className="font-serif text-lg font-semibold text-ink mb-3">Ingredients</h2>
        <ul className="space-y-2 mb-6">
          {allIngredients.map((ing) => (
            <li key={ing.id} className="flex items-start gap-2 text-sm">
              <span className="w-1.5 h-1.5 rounded-full bg-terra mt-1.5 flex-shrink-0" />
              <span>
                {ing.quantity_text && <span className="text-terra font-semibold">{ing.quantity_text} </span>}
                <span className="text-ink">{ing.name}</span>
                {ing.notes && <span className="text-ink-soft italic"> — {ing.notes}</span>}
              </span>
            </li>
          ))}
        </ul>

        <h2 className="font-serif text-lg font-semibold text-ink mb-3">Steps</h2>
        <ol className="space-y-4">
          {sortedSteps.map((step, idx) => (
            <li key={step.id} className="flex gap-3 text-sm">
              <span className="flex-shrink-0 w-6 h-6 rounded-full bg-terra text-white text-xs flex items-center justify-center font-medium">
                {idx + 1}
              </span>
              <p className="text-ink pt-0.5">{step.content}</p>
            </li>
          ))}
        </ol>
      </div>
    </div>
  )
}
