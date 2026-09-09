import { useEffect, useRef, useState } from 'react'
import BackButton from './BackButton'
import Icon from './Icon'
import { parseRecipeText } from '../lib/parseRecipeText'
import {
  appendDictated,
  isDictationSupported,
  startDictation,
} from '../lib/speech'
import { parseRecipeWithAI } from '../api/sharing'

// The app's signature way in: say a whole recipe out loud (or paste it) and it's
// organized into fields for you, instead of filling nineteen of them by hand. Two
// modes on one screen — "Say it" and "Type it" — with speaking offered first,
// because it's the thing users didn't know they could do.
//
// TWO PARSERS, in order (handleSort). The server asks a language model first
// (POST /recipes/parse); if it's unavailable the local line-based parser takes
// over. They fail on different inputs: the local one needs one item per line and
// cannot split run-on speech ("you need tamarind, about a thumb of ginger, and
// some kangkong" is one line, three ingredients — exactly how people talk), while
// the model splits that and also lifts out servings, cuisine, the person it came
// from, and a per-step remark. So the model is what makes the "say it messy" promise
// real; the local parser is what keeps the door working when the model is down, out
// of credit, or unconfigured. Nobody sees an error either way.
//
// Neither one SAVES anything: both hand off to the ordinary form, pre-filled and
// editable, so a confidently-wrong parse costs a proofread, not lost work.
//
// A NOTE ON WORDS (POSITIONING.md, enforced by tests): this is browser
// speech-to-text — spoken words become editable characters and the audio is
// discarded, never recorded, stored, or sent. So the copy says "say it" / "talk"
// / "dictate", never "voice", "recording", or "in their own words". And it sells
// the OUTCOME ("we'll sort it into a recipe"), not the machine — "AI" is not the
// app's identity, just how this one door happens to work.

// Map the server's parse response onto the shape the local parser already returns,
// so the screen after this one doesn't care which parser produced its values.
function fromAI(data) {
  return {
    name: data.name || '',
    ingredients: (data.ingredients || []).map((i) => ({
      name: i.name,
      amount: i.amount || '',
      quantity_type: i.quantity_type,
    })),
    steps: (data.steps || []).map((s) => ({ content: s.content, note: s.note || '' })),
    sourceName: data.source_name || '',
    description: data.description || '',
    servings: data.servings || '',
    cuisine: data.cuisine || '',
    usedHeaders: true,
    guessedLines: 0,
    viaAI: true,
  }
}

const PLACEHOLDER = `Chicken Adobo

3 soup spoons soy sauce
a good splash of vinegar
a whole head of garlic

Brown the chicken skin-side down
Add the soy and vinegar
Simmer until the sauce coats a spoon`

export default function PasteRecipe({
  onParsed,
  onBack,
  // Opens the plain field-by-field <RecipeForm>, skipping the parser entirely. The prop
  // keeps its old name; the LABEL deliberately no longer says "type", because "Type it" is
  // one of this screen's two modes and the link read as an offer to do the thing you were
  // already doing (user-reported). It is a third door, not a mode.
  onTypeItIn,
  initialText = '',
  // Optional reassurance shown under the subtitle. Exists for #81: this is the screen you
  // land on when you tap "Write one" mid-post, and without a word here the user has no way
  // to know their half-written meal is still waiting for them.
  note = null,
}) {
  // Seeded from the parent so going back from the form returns the SAME text.
  const [text, setText] = useState(initialText)
  const [tooThin, setTooThin] = useState(false)
  const [working, setWorking] = useState(false)

  // Speaking is offered first — but only where the browser supports it. Firefox
  // has no Web Speech API, so there the "Say it" tab would be a dead control that
  // reads as broken; default (and pin) to Type there instead.
  const canDictate = isDictationSupported()
  const [mode, setMode] = useState(canDictate ? 'say' : 'type')

  // Dictation session state (say mode). The recognizer's callbacks outlive the
  // render that created them, so the live value is mirrored in a ref — appending
  // against the captured prop would drop anything added after listening began.
  const [listening, setListening] = useState(false)
  const [interim, setInterim] = useState('')
  const [problem, setProblem] = useState('')
  const sessionRef = useRef(null)
  const valueRef = useRef(text)
  valueRef.current = text

  // Leaving the page mid-dictation must abort (not stop): an open recognizer would
  // keep the mic indicator lit and could fire a result into an unmounted component.
  useEffect(
    () => () => {
      sessionRef.current?.abort()
      sessionRef.current = null
    },
    [],
  )

  // Enough to be worth sending — the gate only refuses a lone dish name typed by
  // mistake. 4+ words, OR 2+ words with an item separator (a comma or newline), so
  // a terse-but-real "adobo. soy, vinegar, garlic. simmer." gets through. The
  // downstream too-thin check is the real backstop.
  const cleaned = text.trim()
  const words = cleaned.split(/\s+/).filter(Boolean).length
  const enough = words >= 4 || (words >= 2 && /[,\n]/.test(cleaned))

  function update(next) {
    setText(next)
    setTooThin(false)
  }

  // Each dictated utterance is its own LINE (separator '\n'): saying "Adobo", then
  // "three soup spoons soy sauce", then "brown the chicken" must become three lines,
  // not one run-on the parser reads as a giant dish name.
  function commit(finalText) {
    const next = appendDictated(valueRef.current, finalText, '\n')
    valueRef.current = next
    update(next)
  }

  function startListening() {
    setProblem('')
    setInterim('')
    const session = startDictation({
      onResult: ({ final, interim: guess }) => {
        if (final) commit(final)
        setInterim(guess)
      },
      onError: (code) => {
        setProblem(PROBLEMS[code] || PROBLEM_FALLBACK)
        setInterim('')
        setListening(false)
        sessionRef.current = null
      },
      onEnd: () => {
        setInterim('')
        setListening(false)
        sessionRef.current = null
      },
    })
    if (!session) {
      setProblem(PROBLEM_FALLBACK)
      return
    }
    sessionRef.current = session
    setListening(true)
  }

  function stopListening() {
    sessionRef.current?.stop()
  }

  async function handleSort() {
    if (working) return
    // Stop the recognizer if it's still open. Note a sentence still mid-utterance
    // is flushed ASYNCHRONOUSLY (stop() → onResult → setText on a later tick), so
    // it is NOT in the `text` we parse on this pass — it lands in the editable
    // transcript instead. That's acceptable: every committed final is already in
    // `text`, the transcript stays visible to fix, and the too-thin guard below is
    // the real backstop. We don't await the flush because the user has signalled
    // they're done, and the draft they land on is fully editable regardless.
    if (listening) stopListening()
    setWorking(true)
    try {
      let parsed = null
      try {
        const { data } = await parseRecipeWithAI(text)
        if (data?.ai && (data.ingredients?.length || data.steps?.length)) {
          parsed = fromAI(data)
        }
      } catch {
        // fall through to the local parser — never surface a network error here
      }
      if (!parsed) parsed = parseRecipeText(text)

      if (!parsed.ingredients.length && !parsed.steps.length) {
        setTooThin(true)
        return
      }
      onParsed(parsed, text)
    } finally {
      setWorking(false)
    }
  }

  return (
    <div className="min-h-screen bg-cream px-[18px] pt-5 pb-10">
      <div className="mb-4">
        <BackButton onClick={onBack} label="Back" />
      </div>

      <h1 className="font-display font-black text-[28px] text-ink leading-tight">
        Add it your way
      </h1>
      {/* The benefit, said plainly and up front — this is the discoverability fix:
          users didn't realize they could be messy and have it organized for them.
          Sells the outcome, not the machine. */}
      <p className="font-display text-[15px] text-ink mt-2">
        Messy is fine — tell it how you make it, and we&rsquo;ll sort it into a recipe.
      </p>
      {note && (
        <p className="font-display italic text-[13.5px] text-ink-soft mt-2">{note}</p>
      )}

      {/* Mode toggle — "Say it" first (where supported). A segmented sticker pill,
          centered on the screen so it reads as the page's primary switch rather
          than a control hanging off the left margin. */}
      {canDictate && (
        <div className="mt-4 flex justify-center">
        <div
          role="tablist"
          aria-label="How to add the recipe"
          className="inline-flex rounded-full border-2 border-ink bg-cream p-0.5 text-[13px] font-display font-bold"
        >
          <button
            role="tab"
            aria-selected={mode === 'say'}
            onClick={() => setMode('say')}
            className={`inline-flex items-center gap-1.5 px-4 py-1.5 rounded-full transition ${
              mode === 'say' ? 'bg-terra text-cream' : 'text-ink-soft'
            }`}
          >
            <Icon name="mic" className="w-4 h-4" />
            Say it
          </button>
          <button
            role="tab"
            aria-selected={mode === 'type'}
            onClick={() => {
              if (listening) stopListening()
              setMode('type')
            }}
            className={`inline-flex items-center gap-1.5 px-4 py-1.5 rounded-full transition ${
              mode === 'type' ? 'bg-terra text-cream' : 'text-ink-soft'
            }`}
          >
            <Icon name="edit" className="w-4 h-4" />
            Type it
          </button>
        </div>
        </div>
      )}

      {/* SAY MODE — a big mic is the primary act. Tapping starts/stops dictation;
          the live guess shows under it, and everything captured lands in the
          editable transcript below so it can be fixed before sorting. */}
      {mode === 'say' && canDictate ? (
        <div className="mt-5">
          <div className="flex flex-col items-center text-center">
            <button
              type="button"
              onClick={() => (listening ? stopListening() : startListening())}
              aria-label={listening ? 'Stop' : 'Tap to talk'}
              aria-pressed={listening}
              className={`flex items-center justify-center w-24 h-24 rounded-full border-[3px] border-ink shadow-[0_4px_0_#2E3A24] transition-transform active:translate-y-[3px] active:shadow-[0_1px_0_#2E3A24] ${
                listening ? 'bg-terra text-cream animate-pulse' : 'bg-peach text-ink'
              }`}
            >
              <Icon name={listening ? 'stop' : 'mic'} className="w-11 h-11" />
            </button>
            <p
              className="font-display font-bold text-[14px] text-ink mt-3"
              aria-live="polite"
            >
              {/* "Dictating…", never "Listening…": POSITIONING bans "listen" (it
                  implies audio capture that doesn't exist), and this is the same
                  vocabulary DictateButton uses. The guard test below pins it. */}
              {listening ? 'Dictating… tap to stop' : 'Tap to talk'}
            </p>
            {/* The live guess — ephemeral, not written into the transcript until
                the recognizer finalizes it (see commit). */}
            {listening && interim && (
              <p
                aria-hidden="true"
                className="font-display italic text-[13px] text-ink-soft mt-1 max-w-full truncate"
              >
                {interim}
              </p>
            )}
            {problem && (
              <p className="mt-2">
                <span className="error-pill">{problem}</span>
              </p>
            )}
            <p className="font-display italic text-[12.5px] text-ink-soft mt-2 max-w-[19rem]">
              Say the dish, the ingredients, and the steps — however they come out.
              You don&rsquo;t have to be tidy about it.
            </p>
          </div>

          {/* What you've said so far, editable. Appears once there's anything to
              show, so an untouched say-mode screen stays about the mic. */}
          {text.trim() && (
            <div className="mt-5">
              {/* "What we heard" claimed the app HEARD something. It didn't: dictation is the browser
                  turning speech into text on the device, and everything downstream is a string. The
                  comment 28 lines above this one says the status must read "Dictating…", never
                  "Listening…", for precisely this reason — and the guard test pinned that line while
                  this label sat here saying the same forbidden thing louder. */}
              <p className="section-label mb-1.5">What came through — fix anything</p>
              <textarea
                value={text}
                onChange={(e) => update(e.target.value)}
                rows={8}
                className="field font-sans text-[14.5px] leading-relaxed resize-y"
              />
            </div>
          )}
        </div>
      ) : (
        /* TYPE MODE — paste or type into one canvas. The placeholder IS a
           correctly-shaped recipe, so the format can be copied, not memorized. */
        <div className="mt-4">
          <textarea
            value={text}
            onChange={(e) => update(e.target.value)}
            rows={13}
            autoFocus
            className="field font-sans text-[14.5px] leading-relaxed resize-y"
            placeholder={PLACEHOLDER}
          />
        </div>
      )}

      {tooThin && (
        <p className="error-pill mt-3">
          That looks like just a name &mdash; add the ingredients or the steps too.
        </p>
      )}

      <button
        onClick={handleSort}
        disabled={!enough || working}
        className="btn-primary mt-4 flex flex-col items-center py-2.5"
      >
        <span>{working ? 'Sorting it out…' : 'Sort this out →'}</span>
        <span className="font-display italic font-normal text-[12px] text-cream/85 mt-0.5">
          Nothing is saved until you say so
        </span>
      </button>

      {/* The quiet escape hatch: someone with nothing to paste (or who'd rather not
          dictate) goes straight to a blank form. Kept at the bottom so it doesn't
          compete with the primary say/paste act above. */}
      {onTypeItIn && (
        <button
          onClick={onTypeItIn}
          className="block w-full text-center font-display font-bold text-[14px] text-terra mt-5 py-2"
        >
          Rather fill in the form? &rarr;
        </button>
      )}
    </div>
  )
}

// Failure copy in the app's register: say what happened, hand back the way that
// always works. Kept in module scope so it isn't rebuilt each render.
const PROBLEMS = {
  'not-allowed': 'Dictation needs permission from your browser. You can type it instead.',
  'service-not-allowed':
    'Dictation needs permission from your browser. You can type it instead.',
  'no-speech': 'Didn’t catch anything. Try again, or type it.',
  network: 'Dictation needs a connection. You can type it instead.',
}
const PROBLEM_FALLBACK = 'Dictation stopped. You can type it instead.'
