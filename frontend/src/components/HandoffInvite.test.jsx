import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

vi.mock('../api/sharing', () => ({
  handoffRecipe: vi.fn(() =>
    Promise.resolve({ data: { id: 1, state: 'pending', token: 'tok123' } }),
  ),
}))
import { handoffRecipe } from '../api/sharing'
import HandoffInvite from './HandoffInvite'

beforeEach(() => handoffRecipe.mockClear())

describe('HandoffInvite', () => {
  it('sends the handoff and then shows the shareable invite link', async () => {
    const onSent = vi.fn()
    render(<HandoffInvite recipeId={7} onSent={onSent} onSkip={() => {}} />)
    await userEvent.type(
      screen.getByPlaceholderText(/their email/i),
      'mom@example.com',
    )
    // Clear the seeded default first, then type — the note field is pre-filled with
    // the default invitation message now (see the "default invitation message"
    // block), so a raw type() would append to it.
    const note = screen.getByPlaceholderText(/say something with it/i)
    await userEvent.clear(note)
    await userEvent.type(note, 'your adobo')
    await userEvent.click(screen.getByRole('button', { name: /get a link to send/i }))
    // The MESSAGE IS NOT SENT to the server (#102) — the column that stored it and showed it
    // nowhere is gone, so the body carries the recipient and nothing else. The message's own
    // journey is covered by the delivery tests at the bottom of this file.
    expect(handoffRecipe).toHaveBeenCalledWith(7, { to_email: 'mom@example.com' })
    // The whole point: the token must be surfaced, not discarded. onSent must NOT
    // fire yet — that used to skip the share step entirely.
    expect(await screen.findByText(/\/invite\/tok123/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /share the link/i })).toBeInTheDocument()
    expect(onSent).not.toHaveBeenCalled()
  })

  it('does not require an email — a link-only handoff works', async () => {
    // No cached user, so the seeded note is the sender-less default; the point of
    // this test is that a link-only handoff (no email) sends fine.
    render(
      <HandoffInvite
        recipeId={7}
        recipeName="Adobo"
        onSent={() => {}}
        onSkip={() => {}}
      />,
    )
    // no email typed at all
    await userEvent.click(screen.getByRole('button', { name: /get a link to send/i }))
    expect(handoffRecipe).toHaveBeenCalledWith(7, { to_email: null })
    expect(await screen.findByText(/\/invite\/tok123/)).toBeInTheDocument()
  })

  it('calls onSent when the sender taps Done on the share step', async () => {
    const onSent = vi.fn()
    render(<HandoffInvite recipeId={7} onSent={onSent} onSkip={() => {}} />)
    await userEvent.click(screen.getByRole('button', { name: /get a link to send/i }))
    await userEvent.click(await screen.findByRole('button', { name: /done/i }))
    expect(onSent).toHaveBeenCalled()
  })

  it('calls onSkip', async () => {
    const onSkip = vi.fn()
    render(<HandoffInvite recipeId={7} onSent={() => {}} onSkip={onSkip} />)
    await userEvent.click(screen.getByRole('button', { name: /skip/i }))
    expect(onSkip).toHaveBeenCalled()
  })

  it('invites reading and cooking, never remixing or completing (private)', () => {
    render(
      <HandoffInvite
        recipeId={1}
        recipeVisibility="private"
        onSent={() => {}}
        onSkip={() => {}}
      />,
    )
    expect(screen.getByText(/read and cook it/i)).toBeInTheDocument()
    expect(screen.queryByText(/remix/i)).not.toBeInTheDocument()
    // The sharing purpose is to give a dish to someone who's never had it — not to
    // ask them to fill in or edit it (a recipient can't edit anyway).
    expect(screen.queryByText(/add the part/i)).not.toBeInTheDocument()
  })

  it('shows nudge copy for a public recipe', () => {
    render(
      <HandoffInvite
        recipeId={1}
        recipeVisibility="public"
        onSent={() => {}}
        onSkip={() => {}}
      />,
    )
    expect(
      screen.getByText(/already in Browse|don’t have to go looking/i),
    ).toBeInTheDocument()
  })

  // --- the privacy worry round-2 testers raised, answered only as far as the
  // backend actually backs it up (handoff mints a grant; visibility is untouched,
  // so browse's effective_visibility filter still excludes the recipe) ---

  it('promises a private recipe stays out of Browse before you send', () => {
    render(
      <HandoffInvite
        recipeId={1}
        recipeVisibility="private"
        onSent={() => {}}
        onSkip={() => {}}
      />,
    )
    expect(
      screen.getByText(/won’t put your recipe in Browse/i),
    ).toBeInTheDocument()
  })

  it('does NOT claim a private recipe stays out of Browse when it is public', () => {
    render(
      <HandoffInvite
        recipeId={1}
        recipeVisibility="public"
        onSent={() => {}}
        onSkip={() => {}}
      />,
    )
    expect(screen.queryByText(/won’t put your recipe in Browse/i)).toBeNull()
  })

  it('warns on the share step that the link itself is the permission', async () => {
    render(<HandoffInvite recipeId={7} onSent={() => {}} onSkip={() => {}} />)
    await userEvent.click(
      screen.getByRole('button', { name: /get a link to send/i }),
    )
    // /invite/{token} authorizes on the token alone, so a forwarded link works.
    expect(
      await screen.findByText(/anyone who has this link can open the recipe/i),
    ).toBeInTheDocument()
  })

  it('does not claim we email the recipient — nothing in the app sends mail', () => {
    render(<HandoffInvite recipeId={7} onSent={() => {}} onSkip={() => {}} />)
    expect(screen.getByText(/we won’t email them/i)).toBeInTheDocument()
  })

  it('offers no starter chips — just the pre-filled, editable default note', () => {
    // The one-tap starter chips ("You'd love this" / "You asked for it") were
    // removed: the pre-filled default already carries the warm intent the first
    // chip did, so the chips were redundant. The note is the single affordance now.
    render(
      <HandoffInvite
        recipeId={7}
        recipeName="Adobo"
        onSent={() => {}}
        onSkip={() => {}}
      />,
    )
    expect(
      screen.queryByRole('button', { name: /you.d love this/i }),
    ).toBeNull()
    expect(
      screen.queryByRole('button', { name: /you asked for it/i }),
    ).toBeNull()
    expect(
      screen.queryByRole('button', { name: /i made this for you/i }),
    ).toBeNull()
  })

  // The invitation is about one person handing a dish to another, so the note
  // defaults to a warm, ready-to-send message in the SENDER'S OWN VOICE (first
  // person) naming the dish — the sender never faces a blank box, and it sounds
  // like them rather than an app notice.
  describe('default invitation message', () => {
    it('seeds the note in first person, naming the recipe', () => {
      render(
        <HandoffInvite
          recipeId={7}
          recipeName="Adobo"
          onSent={() => {}}
          onSkip={() => {}}
        />,
      )
      expect(screen.getByPlaceholderText(/say something with it/i)).toHaveValue(
        'Here’s my Adobo recipe — I wanted you to have it 💛',
      )
    })

    it('does not put the placeholder "this recipe" into the seeded message', () => {
      // recipeName defaults to the literal string "this recipe" for prose; it must
      // not leak into the message as if it were a dish name.
      render(<HandoffInvite recipeId={7} onSent={() => {}} onSkip={() => {}} />)
      expect(screen.getByPlaceholderText(/say something with it/i)).toHaveValue(
        'Here’s my recipe — I wanted you to have it 💛',
      )
    })

    it('lets the sender edit the seeded message before sharing', async () => {
      render(
        <HandoffInvite
          recipeId={7}
          recipeName="Adobo"
          onSent={() => {}}
          onSkip={() => {}}
        />,
      )
      const note = screen.getByPlaceholderText(/say something with it/i)
      await userEvent.clear(note)
      await userEvent.type(note, 'made this for you, tita')
      expect(note).toHaveValue('made this for you, tita')
      // And the edited note is what gets sent.
      await userEvent.click(
        screen.getByRole('button', { name: /get a link to send/i }),
      )
      expect(handoffRecipe).toHaveBeenCalledWith(7, { to_email: null })
    })
  })
})

// THE DELIVERY HALF HAD NO TESTS AT ALL, which is how the message this component exists to compose
// came to be dropped on three of its four paths. Everything below stubs the two browser APIs the
// share stage depends on.
describe('HandoffInvite — what actually leaves the app (#102)', () => {
  async function reachShareStage() {
    render(<HandoffInvite recipeId={7} recipeName="Adobo" onSent={() => {}} onSkip={() => {}} />)
    await userEvent.click(screen.getByRole('button', { name: /get a link to send/i }))
    await screen.findByText(/\/invite\/tok123/)
  }

  function stubClipboard() {
    const writeText = vi.fn(() => Promise.resolve())
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true })
    return writeText
  }

  afterEach(() => {
    delete navigator.share
  })

  it('shares the MESSAGE and the link together, not the link alone', async () => {
    const share = vi.fn(() => Promise.resolve())
    navigator.share = share
    await reachShareStage()

    await userEvent.click(screen.getByRole('button', { name: /share the link/i }))

    const { text } = share.mock.calls[0][0]
    expect(text).toMatch(/Adobo recipe/)
    expect(text).toContain('/invite/tok123')
  })

  it('copies the WHOLE message when the browser has no share sheet', async () => {
    // Every desktop Firefox, and some desktop Safari. This path used to write the bare URL, so the
    // sentence the compose stage exists to write never left the app for those senders.
    const writeText = stubClipboard()
    await reachShareStage()

    await userEvent.click(screen.getByRole('button', { name: /share the link/i }))

    expect(writeText).toHaveBeenCalledTimes(1)
    const copied = writeText.mock.calls[0][0]
    expect(copied).toMatch(/Adobo recipe/)
    expect(copied).toContain('/invite/tok123')
  })

  it('confirms on the button that was actually pressed', async () => {
    // The only feedback used to appear on the OTHER button, so a sender tapped the primary control
    // and got silence from it.
    stubClipboard()
    await reachShareStage()

    await userEvent.click(screen.getByRole('button', { name: /share the link/i }))

    expect(await screen.findByRole('button', { name: /paste it in your message/i })).toBeInTheDocument()
  })

  it('a CANCELLED share sheet copies nothing and claims nothing', async () => {
    // Cancelling rejects with AbortError. Treating that as a failure worth falling back from
    // flashed "Copied ✓" at someone who had just decided not to send — which reads as "it went".
    const abort = Object.assign(new Error('cancelled'), { name: 'AbortError' })
    navigator.share = vi.fn(() => Promise.reject(abort))
    const writeText = stubClipboard()
    await reachShareStage()

    await userEvent.click(screen.getByRole('button', { name: /share the link/i }))

    expect(writeText).not.toHaveBeenCalled()
    expect(screen.queryByText(/copied/i)).toBeNull()
  })

  it('a REAL share failure still falls back to the clipboard', async () => {
    // Safari rejects with NotAllowedError outside a user gesture. That one is a genuine failure and
    // the clipboard is the right answer — the distinction from a cancel is the whole point.
    navigator.share = vi.fn(() => Promise.reject(Object.assign(new Error('nope'), { name: 'NotAllowedError' })))
    const writeText = stubClipboard()
    await reachShareStage()

    await userEvent.click(screen.getByRole('button', { name: /share the link/i }))

    expect(writeText).toHaveBeenCalledTimes(1)
    expect(writeText.mock.calls[0][0]).toContain('/invite/tok123')
  })

  it('"Copy just the link" copies exactly that', async () => {
    const writeText = stubClipboard()
    await reachShareStage()

    await userEvent.click(screen.getByRole('button', { name: /copy just the link/i }))

    expect(writeText.mock.calls[0][0]).toMatch(/^https?:\/\/[^\s]*\/invite\/tok123$/)
  })
})

describe('HandoffInvite — the Browse reassurance must match the recipe (#102)', () => {
  it('does not tell a FRIENDS recipe that only the link opens it', async () => {
    // `friends` is the default for every new recipe, and every accepted friend can already open it
    // from the profile grid with no link at all — so the private-only line was false on the common
    // path, and contradicted VisibilityControl one tap earlier.
    render(<HandoffInvite recipeId={7} recipeName="Adobo" recipeVisibility="friends" onSent={() => {}} onSkip={() => {}} />)
    expect(screen.getByText(/your friends on issei can already open it/i)).toBeInTheDocument()
    expect(screen.queryByText(/only someone with the link can open it/i)).toBeNull()
  })

  it('keeps the strong promise for a PRIVATE recipe', async () => {
    render(<HandoffInvite recipeId={7} recipeName="Adobo" recipeVisibility="private" onSent={() => {}} onSkip={() => {}} />)
    expect(screen.getByText(/only someone with the link can open it/i)).toBeInTheDocument()
  })

  it('says nothing about Browse for a PUBLIC recipe, because it IS in Browse', async () => {
    render(<HandoffInvite recipeId={7} recipeName="Adobo" recipeVisibility="public" onSent={() => {}} onSkip={() => {}} />)
    expect(screen.queryByText(/won.t put your recipe in Browse/i)).toBeNull()
  })
})

describe('HandoffInvite — the occasion chips (#102)', () => {
  it('offers both occasions, defaulting to the one the app has evidence for', async () => {
    // The app CANNOT know whether someone asked: an in-app request is answered at /requests via
    // fulfillPost(), which never renders this screen, so what arrives here is either an unprompted
    // send or someone who asked at the table. The sender is the only party who knows.
    render(<HandoffInvite recipeId={7} recipeName="Adobo" onSent={() => {}} onSkip={() => {}} />)

    expect(screen.getByRole('button', { name: /they asked for it/i })).toHaveAttribute('aria-pressed', 'false')
    expect(screen.getByRole('button', { name: /just because/i })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByLabelText('Your message')).toHaveValue(
      'Here’s my Adobo recipe — I wanted you to have it 💛',
    )
  })

  it('naming the ask rewrites the message to the product’s own one-liner', async () => {
    render(<HandoffInvite recipeId={7} recipeName="Adobo" onSent={() => {}} onSkip={() => {}} />)

    await userEvent.click(screen.getByRole('button', { name: /they asked for it/i }))

    expect(screen.getByLabelText('Your message')).toHaveValue(
      'You asked for my Adobo recipe — here it is 💛',
    )
  })

  it('NEVER overwrites words the sender typed', async () => {
    // The one thing a chip must not do. Switching occasion after someone has written their own
    // sentence would throw it away — so once touched, their words win and the chip only records
    // the occasion.
    render(<HandoffInvite recipeId={7} recipeName="Adobo" onSent={() => {}} onSkip={() => {}} />)
    const box = screen.getByLabelText('Your message')
    await userEvent.clear(box)
    await userEvent.type(box, 'made this for you, tita')

    await userEvent.click(screen.getByRole('button', { name: /they asked for it/i }))

    expect(box).toHaveValue('made this for you, tita')
  })

  it('says where the message goes', async () => {
    // The box had no label at all, and its placeholder was never seen because it always arrives
    // pre-filled — so nothing told a sender the text lands in their own text message.
    render(<HandoffInvite recipeId={7} recipeName="Adobo" onSent={() => {}} onSkip={() => {}} />)
    expect(screen.getByText(/this goes in your text, with the link/i)).toBeInTheDocument()
  })
})
