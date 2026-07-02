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
      <h1 className="font-serif text-2xl font-bold text-ink">Your Kitchen</h1>
      <p className="text-sm text-ink-soft italic mb-4">Everything you've kept.</p>

      <input
        type="text"
        placeholder="Search recipes..."
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        className="w-full px-4 py-2.5 rounded-lg border border-line bg-card text-sm focus:outline-none focus:border-terra mb-4"
      />

      <div className="grid grid-cols-2 gap-3">
        {filtered.map((recipe) => (
          <button
            key={recipe.id}
            onClick={() => navigate(`/recipes/${recipe.id}`)}
            className="bg-card rounded-xl overflow-hidden shadow-warm text-left"
          >
            <CoverImage url={recipe.cover_photo_url} size="sm" className="w-full h-28" />
            <div className="p-3">
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

      {filtered.length === 0 && (
        <p className="text-center text-ink-soft text-sm mt-8">
          {search
            ? 'No recipes found.'
            : "Your kitchen's just getting started. Keep your first recipe."}
        </p>
      )}
    </div>
  )
}
