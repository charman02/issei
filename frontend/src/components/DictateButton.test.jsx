import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, fireEvent, act } from '@testing-library/react'
import { useState } from 'react'
import DictateButton from './DictateButton'

// The fake recognizer. jsdom ships no Web Speech API, so this is what the seam in
// lib/speech.js exists for — installing a constructor on `window` makes the whole
// component drivable, and NOT installing one exercises the Firefox path.
class FakeRecognition {
  static instances = []

  constructor() {
    FakeRecognition.instances.push(this)
    this.aborted = false
    this.stopped = false
  }

  start() {}
  stop() {
    this.stopped = true
  }
  abort() {
    this.aborted = true
  }

  // Test-side helpers that mimic the browser firing at the component.
  emit(final, interim = '') {
    const mk = (transcript, isFinal) => {
      const alt = [{ transcript }]
      alt.isFinal = isFinal
      return alt
    }
    const results = []
    if (final) results.push(mk(final, true))
    if (interim) results.push(mk(interim, false))
    act(() => this.onresult({ resultIndex: 0, results }))
  }

  fail(code) {
    act(() => this.onerror({ error: code }))
  }

  finish() {
    act(() => this.onend())
  }
}

function install() {
  FakeRecognition.instances = []
  window.SpeechRecognition = FakeRecognition
  return FakeRecognition
}

const latest = () => FakeRecognition.instances[FakeRecognition.instances.length - 1]

// A controlled host, so append behaviour is tested through a real value round
// trip rather than by inspecting the onChange argument alone.
function Host({ initial = '', what = 'the story' }) {
  const [value, setValue] = useState(initial)
  return (
    <>
      <textarea
        aria-label="field"
        value={value}
        onChange={(e) => setValue(e.target.value)}
      />
      <DictateButton value={value} onChange={setValue} what={what} />
    </>
  )
}

const mic = () => screen.getByRole('button', { name: /dictate the story/i })
const stopBtn = () => screen.getByRole('button', { name: /stop dictating/i })
const field = () => screen.getByLabelText('field')

afterEach(() => {
  delete window.SpeechRecognition
  delete window.webkitSpeechRecognition
})

describe('DictateButton — unsupported browsers', () => {
  it('renders NOTHING at all where there is no implementation', () => {
    // Firefox. Not a disabled button, not an error, not an explanation: a control
    // that cannot do what it depicts reads as the app being broken, and there is
    // no action the user could take anyway.
    const { container } = render(
      <DictateButton value="" onChange={() => {}} what="the story" />,
    )
    expect(container).toBeEmptyDOMElement()
    expect(screen.queryByRole('button')).not.toBeInTheDocument()
  })
})

describe('DictateButton — discoverability and accessibility', () => {
  it('is always visible, not revealed on focus', () => {
    // An explicit product decision: three features here have been missed by
    // testers (the step check-off took three attempts), and a focus-only control
    // is one most people never learn exists.
    install()
    render(<Host />)
    expect(mic()).toBeInTheDocument()
  })

  it('is a real button with an accessible name, and not a submit', () => {
    install()
    render(<Host />)
    // type=button matters: these sit inside the recipe <form>, and a default
    // submit would save a half-written recipe on the first tap.
    expect(mic()).toHaveAttribute('type', 'button')
    expect(mic()).toHaveAttribute('aria-pressed', 'false')
  })

  it('names which field it belongs to, so 5 mics are 5 distinct controls', () => {
    install()
    render(
      <>
        <DictateButton value="" onChange={() => {}} what="step 1" />
        <DictateButton value="" onChange={() => {}} what="the note on step 1" />
      </>,
    )
    expect(screen.getByRole('button', { name: 'Dictate step 1' })).toBeInTheDocument()
    expect(
      screen.getByRole('button', { name: 'Dictate the note on step 1' }),
    ).toBeInTheDocument()
  })

  it('is keyboard-operable', () => {
    install()
    render(<Host />)
    mic().focus()
    expect(mic()).toHaveFocus()
    // A <button> activates on Enter/Space natively; the guard is that nothing
    // suppresses that and there is no key handler of our own to get it wrong.
    fireEvent.click(mic())
    expect(stopBtn()).toBeInTheDocument()
  })

  it('conveys the listening state by shape and words, never colour alone', () => {
    // Colour-only state has been a defect here twice. Three redundant signals:
    // the accessible name flips, aria-pressed flips, and the glyph changes shape.
    install()
    render(<Host />)
    const before = mic().querySelector('svg')?.innerHTML
    fireEvent.click(mic())
    expect(stopBtn()).toHaveAttribute('aria-pressed', 'true')
    expect(stopBtn().querySelector('svg')?.innerHTML).not.toBe(before)
    expect(screen.getByText('Dictating…')).toBeInTheDocument()
  })

  it('announces the state change politely', () => {
    install()
    render(<Host />)
    fireEvent.click(mic())
    const live = screen.getByText('Dictating…').closest('[aria-live]')
    expect(live).toHaveAttribute('aria-live', 'polite')
  })
})

describe('DictateButton — dictating into a field', () => {
  it('writes committed text into the field', () => {
    install()
    render(<Host />)
    fireEvent.click(mic())
    latest().emit('Brown the chicken.')
    expect(field()).toHaveValue('Brown the chicken.')
  })

  it('APPENDS to text that is already there, never replaces it', () => {
    // The worst failure this feature could have: a mis-tap costing someone the
    // sentences they already typed.
    install()
    render(<Host initial="My mother made this every new year." />)
    fireEvent.click(mic())
    latest().emit('She never measured anything.')
    expect(field()).toHaveValue(
      'My mother made this every new year. She never measured anything.',
    )
  })

  it('appends across several utterances in one session', () => {
    install()
    render(<Host />)
    fireEvent.click(mic())
    latest().emit('First sentence.')
    latest().emit('Second sentence.')
    expect(field()).toHaveValue('First sentence. Second sentence.')
  })

  it('appends after text typed WHILE dictating, not over it', () => {
    // The stale-prop trap: the recognizer's callbacks outlive the render that
    // created them, so appending against a captured `value` would silently drop
    // whatever was typed after the session began.
    install()
    render(<Host initial="Start." />)
    fireEvent.click(mic())
    fireEvent.change(field(), { target: { value: 'Start. Typed mid-session.' } })
    latest().emit('Dictated after.')
    expect(field()).toHaveValue('Start. Typed mid-session. Dictated after.')
  })
})

describe('DictateButton — interim results stay out of the field', () => {
  it('shows the running guess beside the field, not inside it', () => {
    // Interim results are the recognizer thinking aloud: they get revised and
    // withdrawn. In the field they would flicker on every packet AND could leave
    // a half-guessed fragment saved if the user navigated away mid-utterance.
    install()
    render(<Host />)
    fireEvent.click(mic())
    latest().emit('', 'brown the chick')
    expect(field()).toHaveValue('')
    expect(screen.getByText('brown the chick')).toBeInTheDocument()
  })

  it('drops the guess once the utterance is committed', () => {
    install()
    render(<Host />)
    fireEvent.click(mic())
    latest().emit('', 'brown the chick')
    latest().emit('Brown the chicken.')
    expect(field()).toHaveValue('Brown the chicken.')
    expect(screen.queryByText('brown the chick')).not.toBeInTheDocument()
  })

  it('leaves no partial guess behind when the session just ends', () => {
    install()
    render(<Host />)
    fireEvent.click(mic())
    latest().emit('', 'half a sen')
    latest().finish()
    expect(field()).toHaveValue('')
    expect(screen.queryByText('half a sen')).not.toBeInTheDocument()
  })
})

describe('DictateButton — stopping cleanly', () => {
  it('a second tap stops the recognizer', () => {
    install()
    render(<Host />)
    fireEvent.click(mic())
    fireEvent.click(stopBtn())
    // stop(), not abort(): a sentence in progress is still flushed as a final
    // result rather than thrown away.
    expect(latest().stopped).toBe(true)
    expect(latest().aborted).toBe(false)
  })

  it('returns to the resting state when the browser ends the session', () => {
    // Silence ends it (continuous=false). The button must not stay stuck.
    install()
    render(<Host />)
    fireEvent.click(mic())
    latest().finish()
    expect(mic()).toHaveAttribute('aria-pressed', 'false')
    expect(screen.queryByText('Dictating…')).not.toBeInTheDocument()
  })

  it('can be started again after it ends', () => {
    install()
    render(<Host />)
    fireEvent.click(mic())
    latest().finish()
    fireEvent.click(mic())
    expect(FakeRecognition.instances).toHaveLength(2)
    expect(stopBtn()).toBeInTheDocument()
  })

  it('ABORTS on unmount, so nothing keeps listening after the field is gone', () => {
    // A removed step row whose recognizer stayed open would leave the browser's
    // mic indicator lit with no visible field, then fire a result into a dead
    // component. abort() also detaches the handlers, so a late event can't land.
    install()
    const { unmount } = render(<Host />)
    fireEvent.click(mic())
    const rec = latest()
    unmount()
    expect(rec.aborted).toBe(true)
    expect(rec.onresult).toBeNull()
  })
})

describe('DictateButton — permission denial and errors', () => {
  it('explains a denied microphone and points at typing, without throwing', () => {
    install()
    render(<Host />)
    fireEvent.click(mic())
    expect(() => latest().fail('not-allowed')).not.toThrow()
    expect(
      screen.getByText(
        'Dictation needs permission from your browser. You can type this instead.',
      ),
    ).toBeInTheDocument()
  })

  it('never leaves the button stuck listening after an error', () => {
    // onend does not reliably follow onerror across browsers, so a mic left in
    // the stop state would be unusable until the page reloaded.
    install()
    render(<Host />)
    fireEvent.click(mic())
    latest().fail('not-allowed')
    expect(mic()).toHaveAttribute('aria-pressed', 'false')
    expect(screen.queryByText('Dictating…')).not.toBeInTheDocument()
  })

  it('is usable again after a failure', () => {
    install()
    render(<Host />)
    fireEvent.click(mic())
    latest().fail('network')
    fireEvent.click(mic())
    expect(stopBtn()).toBeInTheDocument()
    // The stale failure message clears when a new attempt begins.
    expect(screen.queryByText(/needs a connection/i)).not.toBeInTheDocument()
  })

  it('has its own wording for hearing nothing, and for a lost connection', () => {
    install()
    render(<Host />)
    fireEvent.click(mic())
    latest().fail('no-speech')
    expect(
      screen.getByText('Didn’t catch anything. Try again, or type it.'),
    ).toBeInTheDocument()

    fireEvent.click(mic())
    latest().fail('network')
    expect(
      screen.getByText('Dictation needs a connection. You can type this instead.'),
    ).toBeInTheDocument()
  })

  it('falls back to one honest line for an error code it has never seen', () => {
    install()
    render(<Host />)
    fireEvent.click(mic())
    latest().fail('audio-capture')
    expect(
      screen.getByText('Dictation stopped. You can type this instead.'),
    ).toBeInTheDocument()
  })

  it('keeps text already dictated when the session then errors', () => {
    install()
    render(<Host />)
    fireEvent.click(mic())
    latest().emit('Brown the chicken.')
    latest().fail('network')
    expect(field()).toHaveValue('Brown the chicken.')
  })

  it('reports rather than throws when the recognizer refuses to start', () => {
    install()
    FakeRecognition.prototype.start = function start() {
      throw new Error('InvalidStateError')
    }
    render(<Host />)
    expect(() => fireEvent.click(mic())).not.toThrow()
    expect(
      screen.getByText('Dictation stopped. You can type this instead.'),
    ).toBeInTheDocument()
    expect(mic()).toHaveAttribute('aria-pressed', 'false')
    delete FakeRecognition.prototype.start
    FakeRecognition.prototype.start = function start() {}
  })
})

// onDone is what makes the form fillable field-by-field by voice: when a session
// ends having captured something, the form moves focus to the next field. The
// gating matters as much as the firing — a stray tap or a denied mic must NOT
// jump focus, or the user loses their place (and, on an error, the message that
// tells them what went wrong).
describe('DictateButton — onDone advances only on a real capture', () => {
  it('fires onDone when a session ends after committing text', () => {
    install()
    const onDone = vi.fn()
    render(
      <DictateButton value="" onChange={() => {}} what="the story" onDone={onDone} />,
    )
    fireEvent.click(mic())
    latest().emit('Brown the chicken.')
    latest().finish()
    expect(onDone).toHaveBeenCalledTimes(1)
  })

  it('does NOT fire onDone when a session ends with nothing captured', () => {
    // A stray tap that catches only silence leaves focus exactly where it was.
    install()
    const onDone = vi.fn()
    render(
      <DictateButton value="" onChange={() => {}} what="the story" onDone={onDone} />,
    )
    fireEvent.click(mic())
    latest().finish()
    expect(onDone).not.toHaveBeenCalled()
  })

  it('does NOT fire onDone when the session ends in an error', () => {
    // The error hands the user back to typing; moving focus would bury it.
    install()
    const onDone = vi.fn()
    render(
      <DictateButton value="" onChange={() => {}} what="the story" onDone={onDone} />,
    )
    fireEvent.click(mic())
    latest().fail('not-allowed')
    expect(onDone).not.toHaveBeenCalled()
  })

  it('does not fire a stale onDone: a later empty session stays put', () => {
    // First session captures and advances; a second, empty session must not
    // advance again off whatever the reset landed on.
    install()
    const onDone = vi.fn()
    render(
      <DictateButton value="" onChange={() => {}} what="the story" onDone={onDone} />,
    )
    fireEvent.click(mic())
    latest().emit('First.')
    latest().finish()
    expect(onDone).toHaveBeenCalledTimes(1)
    fireEvent.click(mic())
    latest().finish()
    expect(onDone).toHaveBeenCalledTimes(1)
  })
})

// THE GUARD. There is no audio anywhere in this product — the browser transcribes
// and the utterance is discarded — and this repo has shipped copy claiming sound
// it doesn't have more than once. A mic button is the single most tempting place
// to reintroduce that claim, so the ban is asserted rather than remembered.
describe('DictateButton — claims no audio, ever', () => {
  const BANNED = /record|recording|voice|audio|in (their|your|his|her)( own)? words|listen/i

  function allText(container) {
    // Everything a user or an assistive technology can reach: visible text plus
    // every accessible name, tooltip and state string in the subtree.
    const attrs = ['aria-label', 'title', 'alt', 'placeholder', 'aria-description']
    const fromAttrs = [...container.querySelectorAll('*')].flatMap((el) =>
      attrs.map((a) => el.getAttribute(a) || ''),
    )
    return [container.textContent || '', ...fromAttrs].join(' ')
  }

  it('says nothing about recording in the resting state', () => {
    install()
    const { container } = render(<Host />)
    expect(allText(container)).not.toMatch(BANNED)
    // And the affordance is named for what it does.
    expect(mic()).toHaveAccessibleName('Dictate the story')
  })

  it('says nothing about recording while dictating', () => {
    install()
    const { container } = render(<Host />)
    fireEvent.click(mic())
    latest().emit('Brown the chicken.', 'and then the')
    expect(allText(container)).not.toMatch(BANNED)
    expect(stopBtn()).toHaveAccessibleName('Stop dictating the story')
  })

  it('says nothing about recording in any failure message', () => {
    install()
    const { container } = render(<Host />)
    for (const code of [
      'not-allowed',
      'service-not-allowed',
      'no-speech',
      'network',
      'audio-capture',
    ]) {
      fireEvent.click(mic())
      latest().fail(code)
      expect(allText(container)).not.toMatch(BANNED)
    }
  })

  it('uses "Dictate"/"Dictating" as the whole vocabulary for this feature', () => {
    install()
    render(<Host />)
    expect(mic()).toHaveAccessibleName(/^Dictate /)
    fireEvent.click(mic())
    expect(screen.getByText('Dictating…')).toBeInTheDocument()
  })
})
