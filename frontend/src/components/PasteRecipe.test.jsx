import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, fireEvent, act } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import PasteRecipe from './PasteRecipe'

// The say/paste screen had NO test when it was rewritten into the "Say it / Type
// it" toggle, and that gap let the banned word "Listening…" ship on the app's
// signature add path (a ship-review HOLD). These pin the two things that matter
// most here: the toggle renders both modes, and NO copy in either mic state
// claims audio the product doesn't have.

// The model parse and the local parser are both stubbed away — this file is about
// the screen's copy and mode toggle, not the parse pipeline (that's covered end to
// end in PlantRecipe.test.jsx).
vi.mock('../api/sharing', () => ({
  parseRecipeWithAI: vi.fn(() => Promise.resolve({ data: { ai: false } })),
}))

// jsdom ships no Web Speech API. Installing a fake constructor on `window` is what
// makes say-mode reachable; NOT installing one exercises the type-only fallback
// (Firefox), where the toggle must not even render.
class FakeRecognition {
  static instances = []
  constructor() {
    FakeRecognition.instances.push(this)
  }
  start() {}
  stop() {}
  abort() {}
  emit(final, interim = '') {
    const mk = (transcript, isFinal) =>
      Object.assign([{ transcript }], { isFinal })
    const results = []
    if (final) results.push(mk(final, true))
    if (interim) results.push(mk(interim, false))
    act(() => this.onresult({ resultIndex: 0, results }))
  }
}
function install() {
  FakeRecognition.instances = []
  window.SpeechRecognition = FakeRecognition
}
const latest = () =>
  FakeRecognition.instances[FakeRecognition.instances.length - 1]

const noop = () => {}

// PasteRecipe renders BackButton, which calls useNavigate() — so it needs a Router
// in the tree, same as PlantRecipe's own tests.
function renderPaste(props = {}) {
  return render(
    <MemoryRouter>
      <PasteRecipe onParsed={noop} onBack={noop} {...props} />
    </MemoryRouter>,
  )
}

afterEach(() => {
  delete window.SpeechRecognition
  delete window.webkitSpeechRecognition
})

describe('PasteRecipe — the say/type toggle', () => {
  it('offers both modes where dictation is supported, and starts on Say it', () => {
    install()
    renderPaste()
    expect(screen.getByRole('tab', { name: /say it/i })).toBeInTheDocument()
    expect(screen.getByRole('tab', { name: /type it/i })).toBeInTheDocument()
    // Say-first: the big mic is the primary act on arrival.
    expect(screen.getByRole('button', { name: /tap to talk/i })).toBeInTheDocument()
  })

  it('renders NO toggle in a browser without dictation, falling back to the type box', () => {
    // Firefox. Not a dead tab — the whole toggle is absent and the paste box is
    // the only mode, exactly as the screen behaved before the rewrite.
    renderPaste()
    expect(screen.queryByRole('tab')).not.toBeInTheDocument()
    expect(screen.getByRole('textbox')).toBeInTheDocument()
  })

  it('switches to the paste box when Type it is chosen', () => {
    install()
    renderPaste()
    fireEvent.click(screen.getByRole('tab', { name: /type it/i }))
    expect(screen.getByRole('textbox')).toBeInTheDocument()
  })
})

// THE GUARD — the finding this file exists for. There is no audio anywhere in the
// product; the browser transcribes and the utterance is discarded. "listen" is
// banned exactly because it implies capture that doesn't happen (POSITIONING #1),
// and this screen's live status must use the same "Dictating…" vocabulary the
// rest of the app does.
describe('PasteRecipe — claims no audio, ever', () => {
  const BANNED = /record|recording|\bvoice\b|audio|in (their|your|his|her)( own)? words|listen/i
  const allText = (container) => {
    const attrs = ['aria-label', 'title', 'alt', 'placeholder']
    const named = [...container.querySelectorAll('*')].flatMap((el) =>
      attrs.map((a) => el.getAttribute(a) || ''),
    )
    return [container.textContent || '', ...named].join(' ')
  }

  it('says nothing about recording in the resting say-mode', () => {
    install()
    const { container } = renderPaste()
    expect(allText(container)).not.toMatch(BANNED)
  })

  it('says nothing about recording while actively dictating', () => {
    // The regression that shipped: the live status read "Listening…". It must read
    // "Dictating…" and carry no banned word even mid-utterance.
    install()
    const { container } = renderPaste()
    fireEvent.click(screen.getByRole('button', { name: /tap to talk/i }))
    latest().emit('Adobo', 'and then the')
    expect(screen.getByText(/dictating…/i)).toBeInTheDocument()
    expect(allText(container)).not.toMatch(BANNED)
  })

  it('says nothing about recording in the type mode either', () => {
    install()
    const { container } = renderPaste()
    fireEvent.click(screen.getByRole('tab', { name: /type it/i }))
    expect(allText(container)).not.toMatch(BANNED)
  })
})
