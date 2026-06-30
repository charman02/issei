import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import client from '../api/client'
import CoverImage from '../components/CoverImage'

const DIET_FILTERS = [
  'Vegetarian',
  'Vegan',
  'Gluten-Free',
  'Dairy-Free',
  'Halal',
  'Kosher',
]

// Section definitions. Each has a predicate selecting matching recipes from the
// full list, plus an optional sort. Cuisine sections match case-insensitively.
const CUISINES = ['Japanese', 'Korean', 'Chinese', 'Filipino', 'Vietnamese', 'Indian']

function buildSections(recipes) {
  const sections = CUISINES.map((cuisine) => ({
    title: cuisine,
    recipes: recipes.filter(
      (r) => (r.cuisine || '').toLowerCase() === cuisine.toLowerCase()
    ),
  }))

  sections.push({
    title: 'Quick & Easy',
    recipes: recipes.filter(
      (r) => r.prep_time_minutes != null && r.prep_time_minutes <= 30
    ),
  })

  sections.push({
    title: 'Recently Added',
    recipes: [...recipes].sort(
      (a, b) => new Date(b.created_at) - new Date(a.created_at)
    ),
  })

  return sections
}

function RecipeCard({ recipe, onClick }) {
  return (
    <button
      onClick={onClick}
      className="flex-shrink-0 w-40 bg-surface rounded-xl overflow-hidden shadow-sm text-left"
    >
      <CoverImage url={recipe.cover_photo_url} size="sm" className="w-full h-24" />
      <div className="p-3">
        <p className="font-serif font-semibold text-sm text-primary truncate">
          {recipe.name}
        </p>
        {recipe.author_full_name && (
          <p className="text-xs text-gray-400 truncate mt-0.5">
            {recipe.author_full_name}
          </p>
        )}
      </div>
    </button>
  )
}

export default function Browse() {
  const [recipes, setRecipes] = useState(null)
  const [search, setSearch] = useState('')
  const [activeDiets, setActiveDiets] = useState([])
  const navigate = useNavigate()

  useEffect(() => {
    client
      .get('/recipes/browse')
      .then((res) => setRecipes(res.data))
      .catch(() => setRecipes([]))
  }, [])

  function toggleDiet(diet) {
    setActiveDiets((prev) =>
      prev.includes(diet) ? prev.filter((d) => d !== diet) : [...prev, diet]
    )
  }

  if (recipes === null) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="w-8 h-8 border-2 border-secondary border-t-accent rounded-full animate-spin" />
      </div>
    )
  }

  // Apply search + diet filters before splitting into sections, so filtering
  // affects every section consistently.
  const searchLower = search.toLowerCase()
  const filteredRecipes = recipes.filter((r) => {
    const matchesSearch = r.name.toLowerCase().includes(searchLower)
    const matchesDiet =
      activeDiets.length === 0 ||
      activeDiets.every((diet) =>
        (r.diet || '').toLowerCase().includes(diet.toLowerCase())
      )
    return matchesSearch && matchesDiet
  })

  const sections = buildSections(filteredRecipes).filter(
    (section) => section.recipes.length > 0
  )

  return (
    <div className="pt-6">
      <div className="px-4">
        <h1 className="font-serif text-2xl font-bold text-primary mb-4">Browse</h1>

        <input
          type="text"
          placeholder="Search recipes..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="w-full px-4 py-2.5 rounded-lg border border-secondary bg-surface text-sm focus:outline-none focus:border-accent mb-4"
        />
      </div>

      {/* Diet filter chips — wrap so all options stay visible on mobile */}
      <div className="flex flex-wrap gap-2 px-4 pb-4">
        {DIET_FILTERS.map((diet) => {
          const active = activeDiets.includes(diet)
          return (
            <button
              key={diet}
              onClick={() => toggleDiet(diet)}
              className={`px-4 py-1.5 rounded-full text-sm border transition-colors ${
                active
                  ? 'bg-accent text-white border-accent'
                  : 'bg-surface text-gray-600 border-secondary'
              }`}
            >
              {diet}
            </button>
          )
        })}
      </div>

      {/* Sections */}
      {sections.length === 0 ? (
        <p className="text-center text-gray-400 text-sm mt-8 px-4">
          No recipes found.
        </p>
      ) : (
        <div className="space-y-6">
          {sections.map((section) => (
            <section key={section.title}>
              <h2 className="font-serif text-lg font-semibold text-primary mb-3 px-4">
                {section.title}
              </h2>
              <div className="flex gap-3 overflow-x-auto px-4 pb-2 scrollbar-hide">
                {section.recipes.map((recipe) => (
                  <RecipeCard
                    key={`${section.title}-${recipe.id}`}
                    recipe={recipe}
                    onClick={() => navigate(`/recipes/${recipe.id}`)}
                  />
                ))}
              </div>
            </section>
          ))}
        </div>
      )}
    </div>
  )
}
