import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import client from '../api/client'
import CoverImage from '../components/CoverImage'

function getGreeting() {
  const hour = new Date().getHours()
  if (hour < 12) return 'Good morning'
  if (hour < 18) return 'Good afternoon'
  return 'Good evening'
}

export default function Home() {
  const [recipes, setRecipes] = useState(null)
  const navigate = useNavigate()
  const user = JSON.parse(localStorage.getItem('issei_user') || '{}')

  useEffect(() => {
    client.get('/recipes').then((res) => setRecipes(res.data)).catch(() => setRecipes([]))
  }, [])

  if (recipes === null) {
    return <div className="p-6 text-center text-ink-soft">Loading...</div>
  }

  if (recipes.length === 0) {
    return (
      <div className="min-h-screen px-6">
        <p className="text-terra text-xs font-sans uppercase tracking-[0.18em] pt-8">
          {getGreeting()}, {user.first_name || 'friend'}
        </p>
        <div className="flex flex-col items-center justify-center text-center pt-16">
          <h1 className="font-serif text-6xl font-bold text-ink mb-4">一世</h1>
          <p className="font-serif text-xl text-ink mb-2">Every family has a dish that means home.</p>
          <p className="text-sm text-ink-soft mb-8 max-w-xs">
            Start with the one you'd miss most — the taste you'd want to keep forever.
          </p>
          <button
            onClick={() => navigate('/add')}
            className="px-6 py-3 rounded-lg bg-terra text-white font-medium text-sm"
          >
            Keep your first recipe
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className="px-4 pt-8">
      <p className="text-terra text-xs font-sans uppercase tracking-[0.18em] mb-1">
        {getGreeting()}, {user.first_name || 'friend'}
      </p>
      <h2 className="font-serif text-2xl text-ink">What's cooking tonight?</h2>
      <p className="text-sm text-ink-soft italic mb-6">
        Recipes that live in memory, not cookbooks.
      </p>

      <h3 className="section-label mb-3">From your kitchen</h3>
      <div className="flex gap-3 overflow-x-auto pb-4 -mx-4 px-4 scrollbar-hide">
        {recipes.slice(0, 10).map((recipe) => (
          <button
            key={recipe.id}
            onClick={() => navigate(`/recipes/${recipe.id}`)}
            className="flex-shrink-0 w-44 bg-card rounded-xl overflow-hidden shadow-sm text-left"
          >
            <CoverImage url={recipe.cover_photo_url} size="sm" className="w-full h-24" />
            <div className="p-4">
              <p className="font-serif font-semibold text-sm text-ink truncate">
                {recipe.name}
              </p>
              {recipe.author_full_name && (
                <p className="text-xs text-ink-soft truncate mt-0.5">
                  {recipe.author_full_name}
                </p>
              )}
              {recipe.cuisine && (
                <span className="inline-block mt-1 px-2 py-0.5 text-xs bg-line/50 text-ink-soft rounded-full">
                  {recipe.cuisine}
                </span>
              )}
            </div>
          </button>
        ))}
      </div>
    </div>
  )
}
