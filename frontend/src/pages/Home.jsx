import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import client from '../api/client'
import RecipeCard from '../components/RecipeCard'
import SectionHeader from '../components/SectionHeader'
import Wordmark from '../components/Wordmark'

function getGreeting() {
  const hour = new Date().getHours()
  if (hour < 12) return 'Good morning'
  if (hour < 18) return 'Good afternoon'
  return 'Good evening'
}

export default function Home() {
  // mine = recipes the user has kept; community = everyone's feed (newest first)
  const [mine, setMine] = useState(null)
  const [community, setCommunity] = useState([])
  const navigate = useNavigate()
  const user = JSON.parse(localStorage.getItem('issei_user') || '{}')

  useEffect(() => {
    client
      .get('/recipes')
      .then((res) => setMine(res.data))
      .catch(() => setMine([]))
    client
      .get('/recipes/browse')
      .then((res) => setCommunity(res.data))
      .catch(() => setCommunity([]))
  }, [])

  if (mine === null) {
    return <div className="p-6 text-center text-ink-soft">Loading…</div>
  }

  const greeting = (
    <p className="text-terra text-[11px] font-sans font-semibold uppercase tracking-[0.22em]">
      {getGreeting()}, {user.first_name || 'friend'}
    </p>
  )

  // First-run: nothing kept yet. Warm hero + CTA (bottom nav still offers Add).
  if (mine.length === 0) {
    return (
      <div className="min-h-screen px-6">
        <div className="pt-8">{greeting}</div>
        <div className="flex flex-col items-center justify-center text-center pt-20">
          <Wordmark className="text-5xl mb-6" />
          <h1 className="font-serif font-black text-[26px] leading-[1.1] text-ink mb-3 max-w-[15rem]">
            Every family has a dish that means home.
          </h1>
          <p className="text-sm text-ink-soft mb-8 max-w-xs leading-relaxed">
            Start with the one you'd miss most — the taste you'd want to keep
            forever.
          </p>
          <button
            onClick={() => navigate('/add')}
            className="btn-primary !w-auto px-6"
          >
            Keep your first recipe
          </button>
        </div>
      </div>
    )
  }

  // "Passed down lately" = the community feed, excluding the user's own recipes.
  const passedDown = community.filter((r) => r.user_id !== user.id).slice(0, 12)

  return (
    <div className="pt-8">
      <div className="px-4">
        {greeting}
        <h1 className="font-serif font-black text-[32px] leading-[1.02] tracking-[-0.01em] text-ink mt-1.5">
          What's cooking tonight?
        </h1>
        <p className="font-serif italic text-[14.5px] text-ink-soft mt-1.5">
          Recipes that live in memory, not cookbooks.
        </p>
      </div>

      {passedDown.length > 0 && (
        <>
          <div className="px-4">
            <SectionHeader className="mt-5">Passed down lately</SectionHeader>
          </div>
          <div className="flex gap-3.5 overflow-x-auto pb-1 px-4 scrollbar-hide">
            {passedDown.map((recipe) => (
              <RecipeCard
                key={recipe.id}
                recipe={recipe}
                onClick={() => navigate(`/recipes/${recipe.id}`)}
              />
            ))}
          </div>
        </>
      )}

      <div className="px-4">
        <SectionHeader className="mt-5">From your garden</SectionHeader>
      </div>
      <div className="flex gap-3.5 overflow-x-auto pb-1 px-4 scrollbar-hide">
        {mine.slice(0, 12).map((recipe) => (
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
