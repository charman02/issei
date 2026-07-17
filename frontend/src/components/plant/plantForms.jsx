// The four distinct stage forms + shared defs + soul accents for LivingPlant.
// SVG geometry copied verbatim from .superpowers/r2-living-plant-v6.html (the
// locked R2 prototype) and converted HTML→JSX. The cascade part-tags
// (gTrunk/gBranchL/gBranchR/gCanopy, gStem/gLeafL/gLeafR, gMound/gKernel/gTip)
// are load-bearing — plant.css animates them by these class names.
export const PLANT_VIEWBOX = '0 0 302 336'

export function PlantDefs() {
  return (
    <defs>
      <linearGradient id="potG" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0" stopColor="#D98B4F" />
        <stop offset="1" stopColor="#A85E2E" />
      </linearGradient>
      <linearGradient id="potRimG" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0" stopColor="#E5A868" />
        <stop offset="1" stopColor="#C9773E" />
      </linearGradient>
      <linearGradient id="soilG" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0" stopColor="#5B4632" />
        <stop offset="1" stopColor="#3E301F" />
      </linearGradient>
      <linearGradient id="trunkG" x1="0" y1="0" x2="1" y2="0">
        <stop offset="0" stopColor="#8A6A45" />
        <stop offset="45%" stopColor="#6E5236" />
        <stop offset="100%" stopColor="#513A24" />
      </linearGradient>
      <linearGradient id="stemG" x1="0" y1="0" x2="1" y2="0">
        <stop offset="0" stopColor="#7FA05A" />
        <stop offset="100%" stopColor="#557038" />
      </linearGradient>
      <linearGradient id="leafG" x1="0" y1="0" x2="1" y2="1">
        <stop offset="0" stopColor="#8DAD66" />
        <stop offset="100%" stopColor="#5C7A3F" />
      </linearGradient>
      <radialGradient id="canDeep" cx="42%" cy="34%" r="72%">
        <stop offset="0" stopColor="#4E6A34" />
        <stop offset="100%" stopColor="#3B5228" />
      </radialGradient>
      <radialGradient id="canMid" cx="40%" cy="30%" r="74%">
        <stop offset="0" stopColor="#6B8C48" />
        <stop offset="100%" stopColor="#557038" />
      </radialGradient>
      <radialGradient id="canBright" cx="36%" cy="26%" r="78%">
        <stop offset="0" stopColor="#8DAD66" />
        <stop offset="100%" stopColor="#6F9150" />
      </radialGradient>
      <radialGradient id="fruitG" cx="34%" cy="30%" r="82%">
        <stop offset="0" stopColor="#F4BC64" />
        <stop offset="52%" stopColor="#E8973A" />
        <stop offset="100%" stopColor="#C46E1C" />
      </radialGradient>
      <radialGradient id="seedG" cx="38%" cy="30%" r="80%">
        <stop offset="0" stopColor="#9A7A50" />
        <stop offset="100%" stopColor="#6E5236" />
      </radialGradient>
      {/* CHANGE 4 — a soft one-sided body shade for a cohesive pot, no hard split */}
      <linearGradient id="potShadeG" x1="0" y1="0" x2="1" y2="0">
        <stop offset="0" stopColor="#7C3F1C" stopOpacity="0" />
        <stop offset="100%" stopColor="#7C3F1C" stopOpacity=".42" />
      </linearGradient>
      <filter id="softGlow" x="-80%" y="-80%" width="260%" height="260%">
        <feGaussianBlur stdDeviation="4" result="b" />
        <feMerge>
          <feMergeNode in="b" />
          <feMergeNode in="SourceGraphic" />
        </feMerge>
      </filter>
      <radialGradient id="groundShadow" cx="50%" cy="50%" r="50%">
        <stop offset="0" stopColor="rgba(46,58,36,.28)" />
        <stop offset="100%" stopColor="rgba(46,58,36,0)" />
      </radialGradient>
      {/* clip: guarantees NOTHING renders above the plant area / into the header.
          A hard safety net so no fruit or leaf can ever escape to a corner. */}
      <clipPath id="stageClip">
        <rect x="0" y="0" width="302" height="336" />
      </clipPath>
    </defs>
  )
}

export const FORMS = {
  // =========================================================
  // FORM 1 — SEED: a kernel just planted, barely breaking ground.
  // =========================================================
  seed: (
    <g className="form" id="formSeed">
      {/* soil mound over the seed */}
      <path className="gPart gMound" d="M132 264 Q151 254 170 264 Z" fill="#4A3A26" />
      {/* the seed itself, half-buried */}
      <g className="gPart gKernel">
        <ellipse cx="151" cy="260" rx="10" ry="7" fill="url(#seedG)" />
        <path d="M144 259 Q151 255 158 259" stroke="#3E301F" strokeWidth="1.3" fill="none" strokeLinecap="round" />
      </g>
      {/* the very first hairline of green just cracking the surface */}
      <g className="gPart gTip">
        <path d="M151 256 q1 -6 3 -9" stroke="#6F9150" strokeWidth="2" fill="none" strokeLinecap="round" />
        <path d="M154 247 q3 -1 5 -3" stroke="#7FA05A" strokeWidth="2" fill="none" strokeLinecap="round" />
      </g>
    </g>
  ),
  // =========================================================
  // FORM 2 — SPROUT: a slim stem with two young leaves. First life.
  // =========================================================
  sprout: (
    <g className="form" id="formSprout">
      {/* slim curving stem rising from the soil */}
      <path className="gPart gStem" d="M149 264 C150 244 149 226 151 210 L153 210 C155 226 152 244 153 264 Z" fill="url(#stemG)" />
      {/* left young leaf */}
      <g className="gPart gLeafL">
        <path d="M150 224 C136 220 126 210 126 198 C138 200 149 210 152 222 Z" fill="url(#leafG)" />
        <path d="M150 222 C142 218 136 212 133 205" stroke="#415A2C" strokeWidth="1.2" fill="none" opacity=".4" strokeLinecap="round" />
      </g>
      {/* right young leaf */}
      <g className="gPart gLeafR">
        <path d="M152 216 C166 210 176 200 177 188 C165 190 154 202 150 214 Z" fill="url(#leafG)" />
        <path d="M152 214 C160 208 167 202 170 195" stroke="#415A2C" strokeWidth="1.2" fill="none" opacity=".4" strokeLinecap="round" />
      </g>
    </g>
  ),
  // =========================================================
  // FORM 3 — SAPLING: a small young tree. A FEW soul accents.
  // Canopy centered near cy~158, so all accents sit within it.
  // =========================================================
  sapling: (
    <g className="form" id="formSapling">
      {/* thin young trunk */}
      <path className="gPart gTrunk" d="M150 265 C147 246 147 220 150 196 C151 220 153 246 153 265 Z" fill="url(#trunkG)" />
      {/* two slim branches */}
      <path className="gPart gBranchL" d="M150 214 C140 208 132 202 126 194 C134 202 143 208 151 216 Z" fill="url(#trunkG)" />
      <path className="gPart gBranchR" d="M152 208 C162 202 170 196 176 188 C168 196 159 202 151 210 Z" fill="url(#trunkG)" />
      {/* modest open canopy: fewer, smaller lobes than the tree */}
      <g className="gPart gCanopy">
        <ellipse cx="151" cy="164" rx="46" ry="40" fill="url(#canDeep)" />
        <ellipse cx="124" cy="176" rx="22" ry="19" fill="url(#canDeep)" />
        <ellipse cx="178" cy="176" rx="22" ry="19" fill="url(#canDeep)" />
        <ellipse cx="151" cy="160" rx="40" ry="34" fill="url(#canMid)" />
        <ellipse cx="130" cy="172" rx="20" ry="17" fill="url(#canMid)" />
        <ellipse cx="172" cy="172" rx="20" ry="17" fill="url(#canMid)" />
        <ellipse cx="140" cy="146" rx="24" ry="20" fill="url(#canBright)" />
        <ellipse cx="164" cy="150" rx="20" ry="17" fill="url(#canBright)" />
        <path d="M132 156 q14 5 26 3" stroke="#3B5228" strokeWidth="1.3" fill="none" opacity=".32" strokeLinecap="round" />
        <path d="M148 168 q14 -3 26 -1" stroke="#3B5228" strokeWidth="1.3" fill="none" opacity=".3" strokeLinecap="round" />
      </g>
    </g>
  ),
  // =========================================================
  // FORM 4 — TREE (flourishing): full solid lush canopy.
  // Canopy body spans roughly cx 88..214, cy 96..204.
  // =========================================================
  tree: (
    <g className="form" id="formTree">
      {/* tall tapered solid trunk */}
      <path
        className="gPart gTrunk"
        d="M151 265
                       C146 244 145 226 149 202
                       C150 190 149 178 150 168
                       C151 178 152 190 153 202
                       C157 226 156 246 156 265 Z"
        fill="url(#trunkG)"
      />
      <path className="gPart gBranchL" d="M150 196 C138 190 128 184 120 172 C130 182 141 190 151 200 Z" fill="url(#trunkG)" />
      <path className="gPart gBranchR" d="M152 204 C164 198 176 192 184 182 C174 194 162 202 151 208 Z" fill="url(#trunkG)" />

      <g className="gPart gCanopy">
        {/* deepest back mass (shadow side) */}
        <ellipse cx="151" cy="150" rx="72" ry="60" fill="url(#canDeep)" />
        <ellipse cx="104" cy="168" rx="34" ry="30" fill="url(#canDeep)" />
        <ellipse cx="198" cy="168" rx="34" ry="30" fill="url(#canDeep)" />
        {/* mid tone main body */}
        <ellipse cx="151" cy="146" rx="62" ry="52" fill="url(#canMid)" />
        <ellipse cx="112" cy="160" rx="30" ry="26" fill="url(#canMid)" />
        <ellipse cx="190" cy="160" rx="30" ry="26" fill="url(#canMid)" />
        <ellipse cx="151" cy="176" rx="46" ry="30" fill="url(#canMid)" />
        {/* bright highlight lobes (light side, upper-left) */}
        <ellipse cx="128" cy="126" rx="34" ry="28" fill="url(#canBright)" />
        <ellipse cx="168" cy="130" rx="30" ry="25" fill="url(#canBright)" />
        <ellipse cx="150" cy="150" rx="34" ry="26" fill="url(#canBright)" />
        <ellipse cx="132" cy="106" rx="20" ry="17" fill="url(#canBright)" />
        <ellipse cx="172" cy="110" rx="18" ry="15" fill="url(#canMid)" />
        {/* vein hints */}
        <path d="M118 132 q16 6 30 4" stroke="#3B5228" strokeWidth="1.4" fill="none" opacity=".35" strokeLinecap="round" />
        <path d="M150 150 q18 -4 32 -2" stroke="#3B5228" strokeWidth="1.4" fill="none" opacity=".3" strokeLinecap="round" />
        <path d="M120 168 q14 8 28 8" stroke="#3B5228" strokeWidth="1.4" fill="none" opacity=".3" strokeLinecap="round" />
        {/* solid leaf tips for organic edge (all inside frame) */}
        <path d="M83 150 C74 142 72 132 78 126 C86 132 88 142 88 152 Z" fill="url(#canMid)" />
        <path d="M219 150 C228 142 230 132 224 126 C216 132 214 142 214 152 Z" fill="url(#canMid)" />
        <path d="M151 92 C146 82 148 72 156 70 C160 78 158 88 154 96 Z" fill="url(#canBright)" />
      </g>{/* /.gCanopy */}
    </g>
  ),
}

// =========================================================
// SOUL LAYER — blossoms (words) + fruit (cooked/passed on).
// The sapling (.soulSapling) + tree (.soulTree) accent <g> nodes copied
// verbatim from v6's #soulLayer. Each carries data-part/data-quote/role/
// tabIndex/aria-label and its position in style={{ '--tx':…, '--ty':… }}.
// =========================================================
export const SOUL_ACCENTS = (
  <>
    {/* ---- SAPLING SOUL: a few, intermixed inside the modest canopy ---- */}
    {/* blossom high-left */}
    <g
      className="blossom tapPart soulSapling d1"
      data-part="blossom"
      data-quote="0"
      role="button"
      tabIndex={0}
      aria-label="A memory in her words"
      style={{ '--tx': '134px', '--ty': '146px' }}
    >
      <g className="petals">
        <ellipse cx="0" cy="-6.5" rx="3.7" ry="7" fill="var(--blossom)" />
        <ellipse cx="6.2" cy="-2" rx="3.7" ry="7" fill="var(--blossom)" transform="rotate(72 6.2 -2)" />
        <ellipse cx="3.8" cy="5.5" rx="3.7" ry="7" fill="var(--blossom)" transform="rotate(144 3.8 5.5)" />
        <ellipse cx="-3.8" cy="5.5" rx="3.7" ry="7" fill="var(--blossom)" transform="rotate(216 -3.8 5.5)" />
        <ellipse cx="-6.2" cy="-2" rx="3.7" ry="7" fill="var(--blossom)" transform="rotate(288 -6.2 -2)" />
      </g>
      <circle r="2.9" fill="var(--saffron)" />
    </g>
    {/* fruit high-right (intermixed: fruit up here, not only at the bottom) */}
    <g
      className="fruit tapPart soulSapling d2"
      data-part="fruit"
      role="button"
      tabIndex={0}
      aria-label="Times cooked and passed on"
      style={{ '--tx': '170px', '--ty': '150px' }}
    >
      <circle r="7.5" fill="url(#fruitG)" />
      <ellipse cx="-2.2" cy="-2.6" rx="2.2" ry="1.4" fill="#FFE6BC" opacity=".85" />
      <path d="M0 -7.5 q1.4 -3 3.6 -3" stroke="#3B5228" strokeWidth="1.3" fill="none" strokeLinecap="round" />
    </g>
    {/* blossom low-center */}
    <g
      className="blossom tapPart soulSapling d3"
      data-part="blossom"
      data-quote="1"
      role="button"
      tabIndex={0}
      aria-label="A memory in her words"
      style={{ '--tx': '150px', '--ty': '174px' }}
    >
      <g className="petals">
        <ellipse cx="0" cy="-6.5" rx="3.7" ry="7" fill="var(--blossom)" />
        <ellipse cx="6.2" cy="-2" rx="3.7" ry="7" fill="var(--blossom)" transform="rotate(72 6.2 -2)" />
        <ellipse cx="3.8" cy="5.5" rx="3.7" ry="7" fill="var(--blossom)" transform="rotate(144 3.8 5.5)" />
        <ellipse cx="-3.8" cy="5.5" rx="3.7" ry="7" fill="var(--blossom)" transform="rotate(216 -3.8 5.5)" />
        <ellipse cx="-6.2" cy="-2" rx="3.7" ry="7" fill="var(--blossom)" transform="rotate(288 -6.2 -2)" />
      </g>
      <circle r="2.9" fill="var(--saffron)" />
    </g>

    {/* ---- TREE SOUL: fixed lush set, INTERMIXED across the canopy ---- */}
    {/* blossom upper-left */}
    <g
      className="blossom tapPart soulTree d1"
      data-part="blossom"
      data-quote="0"
      role="button"
      tabIndex={0}
      aria-label="A memory in her words"
      style={{ '--tx': '118px', '--ty': '120px' }}
    >
      <g className="petals">
        <ellipse cx="0" cy="-7" rx="4" ry="7.5" fill="var(--blossom)" />
        <ellipse cx="6.7" cy="-2.2" rx="4" ry="7.5" fill="var(--blossom)" transform="rotate(72 6.7 -2.2)" />
        <ellipse cx="4.1" cy="6" rx="4" ry="7.5" fill="var(--blossom)" transform="rotate(144 4.1 6)" />
        <ellipse cx="-4.1" cy="6" rx="4" ry="7.5" fill="var(--blossom)" transform="rotate(216 -4.1 6)" />
        <ellipse cx="-6.7" cy="-2.2" rx="4" ry="7.5" fill="var(--blossom)" transform="rotate(288 -6.7 -2.2)" />
      </g>
      <circle r="3.1" fill="var(--saffron)" />
    </g>
    {/* fruit upper-right (HIGH — intermixed, not clustered at bottom) */}
    <g
      className="fruit tapPart soulTree d2"
      data-part="fruit"
      role="button"
      tabIndex={0}
      aria-label="Times cooked and passed on"
      style={{ '--tx': '180px', '--ty': '128px' }}
    >
      <circle r="9" fill="url(#fruitG)" />
      <ellipse cx="-2.8" cy="-3.2" rx="2.6" ry="1.6" fill="#FFE6BC" opacity=".85" />
      <path d="M0 -9 q-1.5 -3 -4 -3" stroke="#3B5228" strokeWidth="1.4" fill="none" strokeLinecap="round" />
    </g>
    {/* blossom top-center */}
    <g
      className="blossom tapPart soulTree d3"
      data-part="blossom"
      data-quote="1"
      role="button"
      tabIndex={0}
      aria-label="A memory in her words"
      style={{ '--tx': '152px', '--ty': '108px' }}
    >
      <g className="petals">
        <ellipse cx="0" cy="-7" rx="4" ry="7.5" fill="var(--blossom)" />
        <ellipse cx="6.7" cy="-2.2" rx="4" ry="7.5" fill="var(--blossom)" transform="rotate(72 6.7 -2.2)" />
        <ellipse cx="4.1" cy="6" rx="4" ry="7.5" fill="var(--blossom)" transform="rotate(144 4.1 6)" />
        <ellipse cx="-4.1" cy="6" rx="4" ry="7.5" fill="var(--blossom)" transform="rotate(216 -4.1 6)" />
        <ellipse cx="-6.7" cy="-2.2" rx="4" ry="7.5" fill="var(--blossom)" transform="rotate(288 -6.7 -2.2)" />
      </g>
      <circle r="3.1" fill="var(--saffron)" />
    </g>
    {/* fruit lower-left */}
    <g
      className="fruit tapPart soulTree d4"
      data-part="fruit"
      role="button"
      tabIndex={0}
      aria-label="Times cooked and passed on"
      style={{ '--tx': '120px', '--ty': '176px' }}
    >
      <circle r="8.5" fill="url(#fruitG)" />
      <ellipse cx="-2.6" cy="-3" rx="2.4" ry="1.5" fill="#FFE6BC" opacity=".85" />
      <path d="M0 -8.5 q1.5 -3 4 -3" stroke="#3B5228" strokeWidth="1.4" fill="none" strokeLinecap="round" />
    </g>
    {/* blossom lower-right (blossom LOW — intermixed) */}
    <g
      className="blossom tapPart soulTree d5"
      data-part="blossom"
      data-quote="2"
      role="button"
      tabIndex={0}
      aria-label="A memory in her words"
      style={{ '--tx': '184px', '--ty': '172px' }}
    >
      <g className="petals">
        <ellipse cx="0" cy="-7" rx="4" ry="7.5" fill="var(--blossom)" />
        <ellipse cx="6.7" cy="-2.2" rx="4" ry="7.5" fill="var(--blossom)" transform="rotate(72 6.7 -2.2)" />
        <ellipse cx="4.1" cy="6" rx="4" ry="7.5" fill="var(--blossom)" transform="rotate(144 4.1 6)" />
        <ellipse cx="-4.1" cy="6" rx="4" ry="7.5" fill="var(--blossom)" transform="rotate(216 -4.1 6)" />
        <ellipse cx="-6.7" cy="-2.2" rx="4" ry="7.5" fill="var(--blossom)" transform="rotate(288 -6.7 -2.2)" />
      </g>
      <circle r="3.1" fill="var(--saffron)" />
    </g>
    {/* fruit low-center */}
    <g
      className="fruit tapPart soulTree d6"
      data-part="fruit"
      role="button"
      tabIndex={0}
      aria-label="Times cooked and passed on"
      style={{ '--tx': '150px', '--ty': '190px' }}
    >
      <circle r="7.5" fill="url(#fruitG)" />
      <ellipse cx="-2.2" cy="-2.6" rx="2.1" ry="1.3" fill="#FFE6BC" opacity=".85" />
    </g>
  </>
)
