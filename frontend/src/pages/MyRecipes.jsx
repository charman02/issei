import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import client from '../api/client'
import CoverImage from '../components/CoverImage'

export default function MyRecipes() {
  const [recipes, setRecipes] = useState([])
  const [search, setSearch] = useState('')
  const navigate = useNavigate()

  useEffect(() => {
    client.get('/recipes').then((res) => setRecipes(res.data)).catch(() => {})
  }, [])

  const filtered = recipes.filter((r) =>
    r.name.toLowerCase().includes(search.toLowerCase())
  )

  return (
    <div className="px-4 pt-6">
      <h1 className="font-serif text-2xl font-bold text-primary mb-4">My Recipes</h1>

      <input
        type="text"
        placeholder="Search recipes..."
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        className="w-full px-4 py-2.5 rounded-lg border border-secondary bg-surface text-sm focus:outline-none focus:border-accent mb-4"
      />

      <div className="grid grid-cols-2 gap-3">
        {filtered.map((recipe) => (
          <button
            key={recipe.id}
            onClick={() => navigate(`/recipes/${recipe.id}`)}
            className="bg-surface rounded-xl overflow-hidden shadow-sm text-left"
          >
            <CoverImage url={recipe.cover_photo_url} size="sm" className="w-full h-28" />
            <div className="p-3">
              <p className="font-serif font-semibold text-sm text-primary truncate">
                {recipe.name}
              </p>
              {recipe.author_full_name && (
                <p className="text-xs text-gray-400 truncate mt-0.5">
                  {recipe.author_full_name}
                </p>
              )}
              {recipe.cuisine && (
                <span className="inline-block mt-1 px-2 py-0.5 text-xs bg-secondary/40 text-gray-600 rounded-full">
                  {recipe.cuisine}
                </span>
              )}
            </div>
          </button>
        ))}
      </div>

      {filtered.length === 0 && (
        <p className="text-center text-gray-400 text-sm mt-8">No recipes found.</p>
      )}
    </div>
  )
}
