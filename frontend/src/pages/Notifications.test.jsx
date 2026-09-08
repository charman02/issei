import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Routes, Route } from 'react-router-dom'

vi.mock('../api/notifications', () => ({
  getNotifications: vi.fn(),
  markNotificationsRead: vi.fn(),
}))
import { getNotifications, markNotificationsRead } from '../api/notifications'
import Notifications from './Notifications'

const note = (over = {}) => ({
  id: 1,
  type: 'recipe_request',
  actor_id: 7,
  actor_first_name: 'Ana',
  actor_last_name: 'Cruz',
  actor_photo_url: null,
  post_id: 5,
  recipe_id: null,
  subject: 'Sinigang',
  read: false,
  created_at: new Date().toISOString(),
  ...over,
})

function renderPage(notifications = []) {
  markNotificationsRead.mockResolvedValue({ data: { notifications, unread_count: 0 } })
  getNotifications.mockResolvedValue({ data: { notifications, unread_count: 0 } })
  return render(
    <MemoryRouter initialEntries={['/notifications']}>
      <Routes>
        <Route path="/notifications" element={<Notifications />} />
        <Route path="/requests" element={<div>requests page</div>} />
        <Route path="/recipes/:id" element={<div>recipe page</div>} />
        <Route path="/friends" element={<div>friends page</div>} />
        <Route path="/u/:id" element={<div>their profile</div>} />
      </Routes>
    </MemoryRouter>,
  )
}

beforeEach(() => vi.clearAllMocks())

describe('Notifications — issei’s first inbox (#79)', () => {
  it('marks everything read on open, in the same call that fetches', async () => {
    renderPage([note()])
    await screen.findByText(/asked you for your Sinigang/i)
    // One round trip: the list returned by the mark-read call IS what renders, so the badge
    // and the rows can never disagree.
    expect(markNotificationsRead).toHaveBeenCalledTimes(1)
    expect(getNotifications).not.toHaveBeenCalled()
  })

  it('still shows the list if marking read fails', async () => {
    markNotificationsRead.mockRejectedValue(new Error('offline'))
    getNotifications.mockResolvedValue({
      data: { notifications: [note()], unread_count: 1 },
    })
    render(
      <MemoryRouter>
        <Notifications />
      </MemoryRouter>,
    )
    // A failed write must not cost you the ability to READ your inbox.
    expect(await screen.findByText(/asked you for your Sinigang/i)).toBeInTheDocument()
  })

  it('says the right sentence for each type', async () => {
    renderPage([
      note({ id: 1, type: 'recipe_request', subject: 'Sinigang' }),
      note({ id: 2, type: 'request_fulfilled', subject: 'Adobo', recipe_id: 9 }),
      note({ id: 3, type: 'friend_request', subject: null, post_id: null }),
      note({ id: 4, type: 'friend_accept', subject: null, post_id: null }),
    ])
    expect(await screen.findByText('Ana Cruz asked you for your Sinigang.')).toBeInTheDocument()
    expect(screen.getByText('Ana Cruz sent you Adobo.')).toBeInTheDocument()
    expect(screen.getByText('Ana Cruz wants to be friends.')).toBeInTheDocument()
    expect(screen.getByText('Ana Cruz is now your friend.')).toBeInTheDocument()
  })

  it('renders an unknown type as a line rather than blanking the inbox', async () => {
    // A client can be older than the server that wrote the row; the inbox must survive it.
    renderPage([note({ type: 'something_new_2027', subject: null, post_id: null })])
    expect(await screen.findByText(/Ana Cruz did something\./)).toBeInTheDocument()
  })

  it('an ask opens the cook’s requests page', async () => {
    renderPage([note({ type: 'recipe_request' })])
    await userEvent.click(await screen.findByText(/asked you for your Sinigang/i))
    expect(await screen.findByText('requests page')).toBeInTheDocument()
  })

  it('an arrival opens the recipe itself', async () => {
    renderPage([note({ type: 'request_fulfilled', recipe_id: 9, subject: 'Adobo' })])
    await userEvent.click(await screen.findByText(/sent you Adobo/i))
    expect(await screen.findByText('recipe page')).toBeInTheDocument()
  })

  it('a line whose subject was deleted still reads, but is not a link', async () => {
    // The FK SET NULLs when a post or recipe is deleted. The fact that it happened is still
    // true, so the line stays — it just must not offer a tap that 404s.
    renderPage([
      note({ type: 'request_fulfilled', recipe_id: null, post_id: null, subject: null }),
    ])
    expect(
      await screen.findByText('Ana Cruz sent you the recipe you asked for.'),
    ).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /sent you/i })).not.toBeInTheDocument()
  })

  it('an ask whose post was deleted still reads, but is not a link either', async () => {
    // Same rule as above, for the type that was missing it: `recipe_request` linked to
    // /requests unconditionally, so after the cook deleted the post the line tapped through
    // to an empty asks page — asserting an ask that had cascaded away with the post.
    renderPage([note({ type: 'recipe_request', post_id: null, subject: null })])
    expect(await screen.findByText(/asked you for a recipe/i)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /asked you for a recipe/i })).toBeNull()
  })

  it('an ask whose post still exists DOES open the asks page', async () => {
    renderPage([note({ type: 'recipe_request', post_id: 5, subject: null })])
    await userEvent.click(await screen.findByText(/asked you for a recipe/i))
    expect(await screen.findByText('requests page')).toBeInTheDocument()
  })

  it('a keep says SOMEONE, never a name (#96)', async () => {
    // The API already nulls every actor field for this type; the copy hardcodes "Someone" as
    // well, so a server-side regression that leaked the name still couldn't surface it. The
    // cook learns how many people kept a recipe, never who.
    renderPage([
      note({ type: 'recipe_kept', actor_first_name: null, actor_last_name: null,
             actor_photo_url: null, post_id: null, recipe_id: 4, subject: 'Adobo' }),
    ])
    expect(await screen.findByText('Someone kept your Adobo.')).toBeInTheDocument()
  })

  it('a keep will not print a name even if one arrives anyway', async () => {
    // Belt and braces: the client must not be the only thing standing between a leaked actor
    // and the screen, but it must not be the thing that leaks it either.
    renderPage([
      note({ type: 'recipe_kept', actor_first_name: 'Zenobia', actor_last_name: 'Quist',
             recipe_id: 4, subject: 'Adobo' }),
    ])
    expect(await screen.findByText('Someone kept your Adobo.')).toBeInTheDocument()
    expect(screen.queryByText(/Zenobia/)).toBeNull()
  })

  it('a keep opens the recipe, and nothing when the recipe is gone', async () => {
    renderPage([note({ type: 'recipe_kept', recipe_id: 4, subject: 'Adobo' })])
    await userEvent.click(await screen.findByText('Someone kept your Adobo.'))
    expect(await screen.findByText('recipe page')).toBeInTheDocument()
  })

  it('a keep whose recipe was deleted still reads, but is not a link', async () => {
    renderPage([
      note({ type: 'recipe_kept', recipe_id: null, post_id: null, subject: null }),
    ])
    expect(await screen.findByText(/someone kept one of your recipes/i)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /someone kept/i })).toBeNull()
  })

  it('an empty inbox explains itself instead of showing a blank screen', async () => {
    renderPage([])
    expect(await screen.findByText(/nothing new/i)).toBeInTheDocument()
  })

  it('never says voice, audio, recording or listen', async () => {
    // POSITIONING: a per-step note is TYPED text. A new user-facing surface is exactly where
    // that claim gets made by accident.
    const BANNED = /record|recording|\bvoice\b|audio|in their own words|listen/i
    renderPage([
      note({ id: 1, type: 'recipe_request' }),
      note({ id: 2, type: 'request_fulfilled', recipe_id: 9, subject: 'Adobo' }),
      note({ id: 3, type: 'friend_request', subject: null }),
    ])
    await screen.findByText(/asked you for your Sinigang/i)
    expect(document.body.textContent).not.toMatch(BANNED)
  })
})
