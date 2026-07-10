// The provenance line — "🌱 Lola → you". Built from origin_attribution (the ghost
// ancestor) + the recipe's keeper. Reads fine at 1 node; no tree/network needed.
// See living-recipe spec §1.2.
export default function Provenance({ recipe }) {
  const origin = recipe.origin_attribution
    ? recipe.origin_attribution.split('·')[0].trim()
    : null
  const keeper = recipe.author_full_name || null
  if (!origin && !keeper) return null

  return (
    <p className="font-sans text-[11px] text-ink-soft flex items-center gap-1.5">
      <span aria-hidden="true">🌱</span>
      {origin && keeper ? (
        <span>{origin} <span className="text-growth">→</span> {keeper}</span>
      ) : (
        <span>{origin || keeper}</span>
      )}
    </p>
  )
}
