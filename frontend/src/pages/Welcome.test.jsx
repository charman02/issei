import { describe, it, expect, beforeEach, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Routes, Route } from 'react-router-dom'
// #110 put a notifications ask on the last panel. jsdom has no PushManager, so without a mock
// `pushAvailability()` returns 'unsupported' and the panel renders its honest can't-do branch —
// which is what most of the tests above exercise. These handles let the other two branches be
// driven, since 'ready' and 'install-first' are the states that matter to real people.
const push = { availability: 'unsupported', enable: vi.fn() }
vi.mock('../lib/push', () => ({
  pushAvailability: () => push.availability,
  enable: (...args) => push.enable(...args),
}))
import Welcome from './Welcome'

function renderWelcome() {
  return render(
    <MemoryRouter initialEntries={['/welcome']}>
      <Routes>
        <Route path="/welcome" element={<Welcome />} />
        <Route path="/" element={<div>home</div>} />
      </Routes>
    </MemoryRouter>,
  )
}

// "Seen" is recorded per user id, so a signed-in user has to exist for any of
// this to mean anything — that scoping is what stops the second person to sign up
// on a shared phone from being silently skipped.
function signIn(id = 7) {
  localStorage.setItem('issei_user', JSON.stringify({ id, first_name: 'Charlie' }))
}

beforeEach(() => {
  push.availability = 'unsupported'
  push.enable = vi.fn(() => Promise.resolve({ ok: true }))
  localStorage.clear()
  signIn()
})

describe('Welcome — what it teaches', () => {
  it('shows what the app is for by SHOWING a recipe, then names itself', async () => {
    renderWelcome()
    expect(screen.getByText(/their way\./)).toBeInTheDocument()
    // Deliberately terse: the owner cut this panel's paragraph, because a new
    // user shouldn't have to read prose to learn what the app is. The sample
    // card below is the evidence, so the words only have to point at it.
    expect(screen.getByText(/not grams\. theirs\./i)).toBeInTheDocument()
    // The sample card — a folk amount kept verbatim, badged as theirs, plus the
    // remark that carries the knowledge an ingredient list can't hold.
    expect(screen.getByText('3 soup spoons')).toBeInTheDocument()
    expect(screen.getByText('their way')).toBeInTheDocument()
    expect(screen.getByText(/colour of tea/i)).toBeInTheDocument()
    // The gloss, on the same panel but last.
    expect(screen.getByText(/一世 · issei/)).toBeInTheDocument()
  })

  it('covers the second half — how to actually use it', async () => {
    renderWelcome()
    await userEvent.click(screen.getByRole('button', { name: /next/i }))
    expect(screen.getByText('Write a recipe')).toBeInTheDocument()
    expect(screen.getByText('Send it to someone')).toBeInTheDocument()
    // The instruction names the control the user will actually find on the
    // recipe page, verbatim — a paraphrase would send them hunting.
    expect(
      screen.getByText(/Send this to someone/),
    ).toBeInTheDocument()
  })

  it('is four panels — two that teach, then two optional ACTION steps', async () => {
    // The rule is "at most two TEACHING panels", not "never more than two panels". Panels 1–2
    // teach; 3 and 4 are single optional ACTIONS (add a photo, allow notifications), each with a
    // fallback elsewhere in the app for anyone who skips — the You-page nudge (#77) and the Home
    // strip (`NotifyNudge`) respectively. That's what keeps a fourth panel from being drift.
    renderWelcome()
    expect(screen.getByText('1 of 4')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: /next/i }))
    expect(screen.getByText('2 of 4')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: /next/i }))
    expect(screen.getByText('3 of 4')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: /skip for now/i }))
    expect(screen.getByText('4 of 4')).toBeInTheDocument()
    // The notifications panel is the last one: it finishes, it does not go to a fifth.
    expect(screen.queryByText('5 of')).not.toBeInTheDocument()
  })

  it('the photo step is genuinely optional — skipping it advances, never blocks', async () => {
    // Honesty requirement: the photo panel must never be a gate. With no photo picked its button
    // reads "Skip for now" and moves on rather than finishing — it is no longer the last panel.
    renderWelcome()
    await userEvent.click(screen.getByRole('button', { name: /next/i }))
    await userEvent.click(screen.getByRole('button', { name: /next/i }))
    expect(screen.getByLabelText(/add a profile photo/i)).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: /skip for now/i }))
    expect(screen.getByText('4 of 4')).toBeInTheDocument()
  })

  it('claims nothing about voice or audio', async () => {
    // There is no audio in the product: Step.voice_note is a TEXT column typed by
    // whoever recorded the recipe.
    renderWelcome()
    expect(screen.queryByText(/\bvoice\b/i)).not.toBeInTheDocument()
    expect(screen.queryByText(/recording|audio|listen/i)).not.toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: /next/i }))
    expect(screen.queryByText(/\bvoice\b/i)).not.toBeInTheDocument()
    expect(screen.queryByText(/recording|audio|listen/i)).not.toBeInTheDocument()
  })

  it('never suggests you can edit a recipe someone sent you', async () => {
    // Verified false: PATCH /recipes/{id} filters on user_id, so a granted
    // non-owner cannot edit.
    renderWelcome()
    await userEvent.click(screen.getByRole('button', { name: /next/i }))
    expect(screen.queryByText(/edit/i)).not.toBeInTheDocument()
  })
})

describe('Welcome — shows exactly once', () => {
  it('marks itself seen on arrival, before any button is pressed', async () => {
    renderWelcome()
    expect(screen.getByText('1 of 4')).toBeInTheDocument()
    // Closing the tab here must be as final as finishing, so the flag is written
    // on mount rather than on exit.
    expect(JSON.parse(localStorage.getItem('issei_prefs')).welcomeSeenBy).toEqual([
      7,
    ])
  })

  it('skipping is as final as completing — a second visit redirects home', async () => {
    const { unmount } = renderWelcome()
    await userEvent.click(screen.getByRole('button', { name: /skip/i }))
    expect(await screen.findByText('home')).toBeInTheDocument()
    unmount()

    renderWelcome()
    expect(await screen.findByText('home')).toBeInTheDocument()
    expect(screen.queryByText('1 of 4')).not.toBeInTheDocument()
  })

  it('completing also persists, and lands on Home', async () => {
    const { unmount } = renderWelcome()
    // Walk both teaching panels, skip the photo, then finish from the notifications panel. In
    // jsdom there is no PushManager, so that panel renders its "this browser can't" branch and its
    // one button finishes — which is the honest behaviour, not a test convenience.
    await userEvent.click(screen.getByRole('button', { name: /next/i }))
    await userEvent.click(screen.getByRole('button', { name: /next/i }))
    await userEvent.click(screen.getByRole('button', { name: /skip for now/i }))
    await userEvent.click(screen.getByRole('button', { name: /open my kitchen/i }))
    expect(await screen.findByText('home')).toBeInTheDocument()
    unmount()

    renderWelcome()
    expect(await screen.findByText('home')).toBeInTheDocument()
  })

  it('Back steps back ONE panel from anywhere, never straight to the start', async () => {
    // A forward-only intro means one mistaken tap costs the explanation for good,
    // since the welcome never runs again. Back must also step back exactly one — from
    // the photo panel it should land on the how-to panel, not skip it back to panel one.
    renderWelcome()
    expect(screen.queryByRole('button', { name: /back/i })).not.toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: /next/i }))
    await userEvent.click(screen.getByRole('button', { name: /next/i }))
    await userEvent.click(screen.getByRole('button', { name: /skip for now/i }))
    // On the notifications panel now; Back → the photo panel, not two back.
    expect(screen.getByText('4 of 4')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: /back/i }))
    expect(screen.getByText('3 of 4')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: /back/i }))
    expect(screen.getByText('2 of 4')).toBeInTheDocument()
    // And Back again → panel one, with its content.
    await userEvent.click(screen.getByRole('button', { name: /back/i }))
    expect(screen.getByText('1 of 4')).toBeInTheDocument()
    expect(screen.getByText(/not grams\. theirs\./i)).toBeInTheDocument()
  })

  it('skip is reachable from EVERY panel, so nobody is stranded', async () => {
    // The header Skip is at the same coordinates on all three panels. On the photo
    // panel there are two ways out (header Skip + the "Skip for now" finish button),
    // so getAllByRole is used there rather than the single-match getByRole.
    renderWelcome()
    expect(screen.getByRole('button', { name: /^skip$/i })).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: /next/i }))
    expect(screen.getByRole('button', { name: /^skip$/i })).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: /next/i }))
    expect(screen.getByRole('button', { name: /^skip$/i })).toBeInTheDocument()
  })

  it('shares the issei_prefs bag rather than inventing a key', async () => {
    // One bag means "clear site data" resets every client-side preference
    // together, and Profile's toggles must survive the welcome writing to it.
    localStorage.setItem('issei_prefs', JSON.stringify({ reduceMotion: true }))
    renderWelcome()
    const prefs = JSON.parse(localStorage.getItem('issei_prefs'))
    expect(prefs).toEqual({ reduceMotion: true, welcomeSeenBy: [7] })
  })

  it('welcomes a SECOND account on the same device', async () => {
    // The bug this pins: a single boolean flag meant the second person to sign up
    // on a shared phone never got welcomed, because the first had already set it.
    const { unmount } = renderWelcome()
    await userEvent.click(screen.getByRole('button', { name: /skip/i }))
    unmount()

    signIn(99)
    renderWelcome()
    expect(screen.getByText('1 of 4')).toBeInTheDocument()
    // and the first account is still marked, not clobbered
    expect(
      JSON.parse(localStorage.getItem('issei_prefs')).welcomeSeenBy,
    ).toEqual([7, 99])
  })

  it('tolerates the old boolean flag shape instead of crashing', async () => {
    // A user mid-session when this shipped has `welcomeSeen: true` from the old
    // scheme. They get welcomed once more rather than hitting a type error.
    localStorage.setItem('issei_prefs', JSON.stringify({ welcomeSeen: true }))
    renderWelcome()
    expect(screen.getByText('1 of 4')).toBeInTheDocument()
  })

  it('survives an unreadable prefs bag instead of crashing', async () => {
    localStorage.setItem('issei_prefs', 'not json{')
    renderWelcome()
    expect(screen.getByText('1 of 4')).toBeInTheDocument()
  })
})

describe('Welcome — the notifications ask (#110)', () => {
  async function toNotifyPanel() {
    renderWelcome()
    await userEvent.click(screen.getByRole('button', { name: /next/i }))
    await userEvent.click(screen.getByRole('button', { name: /next/i }))
    await userEvent.click(screen.getByRole('button', { name: /skip for now/i }))
    expect(screen.getByText('4 of 4')).toBeInTheDocument()
  }

  it('does NOT fire the permission dialog on arrival — it explains first', async () => {
    // THE ONE-SHOT PROBLEM, and the reason this panel exists in this shape. A decline sets
    // `denied` for the origin permanently: no web app can ask again, the person has to go into
    // browser settings. Firing the system dialog the instant the panel mounts is the version of
    // "ask on first launch" that permanently loses people who would have said yes once they knew
    // what arrives. So the dialog sits behind a tap, after two lines naming what it's for.
    push.availability = 'ready'
    await toNotifyPanel()
    expect(push.enable).not.toHaveBeenCalled()
    expect(screen.getByRole('button', { name: /turn on notifications/i })).toBeInTheDocument()
  })

  it('names the two things that actually arrive, and no third', async () => {
    // A permission ask converts on being specific. "Stay updated" is what an app says when it
    // intends to send whatever it likes later.
    push.availability = 'ready'
    await toNotifyPanel()
    expect(screen.getByText(/asks you for a recipe/i)).toBeInTheDocument()
    expect(screen.getByText(/nudge to share what you cooked/i)).toBeInTheDocument()
    expect(screen.getByText(/two things, and nothing else/i)).toBeInTheDocument()
  })

  it('granting subscribes and silences the Home strip, so the yes is only asked once', async () => {
    // Without the pref, `NotifyNudge` would offer it again on the very next screen — which reads
    // as the app not having heard the answer. Same key `NotificationSettings` writes.
    push.availability = 'ready'
    await toNotifyPanel()
    await userEvent.click(screen.getByRole('button', { name: /turn on notifications/i }))

    await waitFor(() => expect(push.enable).toHaveBeenCalled())
    expect(await screen.findByText(/you.{0,3}re set/i)).toBeInTheDocument()
    expect(JSON.parse(localStorage.getItem('issei_prefs')).notifyNudgeDismissed).toBe(true)
    // And the finish is now the only way on — no second chance to press the same button.
    expect(screen.queryByRole('button', { name: /turn on notifications/i })).toBeNull()
  })

  it('"Not now" finishes WITHOUT touching permission, so Home can still ask', async () => {
    // This is what makes the panel genuinely optional. Skipping leaves permission at 'default',
    // which is exactly the state NotifyNudge shows for — so only a real decline is final, and the
    // pref that hides the strip is deliberately NOT written here.
    push.availability = 'ready'
    await toNotifyPanel()
    await userEvent.click(screen.getByRole('button', { name: /not now/i }))

    expect(push.enable).not.toHaveBeenCalled()
    expect(await screen.findByText('home')).toBeInTheDocument()
    expect(JSON.parse(localStorage.getItem('issei_prefs') || '{}').notifyNudgeDismissed).toBeUndefined()
  })

  it('a refusal shows why and leaves the way out working', async () => {
    push.availability = 'ready'
    push.enable = vi.fn(() => Promise.resolve({ ok: false, message: 'Permission was blocked.' }))
    await toNotifyPanel()
    await userEvent.click(screen.getByRole('button', { name: /turn on notifications/i }))

    expect(await screen.findByText(/permission was blocked/i)).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: /not now/i }))
    expect(await screen.findByText('home')).toBeInTheDocument()
  })

  it('on an iPhone in Safari it teaches the INSTALL, never a button that cannot work', async () => {
    // Push is granted only to a site added to the home screen, so there is nothing to ask for yet.
    // Not an edge case: iPhones are most of this app's audience, and on iOS "when they first
    // download the app" has no download — it has Add to Home Screen. Rendering the real button
    // here would be a control that fails on tap, which is the mistake NotificationSettings
    // already refuses to make.
    push.availability = 'install-first'
    await toNotifyPanel()
    expect(screen.getByText(/add to home screen/i)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /turn on notifications/i })).toBeNull()
    await userEvent.click(screen.getByRole('button', { name: /open my kitchen/i }))
    expect(await screen.findByText('home')).toBeInTheDocument()
  })

  it('an unsupported browser says so plainly and still finishes', async () => {
    push.availability = 'unsupported'
    await toNotifyPanel()
    expect(screen.getByText(/can.{0,3}t do notifications/i)).toBeInTheDocument()
    expect(screen.getByText(/still shows up in your inbox/i)).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: /open my kitchen/i }))
    expect(await screen.findByText('home')).toBeInTheDocument()
  })

  it('claims no audio, on the newest panel in the flow', async () => {
    // POSITIONING: every new user-facing surface tends to add one of these, so the sweep runs here
    // too rather than only over the teaching panels.
    push.availability = 'ready'
    await toNotifyPanel()
    const BANNED = /record|recording|\bvoice\b|audio|in (their|your|his|her)( own)? words|listen/i
    expect(document.body.textContent).not.toMatch(BANNED)
  })
})
