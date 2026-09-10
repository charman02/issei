import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'

// Only the axios instance is stubbed. `toUserMessage` stays REAL: it is the
// thing under test in the error cases below, and mocking it would let the
// [object Object] bug back in while the suite stayed green.
vi.mock('../api/client', async () => ({
  ...(await vi.importActual('../api/client')),
  default: { post: vi.fn(), patch: vi.fn() },
}))
import client from '../api/client'

const mockNavigate = vi.fn()
vi.mock('react-router-dom', async () => ({
  ...(await vi.importActual('react-router-dom')),
  useNavigate: () => mockNavigate,
}))
import Login from './Login'

beforeEach(() => {
  localStorage.clear()
  mockNavigate.mockClear()
  client.post.mockReset()
  client.patch.mockReset()
  client.patch.mockResolvedValue({ data: { id: 1, timezone: 'America/New_York' } })
})

describe('Login', () => {
  it('REPLACES history on sign-in so back does not return to /login', async () => {
    // The bug this guards: a pushed entry left /login behind Home, so the very
    // first back gesture a new user made showed them the sign-in screen while
    // already signed in — which reads as "back is broken".
    client.post.mockResolvedValue({
      data: { access_token: 'tok', user: { id: 1, first_name: 'Charlie' } },
    })
    render(
      <MemoryRouter>
        <Login />
      </MemoryRouter>,
    )
    fireEvent.change(screen.getByPlaceholderText('Email'), {
      target: { value: 'a@b.com' },
    })
    fireEvent.change(screen.getByPlaceholderText('Password'), {
      target: { value: 'pw123456' },
    })
    // both the tab and the submit read "Sign in", so submit the form itself
    fireEvent.submit(screen.getByPlaceholderText('Password').closest('form'))

    await waitFor(() =>
      expect(mockNavigate).toHaveBeenCalledWith('/', { replace: true }),
    )
  })

  it('uses kitchen signup copy, not the cookbook "Join the table"', () => {
    render(
      <MemoryRouter>
        <Login />
      </MemoryRouter>,
    )
    // On the Sign In tab, only the signup TAB button reads "Open your kitchen"
    // (the submit button reads "Sign in"), so this is unambiguous.
    expect(
      screen.getByRole('button', { name: /open your kitchen/i }),
    ).toBeInTheDocument()
    expect(
      screen.queryByRole('button', { name: /join the table/i }),
    ).not.toBeInTheDocument()
  })

  it('keeps ONE orienting line and nothing more', async () => {
    // A first-time visitor still needs to know what they're signing into, so the
    // tagline stays. Everything that used to sit under it now runs after signup
    // at /welcome — see Welcome.test.jsx.
    render(
      <MemoryRouter>
        <Login />
      </MemoryRouter>,
    )
    expect(
      screen.getByText(/someone cooked you that you.d never had before/i),
    ).toBeInTheDocument()
    expect(
      screen.queryByText(/not a scrubbed list of grams/i),
    ).not.toBeInTheDocument()
  })

  it('no longer buries the form under a sample recipe and a glossary', async () => {
    // The regression this guards: an earlier pass stacked a pitch card, a sample
    // recipe and the 一世 gloss above the fields, so a returning user had to
    // scroll past an explanation they'd already read to sign in.
    render(
      <MemoryRouter>
        <Login />
      </MemoryRouter>,
    )
    expect(screen.queryByText('3 soup spoons')).not.toBeInTheDocument()
    expect(screen.queryByText('their way')).not.toBeInTheDocument()
    expect(screen.queryByText(/colour of tea/i)).not.toBeInTheDocument()
    expect(screen.queryByText(/一世 · issei/)).not.toBeInTheDocument()
  })

  it('sends a NEW signup to the welcome, and a returning sign-in straight home', async () => {
    // The whole point of threading `isNew` through finishAuth: "empty kitchen"
    // is not the same as "new account", so only signup may trigger the intro.
    client.post.mockResolvedValue({
      data: { access_token: 'tok', user: { id: 1, first_name: 'Mia' } },
    })
    const { unmount } = render(
      <MemoryRouter>
        <Login />
      </MemoryRouter>,
    )
    fireEvent.click(screen.getByRole('button', { name: /open your kitchen/i }))
    fireEvent.change(screen.getByPlaceholderText('First name'), {
      target: { value: 'Mia' },
    })
    fireEvent.change(screen.getByPlaceholderText('Last name'), {
      target: { value: 'Tan' },
    })
    fireEvent.change(screen.getByPlaceholderText('Email'), {
      target: { value: 'a@b.com' },
    })
    fireEvent.change(screen.getByPlaceholderText('Password'), {
      target: { value: 'pw123456' },
    })
    fireEvent.change(screen.getByPlaceholderText('Confirm password'), {
      target: { value: 'pw123456' },
    })
    fireEvent.submit(screen.getByPlaceholderText('Confirm password').closest('form'))
    await waitFor(() =>
      expect(mockNavigate).toHaveBeenCalledWith('/welcome', { replace: true }),
    )
    unmount()

    // Same credentials, sign-in tab: no welcome.
    mockNavigate.mockClear()
    render(
      <MemoryRouter>
        <Login />
      </MemoryRouter>,
    )
    fireEvent.change(screen.getByPlaceholderText('Email'), {
      target: { value: 'a@b.com' },
    })
    fireEvent.change(screen.getByPlaceholderText('Password'), {
      target: { value: 'pw123456' },
    })
    fireEvent.submit(screen.getByPlaceholderText('Password').closest('form'))
    await waitFor(() =>
      expect(mockNavigate).toHaveBeenCalledWith('/', { replace: true }),
    )
    expect(mockNavigate).not.toHaveBeenCalledWith('/welcome', { replace: true })
  })

  it('claims nothing about voice or audio', async () => {
    // There is no audio in the product; Step.voice_note is typed text.
    render(
      <MemoryRouter>
        <Login />
      </MemoryRouter>,
    )
    expect(screen.queryByText(/\bvoice\b/i)).not.toBeInTheDocument()
    expect(screen.queryByText(/recording|audio|listen/i)).not.toBeInTheDocument()
  })

  it('gives an invite recipient the continuation line, not a general intro', async () => {
    // Arriving with ?invite=, this person has just scrolled someone's actual
    // recipe. What they need is the thread back to that dish.
    render(
      <MemoryRouter initialEntries={['/login?tab=signup&invite=abc123']}>
        <Login />
      </MemoryRouter>,
    )
    expect(
      screen.getByText(/one more step to keep that recipe/i),
    ).toBeInTheDocument()
    expect(
      screen.getByText(/in your kitchen, for good/i),
    ).toBeInTheDocument()
  })

  it('claims the invite, skips the welcome, and LANDS ON THE RECIPE', async () => {
    // A tutorial between this person and the dish they signed up for would be the app talking over
    // the thing it is trying to explain — so /welcome is skipped.
    //
    // And the destination is the RECIPE, not '/'. This assertion used to expect '/', justified by
    // "Home leads with their recipe" — true of the hero-deck Home that #67 replaced with the
    // friends feed, which shows a brand-new account nothing of their own at all. The claim response
    // carries recipe_id; using it is what makes the highest-intent moment in the product land on
    // the dish someone signed up to keep.
    client.post.mockResolvedValue({
      data: { access_token: 'tok', user: { id: 1 }, recipe_id: 9 },
    })
    render(
      <MemoryRouter initialEntries={['/login?tab=signup&invite=abc123']}>
        <Login />
      </MemoryRouter>,
    )
    fireEvent.change(screen.getByPlaceholderText('First name'), {
      target: { value: 'Mia' },
    })
    fireEvent.change(screen.getByPlaceholderText('Last name'), {
      target: { value: 'Tan' },
    })
    fireEvent.change(screen.getByPlaceholderText('Email'), {
      target: { value: 'a@b.com' },
    })
    fireEvent.change(screen.getByPlaceholderText('Password'), {
      target: { value: 'pw123456' },
    })
    fireEvent.change(screen.getByPlaceholderText('Confirm password'), {
      target: { value: 'pw123456' },
    })
    fireEvent.submit(
      screen.getByPlaceholderText('Confirm password').closest('form'),
    )
    await waitFor(() =>
      expect(mockNavigate).toHaveBeenCalledWith('/recipes/9', { replace: true }),
    )
    expect(client.post).toHaveBeenCalledWith('/recipes/invite/abc123/claim')
  })


  it('still signs in when the invite claim FAILS, just not onto a recipe', async () => {
    // A dead token must not block sign-in. The claim throws, there is no recipe_id, and the person
    // lands on Home rather than a broken route or an error screen.
    client.post.mockImplementation((url) =>
      url.includes('/claim')
        ? Promise.reject(new Error('gone'))
        : Promise.resolve({ data: { access_token: 'tok', user: { id: 1 } } }),
    )
    render(
      <MemoryRouter initialEntries={['/login?invite=dead']}>
        <Login />
      </MemoryRouter>,
    )
    fireEvent.change(screen.getByPlaceholderText('Email'), { target: { value: 'a@b.com' } })
    fireEvent.change(screen.getByPlaceholderText('Password'), { target: { value: 'pw123456' } })
    fireEvent.submit(screen.getByPlaceholderText('Password').closest('form'))

    await waitFor(() => expect(mockNavigate).toHaveBeenCalledWith('/', { replace: true }))
  })

  // --- Error rendering -----------------------------------------------------
  // The live bug: FastAPI answers a schema failure with 422 and `detail` as an
  // ARRAY OF OBJECTS, and `detail || 'Login failed'` rendered that array —
  // "[object Object]" in the pill. The first thing a new user hit if they chose
  // a short password. Normalization now happens in api/client (toUserMessage),
  // so these assert the rendered pill, not the helper.
  it('renders a 422 array-shaped detail as readable text, never an object', async () => {
    client.post.mockRejectedValue({
      response: {
        status: 422,
        data: {
          detail: [
            {
              type: 'string_too_short',
              loc: ['body', 'password'],
              msg: 'String should have at least 8 characters',
            },
          ],
        },
      },
    })
    render(
      <MemoryRouter>
        <Login />
      </MemoryRouter>,
    )
    fireEvent.change(screen.getByPlaceholderText('Email'), {
      target: { value: 'a@b.com' },
    })
    // long enough to clear the client-side check, so the server's 422 is what
    // reaches the pill
    fireEvent.change(screen.getByPlaceholderText('Password'), {
      target: { value: 'pw123456' },
    })
    fireEvent.submit(screen.getByPlaceholderText('Password').closest('form'))

    const pill = await screen.findByText(/at least 8 characters/i)
    expect(pill).toBeInTheDocument()
    expect(pill.textContent).not.toMatch(/object Object|\[\{|"loc"/)
  })

  it('names every failing field when a 422 reports more than one', async () => {
    // Surfacing only the first would make the user fix one thing, submit, and
    // get stopped again by a rule that was already broken.
    client.post.mockRejectedValue({
      response: {
        status: 422,
        data: {
          detail: [
            { loc: ['body', 'email'], msg: 'value is not a valid email address: bad' },
            { loc: ['body', 'first_name'], msg: 'String should have at least 1 character' },
          ],
        },
      },
    })
    render(
      <MemoryRouter>
        <Login />
      </MemoryRouter>,
    )
    fireEvent.change(screen.getByPlaceholderText('Email'), {
      target: { value: 'a@b.com' },
    })
    fireEvent.change(screen.getByPlaceholderText('Password'), {
      target: { value: 'pw123456' },
    })
    fireEvent.submit(screen.getByPlaceholderText('Password').closest('form'))

    expect(await screen.findByText(/doesn.t look right/i)).toBeInTheDocument()
    expect(screen.getByText(/First name needs at least 1 character/i)).toBeInTheDocument()
  })

  it('passes a plain-string detail through as the router wrote it', async () => {
    client.post.mockRejectedValue({
      response: { status: 401, data: { detail: 'Invalid email or password' } },
    })
    render(
      <MemoryRouter>
        <Login />
      </MemoryRouter>,
    )
    fireEvent.change(screen.getByPlaceholderText('Email'), {
      target: { value: 'a@b.com' },
    })
    fireEvent.change(screen.getByPlaceholderText('Password'), {
      target: { value: 'pw123456' },
    })
    fireEvent.submit(screen.getByPlaceholderText('Password').closest('form'))

    expect(await screen.findByText('Invalid email or password')).toBeInTheDocument()
  })

  it('says the connection failed when there is no response, not that sign-in failed', async () => {
    // An offline phone is not a wrong password. Telling this user "Login failed"
    // sends them to change a password that was never the problem.
    client.post.mockRejectedValue({ message: 'Network Error' })
    render(
      <MemoryRouter>
        <Login />
      </MemoryRouter>,
    )
    fireEvent.change(screen.getByPlaceholderText('Email'), {
      target: { value: 'a@b.com' },
    })
    fireEvent.change(screen.getByPlaceholderText('Password'), {
      target: { value: 'pw123456' },
    })
    fireEvent.submit(screen.getByPlaceholderText('Password').closest('form'))

    expect(await screen.findByText(/check your connection/i)).toBeInTheDocument()
    expect(screen.queryByText(/Sign-in didn/i)).not.toBeInTheDocument()
  })

  // --- Inline validation, before the request ------------------------------
  function fillSignup(overrides = {}) {
    const values = {
      'First name': 'Mia',
      'Last name': 'Tan',
      Email: 'a@b.com',
      Password: 'pw123456',
      'Confirm password': 'pw123456',
      ...overrides,
    }
    for (const [placeholder, value] of Object.entries(values)) {
      fireEvent.change(screen.getByPlaceholderText(placeholder), {
        target: { value },
      })
    }
    fireEvent.submit(
      screen.getByPlaceholderText('Confirm password').closest('form'),
    )
  }

  function renderSignup() {
    render(
      <MemoryRouter initialEntries={['/login?tab=signup']}>
        <Login />
      </MemoryRouter>,
    )
  }

  it('states the password minimum up front, before anyone can fail it', async () => {
    // A minimum you discover by being rejected is a minimum stated too late.
    renderSignup()
    expect(screen.getByText(/at least 8 characters/i)).toBeInTheDocument()
  })

  it('rejects a malformed email without asking the server', async () => {
    renderSignup()
    fillSignup({ Email: 'mia@' })
    expect(await screen.findByText(/doesn.t look right/i)).toBeInTheDocument()
    expect(client.post).not.toHaveBeenCalled()
  })

  it('rejects a short password without asking the server', async () => {
    renderSignup()
    fillSignup({ Password: 'pw1', 'Confirm password': 'pw1' })
    expect(
      await screen.findByText(/Passwords need at least 8 characters/i),
    ).toBeInTheDocument()
    expect(client.post).not.toHaveBeenCalled()
  })

  it('rejects a whitespace-only name — the byline would render as nothing', async () => {
    renderSignup()
    fillSignup({ 'First name': '   ' })
    expect(
      await screen.findByText(/Add your first name/i),
    ).toBeInTheDocument()
    expect(client.post).not.toHaveBeenCalled()
  })

  it('rejects a whitespace-only last name too', async () => {
    renderSignup()
    fillSignup({ 'Last name': '  ' })
    expect(await screen.findByText(/Add your last name/i)).toBeInTheDocument()
    expect(client.post).not.toHaveBeenCalled()
  })

  it('still catches mismatched passwords', async () => {
    renderSignup()
    fillSignup({ 'Confirm password': 'pw12345678' })
    expect(await screen.findByText(/Those passwords don.t match/i)).toBeInTheDocument()
    expect(client.post).not.toHaveBeenCalled()
  })

  it('sends trimmed names — a stray space should not become part of a byline', async () => {
    client.post.mockResolvedValue({
      data: { access_token: 'tok', user: { id: 1 } },
    })
    renderSignup()
    fillSignup({ 'First name': '  Mia ', 'Last name': ' Tan  ' })
    await waitFor(() =>
      expect(client.post).toHaveBeenCalledWith(
        '/auth/signup',
        expect.objectContaining({ first_name: 'Mia', last_name: 'Tan' }),
      ),
    )
  })

  it('clears fields when switching Sign In ↔ signup', async () => {
    render(
      <MemoryRouter>
        <Login />
      </MemoryRouter>,
    )
    // type an email on the Sign In tab
    const email = screen.getByPlaceholderText('Email')
    fireEvent.change(email, { target: { value: 'stale@example.com' } })
    expect(email).toHaveValue('stale@example.com')
    // switch to signup (click the signup tab), then back to Sign In
    fireEvent.click(
      screen.getByRole('button', { name: /open your kitchen/i }),
    )
    // now on signup: TWO buttons read "open your kitchen" (tab + submit).
    // Return to Sign In via its tab.
    fireEvent.click(screen.getByRole('button', { name: /^sign in$/i }))
    // the email field is a fresh empty field
    expect(screen.getByPlaceholderText('Email')).toHaveValue('')
  })
})

describe('Login — the timezone the daily nudge depends on (#89)', () => {
  // WHY THIS LIVES ON THE SIGN-IN PATH. The daily prompt fires at a fixed hour in the RECIPIENT'S
  // local time, and `services/prompt.local_now()` returns None — "never due" — for a user with no
  // zone stored. Nobody opens settings to volunteer a value the browser already knows, so if this
  // one line goes, notifications quietly stop reaching every new account and no other test notices.
  function signIn(userOverrides = {}) {
    client.post.mockResolvedValue({
      data: {
        access_token: 'tok',
        user: { id: 1, first_name: 'Charlie', ...userOverrides },
      },
    })
    render(
      <MemoryRouter>
        <Login />
      </MemoryRouter>,
    )
    fireEvent.change(screen.getByPlaceholderText('Email'), { target: { value: 'a@b.com' } })
    fireEvent.change(screen.getByPlaceholderText('Password'), { target: { value: 'pw123456' } })
    fireEvent.submit(screen.getByPlaceholderText('Password').closest('form'))
  }

  it('sends the browser zone on sign-in', async () => {
    signIn()
    await waitFor(() =>
      expect(client.patch).toHaveBeenCalledWith('/auth/me', {
        timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
      }),
    )
  })

  it('does NOT re-send it when the server already has the same zone', async () => {
    // A returning user signs in often; a write per sign-in for an unchanged value is pure noise.
    signIn({ timezone: Intl.DateTimeFormat().resolvedOptions().timeZone })
    await waitFor(() => expect(mockNavigate).toHaveBeenCalled())
    expect(client.patch).not.toHaveBeenCalled()
  })

  it('signs in normally when the timezone write FAILS', async () => {
    // Not awaited and not fatal: a zone is not worth failing a sign-in over, and the next sign-in
    // tries again. Awaiting it also put a round trip between the tap and the destination.
    client.patch.mockRejectedValue(new Error('boom'))
    signIn()
    await waitFor(() => expect(mockNavigate).toHaveBeenCalledWith('/', { replace: true }))
  })
})
