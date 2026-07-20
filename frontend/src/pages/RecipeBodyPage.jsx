import { useState, useEffect } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import client from '../api/client'
import Icon from '../components/Icon'
import RecipeBody from '../components/RecipeBody'

// The full "View recipe" page — the always-readable body (ingredients + steps,
// with the cooking-mode toggle) on its own route (/recipes/:id/full) instead of
// the plant page's slide-up sheet. Only the container changed: the content is
// still <RecipeBody>. Back returns to the plant page.
export default function RecipeBodyPage() {
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

  return (
    <div className="relative min-h-screen">
      <header className="px-6 pt-4 pb-1">
        <div className="flex items-center mb-2">
          <button
            onClick={back}
            aria-label="Back to the plant"
            className="inline-flex items-center justify-center w-10 h-10 rounded-full border border-line bg-card/70 text-terra shadow-[0_1px_0_rgba(255,255,255,.55)_inset,0_4px_12px_-8px_rgba(46,58,36,.4)] active:scale-95 transition"
          >
            <Icon name="back" className="w-5 h-5" />
          </button>
        </div>
        <h1 className="font-serif font-semibold text-[30px] leading-[1.04] text-ink text-center">
          {recipe.name}
        </h1>
      </header>

      <div className="px-6 pb-12">
        <RecipeBody recipe={recipe} />
      </div>
    </div>
  )
}
