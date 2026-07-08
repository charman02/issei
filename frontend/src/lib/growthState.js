// Derives the seed→tree growth state + bloom layer for a recipe.
// Reads defensively: works whether the API returns counts or arrays.
// See docs/superpowers/specs/2026-07-07-lineage-capture-flows-design.md §2.2.

const BLOOM_RECENT_DAYS = 30
const BLOOM_MANY_COOKS = 5

export function ownerCookCount(recipe) {
  if (typeof recipe.owner_cook_count === 'number') return recipe.owner_cook_count
  if (Array.isArray(recipe.cook_events) && recipe.user_id != null) {
    return recipe.cook_events.filter((e) => e.user_id === recipe.user_id).length
  }
  return 0
}

function childCount(recipe) {
  if (typeof recipe.child_count === 'number') return recipe.child_count
  if (Array.isArray(recipe.children)) return recipe.children.length
  return 0
}

function totalCookCount(recipe) {
  if (typeof recipe.cook_count === 'number') return recipe.cook_count
  if (Array.isArray(recipe.cook_events)) return recipe.cook_events.length
  return 0
}

export function stateForRecipe(recipe) {
  const children = childCount(recipe)
  if (children > 0) {
    return recipe.has_grandchildren ? 'tree' : 'sapling'
  }
  return totalCookCount(recipe) > 0 ? 'sprout' : 'seed'
}

export function bloomForRecipe(recipe) {
  const cooks = totalCookCount(recipe)
  if (cooks === 0 || !recipe.last_cooked_at) return 'normal'
  const daysSince = (Date.now() - new Date(recipe.last_cooked_at).getTime()) / 86400000
  if (daysSince > 180) return 'dormant'
  if (cooks >= BLOOM_MANY_COOKS && daysSince <= BLOOM_RECENT_DAYS) return 'blooming'
  return 'normal'
}
