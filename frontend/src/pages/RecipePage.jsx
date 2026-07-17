import { useState, useEffect, useRef } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import client from '../api/client'
import { cookRecipe } from '../api/lineage'
import LivingPlant from '../components/LivingPlant'
import SoulSheet from '../components/SoulSheet'
import HandoffInvite from '../components/HandoffInvite'
import VisibilityControl from '../components/VisibilityControl'
import Icon from '../components/Icon'
import { decideGrowth } from '../hooks/useGrowthAnimation'
import { stageForRecipe, vitalityForRecipe } from '../lib/growth'
import { sourceNameOf } from '../lib/sourceName'

// RecipePage — the R2 living-plant recipe hero. The recipe is a *plant*: it
// loads the recipe, renders the plant hero (LivingPlant) + centered header +
// stage caption + the true soul counts, and mounts the SoulSheet that opens when
// a plant part is tapped or "View recipe" is pressed. Tending ("Add a memory")
// re-fetches the recipe and plays the grow-or-bloom beat. Layout, copy, and the
// CAPTIONS/soul-row treatment are reproduced from the locked prototype
// .superpowers/r2-living-plant-v6.html.

// Stage caption per stage (v6 CAPTIONS). The bold lead word is the growth green.
const CAPTIONS = {
  seed: { lead: 'Planted', rest: 'just breaking ground' },
  sprout: { lead: 'Sprouting', rest: 'first green, its own shape' },
  sapling: { lead: 'Rooting', rest: 'a young tree, memory beginning' },
  tree: { lead: 'Flourishing', rest: 'full of memory and fruit' },
}

// The soul row rests at 0 on seed/sprout (no accents present yet), and shows the
// true numbers once the plant has soul (sapling/tree). Mirrors v6's updateSoulRow.
const STAGES_WITH_SOUL = new Set(['sapling', 'tree'])

// Split "Lola Remedios · Cebu" → the trailing place segment (after the name).
function placeOf(recipe) {
  const attr = (recipe.origin_attribution || '').trim()
  if (!attr) return null
  const parts = attr.split('·').map((s) => s.trim())
  return parts.slice(1).join(' · ') || null
}

// A small blossom glyph for the "memories" stat (v6 soul-row icon).
function BlossomStat() {
  return (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden="true" className="w-[15px] h-[15px] flex-shrink-0">
      <g fill="#D99A2B">
        <ellipse cx="12" cy="6" rx="2.4" ry="4" />
        <ellipse cx="17.3" cy="9.7" rx="2.4" ry="4" transform="rotate(72 17.3 9.7)" />
        <ellipse cx="15.2" cy="16" rx="2.4" ry="4" transform="rotate(144 15.2 16)" />
        <ellipse cx="8.8" cy="16" rx="2.4" ry="4" transform="rotate(216 8.8 16)" />
        <ellipse cx="6.7" cy="9.7" rx="2.4" ry="4" transform="rotate(288 6.7 9.7)" />
      </g>
      <circle cx="12" cy="12" r="2" fill="#FCF8EE" />
    </svg>
  )
}

// A fruit glyph for the "cooked" stat.
function FruitStat() {
  return (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden="true" className="w-[15px] h-[15px] flex-shrink-0">
      <circle cx="12" cy="12" r="8" fill="#E8973A" />
      <ellipse cx="9.4" cy="9.2" rx="2.4" ry="1.5" fill="#FFE6BC" />
      <path d="M12 3.6q1.4-2 3.6-2.2" stroke="#5C7A3F" strokeWidth="1.6" fill="none" strokeLinecap="round" />
    </svg>
  )
}

// A heart glyph for the "passed on" stat (plum — the heritage accent).
function ShareStat() {
  return (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden="true" className="w-[15px] h-[15px] flex-shrink-0">
      <path
        d="M12 20s-7-4.6-7-9.4A3.6 3.6 0 0 1 12 8a3.6 3.6 0 0 1 7 2.6C19 15.4 12 20 12 20Z"
        fill="#8A3D5A"
      />
    </svg>
  )
}

function SoulStat({ icon, n, label }) {
  return (
    <span className="inline-flex items-center gap-[7px] px-[15px] [&+&]:border-l [&+&]:border-line">
      {icon}
      <span className="inline-flex items-baseline gap-1">
        <span className="font-serif font-bold text-[19px] leading-none text-ink">{n}</span>
        <span className="text-[11.5px] font-semibold tracking-[0.4px] lowercase text-ink-soft">
          {label}
        </span>
      </span>
    </span>
  )
}

export default function RecipePage() {
  const { id } = useParams()
  const navigate = useNavigate()
  const [recipe, setRecipe] = useState(null)
  const [error, setError] = useState('')
  const [sheet, setSheet] = useState({ open: false, panel: null })
  const [showHandoff, setShowHandoff] = useState(false)
  const [tending, setTending] = useState(false)
  // A pending grow/bloom beat, played AFTER the fresh recipe (and its new stage
  // prop) has rendered — LivingPlant.grow() reads stage from its closure, so the
  // new stage must be on the DOM before we animate. See the effect below.
  const [pendingAnim, setPendingAnim] = useState(null)
  const growRef = useRef(null)

  const reduce =
    typeof window !== 'undefined' &&
    window.matchMedia &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches

  const currentUser = JSON.parse(localStorage.getItem('issei_user') || '{}')
  const isOwner = recipe && currentUser.id === recipe.user_id

  useEffect(() => {
    client
      .get(`/recipes/${id}`)
      .then((res) => setRecipe(res.data))
      .catch(() => setError('Recipe not found'))
  }, [id])

  // Play the queued grow/bloom beat once the new stage prop has rendered.
  useEffect(() => {
    if (!pendingAnim) return
    const handle = growRef.current
    if (handle) {
      if (pendingAnim.beat === 'grow') handle.grow(pendingAnim.stage)
      else handle.bloom()
    }
    setPendingAnim(null)
  }, [pendingAnim])

  function openSheet(kind, quoteIndex = 0) {
    setSheet({ open: true, panel: { kind, quoteIndex } })
  }
  // LivingPlant fires (part, quoteIndex); map the tapped part → sheet panel.
  function onPartTap(part, quoteIndex) {
    openSheet(part, quoteIndex)
  }
  function closeSheet() {
    setSheet((s) => ({ ...s, open: false }))
  }

  // TEND ("Add a memory"): capture the stage now, perform the concrete tend act
  // (cookRecipe for v1), re-fetch, then queue the grow-or-bloom beat. Resilient:
  // a failed tend leaves the UI as-is (matches the old handleCook).
  async function tend() {
    if (tending || !recipe) return
    setTending(true)
    const prevStage = stageForRecipe(recipe)
    try {
      await cookRecipe(id, {})
    } catch {
      /* non-fatal; carry on to re-fetch so counts still reconcile */
    }
    try {
      const { data: fresh } = await client.get(`/recipes/${id}`)
      const nextStage = stageForRecipe(fresh)
      setRecipe(fresh) // new stage prop first, THEN animate (in the effect)
      setPendingAnim({ beat: decideGrowth(prevStage, nextStage), stage: nextStage })
    } catch {
      /* non-fatal; leave UI as-is */
    } finally {
      setTending(false)
    }
  }

  if (error) {
    return (
      <div className="p-6 text-center">
        <p className="text-red-600 mb-4">{error}</p>
        <button
          onClick={() => navigate('/my-recipes')}
          className="text-terra text-sm"
        >
          Back to your garden
        </button>
      </div>
    )
  }

  if (!recipe) {
    return <div className="p-6 text-center text-ink-soft">Loading…</div>
  }

  const stage = stageForRecipe(recipe)
  const vitality = vitalityForRecipe(recipe)
  const hasSoul = STAGES_WITH_SOUL.has(stage)
  const caption = CAPTIONS[stage] || CAPTIONS.seed
  const source = sourceNameOf(recipe)
  const place = placeOf(recipe)

  // True counts, resting at 0 until the plant has soul (matches v6). Memories are
  // derived from the recipe's soul — every non-empty step voice_note, plus the
  // story when present (and not already one of those voice_notes). This mirrors
  // SoulSheet's blossom-panel count exactly so the hero row and sheet agree; there
  // is no memory_count field, and cook_count is a different quantity (the "cooked"
  // stat), so it is deliberately NOT a fallback here.
  const story = recipe.story && recipe.story.trim()
  const voiceNotes = (recipe.steps || [])
    .filter((s) => s.voice_note && s.voice_note.trim())
    .map((s) => s.voice_note.trim())
  const memories = hasSoul
    ? voiceNotes.length + (story && !voiceNotes.includes(story) ? 1 : 0)
    : 0
  const cooked = hasSoul ? recipe.cook_count ?? 0 : 0
  const shared = hasSoul ? recipe.shared_with_count ?? 0 : 0

  return (
    <div className="relative min-h-screen">
      {/* HEADER — circular back button, then a centered title + metadata row. */}
      <header className="px-6 pt-4 pb-1.5 relative z-[3]">
        <div className="flex items-center mb-2.5">
          <button
            onClick={() => navigate(-1)}
            aria-label="Back"
            className="inline-flex items-center justify-center w-10 h-10 rounded-full border border-line bg-card/70 text-terra shadow-[0_1px_0_rgba(255,255,255,.55)_inset,0_4px_12px_-8px_rgba(46,58,36,.4)] active:scale-95 transition"
          >
            <Icon name="back" className="w-5 h-5" />
          </button>
        </div>

        <div className="text-center">
          <h1 className="font-serif font-semibold text-[34px] leading-[1.02] tracking-[0.2px] text-ink m-0">
            {recipe.name}
          </h1>
          {(source || place || recipe.cuisine) && (
            <div className="flex items-center justify-center gap-[9px] flex-wrap mt-2">
              {source && (
                <span className="inline-flex items-center gap-[5px] font-sans text-[12.5px] font-bold tracking-[0.2px] text-plum">
                  <svg viewBox="0 0 24 24" fill="none" aria-hidden="true" className="w-[13px] h-[13px]">
                    <path
                      d="M12 20s-7-4.6-7-9.4A3.6 3.6 0 0 1 12 8a3.6 3.6 0 0 1 7 2.6C19 15.4 12 20 12 20Z"
                      fill="#8A3D5A"
                    />
                  </svg>
                  from {source}
                </span>
              )}
              {source && (place || recipe.cuisine) && (
                <span className="w-px h-[13px] bg-line inline-block" />
              )}
              {(place || recipe.cuisine) && (
                <span className="inline-flex items-center gap-[9px] text-[11.5px] font-semibold tracking-[0.55px] uppercase text-ink-soft">
                  {place && (
                    <span className="inline-flex items-center gap-1">
                      <svg viewBox="0 0 24 24" fill="none" aria-hidden="true" className="w-3 h-3 opacity-85">
                        <path d="M12 22s7-6.1 7-11a7 7 0 1 0-14 0c0 4.9 7 11 7 11Z" stroke="#4A5540" strokeWidth="1.8" />
                        <circle cx="12" cy="11" r="2.4" fill="#4A5540" />
                      </svg>
                      {place}
                    </span>
                  )}
                  {place && recipe.cuisine && (
                    <span className="w-[3px] h-[3px] rounded-full bg-line inline-block" />
                  )}
                  {recipe.cuisine && (
                    <span className="inline-flex items-center gap-1">
                      <svg viewBox="0 0 24 24" fill="none" aria-hidden="true" className="w-3 h-3 opacity-85">
                        <path d="M4 12h16M4 12a8 8 0 0 0 16 0M3.5 12h17M6 20h12" stroke="#4A5540" strokeWidth="1.6" strokeLinecap="round" />
                        <path d="M10 4c0 1.4-1 2-1 3.2M14 4c0 1.4-1 2-1 3.2" stroke="#4A5540" strokeWidth="1.5" strokeLinecap="round" />
                      </svg>
                      {recipe.cuisine}
                    </span>
                  )}
                </span>
              )}
            </div>
          )}
        </div>
      </header>

      {/* STAGE — the living plant hero, over a soft light pool. */}
      <section
        className="relative z-[3] flex justify-center overflow-hidden pt-1"
        style={{
          background:
            'radial-gradient(66% 54% at 50% 42%, #F8F2E6 0%, rgba(248,242,230,0) 74%)',
        }}
      >
        <div className="w-[302px] h-[336px] relative">
          <LivingPlant
            stage={stage}
            vitality={vitality}
            onPartTap={onPartTap}
            growRef={growRef}
            reduceMotion={reduce}
          />
        </div>
      </section>

      {/* HINT LINE — the discoverability nudge (only while the plant has soul). */}
      {hasSoul && (
        <p className="text-center px-[30px] pt-0.5 font-serif italic font-medium text-[14.5px] leading-[1.3] text-ink-soft relative z-[3]">
          <span className="text-saffron not-italic">&#10022;</span> tap the blossoms
          to hear their words
        </p>
      )}

      {/* STAGE CAPTION — where the plant is in its life. */}
      <p className="text-center px-[30px] pt-1.5 pb-3 font-serif italic font-medium text-[16.5px] leading-[1.3] text-ink-soft relative z-[3]">
        <b className="not-italic font-semibold text-growth">{caption.lead}</b>
        {' · '}
        {caption.rest}
      </p>

      {/* SOUL ROW — the true numbers; rests at 0 on seed/sprout. */}
      <div
        className="flex items-center justify-center px-6 pb-3 relative z-[3]"
        style={{ opacity: hasSoul ? 1 : 0.5 }}
      >
        <SoulStat icon={<BlossomStat />} n={memories} label="memories" />
        <SoulStat icon={<FruitStat />} n={cooked} label="cooked" />
        <SoulStat icon={<ShareStat />} n={shared} label="passed on" />
      </div>

      {/* CONTROLS — the two actions. */}
      <div className="px-6 pt-1 pb-2 relative z-[3]">
        <div className="flex gap-[11px]">
          <button
            onClick={tend}
            disabled={tending}
            className="flex-1 inline-flex items-center justify-center gap-2 font-serif font-semibold text-[15px] text-white bg-terra rounded-[10px] px-3.5 py-3 shadow-[0_8px_16px_rgba(181,80,42,0.28)] active:translate-y-px disabled:opacity-70 transition"
          >
            <svg viewBox="0 0 24 24" fill="none" aria-hidden="true" className="w-4 h-4 flex-shrink-0">
              <g fill="#FCF8EE">
                <ellipse cx="12" cy="5.5" rx="2.7" ry="4.4" />
                <ellipse cx="17.9" cy="9.6" rx="2.7" ry="4.4" transform="rotate(72 17.9 9.6)" />
                <ellipse cx="15.6" cy="16.6" rx="2.7" ry="4.4" transform="rotate(144 15.6 16.6)" />
                <ellipse cx="8.4" cy="16.6" rx="2.7" ry="4.4" transform="rotate(216 8.4 16.6)" />
                <ellipse cx="6.1" cy="9.6" rx="2.7" ry="4.4" transform="rotate(288 6.1 9.6)" />
              </g>
              <circle cx="12" cy="12" r="2.3" fill="#D99A2B" />
            </svg>
            <span className="leading-none">Add a memory</span>
          </button>
          <button
            onClick={() => openSheet('recipe')}
            className="flex-1 inline-flex items-center justify-center gap-2 font-serif font-semibold text-[15px] text-terra bg-card/60 border border-line rounded-[10px] px-3.5 py-3 shadow-[0_1px_0_rgba(255,255,255,.5)_inset] active:translate-y-px transition"
          >
            <svg viewBox="0 0 24 24" fill="none" aria-hidden="true" className="w-[15px] h-[15px]">
              <path
                d="M6 3.5h9l3.5 3.5V20a.5.5 0 0 1-.5.5H6a.5.5 0 0 1-.5-.5V4a.5.5 0 0 1 .5-.5Z"
                stroke="#B5502A"
                strokeWidth="1.6"
                strokeLinejoin="round"
              />
              <path d="M9 11h6M9 14.5h6M9 7.6h3" stroke="#B5502A" strokeWidth="1.6" strokeLinecap="round" />
            </svg>
            View recipe
          </button>
        </div>
      </div>

      {/* OWNER SURFACES — visibility control, pass-it-on, and the warm
          empty-state invitation (only when there's no story yet). */}
      {isOwner && (
        <div className="px-6 pt-2 pb-4 relative z-[3]">
          <VisibilityControl
            recipe={recipe}
            onChange={(v) => setRecipe({ ...recipe, visibility: v })}
          />

          <button
            onClick={() => setShowHandoff((v) => !v)}
            className="mt-3 px-5 py-3 rounded-[10px] border border-line text-ink-soft font-serif text-sm"
          >
            Pass it on
          </button>

          {showHandoff && (
            <div className="mt-4 border-t border-line pt-4">
              <HandoffInvite
                recipeId={recipe.id}
                recipeVisibility={recipe.visibility}
                sourceName={source}
                onSent={() => setShowHandoff(false)}
                onSkip={() => setShowHandoff(false)}
              />
            </div>
          )}

          {!recipe.story && (
            <button
              onClick={() => navigate(`/recipes/${recipe.id}/edit`)}
              className="mt-3 w-full text-left rounded-xl border border-dashed border-line bg-card/60 px-[15px] py-3"
            >
              <span className="font-serif italic text-[13px] text-terra">
                Whose hands does this come from? Add a memory ↦
              </span>
            </button>
          )}
        </div>
      )}

      {/* THE SOUL SHEET — the tapped facet (blossom/fruit/base) or the body. */}
      <SoulSheet
        open={sheet.open}
        panel={sheet.panel}
        recipe={recipe}
        onClose={closeSheet}
      />
    </div>
  )
}
