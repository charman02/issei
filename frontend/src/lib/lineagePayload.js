// Pure builders for lineage request bodies / form seeds. Keeps components thin.

const clean = (v) => (v && String(v).trim() ? String(v).trim() : null)

export function buildOriginPayload({ name, place, year, memory }) {
  if (!name || !name.trim()) return null // self-authored root: no origin
  return { name: name.trim(), place: clean(place), year: clean(year), memory: clean(memory) }
}

export function buildRemixInitialValues(parent) {
  return {
    name: parent.name || '',
    servings: parent.servings ?? '',
    cuisine: parent.cuisine || '',
    source: parent.source || '',
    notes: parent.notes || '',   // pre-filled, editable
    story: '',                   // remixer writes their own
    ingredients: (parent.ingredients || []).map((i) => ({ ...i })),
    steps: (parent.steps || []).map((s) => ({ ...s })),
  }
}
