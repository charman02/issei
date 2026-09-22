// The sentence that leaves the app when someone tells a friend about issei.
//
// One source, like `inviteMessage.js`, because this text lands in a stranger's messages app next to
// a link they have no other context for — and it is the ONLY thing standing between "someone sent me
// an app" and understanding the product. A second copy of it somewhere would drift.
//
// THE ORDER IS THE WHOLE DESIGN, and POSITIONING.md dictates it. The hook is the FEED ("curious what
// your friends are cooking") because that is what a stranger can picture instantly and what the
// owner's own users asked for. But POSITIONING's "The feed and the handoff: one product" is explicit
// that the feed is the TOP OF THE FUNNEL and the handoff is the payload — "presence → the ask → the
// handoff" — so a message that stops at the feed would sell a photo app and set up the wrong
// expectation on arrival. So: hook with the feed, resolve to the recipe, in that order, every time.
//
// FIRST PERSON, deliberately, exactly as `defaultInviteMessage` is: this is sent from a person's own
// texting app, so it has to read like them and not like an app notice. "I'm on issei" is the whole
// referral — a recommendation from someone you know is the only reason anyone opens an app link.
//
// NO 💛 HERE. That glyph is the SENDER's, spent on the invite message where one person is handing
// one dish to one person (#102 removed the app's other use of it for exactly this reason). A
// referral is an introduction, not an intimacy.
export const REFERRAL_URL = 'https://issei.app'

export function defaultReferralMessage() {
  return (
    'Curious what your friends are cooking today?\n\n' +
    'I’m on issei — it’s how someone sends you the recipe for the thing you just ' +
    'tasted. Not a scrubbed list of grams: the dish the way they actually make it, with ' +
    '“a good splash” left as “a good splash.”'
  )
}

// What actually goes to the OS: the sentence AND the link, always together. `HandoffInvite` learned
// this the hard way — its clipboard fallback used to copy the bare URL, so for every browser without
// a share sheet the sentence the compose screen existed to write never left the app.
export function referralShareText() {
  return `${defaultReferralMessage()}\n\n${REFERRAL_URL}`
}
