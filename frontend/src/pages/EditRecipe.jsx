import { useState, useEffect } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import client from '../api/client'
import RecipeForm from '../components/RecipeForm'

// Loads an existing recipe, maps it to RecipeForm's initial-value shape, and
// PATCHes on save. Editing is owner-only: the backend PATCH already scopes to
// the current user (404 otherwise), and we redirect non-owners client-side so
// they never see the form.
export default function EditRecipe() {
  const { id } = useParams()
  const navigate = useNavigate()
  const [initialValues, setInitialValues] = useState(null)
  const [error, setError] = useState('')
  const currentUser = JSON.parse(localStorage.getItem('issei_user') || '{}')

  useEffect(() => {
    client
      .get(`/recipes/${id}`)
      .then((res) => {
        const recipe = res.data
        if (currentUser.id !== recipe.user_id) {
          navigate(`/recipes/${id}`, { replace: true })
          return
        }

        // Merge direct-FK + sectioned ingredients into flat rows ordered by
        // position. The form takes a single free-text quantity per row, so we
        // surface the stored quantity_text verbatim (what the user typed).
        const flatIngredients = [
          ...recipe.ingredients,
          ...recipe.ingredient_sections.flatMap((s) => s.ingredients),
        ]
          .sort((a, b) => a.position - b.position)
          .map((ing) => ({ name: ing.name, quantity: ing.quantity_text || '' }))

        // Carry section_header through the round-trip: the PATCH replaces all
        // steps, so dropping it here would null a persisted field on save.
        const flatSteps = [...recipe.steps]
          .sort((a, b) => a.position - b.position)
          .map((s) => ({ content: s.content, section_header: s.section_header ?? null }))

        setInitialValues({
          name: recipe.name,
          servings: recipe.servings,
          cuisine: recipe.cuisine,
          description: recipe.description,
          story: recipe.story,
          coverPhotoUrl: recipe.cover_photo_url || '',
          ingredients: flatIngredients,
          steps: flatSteps,
        })
      })
      .catch(() => setError('Recipe not found'))
  }, [id])

  async function handleSave(payload) {
    await client.patch(`/recipes/${id}`, payload)
    navigate(`/recipes/${id}`)
  }

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

  if (!initialValues) {
    return <div className="p-6 text-center text-ink-soft">Loading…</div>
  }

  return <RecipeForm mode="edit" initialValues={initialValues} onSubmit={handleSave} />
}
