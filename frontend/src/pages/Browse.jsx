import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import client from '../api/client'
import RecipeCard from '../components/RecipeCard'
import SectionHeader from '../components/SectionHeader'
import IconField from '../components/IconField'

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
const CUISINES = [
  'Japanese', 'Korean', 'Chinese', 'Filipino', 'Vietnamese', 'Thai', 'Indian',
  'Middle Eastern', 'Mexican', 'Italian', 'West African', 'Caribbean',
]

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
        <div className="w-8 h-8 border-2 border-line border-t-terra rounded-full animate-spin" />
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
        <h1 className="font-serif font-black text-[28px] text-ink">Browse</h1>
        <p className="font-serif italic text-sm text-ink-soft mt-0.5">
          Wander through everyone’s gardens.
        </p>

        <IconField
          icon="search"
          iconClassName="text-ink-soft"
          type="text"
          placeholder="Search recipes"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          wrapperClassName="mt-3.5"
        />
      </div>

      {/* Diet filter chips — wrap so all options stay visible on mobile */}
      <div className="flex flex-wrap gap-2 px-4 pt-3 pb-1">
        {DIET_FILTERS.map((diet) => (
          <button
            key={diet}
            onClick={() => toggleDiet(diet)}
            className={`chip ${activeDiets.includes(diet) ? 'chip--active' : ''}`}
          >
            {diet}
          </button>
        ))}
      </div>

      {/* Sections */}
      {sections.length === 0 ? (
        <p className="text-center text-ink-soft text-sm mt-8 px-4">
          No recipes found.
        </p>
      ) : (
        <div>
          {sections.map((section) => (
            <section key={section.title}>
              <div className="px-4">
                <SectionHeader seal={false} className="mt-5">{section.title}</SectionHeader>
              </div>
              <div className="flex gap-3.5 overflow-x-auto px-4 pb-1 scrollbar-hide">
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
