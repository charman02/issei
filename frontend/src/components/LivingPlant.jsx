// LivingPlant — the R2 recipe-page plant. Renders the four-stage plant SVG
// (one visible stage form + its soul accents + idle sway) and exposes imperative
// grow/bloom animations through `growRef`.
//
// Behaviour (timings + cadence) is reproduced from the locked prototype
// .superpowers/r2-living-plant-v6.html (its growTo / bloom / applySoul). The
// classes toggled here (.cascading, .brighten, .justBloomed, .reBloom, .on) are
// animated by plant.css — do not rename them.
import { useEffect, useLayoutEffect, useRef } from 'react'
import { PLANT_VIEWBOX, PlantDefs, FORMS, SOUL_ACCENTS } from './plant/plantForms'
import './plant/plant.css'

// v6 growth-beat timing constants (from the prototype's growTo()).
const GROW_MS = 5200 // medium cascade (chosen from the gallery)
const CANOPY_LANDED = Math.round(GROW_MS * 0.76) // 3952ms — accents unfurl just after the canopy fills
const CASCADE_CLEAR = GROW_MS + 80 // 5280ms — rest the form back to its normal state
// v6 bloom-beat timing constants (from the prototype's bloom()/unfurlBlossom()).
const BRIGHTEN_MS = 1120
const JUST_BLOOMED_MS = 800
const RE_BLOOM_MS = 860

// Which soul-accent class is active for a given stage. None on seed/sprout; the
// sapling set on sapling; the tree set on tree.
function soulClassFor(stage) {
  if (stage === 'sapling') return 'soulSapling'
  if (stage === 'tree') return 'soulTree'
  return null
}

// The visible-accent rule: none on seed/sprout; sapling shows .soulSapling and
// tree shows .soulTree — on ANY sapling/tree regardless of vitality. This gates
// on stage only (matching the locked v6 prototype's SOUL_BY_STAGE, which has no
// vitality axis) so the plant's tappable accents agree with RecipePage's
// stage-only hint line + soul row. `vitality` is retained for the data-vitality
// attribute (future use) but does NOT gate accent visibility.
function soulVisible(stage) {
  return soulClassFor(stage) !== null
}

// Toggle the .on class on the accent nodes for the active soul set (mirrors the
// prototype's applySoul). `show` false clears every accent.
function applySoul(svg, stage, show) {
  if (!svg) return
  const active = soulClassFor(stage)
  svg.querySelectorAll('.soulSapling, .soulTree').forEach((el) => {
    el.classList.toggle('on', show && active !== null && el.classList.contains(active))
  })
}

export default function LivingPlant({
  stage = 'seed',
  vitality = 'bare',
  onPartTap,
  reduceMotion = false,
  growRef,
}) {
  const svgRef = useRef(null)
  const swayRef = useRef(null)
  const timersRef = useRef([])

  function clearTimers() {
    timersRef.current.forEach(clearTimeout)
    timersRef.current = []
  }
  useEffect(() => () => clearTimers(), [])

  // Reflect the current stage/vitality onto the accent nodes on every render
  // where props change (a non-imperative render). grow()/bloom() below override
  // this transiently, then settle back to the same rule.
  useLayoutEffect(() => {
    applySoul(svgRef.current, stage, soulVisible(stage))
  }, [stage, vitality])

  // Find the active .form element (the one plant.css shows for this stage).
  function activeForm() {
    const svg = svgRef.current
    if (!svg) return null
    const ids = { seed: 'formSeed', sprout: 'formSprout', sapling: 'formSapling', tree: 'formTree' }
    return svg.querySelector('#' + ids[stage])
  }

  // ---- delegated tap/keyboard handling ----
  // A single handler on the <svg> finds the nearest [data-part] ancestor of the
  // event target and reports it, so both authored and future accents just work.
  function firePart(target) {
    if (!onPartTap) return
    const el = target && target.closest && target.closest('[data-part]')
    if (!el) return
    const part = el.getAttribute('data-part')
    const quoteIndex = Number(el.dataset.quote) || 0
    onPartTap(part, quoteIndex)
  }
  function handleClick(e) {
    firePart(e.target)
  }
  function handleKeyDown(e) {
    if (e.key !== 'Enter' && e.key !== ' ' && e.key !== 'Spacebar') return
    const el = e.target && e.target.closest && e.target.closest('[data-part]')
    if (!el) return
    e.preventDefault()
    firePart(e.target)
  }

  // ---- imperative grow/bloom handle exposed via growRef ----
  useEffect(() => {
    if (!growRef) return undefined

    // GROWTH beat — the active form's parts cascade up from their own bases
    // (trunk → branches → canopy), then the soul accents unfurl once the canopy
    // has landed. Mirrors the prototype's growTo(stage).
    function grow() {
      const svg = svgRef.current
      if (reduceMotion) {
        // No animation: jump straight to the final resting state for this stage.
        applySoul(svg, stage, soulVisible(stage))
        return
      }
      clearTimers()
      // Hold accents off while the bare form grows.
      applySoul(svg, stage, false)
      const form = activeForm()
      if (!form) {
        applySoul(svg, stage, soulVisible(stage))
        return
      }
      // Restart the cascade animations cleanly (drop + re-add after a reflow).
      form.classList.remove('cascading')
      // eslint-disable-next-line no-unused-expressions
      form.getBBox && form.getBBox() // force reflow so the keyframes restart
      form.classList.add('cascading')
      // Accents unfurl right after the canopy lands.
      timersRef.current.push(
        setTimeout(() => applySoul(svgRef.current, stage, soulVisible(stage)), CANOPY_LANDED),
      )
      // Rest the form back to its normal (transition-driven) state once done.
      timersRef.current.push(
        setTimeout(() => {
          if (form.isConnected) form.classList.remove('cascading')
        }, CASCADE_CLEAR),
      )
    }

    // BLOOM beat — the whole above-soil plant brightens briefly AND a tree
    // blossom pulses. No stage change. Mirrors the prototype's bloom().
    function bloom() {
      const svg = svgRef.current
      // A bloom always ensures accents are shown (a memory has taken root).
      applySoul(svg, stage, soulVisible(stage))
      if (reduceMotion) return
      const sway = swayRef.current
      if (sway) {
        sway.classList.remove('brighten')
        // eslint-disable-next-line no-unused-expressions
        sway.getBBox && sway.getBBox()
        sway.classList.add('brighten')
        timersRef.current.push(
          setTimeout(() => {
            if (swayRef.current) swayRef.current.classList.remove('brighten')
          }, BRIGHTEN_MS),
        )
      }
      // Pulse ONE blossom of the CURRENT stage's soul set (never a hidden
      // tree blossom while a sapling is showing — that blossom is positioned for
      // the taller tree canopy and would flash above the smaller plant). Only
      // consider blossoms that are actually shown (.on) for this stage.
      if (!svg) return
      const soulClass = soulClassFor(stage) // 'soulSapling' | 'soulTree' | null
      if (!soulClass) return
      const blossoms = svg.querySelectorAll('.' + soulClass + '.blossom.on')
      if (!blossoms.length) return
      const g = blossoms[Math.floor(Math.random() * blossoms.length)]
      const isOn = g.classList.contains('on')
      const pulseClass = isOn ? 'reBloom' : 'justBloomed'
      const pulseMs = isOn ? RE_BLOOM_MS : JUST_BLOOMED_MS
      g.classList.remove(pulseClass)
      // eslint-disable-next-line no-unused-expressions
      g.getBBox && g.getBBox()
      g.classList.add(pulseClass, 'glow')
      timersRef.current.push(
        setTimeout(() => {
          g.classList.remove(pulseClass)
          g.classList.remove('glow')
        }, pulseMs),
      )
    }

    growRef.current = { grow, bloom }
    return () => {
      if (growRef && growRef.current && growRef.current.grow === grow) {
        growRef.current = null
      }
    }
  }, [growRef, reduceMotion, stage, vitality])

  return (
    <svg
      ref={svgRef}
      className="plant"
      data-stage={stage}
      data-vitality={vitality}
      viewBox={PLANT_VIEWBOX}
      onClick={handleClick}
      onKeyDown={handleKeyDown}
    >
      <PlantDefs />
      <g ref={swayRef} className="sway">
        {FORMS[stage]}
        {SOUL_ACCENTS}
      </g>
    </svg>
  )
}
