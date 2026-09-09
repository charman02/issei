import { describe, it, expect, vi, beforeEach } from 'vitest'
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
    expect(handoffRecipe).toHaveBeenCalledWith(7, {
      to_email: 'mom@example.com',
      note: 'your adobo',
    })
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
    expect(handoffRecipe).toHaveBeenCalledWith(7, {
      to_email: null,
      note: 'Here’s my Adobo recipe — I wanted you to have it 💛',
    })
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
      expect(handoffRecipe).toHaveBeenCalledWith(7, {
        to_email: null,
        note: 'made this for you, tita',
      })
    })
  })
})
