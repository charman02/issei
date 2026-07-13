// Growth stage + vitality for a recipe. The server computes these
// (recipe.growth_stage / recipe.growth_vitality) and is the source of truth;
// this mirrors the backend as a defensive fallback. See growth spec §2.

const SAPLING_SOUL = 3
const TREE_SOUL = 3
const HEAVY_USE = 5
const BLOOM = 2
const FRUIT = 12

function soulCount(r) {
  return [r.story, r.cover_photo_url, r.origin_attribution, r.notes].filter(
    Boolean,
  ).length
}

export function stageForRecipe(recipe) {
  if (recipe.growth_stage) return recipe.growth_stage
  const soul = soulCount(recipe)
  const cooks = recipe.cook_count || 0
  if (soul >= TREE_SOUL && (cooks >= 1 || soul >= 4)) return 'tree'
  if (soul >= SAPLING_SOUL || cooks >= HEAVY_USE) return 'sapling'
  if (soul >= 1 || cooks >= 1) return 'sprout'
  return 'seed'
}

export function vitalityForRecipe(recipe) {
  if (recipe.growth_vitality) return recipe.growth_vitality
  const activity = (recipe.cook_count || 0) + (recipe.shared_with_count || 0)
  if (activity >= FRUIT) return 'fruiting'
  if (activity >= BLOOM) return 'blooming'
  return 'bare'
}
