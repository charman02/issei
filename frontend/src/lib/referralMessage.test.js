import { describe, it, expect } from 'vitest'
import {
  defaultReferralMessage,
  referralShareText,
  REFERRAL_URL,
} from './referralMessage'

// The sentence that leaves the app when someone recommends issei. It lands in a stranger's messages
// next to a link they have no other context for, which makes it the single highest-leverage string
// in the product after the invite message — and, like that one, it is not a screen, so no rendered
// assertion anywhere else can reach it.

describe('defaultReferralMessage', () => {
  it('opens with the feed hook and RESOLVES to the handoff, in that order', () => {
    // POSITIONING's "The feed and the handoff: one product": the feed is the top of the funnel, the
    // handoff is the payload. A message that stopped at the hook would sell a photo app.
    const body = defaultReferralMessage()
    const hook = body.indexOf('Curious what your friends are cooking')
    const payload = body.indexOf('the dish the way they really make it')
    expect(hook).toBe(0)
    expect(payload).toBeGreaterThan(hook)
  })

  it('summarises BOTH sides, matching the page it lands on', () => {
    // The owner's note applied to the share text too: the first version framed issei as the thing
    // that sends you a recipe you already tasted — the founding moment, and only half the product.
    // This message and `Landing.jsx` are one tap apart and must describe the same app.
    const body = defaultReferralMessage()
    expect(body).toMatch(/see what people are actually making/i)
    expect(body).toMatch(/ask them for the recipe/i)
  })

  it('does NOT claim access to any recipe of theirs', () => {
    // FALSE: `can_view` gives a friend your public + friends recipes, never your private ones, and a
    // recipe behind a post arrives by ASKING. A referral must not promise what the app refuses.
    const body = defaultReferralMessage()
    expect(body).not.toMatch(/any of their recipes/i)
    expect(body).not.toMatch(/all (of )?their recipes/i)
  })

  it('carries the fidelity promise, which is the actual differentiator', () => {
    expect(defaultReferralMessage()).toContain('“a good splash”')
  })

  it('is FIRST PERSON, because it is sent from a person\'s own texting app', () => {
    // Same reason `defaultInviteMessage` is: it has to read like them, not like an app notice. A
    // recommendation from someone you know is the only reason anyone opens an app link.
    expect(defaultReferralMessage()).toMatch(/I’m on issei/)
  })

  it('uses the same curly punctuation as the rest of the app', () => {
    // A ship gate caught straight quotes here while `lib/inviteMessage.js` writes `Here’s` and
    // `Landing.jsx` writes “a good splash”. Two surfaces of ONE feature rendering the same words
    // with different punctuation looks careless in the most-forwarded string in the product.
    const body = defaultReferralMessage()
    expect(body).not.toMatch(/'/)
    expect(body).not.toMatch(/"/)
  })

  it('does NOT sign itself with the sender\'s heart', () => {
    // The 💛 is spent on the invite message, where one person hands one dish to one person. #102
    // removed the app's other use of it so one glyph doesn't do two jobs; a referral is an
    // introduction, not an intimacy.
    expect(defaultReferralMessage()).not.toContain('💛')
  })
})

describe('referralShareText', () => {
  it('always carries the link WITH the words', () => {
    // The bug this prevents is the one `HandoffInvite` shipped: a clipboard path that copied the
    // bare URL, so the sentence never left the app for any browser without a share sheet.
    const text = referralShareText()
    expect(text).toContain(defaultReferralMessage())
    expect(text.endsWith(REFERRAL_URL)).toBe(true)
  })

  it('points at the apex domain, not a deploy alias or a path', () => {
    // `issei.app` is the only address a person repeats out loud, and it is the URL the static OG
    // tags in index.html already describe — so a shared link unfurls correctly with no crawler
    // rewrite. A vercel.app preview host here would both break the unfurl and leak the platform.
    expect(REFERRAL_URL).toBe('https://issei.app')
    expect(REFERRAL_URL).not.toMatch(/vercel|onrender|localhost/)
  })

  it('makes no claim the product cannot back (POSITIONING)', () => {
    const text = referralShareText()
    for (const pattern of [
      /voice/i,
      /recording/i,
      /\baudio\b/i,
      /listen/i,
      /in (their|your|his|her)( own)? words/i,
      /family tree/i,
      /lineage/i,
      /make it yours/i,
      /\bremix/i,
      /expires?\b/i,
      /shopping list/i,
    ]) {
      expect(text).not.toMatch(pattern)
    }
  })
})
