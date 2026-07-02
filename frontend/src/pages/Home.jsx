import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import client from '../api/client'
import RecipeCard from '../components/RecipeCard'
import Wordmark from '../components/Wordmark'

function getGreeting() {
  const hour = new Date().getHours()
  if (hour < 12) return 'Good morning'
  if (hour < 18) return 'Good afternoon'
  return 'Good evening'
}

// Section header: spaced label + hairline rule + a small terra seal at the end.
function SectionHeader({ children }) {
  return (
    <div className="flex items-center gap-2.5 mb-3">
      <span className="section-label whitespace-nowrap">{children}</span>
      <span className="h-px flex-1 bg-line" />
      <span className="font-serif text-xs text-terra/60">issei.</span>
    </div>
  )
}

export default function Home() {
  const [recipes, setRecipes] = useState(null)
  const navigate = useNavigate()
  const user = JSON.parse(localStorage.getItem('issei_user') || '{}')

  useEffect(() => {
    client.get('/recipes').then((res) => setRecipes(res.data)).catch(() => setRecipes([]))
  }, [])

  if (recipes === null) {
    return <div className="p-6 text-center text-ink-soft">Loading…</div>
  }

  const greeting = (
    <p className="text-terra text-[11px] font-sans font-semibold uppercase tracking-[0.22em]">
      {getGreeting()}, {user.first_name || 'friend'}
    </p>
  )

  if (recipes.length === 0) {
    return (
      <div className="min-h-screen px-6">
        <div className="pt-8">{greeting}</div>
        <div className="flex flex-col items-center justify-center text-center pt-20">
          <Wordmark className="text-5xl mb-6" />
          <h1 className="font-serif font-black text-[26px] leading-[1.1] text-ink mb-3 max-w-[15rem]">
            Every family has a dish that means home.
          </h1>
          <p className="text-sm text-ink-soft mb-8 max-w-xs leading-relaxed">
            Start with the one you'd miss most — the taste you'd want to keep forever.
          </p>
          <button
            onClick={() => navigate('/add')}
            className="px-6 py-3 rounded-lg bg-terra text-white font-serif font-semibold text-sm shadow-[0_8px_18px_rgba(189,90,44,0.3)]"
          >
            Keep your first recipe
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className="px-4 pt-8">
      {greeting}
      <h1 className="font-serif font-black text-[32px] leading-[1.02] tracking-[-0.01em] text-ink mt-2">
        What's cooking tonight?
      </h1>
      <p className="font-serif italic text-[15px] text-ink-soft mt-2 mb-7">
        Recipes that live in memory, not cookbooks.
      </p>

      <SectionHeader>From your kitchen</SectionHeader>
      <div className="flex gap-3.5 overflow-x-auto pb-2 -mx-4 px-4 scrollbar-hide">
        {recipes.slice(0, 12).map((recipe) => (
          <RecipeCard
            key={recipe.id}
            recipe={recipe}
            onClick={() => navigate(`/recipes/${recipe.id}`)}
          />
        ))}
      </div>
    </div>
  )
}
