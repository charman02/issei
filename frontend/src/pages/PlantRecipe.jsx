import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import RecipeForm from '../components/RecipeForm'
import HandoffInvite from '../components/HandoffInvite'
import Plant from '../components/Plant'
import { buildOriginPayload } from '../lib/lineagePayload'
import { plantedBeatCopy } from '../lib/plantedBeat'
import { plantRecipe } from '../api/lineage'

export default function PlantRecipe() {
  const navigate = useNavigate()
  const [step, setStep] = useState('doorway') // doorway|origin|form|planted|handoff
  const [originMode, setOriginMode] = useState(null) // 'ancestor'|'mine'
  const [origin, setOrigin] = useState({ name: '', place: '', year: '', memory: '' })
  const [selfMemory, setSelfMemory] = useState('')
  const [planted, setPlanted] = useState(null)

  function chooseDoor(mode) { setOriginMode(mode); setStep('origin') }

  async function handleFormSubmit(formPayload) {
    const payload = { ...formPayload }
    if (originMode === 'ancestor') {
      // The doorway memory belongs to the ANCESTOR (origin.memory), which is
      // distinct from the dish's own story — leave payload.story from the form.
      payload.origin = buildOriginPayload(origin)
    }
    // On the 'mine' path the doorway memory seeds the form's Story field via
    // initialValues below, so formPayload.story is already authoritative — no
    // override here (that would silently discard edits made in the form).
    const { data } = await plantRecipe(payload)
    setPlanted(data)
    setStep('planted')
  }

  if (step === 'doorway') {
    return (
      <div className="px-[18px] pt-8">
        <h1 className="font-serif font-black text-[28px] text-ink leading-tight">Where does this<br />recipe begin?</h1>
        <p className="font-serif italic text-[15px] text-ink-soft mt-2 mb-6">Every seed has a first hand that held it.</p>
        <button onClick={() => chooseDoor('ancestor')} className="block w-full text-left bg-card border border-line rounded-2xl p-4 mb-3 shadow-warm">
          <span className="font-serif font-semibold text-[17px] text-ink">A seed passed to you</span>
          <span className="block font-sans text-[12.5px] text-ink-soft mt-0.5">Someone taught you this. Honor them.</span>
        </button>
        <button onClick={() => chooseDoor('mine')} className="block w-full text-left bg-card border border-line rounded-2xl p-4 shadow-warm">
          <span className="font-serif font-semibold text-[17px] text-ink">A seed of your own</span>
          <span className="block font-sans text-[12.5px] text-ink-soft mt-0.5">You are the root of this one.</span>
        </button>
      </div>
    )
  }

  if (step === 'origin') {
    return (
      <div className="px-[18px] pt-8">
        {originMode === 'ancestor' ? (
          <>
            <h1 className="font-serif font-black text-[26px] text-ink leading-tight">Who taught you<br />this recipe?</h1>
            <p className="font-serif italic text-[14px] text-ink-soft mt-2 mb-5">They'll sit at the root of its tree.</p>
            <input className="field mb-2.5" placeholder="Their name" value={origin.name} onChange={(e) => setOrigin({ ...origin, name: e.target.value })} />
            <div className="flex gap-2.5 mb-2.5">
              <input className="field" placeholder="Place (optional)" value={origin.place} onChange={(e) => setOrigin({ ...origin, place: e.target.value })} />
              <input className="field" placeholder="Year (optional)" value={origin.year} onChange={(e) => setOrigin({ ...origin, year: e.target.value })} />
            </div>
            <textarea className="field resize-none mb-4" rows={3} placeholder="A memory of them & this dish (optional)" value={origin.memory} onChange={(e) => setOrigin({ ...origin, memory: e.target.value })} />
            <button className="btn-primary disabled:opacity-50" disabled={!origin.name.trim()} onClick={() => setStep('form')}>Continue to the recipe →</button>
          </>
        ) : (
          <>
            <h1 className="font-serif font-black text-[26px] text-ink leading-tight">This one starts<br />with you.</h1>
            <p className="font-serif italic text-[14px] text-ink-soft mt-2 mb-5">You're the root of this dish's tree.</p>
            <textarea className="field resize-none mb-4" rows={4} placeholder="What made this yours? (optional)" value={selfMemory} onChange={(e) => setSelfMemory(e.target.value)} />
            <button className="btn-primary" onClick={() => setStep('form')}>Continue to the recipe →</button>
          </>
        )}
      </div>
    )
  }

  if (step === 'form') {
    // Mine path: pre-fill the Story field with the doorway memory so there's
    // ONE story input. Ancestor path: no seed — the doorway memory is the
    // ancestor's (captured in origin.memory), not the dish's story.
    const initialValues = originMode === 'mine' ? { story: selfMemory } : {}
    return (
      <RecipeForm
        mode="add"
        initialValues={initialValues}
        onSubmit={handleFormSubmit}
        intro={
          <p className="font-serif italic text-[14px] text-ink-soft -mt-2 mb-4">
            Add what you’ve got — “a splash of vinegar” is perfect. Only the name is required.
          </p>
        }
      />
    )
  }

  if (step === 'planted') {
    // The ancestor's first name personalizes the "add their story" act; the
    // self-authored path has no source, so the act reads "add a memory".
    const sourceName =
      originMode === 'ancestor' && origin.name.trim()
        ? origin.name.trim().split(/\s+/)[0]
        : null
    const beat = plantedBeatCopy(planted, sourceName)
    return (
      <div className="px-[18px] pt-12 text-center flex flex-col items-center">
        <Plant stage={beat.stage} vitality={planted?.growth_vitality || 'bare'} size={96} />
        <p className="font-sans text-[10px] font-semibold tracking-[0.18em] uppercase text-herb mt-5 mb-2">{beat.eyebrow}</p>
        <h1 className="font-serif font-black italic text-[26px] text-ink leading-tight">{beat.heading}</h1>
        <p className="font-serif italic text-[14px] text-ink-soft mt-3 mb-8 max-w-[16rem]">{beat.body}</p>
        <button className="btn-primary" onClick={() => setStep('handoff')}>Pass it on →</button>
        <button className="mt-3 font-serif italic text-ink-soft text-sm" onClick={() => navigate(`/recipes/${planted.id}`)}>Take me to it →</button>
      </div>
    )
  }

  // step === 'handoff' — only reachable after a successful plant, but guard
  // `planted` defensively to match the optional-chaining used in the planted beat.
  if (!planted) return null
  return (
    <HandoffInvite
      recipeId={planted.id}
      sourceName={originMode === 'ancestor' && origin.name.trim() ? origin.name.trim() : null}
      onSent={() => navigate(`/recipes/${planted.id}`)}
      onSkip={() => navigate(`/recipes/${planted.id}`)}
    />
  )
}
