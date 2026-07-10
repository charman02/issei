// Imprecise measures are TRUTH, not a defect — "a dash", "3 soup spoons",
// "until it smells right". We tag them (never normalize them) so the person's
// way of cooking is celebrated. See living-recipe spec §1.1 / §8.2.

export function isImprecise(ingredient) {
  const t = ingredient?.quantity_type
  return t === 'imprecise' || t === 'unmeasured'
}

export function impreciseLabel() {
  return 'their way'
}
