// Pure builders for lineage request bodies / form seeds. Keeps components thin.

const clean = (v) => (v && String(v).trim() ? String(v).trim() : null)

export function buildOriginPayload({ name, place, year, memory }) {
  if (!name || !name.trim()) return null // self-authored root: no origin
  return { name: name.trim(), place: clean(place), year: clean(year), memory: clean(memory) }
}

export function buildRemixInitialValues(parent) {
  // Merge direct-FK + sectioned ingredients into flat rows ordered by position,
  // mapping to RecipeForm's row shape ({ name, quantity }). Mirror EditRecipe:
  // the form binds a single free-text `quantity`, so surface `quantity_text`
  // verbatim — otherwise seeded quantities show blank and are wiped on submit.
  const flatIngredients = [
    ...(parent.ingredients || []),
    ...(parent.ingredient_sections || []).flatMap((s) => s.ingredients || []),
  ]
    .slice()
    .sort((a, b) => a.position - b.position)
    .map((ing) => ({ name: ing.name, quantity: ing.quantity_text || '' }))

  const flatSteps = [...(parent.steps || [])]
    .sort((a, b) => a.position - b.position)
    .map((s) => ({ content: s.content, voice_note: s.voice_note }))

  return {
    name: parent.name || '',
    servings: parent.servings ?? '',
    cuisine: parent.cuisine || '',
    source: parent.source || '',
    notes: parent.notes || '',   // pre-filled, editable
    story: '',                   // remixer writes their own
    ingredients: flatIngredients,
    steps: flatSteps,
  }
}
