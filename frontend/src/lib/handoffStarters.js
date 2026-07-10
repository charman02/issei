// One-tap note starters that carry the sender's intent (spec §4.2). The app never
// guesses intent from the recipient's identity — the note carries it. The ONE safe
// auto-touch: when passing back to the recipe's recorded source, pre-select the
// fill-in starter (near-certain there), still fully editable.
export const HANDOFF_STARTERS = [
  { key: 'fill', label: '✍️ Add the part I’m missing', note: 'Add the part I’m missing — the measures, the timing, the way you know it.' },
  { key: 'love', label: '💛 You’d love this', note: 'You’d love this — I wanted you to have it.' },
]

export function defaultStarterKey(sourceName) {
  return sourceName ? 'fill' : null
}
