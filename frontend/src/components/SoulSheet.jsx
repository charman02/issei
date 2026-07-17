import { useEffect } from 'react'
import RecipeBody from './RecipeBody'
import './soulSheet.css'

// SoulSheet — the R2 living-plant recipe page's bottom sheet. Tapping a plant
// part opens this sheet over a scrim; each part shows a different facet of the
// recipe's *soul*:
//   blossom → her words (memories): ONE featured memory in a calm plum card,
//             then a quieter list of the OTHER memories (from step voice_notes);
//             the keeper's own memories get a plum emphasis (.byCreator).
//   fruit   → the real totals: cook_count cooked, shared_with_count passed on.
//   base    → origin: origin_attribution + place.
//   recipe  → <RecipeBody /> (the always-readable body).
// Markup + copy reproduced from the locked prototype
// .superpowers/r2-living-plant-v6.html (panelForBlossom/Fruit/Base + recipePanel).
//
// `panel` is an OBJECT: { kind, quoteIndex } with kind ∈
// {'blossom','fruit','base','recipe'}. Clicking the scrim OR pressing Escape
// calls onClose.

// Pull the keeper's display name from the recipe (origin_attribution may carry a
// "Name · Place" form — the name is the part before the separator).
function keeperName(recipe) {
  const full = recipe.author_full_name
  if (full) return full
  const attr = recipe.origin_attribution || ''
  return attr.split('·')[0].trim() || attr.trim()
}

// Split "Lola Remedios · Cebu" → { who: 'Lola Remedios', place: 'Cebu' }.
function originParts(recipe) {
  const attr = (recipe.origin_attribution || '').trim()
  const [who, ...rest] = attr.split('·').map((s) => s.trim())
  return { who: who || attr, place: rest.join(' · ') }
}

// The memories that make up the blossom panel: every step voice_note, in order,
// each attributed to the recipe keeper (their words, recorded in her kitchen).
function memories(recipe) {
  const keeper = keeperName(recipe)
  return [...(recipe.steps || [])]
    .sort((a, b) => (a.position || 0) - (b.position || 0))
    .filter((s) => s.voice_note && s.voice_note.trim())
    .map((s) => ({ text: s.voice_note.trim(), by: keeper, creator: true }))
}

// blossom → memories, de-crowded (v6 CHANGE v5): a featured headline memory in a
// plum card, then a quieter list of the *others* (featured filtered out).
function BlossomPanel({ recipe, quoteIndex = 0 }) {
  const keeper = keeperName(recipe)
  const all = memories(recipe)
  // The featured/headlining memory: recipe.story when present, else the memory
  // at quoteIndex among the available voice_notes.
  const featuredText =
    (recipe.story && recipe.story.trim()) ||
    (all[quoteIndex] && all[quoteIndex].text) ||
    (all[0] && all[0].text) ||
    ''
  // v6: exclude the featured quote from the list so it isn't shown twice.
  const rest = all.filter((m) => m.text !== featuredText)
  const count = all.length + (recipe.story && !all.some((m) => m.text === recipe.story.trim()) ? 1 : 0)

  return (
    <>
      <p className="sheetKicker person">a memory · her words</p>
      {featuredText && (
        <div className="featMem">
          <p className="quote">&ldquo;{featuredText}&rdquo;</p>
          <p className="quoteBy">
            &mdash; <b>{keeper}</b>, recorded in her kitchen
          </p>
        </div>
      )}
      {rest.length > 0 && (
        <>
          <p className="memCount">
            One blossom for <b>{count} memories</b> gathered around {recipe.name}:
          </p>
          <div className="memList">
            {rest.map((m, i) => {
              const isCreator = m.creator || m.by === keeper
              return (
                <div key={i} className={'m' + (isCreator ? ' byCreator' : '')}>
                  <div className="mq">&ldquo;{m.text}&rdquo;</div>
                  <div className="mby">
                    &mdash;{' '}
                    {isCreator ? (
                      <>
                        <b>{m.by}</b> <span className="keeperTag">· the keeper</span>
                      </>
                    ) : (
                      m.by
                    )}
                  </div>
                </div>
              )
            })}
          </div>
        </>
      )}
    </>
  )
}

// fruit → the real totals (cook_count cooked, shared_with_count passed on).
function FruitPanel({ recipe }) {
  const cooked = recipe.cook_count || 0
  const shared = recipe.shared_with_count || 0
  return (
    <>
      <p className="sheetKicker fruitk">the fruit · it lives on</p>
      <p className="sheetTitle">Cooked &amp; passed on</p>
      <div className="statBig">
        <div className="s">
          <div className="num">{cooked}&times;</div>
          <div className="lab">times cooked</div>
        </div>
        <div className="s">
          <div className="num">{shared}</div>
          <div className="lab">people it reached</div>
        </div>
      </div>
      <p className="sheetBody">
        The tree keeps a tasteful few fruit, but the count is real &mdash; every time
        it&rsquo;s cooked and handed on, it lives another day across the family.
      </p>
    </>
  )
}

// base → origin: who it comes from + place, in the verbatim v6 copy pattern.
function BasePanel({ recipe }) {
  const { who, place } = originParts(recipe)
  return (
    <>
      <p className="sheetKicker">roots · where it comes from</p>
      <p className="sheetTitle">from {who}</p>
      <p className="sheetBody">
        {place && <b>{place}. </b>}
        Learned at the stove, handed down by hand &mdash; the way she cooked.
      </p>
    </>
  )
}

// recipe → the always-readable body.
function RecipePanel({ recipe }) {
  return (
    <>
      <p className="sheetKicker">the body · always readable</p>
      <p className="sheetTitle">{recipe.name}</p>
      <RecipeBody recipe={recipe} />
    </>
  )
}

export default function SoulSheet({ open, panel, recipe, onClose }) {
  const kind = panel && panel.kind

  // Escape closes the sheet (only while open).
  useEffect(() => {
    if (!open) return undefined
    function onKeyDown(e) {
      if (e.key === 'Escape' && onClose) onClose()
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [open, onClose])

  return (
    <>
      <div
        className={'scrim' + (open ? ' open' : '')}
        onClick={onClose}
        aria-hidden="true"
      />
      <div
        className={'sheet' + (open ? ' open' : '')}
        role="dialog"
        aria-modal="true"
        aria-label="detail"
      >
        <div className="grab" />
        {open && recipe && (
          <div>
            {kind === 'blossom' && (
              <BlossomPanel recipe={recipe} quoteIndex={panel.quoteIndex} />
            )}
            {kind === 'fruit' && <FruitPanel recipe={recipe} />}
            {kind === 'base' && <BasePanel recipe={recipe} />}
            {kind === 'recipe' && <RecipePanel recipe={recipe} />}
          </div>
        )}
      </div>
    </>
  )
}
