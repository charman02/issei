// Growth stage + vitality for a recipe. The server computes these
// (recipe.growth_stage / recipe.growth_vitality) and is the source of truth;
// this mirrors the backend as a defensive fallback. See growth spec §2.

const SAPLING_SOUL = 3
const TREE_SOUL = 3
const HEAVY_USE = 5
const BLOOM = 2
const FRUIT = 12

// True if any step carries the person's words (a non-empty voice_note).
function hasStepWords(r) {
  return (r.steps || []).some((s) => (s.voice_note || '').trim())
}

// The soul dimensions — what carries the PERSON (mirrors app/services/growth.py).
// Generic recipe `notes` and cooking are deliberately NOT soul. Each entry is a
// concrete, user-fillable act, so the grow-guidance UI can name the next gap.
export const SOUL_DIMENSIONS = [
  { key: 'story', label: 'a story', filled: (r) => Boolean(r.story) },
  {
    key: 'photo',
    label: 'a photo',
    filled: (r) => Boolean(r.cover_photo_url),
  },
  {
    key: 'origin',
    label: 'who it came from',
    filled: (r) => Boolean(r.origin_attribution),
  },
  { key: 'words', label: 'their words on a step', filled: hasStepWords },
]

export function soulDimensions(recipe) {
  return SOUL_DIMENSIONS.map((d) => ({
    key: d.key,
    label: d.label,
    filled: d.filled(recipe),
  }))
}

function soulCount(r) {
  return SOUL_DIMENSIONS.reduce((n, d) => n + (d.filled(r) ? 1 : 0), 0)
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

// ---- grow guidance (the "how do I grow this?" surface) ----
// The plant grows on soul BREADTH: sprout = any 1 dimension, sapling = 3 of 4
// (or heavy use), tree = 3 of 4 WITH real soul (use can't reach tree). This is
// surfaced two ways: a gentle one-line nudge (growNudge) + an opt-in panel
// (growPlan). Never a bar/% — "living, never a scoreboard".

// A soft, single "next nourishing act" line — names ONE real gap, warmly.
// Returns null when the plant is fully grown (a tree) — nothing to nudge.
export function growNudge(recipe) {
  const stage = stageForRecipe(recipe)
  if (stage === 'tree') return null
  const missing = soulDimensions(recipe).filter((d) => !d.filled)
  if (!missing.length) return null
  const next = missing[0].label
  if (stage === 'sapling') {
    // 3 of 4 soul reaches tree; a sapling is one or two acts away.
    return `Add ${next} — it’s almost a tree.`
  }
  if (stage === 'sprout') {
    return `Add ${next} to help it grow.`
  }
  // seed
  return `Add ${next} to bring it to life.`
}

// The opt-in "How your plant grows" plan: the path + which soul dimensions are
// filled vs. still open, in plain language (no numbers-as-score).
export function growPlan(recipe) {
  return {
    stage: stageForRecipe(recipe),
    dimensions: soulDimensions(recipe),
    // the plain rule, for the panel's explanatory line
    rule: 'A recipe grows as its person comes through — a tree needs its story told (any three of these).',
  }
}
