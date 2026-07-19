import { useState, useEffect } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import client from '../api/client'
import Icon from '../components/Icon'
import HandoffInvite from '../components/HandoffInvite'
import { sourceNameOf } from '../lib/sourceName'

// A dedicated, focused page for passing a recipe on to someone — its own route
// (/recipes/:id/handoff) rather than a cramped inline form under the plant.
// Loads the recipe for its name/visibility/source, then renders HandoffInvite;
// sending or skipping returns to the recipe page.
export default function HandoffPage() {
  const { id } = useParams()
  const navigate = useNavigate()
  const [recipe, setRecipe] = useState(null)
  const [error, setError] = useState('')

  useEffect(() => {
    client
      .get(`/recipes/${id}`)
      .then((res) => setRecipe(res.data))
      .catch(() => setError('Recipe not found'))
  }, [id])

  const back = () => navigate(`/recipes/${id}`)

  if (error) {
    return (
      <div className="p-6 text-center">
        <p className="text-red-600 mb-4">{error}</p>
        <button onClick={() => navigate('/my-recipes')} className="text-terra text-sm">
          Back to your garden
        </button>
      </div>
    )
  }

  if (!recipe) {
    return <div className="p-6 text-center text-ink-soft">Loading…</div>
  }

  const source = sourceNameOf(recipe)

  return (
    <div className="relative min-h-screen">
      <header className="px-6 pt-4 pb-2">
        <div className="flex items-center mb-3">
          <button
            onClick={back}
            aria-label="Back"
            className="inline-flex items-center justify-center w-10 h-10 rounded-full border border-line bg-card/70 text-terra shadow-[0_1px_0_rgba(255,255,255,.55)_inset,0_4px_12px_-8px_rgba(46,58,36,.4)] active:scale-95 transition"
          >
            <Icon name="back" className="w-5 h-5" />
          </button>
        </div>
        <h1 className="font-serif font-semibold text-[26px] leading-tight text-ink">
          Pass on {recipe.name}
        </h1>
        <p className="font-serif italic text-[14.5px] text-ink-soft mt-1">
          Hand this recipe to someone — they’ll be able to cook it, keep it, and
          add their own memories.
        </p>
      </header>

      <div className="px-6 pb-10">
        <HandoffInvite
          recipeId={recipe.id}
          recipeVisibility={recipe.visibility}
          sourceName={source}
          onSent={back}
          onSkip={back}
        />
      </div>
    </div>
  )
}
