import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import client from '../api/client'

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
    return <div className="p-6 text-center text-gray-400">Loading...</div>
  }

  if (recipes.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center min-h-screen px-6 text-center">
        <h1 className="font-serif text-6xl font-bold text-primary mb-4">一世</h1>
        <p className="font-serif text-xl text-primary mb-2">Preserve your family's recipes.</p>
        <p className="text-sm text-gray-500 mb-8 max-w-xs">
          Keep cultural cooking traditions alive across generations — with room for imprecise
          measurements and the way recipes are actually passed down.
        </p>
        <button
          onClick={() => navigate('/add')}
          className="px-6 py-3 rounded-lg bg-accent text-white font-medium text-sm"
        >
          Add your first recipe
        </button>
      </div>
    )
  }

  return (
    <div className="px-4 pt-8">
      <p className="font-serif text-2xl text-primary mb-1">一世</p>
      <h2 className="font-serif text-xl text-primary mb-6">
        {getGreeting()}, {user.email?.split('@')[0] || 'chef'}.
      </h2>

      <h3 className="text-sm font-medium text-gray-500 uppercase tracking-wide mb-3">
        Recent Recipes
      </h3>
      <div className="flex gap-3 overflow-x-auto pb-4 -mx-4 px-4 scrollbar-hide">
        {recipes.slice(0, 10).map((recipe) => (
          <button
            key={recipe.id}
            onClick={() => navigate(`/recipes/${recipe.id}`)}
            className="flex-shrink-0 w-44 bg-surface rounded-xl p-4 shadow-sm text-left"
          >
            <div className="w-full h-24 bg-secondary/30 rounded-lg mb-3" />
            <p className="font-serif font-semibold text-sm text-primary truncate">
              {recipe.name}
            </p>
            {recipe.cuisine && (
              <span className="inline-block mt-1 px-2 py-0.5 text-xs bg-secondary/40 text-gray-600 rounded-full">
                {recipe.cuisine}
              </span>
            )}
          </button>
        ))}
      </div>
    </div>
  )
}
