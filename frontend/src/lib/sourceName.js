// The recorded source's name = the leading segment of origin_attribution
// (stored "Name · Place · Year"), matching how Provenance.jsx parses it.
export function sourceNameOf(recipe) {
  const attr = recipe?.origin_attribution
  if (!attr) return null
  const name = attr.split('·')[0].trim()
  return name || null
}
