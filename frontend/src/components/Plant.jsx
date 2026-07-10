// The seed→tree plant mark. Each stage is its OWN shape (not one tree at 4 sizes):
// seed = teardrop kernel · sprout = 2-leaf shoot · sapling = baby tree (trunk +
// stubs + small canopy) · tree = trunk + 3-puff canopy. Vitality (bare→blooming→
// fruiting) adds blossom/fruit accents on sapling & tree only. See visual-identity
// spec §2. Colors: herb-green foliage, bark-brown stem, pink blossom, terra/saffron fruit.
const BARK = '#7A5638'
const G1 = '#6F8A4D', G2 = '#8AA36A', G3 = '#7E9758'
const SEED_A = '#8B5E3C', SEED_B = '#6B4426'
const BLOSSOM = '#E7A0B8', FRUIT_T = '#BD5A2C', FRUIT_S = '#D99A2B'

function accents(stage, vitality) {
  if (stage !== 'sapling' && stage !== 'tree') return null
  if (vitality === 'bare') return null
  // positions differ a touch by stage; keep simple + legible
  const pts = stage === 'tree'
    ? [[-8, -13], [6, -10], [0, -20], [11, -15]]
    : [[-6, -13], [6, -14], [0, -18]]
  const fill = vitality === 'fruiting'
    ? (i) => (i % 2 ? FRUIT_S : FRUIT_T)
    : () => BLOSSOM
  const type = vitality === 'fruiting' ? 'fruit' : 'blossom'
  const r = vitality === 'fruiting' ? 2.6 : 2.4
  return pts.map(([x, y], i) => (
    <circle key={i} data-accent={type} cx={x} cy={y} r={r} fill={fill(i)} />
  ))
}

const STAGES = {
  seed: (
    <g>
      <path d="M0,10 C7,4 7,-6 0,-10 C-7,-6 -7,4 0,10Z" fill={SEED_A} />
      <path d="M0,10 C7,4 7,-6 0,-10Z" fill={SEED_B} />
    </g>
  ),
  sprout: (
    <g>
      <path d="M0,11 C0,4 0,0 0,-6" stroke={G1} strokeWidth="2.2" fill="none" strokeLinecap="round" />
      <path d="M0,-2 C-9,-4 -11,-13 -2,-11 C-1,-6 0,-4 0,-2Z" fill={G1} />
      <path d="M0,-4 C9,-6 11,-15 2,-12 C1,-7 0,-6 0,-4Z" fill={G2} />
    </g>
  ),
  sapling: (
    <g>
      <path d="M0,11 L0,-6" stroke={BARK} strokeWidth="2.6" strokeLinecap="round" />
      <path d="M0,0 L-4,-3 M0,-2 L4,-5" stroke={BARK} strokeWidth="1.8" strokeLinecap="round" />
      <circle cx="-4" cy="-10" r="6" fill={G1} />
      <circle cx="4" cy="-11" r="6" fill={G2} />
      <circle cx="0" cy="-15" r="6.5" fill={G3} />
    </g>
  ),
  tree: (
    <g>
      <path d="M0,12 L0,-4" stroke={BARK} strokeWidth="4.5" strokeLinecap="round" />
      <path d="M0,1 L-7,-4 M0,-2 L7,-6" stroke={BARK} strokeWidth="2.6" strokeLinecap="round" />
      <circle cx="-11" cy="-11" r="11" fill={G1} />
      <circle cx="11" cy="-12" r="11" fill={G2} />
      <circle cx="0" cy="-19" r="12" fill={G3} />
    </g>
  ),
}

export default function Plant({ stage = 'seed', vitality = 'bare', size = 28, className = '' }) {
  return (
    <svg
      data-stage={stage} data-vitality={vitality}
      width={size} height={size} viewBox="-24 -30 48 52"
      className={className} role="img" aria-label={`${vitality} ${stage}`}
    >
      {STAGES[stage] || STAGES.seed}
      {accents(stage, vitality)}
    </svg>
  )
}
