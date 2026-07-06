import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import client from '../api/client'
import RecipeCard from '../components/RecipeCard'
import IconField from '../components/IconField'

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
      <h1 className="font-serif font-black text-[28px] text-ink">Your Kitchen</h1>
      <p className="font-serif italic text-sm text-ink-soft mt-0.5">Everything you've kept.</p>

      <IconField
        icon="search"
        iconClassName="text-ink-soft"
        type="text"
        placeholder="Search recipes"
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        wrapperClassName="mt-3.5 mb-4"
      />

      <div className="grid grid-cols-2 gap-3">
        {filtered.map((recipe) => (
          <RecipeCard
            key={recipe.id}
            recipe={recipe}
            variant="grid"
            onClick={() => navigate(`/recipes/${recipe.id}`)}
          />
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
