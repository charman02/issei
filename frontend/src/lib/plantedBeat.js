import { stageForRecipe } from './growth'

// Copy for the "planted!" beat that launches the growth loop (spec §3.2.4).
// Reflects the recipe's REAL computed stage — a recipe planted with an origin or
// a story is already a sprout, not a seed — and names the three nourishing acts
// (cook · add its story · pass it on). `sourceName` personalizes the story act on
// the ancestor path ("add Lola’s story"); on the self-authored path it is null
// and the act reads "add a memory".
export function plantedBeatCopy(recipe, sourceName) {
  const stage = stageForRecipe(recipe)
  const sprouted = stage !== 'seed'
  const storyAct = sourceName ? `add ${sourceName}’s story` : 'add a memory'
  return {
    stage,
    eyebrow: sprouted ? 'First sprout' : 'Seed sown',
    heading: `${recipe.name} is planted.`,
    body: `Cook it, ${storyAct}, or pass it on — and watch it grow.`,
  }
}
