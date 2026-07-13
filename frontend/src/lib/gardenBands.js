import { stageForRecipe } from './growth'

// The Kitchen-as-garden grouping (spec §6). Recipe-plants sort into three growth
// bands so a bare seed sitting above a lush tree creates the pull to "tend the ones
// that need love." Order is fixed (tending → growing → thriving); empty bands are
// omitted so the garden never shows a hollow header.
const BANDS = [
  {
    key: 'tending',
    title: 'Needs tending',
    blurb: 'Young plants — a memory, a cook, or a photo will help them grow.',
    stages: ['seed', 'sprout'],
  },
  {
    key: 'growing',
    title: 'Growing',
    blurb: 'Taking shape. Keep feeding them.',
    stages: ['sapling'],
  },
  {
    key: 'thriving',
    title: 'Thriving',
    blurb: 'Full heirlooms — richly told, cooked, and passed on.',
    stages: ['tree'],
  },
]

export function gardenBands(recipes) {
  return BANDS.map(({ key, title, blurb, stages }) => ({
    key,
    title,
    blurb,
    recipes: recipes.filter((r) => stages.includes(stageForRecipe(r))),
  })).filter((band) => band.recipes.length > 0)
}
