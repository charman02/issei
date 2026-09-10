import { describe, it, expect } from 'vitest'
import { defaultInviteMessage } from './inviteMessage'

describe('defaultInviteMessage', () => {
  it('speaks in the sender’s own voice and names the dish', () => {
    // First person on purpose: the message is shared from the sender's own texting
    // app, so it reads like them, not an app notification that names them.
    expect(defaultInviteMessage({ recipeName: 'Adobo' })).toBe(
      'Here’s my Adobo recipe — I wanted you to have it 💛',
    )
  })

  it('stays a clean sentence when the dish is unknown', () => {
    expect(defaultInviteMessage({})).toBe(
      'Here’s my recipe — I wanted you to have it 💛',
    )
    expect(defaultInviteMessage()).toBe(
      'Here’s my recipe — I wanted you to have it 💛',
    )
  })

  it('trims whitespace so a blank-but-present dish is treated as absent', () => {
    expect(defaultInviteMessage({ recipeName: '   ' })).toBe(
      'Here’s my recipe — I wanted you to have it 💛',
    )
  })

  it('never mentions audio — this is a message about passing a recipe', () => {
    // POSITIONING: the ban is app-wide. The message copy has no reason to imply
    // sound, and this guards against a future rewrite that does.
    const banned = /record|recording|\bvoice\b|audio|listen/i
    for (const args of [{ recipeName: 'Adobo' }, {}]) {
      expect(defaultInviteMessage(args)).not.toMatch(banned)
    }
  })
})

describe('the asked-for variant (#102)', () => {
  // The product's own one-liner is "you asked for the recipe", so this is the truest sentence
  // available WHEN someone asked. The app can't know that it did — an in-app request is answered
  // at /requests via fulfillPost(), which never renders the share stage — so the sender picks.
  it('names the ask and the dish', () => {
    expect(defaultInviteMessage({ recipeName: 'Adobo', asked: true })).toBe(
      'You asked for my Adobo recipe — here it is 💛',
    )
  })

  it('stays a clean sentence with no dish name', () => {
    expect(defaultInviteMessage({ asked: true })).toBe(
      'You asked for my recipe — here it is 💛',
    )
  })

  it('defaults to the unprompted wording, which is what the app has evidence for', () => {
    expect(defaultInviteMessage({ recipeName: 'Adobo' })).toMatch(/I wanted you to have it/)
    expect(defaultInviteMessage({ recipeName: 'Adobo', asked: false })).toMatch(
      /I wanted you to have it/,
    )
  })

  it('is first person either way — the app never narrates the sender in the third person', () => {
    for (const asked of [true, false]) {
      const m = defaultInviteMessage({ recipeName: 'Adobo', asked })
      expect(m).toMatch(/\bmy\b/)
      expect(m).not.toMatch(/passed you|shared with you/i)
    }
  })
})
