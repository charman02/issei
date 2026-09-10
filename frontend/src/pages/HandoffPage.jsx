import { useState, useEffect } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import client from '../api/client'
import Icon from '../components/Icon'
import HandoffInvite from '../components/HandoffInvite'
import Loader from '../components/Loader'

// A dedicated, focused page for passing a recipe on to someone — its own route
// (/recipes/:id/handoff) rather than a cramped inline form under the plant.
// Loads the recipe for its name/visibility, then renders HandoffInvite;
// sending or skipping returns to the recipe page.
export default function HandoffPage() {
  const { id } = useParams()
  const navigate = useNavigate()
  const [recipe, setRecipe] = useState(null)
  const [error, setError] = useState('')

  useEffect(() => {
    client
      .get(`/recipes/${id}`)
      .then((res) => {
        // OWNER-ONLY, checked here as well as on the server.
        //
        // `GET /recipes/{id}` is can_view-gated, so anyone who can READ this recipe loads it fine —
        // a friend, someone holding a grant, anyone at all for a public one. But `handoff_recipe`
        // filters on `Recipe.user_id == current_user.id`, so only the owner can actually mint a
        // link. Without this check a non-owner got the entire send screen — the recipe's name in
        // the header, "This won't put YOUR recipe in Browse", a compose box — and the only possible
        // ending was a "Recipe not found" pill after they'd written a message. The backend leaked
        // nothing; the page just promised something it could never deliver.
        //
        // Read is not write: that rule is enforced server-side, and this is the client agreeing
        // with it instead of discovering it at submit time. RecipePage already gates the entry
        // button on ownership, so this is reachable only by URL or a back-button return.
        const me = JSON.parse(localStorage.getItem('issei_user') || '{}')
        if (String(me.id) !== String(res.data.user_id)) {
          navigate(`/recipes/${id}`, { replace: true })
          return
        }
        setRecipe(res.data)
      })
      .catch(() => setError('Recipe not found'))
  }, [id, navigate])

  // Pop back to wherever we came from (usually the recipe page). Avoids pushing
  // a new entry that would create a back-and-forth history loop.
  const back = () => navigate(-1)

  if (error) {
    return (
      <div className="min-h-screen bg-cream flex flex-col items-center justify-center gap-4 p-6 text-center">
        <span className="error-pill">{error}</span>
        <button onClick={() => navigate('/my-recipes')} className="font-display font-bold text-[13px] text-terra">
          Back to your kitchen →
        </button>
      </div>
    )
  }

  if (!recipe) {
    return <Loader />
  }

  return (
    <div className="relative min-h-screen bg-cream">
      <header className="px-6 pt-4 pb-2">
        <div className="flex items-center mb-3">
          <button
            onClick={back}
            aria-label="Back"
            className="inline-flex items-center justify-center w-10 h-10 rounded-full border-2 border-ink bg-cream text-ink shadow-[0_3px_0_#2E3A24] active:translate-y-[2px] active:shadow-[0_1px_0_#2E3A24] transition-transform"
          >
            <Icon name="back" className="w-5 h-5" />
          </button>
        </div>
        <h1 className="font-display font-black text-[28px] leading-tight text-ink">
          Send <span className="text-terra">{recipe.name}</span>
        </h1>
        <p className="font-display italic text-[14.5px] text-ink-soft mt-1">
          You&rsquo;ll get a link to send. Whoever opens it can read and cook it,
          no account needed.
        </p>
      </header>

      <div className="px-6 pb-10">
        <HandoffInvite
          recipeId={recipe.id}
          recipeName={recipe.name}
          recipeVisibility={recipe.visibility}
          onSent={back}
          onSkip={back}
          showHeading={false}
        />
      </div>
    </div>
  )
}
