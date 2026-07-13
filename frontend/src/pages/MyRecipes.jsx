import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import client from '../api/client'
import RecipeCard from '../components/RecipeCard'
import IconField from '../components/IconField'
import { gardenBands } from '../lib/gardenBands'

export default function MyRecipes() {
  const [recipes, setRecipes] = useState([])
  const [search, setSearch] = useState('')
  const navigate = useNavigate()

  useEffect(() => {
    client
      .get('/recipes')
      .then((res) => setRecipes(res.data))
      .catch(() => {})
  }, [])

  const searching = search.trim().length > 0
  const filtered = recipes.filter((r) =>
    r.name.toLowerCase().includes(search.toLowerCase()),
  )
  // While searching, show a flat grid of matches (grouping a filtered subset would
  // create confusing single-item bands). Otherwise, show the garden by band.
  const bands = searching ? [] : gardenBands(recipes)

  function grid(list) {
    return (
      <div className="grid grid-cols-2 gap-3">
        {list.map((recipe) => (
          <RecipeCard
            key={recipe.id}
            recipe={recipe}
            variant="grid"
            onClick={() => navigate(`/recipes/${recipe.id}`)}
          />
        ))}
      </div>
    )
  }

  return (
    <div className="px-4 pt-6">
      <h1 className="font-serif font-black text-[28px] text-ink">
        Your Garden
      </h1>
      <p className="font-serif italic text-sm text-ink-soft mt-0.5">
        A garden of everything you’ve kept.
      </p>

      <button
        onClick={() => navigate('/shared')}
        className="mt-2 font-sans text-[11.5px] font-semibold text-terra"
      >
        Shared with you →
      </button>

      <IconField
        icon="search"
        iconClassName="text-ink-soft"
        type="text"
        placeholder="Search recipes"
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        wrapperClassName="mt-3.5 mb-4"
      />

      {searching
        ? grid(filtered)
        : bands.map((band) => (
            <section key={band.key} className="mb-6">
              <h2 className="font-serif font-bold text-[17px] text-ink">
                {band.title}
              </h2>
              <p className="font-serif italic text-[12.5px] text-ink-soft mb-2.5">
                {band.blurb}
              </p>
              {grid(band.recipes)}
            </section>
          ))}

      {searching && filtered.length === 0 && (
        <p className="text-center text-ink-soft text-sm mt-8">
          No recipes found.
        </p>
      )}
      {!searching && recipes.length === 0 && (
        <p className="text-center text-ink-soft text-sm mt-8">
          Your garden’s just getting started. Plant your first seed.
        </p>
      )}
    </div>
  )
}
