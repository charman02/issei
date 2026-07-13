import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { getSharedWithMe } from '../api/lineage'
import RecipeCard from '../components/RecipeCard'

export default function SharedWithMe() {
  const [recipes, setRecipes] = useState(null)
  const navigate = useNavigate()

  useEffect(() => {
    getSharedWithMe()
      .then((res) => setRecipes(res.data))
      .catch(() => setRecipes([]))
  }, [])

  if (recipes === null)
    return <div className="p-6 text-center text-ink-soft">Loading…</div>

  return (
    <div className="px-4 pt-6">
      <h1 className="font-serif font-black text-[28px] text-ink">
        Shared with you
      </h1>
      <p className="font-serif italic text-sm text-ink-soft mt-0.5 mb-4">
        Recipes others have passed to you.
      </p>
      {recipes.length === 0 ? (
        <p className="text-center text-ink-soft text-sm mt-8">
          Nothing's been shared with you yet.
        </p>
      ) : (
        <div className="grid grid-cols-2 gap-3">
          {recipes.map((r) => (
            <RecipeCard
              key={r.id}
              recipe={r}
              variant="grid"
              onClick={() => navigate(`/recipes/${r.id}`)}
            />
          ))}
        </div>
      )}
    </div>
  )
}
