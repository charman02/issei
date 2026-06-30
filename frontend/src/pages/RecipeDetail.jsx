import { useState, useEffect } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import client from '../api/client'
import CoverImage from '../components/CoverImage'

export default function RecipeDetail() {
  const { id } = useParams()
  const [recipe, setRecipe] = useState(null)
  const [error, setError] = useState('')
  const navigate = useNavigate()

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
        <button onClick={() => navigate('/my-recipes')} className="text-accent text-sm">
          Back to recipes
        </button>
      </div>
    )
  }

  if (!recipe) {
    return <div className="p-6 text-center text-gray-400">Loading...</div>
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
        <h1 className="font-serif text-2xl font-bold text-primary mb-2">{recipe.name}</h1>

        {recipe.author_full_name && (
          <p className="text-sm text-gray-400 mb-2">By {recipe.author_full_name}</p>
        )}

        <div className="flex items-center gap-2 text-sm text-gray-500 mb-4">
          {recipe.servings && <span>Serves {recipe.servings}</span>}
          {recipe.servings && recipe.cuisine && <span>·</span>}
          {recipe.cuisine && <span>{recipe.cuisine}</span>}
        </div>

        {recipe.description && (
          <p className="text-sm text-gray-600 mb-6">{recipe.description}</p>
        )}

        {recipe.story && (
          <div className="bg-cream rounded-xl p-4 mb-6">
            <h2 className="font-serif text-base font-semibold text-accent mb-2">The Story</h2>
            <p className="font-serif text-sm text-primary/80 italic whitespace-pre-line leading-relaxed">
              {recipe.story}
            </p>
          </div>
        )}

        <h2 className="font-serif text-lg font-semibold text-primary mb-3">Ingredients</h2>
        <ul className="space-y-2 mb-6">
          {allIngredients.map((ing) => (
            <li key={ing.id} className="flex items-start gap-2 text-sm">
              <span className="w-1.5 h-1.5 rounded-full bg-accent mt-1.5 flex-shrink-0" />
              <span>
                {ing.quantity_text && <span className="text-gray-500">{ing.quantity_text} </span>}
                <span className="text-primary">{ing.name}</span>
                {ing.notes && <span className="text-gray-400 italic"> — {ing.notes}</span>}
              </span>
            </li>
          ))}
        </ul>

        <h2 className="font-serif text-lg font-semibold text-primary mb-3">Steps</h2>
        <ol className="space-y-4">
          {sortedSteps.map((step, idx) => (
            <li key={step.id} className="flex gap-3 text-sm">
              <span className="flex-shrink-0 w-6 h-6 rounded-full bg-accent text-white text-xs flex items-center justify-center font-medium">
                {idx + 1}
              </span>
              <p className="text-gray-700 pt-0.5">{step.content}</p>
            </li>
          ))}
        </ol>
      </div>
    </div>
  )
}
