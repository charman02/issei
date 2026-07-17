// The tend → grow-or-bloom decision (R2 spec §4.2). Pure + standalone so it can
// be unit-tested without React. A stage that ADVANCES along the ladder plays the
// cascade growth; anything else (same stage, or a defensive non-advance) blooms.
export const STAGE_LADDER = ['seed', 'sprout', 'sapling', 'tree']

export function decideGrowth(prevStage, nextStage) {
  const from = STAGE_LADDER.indexOf(prevStage)
  const to = STAGE_LADDER.indexOf(nextStage)
  return to > from && from !== -1 ? 'grow' : 'bloom'
}
