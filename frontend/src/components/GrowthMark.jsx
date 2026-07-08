// The seed→tree growth mark. Provisional botanical SVGs (final art = task #10).
// A herb-green shoot distinguishes the seed from a coffee bean.
const TERRA = '#BD5A2C'
const HERB = '#6F8A4D'
const INK = '#3A2A1C'

const STATES = {
  seed: (
    <>
      <ellipse cx="12" cy="14" rx="5" ry="7" fill={TERRA} />
      <path d="M12 7c-1 3 0 5 0 5s1-2 0-5z" fill={HERB} />
    </>
  ),
  sprout: (
    <>
      <path d="M12 21v-8" stroke={INK} strokeWidth="1.5" strokeLinecap="round" />
      <path d="M12 15c-3-.5-5-2.5-5-5.5 3 .5 5 2.5 5 5.5z" fill={HERB} />
      <path d="M12 13c2.4-.4 4-2 4-4.4-2.4.4-4 2-4 4.4z" fill={HERB} opacity=".75" />
    </>
  ),
  sapling: (
    <>
      <path d="M12 21v-9" stroke={INK} strokeWidth="1.6" strokeLinecap="round" />
      <path d="M12 14l-4-3M12 12l4-3" stroke={INK} strokeWidth="1.3" strokeLinecap="round" />
      <circle cx="8" cy="11" r="2.4" fill={HERB} />
      <circle cx="16" cy="9" r="2.4" fill={HERB} />
      <circle cx="12" cy="7" r="2.6" fill={HERB} />
    </>
  ),
  tree: (
    <>
      <path d="M12 21v-7" stroke={INK} strokeWidth="1.8" strokeLinecap="round" />
      <path d="M12 16l-4-3M12 15l4-3M12 12l-3-3M12 11l3-2" stroke={INK} strokeWidth="1.2" strokeLinecap="round" />
      <circle cx="12" cy="7" r="5.5" fill={HERB} />
      <circle cx="7" cy="10" r="3" fill={HERB} />
      <circle cx="17" cy="10" r="3" fill={HERB} />
    </>
  ),
}

export default function GrowthMark({ state = 'seed', bloom = 'normal', size = 20, className = '' }) {
  const key = STATES[state] ? state : 'seed'
  const opacity = bloom === 'dormant' ? 0.5 : 1
  return (
    <svg
      viewBox="0 0 24 24" width={size} height={size} className={className}
      data-growth-state={key} style={{ opacity }} role="img"
    >
      <title>{`${key} — recipe growth state`}</title>
      {STATES[key]}
    </svg>
  )
}
