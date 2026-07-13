import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'

vi.mock('../api/client', () => ({ default: { post: vi.fn() } }))
import Login from './Login'

describe('Login', () => {
  it('uses garden signup copy, not the cookbook "Join the table"', () => {
    render(
      <MemoryRouter>
        <Login />
      </MemoryRouter>,
    )
    // On the Sign In tab, only the signup TAB button reads "Plant your first
    // seed" (the submit button reads "Sign in"), so this is unambiguous.
    expect(
      screen.getByRole('button', { name: /plant your first seed/i }),
    ).toBeInTheDocument()
    expect(
      screen.queryByRole('button', { name: /join the table/i }),
    ).not.toBeInTheDocument()
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
      screen.getByRole('button', { name: /plant your first seed/i }),
    )
    // now on signup: TWO buttons read "plant your first seed" (tab + submit).
    // Return to Sign In via its tab.
    fireEvent.click(screen.getByRole('button', { name: /^sign in$/i }))
    // the email field is a fresh empty field
    expect(screen.getByPlaceholderText('Email')).toHaveValue('')
  })
})
