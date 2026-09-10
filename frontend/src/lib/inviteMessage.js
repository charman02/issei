// The default message a sender shares with an invite link.
//
// FIRST PERSON, on purpose: the message goes out from the sender's OWN texting app,
// under their name, so it should read like something they wrote ("Here's my adobo
// recipe…"), not an app notification that names them in the third person. The
// sender's name is therefore NOT in the text — their phone already carries it. (The
// link-preview CARD is separate and stays third person — that's the app narrating a
// caption, "Charlie passed you…"; built server-side in app/services/invite_og.py.)
//
// It seeds the note field (editable — the sender can rewrite it or clear it) and is
// also the fallback body when the native share sheet fires with no note typed.
// recipeName can be missing, so both branches stay clean, grammatical sentences.
//
// TWO OCCASIONS, AND THE APP CANNOT TELL THEM APART — which is why this takes a flag and the
// compose stage asks (#102).
//
// The product's own one-liner is "you asked for the recipe", so naming the ask is the truest
// sentence there is *when someone asked*. But the in-app ask never reaches this screen: a request
// on a meal is answered at `/requests` via `fulfillPost()`, which mints grants server-side and
// navigates back there without rendering the share stage at all. So everything that arrives here
// is either a cook sending unprompted, or — the founding case — someone who asked AT THE TABLE,
// which leaves no trace in the database.
//
// Defaulting to "you asked" would therefore be false for a share the app has no reason to think
// was requested, and defaulting to "I wanted you to have it" throws away the truest line in the
// product. Neither default is right, and the sender is the one person who knows. Hence a choice,
// not a guess — see HandoffInvite's two chips.
export function defaultInviteMessage({ recipeName, asked = false } = {}) {
  const dish = (recipeName || '').trim()
  // A yellow heart signs off the warmth — 💛 is the sender's to delete like any other word in the
  // editable note. It used to double as the APP's own sign-off on the You page, which meant the
  // same glyph signed both the app's voice and this supposedly-personal sentence; that line was
  // removed (#102), so the heart is the sender's alone now.
  if (asked) {
    return dish
      ? `You asked for my ${dish} recipe — here it is 💛`
      : 'You asked for my recipe — here it is 💛'
  }
  return dish
    ? `Here’s my ${dish} recipe — I wanted you to have it 💛`
    : 'Here’s my recipe — I wanted you to have it 💛'
}
