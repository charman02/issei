"""Builders for the invite link-preview (Open Graph) card.

WHY THIS EXISTS: a link to /invite/{token} should unfurl in iMessage / WhatsApp /
Slack showing the ACTUAL recipe — its name, who passed it, its photo — not the one
generic app card every link used to share. Link crawlers do NOT run the SPA's
JavaScript, so those meta tags must be in the raw HTML the server returns.

The backend serves that HTML (GET /recipes/invite/{token}/preview): the recipe
data is right here, no cross-service call. Vercel routes crawler user-agents on
/invite/:token to this endpoint (see frontend/vercel.json); humans are left on the
normal SPA. This module holds the pure string-building so it is unit-testable
without HTTP. (An earlier attempt served this from a Vercel serverless function,
but Vercel wasn't detecting the api/ folder; serving from FastAPI removes that
dependency and keeps the preview logic next to the data.)

POSITIONING: the copy only ever describes passing a recipe to a person. No "voice",
"recording", "audio", "listen" — there is none here, and the ban is app-wide
(POSITIONING.md); a test asserts this document never reintroduces it.
"""

from html import escape as _escape

# The site-wide fallback preview image (served by the frontend at /og.png).
FALLBACK_IMAGE_PATH = "/og.png"


def escape_html(value) -> str:
    """Escape for use in both element text and double-quoted attributes.

    Recipe names are user input ("Mom's ""special"" adobo", a stray <), so this is
    correctness (don't break the HTML) as much as safety. ``quote=True`` escapes
    both " and ', matching the JS builder this was ported from.
    """
    if value is None:
        return ""
    return _escape(str(value), quote=True)


def build_invite_meta(recipe, *, site_origin, token, reached=True):
    """Produce the fields a crawler card needs.

    ``recipe`` is the InvitePreview-shaped object (or None). ``from_name`` is who
    passed the link on (the owner — only an owner can hand off); ``origin_attribution``
    is the dish's own byline ("Lola"), i.e. who the recipe is *from*.

    ``reached`` distinguishes two None-recipe cases the copy must NOT conflate:
      · reached=True, no recipe → the token is unknown or the recipe was deleted, so say the
        link isn't here. NEVER "expired": nothing in issei expires, and a test forbids the word.
      · reached=False → we couldn't load the recipe (a DB blip): the link may be
        perfectly valid, so a neutral "open on issei" card is honest where
        "this link expired" would be a lie (and could get cached).
    """
    url = f"{site_origin}/invite/{token}"
    name = getattr(recipe, "name", None) if recipe is not None else None
    if not recipe or not name:
        description = (
            "This recipe link isn't here. issei is how someone sends you a dish they cook."
            if reached
            else "Open this recipe on issei — how someone sends you a dish they cook."
        )
        return {
            "url": url,
            "title": "A recipe on issei",
            "description": description,
            "image": f"{site_origin}{FALLBACK_IMAGE_PATH}",
            "image_alt": "issei",
            "found": False,
        }

    # The NAME only, mirroring `frontend/src/lib/sourceName.js`'s sourceNameOf(): an
    # `origin_attribution` may carry "·"-separated place/year segments, and the invite page this
    # card opens shows just "from Lola". The card said "from Lola · Manila · 1998" — the same
    # recipe described two different ways one tap apart. Only legacy/API-written values carry the
    # extra segments today; the current form cannot produce one.
    byline = (
        (getattr(recipe, "origin_attribution", None) or "").split("·")[0].strip() or None
    )
    sender = (getattr(recipe, "from_name", None) or "").strip() or None
    # Title carries the dish and its byline — the app's "from {person}" convention.
    title = f"{name} — from {byline}" if byline else name
    # Description names the SENDER ("Charlie passed you…"), mirroring the landing.
    who = f"{sender} passed you" if sender else "Someone passed you"
    # "no account needed" IS THE CLAUSE THAT ANSWERS "why would I tap this?", so it belongs on every
    # card — not, as before, only on the cards for recipes with no description.
    #
    # Nobody decided to drop it. The two branches were written as alternatives for one og:description
    # line, and the promise happened to live in the else, so the differentiator appeared only on the
    # emptiest cards — the ones with nothing else to say. The cook's own words now come LAST, which
    # is the real cost of this change: iMessage shows roughly two lines, so a long description loses
    # its tail. That is the right trade, because a stranger's first question is whether this costs
    # them an account, and the description is still there for anyone who taps.
    #
    # "on issei" is dropped from this sentence: og:site_name already says issei, and the unfurl shows
    # the domain, so it was the third mention on one card. That buys back most of the room.
    recipe_description = (getattr(recipe, "description", None) or "").strip()
    description = f"{who} the recipe for {name} — read it and cook it, no account needed."
    if recipe_description:
        description = f"{description} {recipe_description}"
    # The alt has to describe the image we ACTUALLY chose. A recipe with no cover photo gets the
    # generic issei card, and calling that "Adobo, from Lola" describes a dish photo that isn't
    # there — to precisely the person who can't see it.
    cover = getattr(recipe, "cover_photo_url", None)
    image = cover or f"{site_origin}{FALLBACK_IMAGE_PATH}"
    if cover:
        image_alt = f"{name}, from {byline}" if byline else name
    else:
        image_alt = "issei"
    return {
        "url": url,
        "title": title,
        "description": description,
        "image": image,
        "image_alt": image_alt,
        "found": True,
    }


def render_invite_og_document(meta) -> str:
    """Render the crawler HTML document.

    A human who somehow lands here (they shouldn't — the rewrite only routes crawler
    user-agents) is bounced to the real URL by the meta refresh; on that second
    request their human UA falls through to the SPA, so there is no redirect loop.
    """
    t = escape_html(meta["title"])
    d = escape_html(meta["description"])
    u = escape_html(meta["url"])
    img = escape_html(meta["image"])
    alt = escape_html(meta["image_alt"])
    return f"""<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>{t}</title>
    <meta name="description" content="{d}" />
    <meta property="og:type" content="article" />
    <meta property="og:site_name" content="issei" />
    <meta property="og:title" content="{t}" />
    <meta property="og:description" content="{d}" />
    <meta property="og:url" content="{u}" />
    <meta property="og:image" content="{img}" />
    <meta property="og:image:alt" content="{alt}" />
    <meta name="twitter:card" content="summary_large_image" />
    <meta name="twitter:title" content="{t}" />
    <meta name="twitter:description" content="{d}" />
    <meta name="twitter:image" content="{img}" />
    <meta http-equiv="refresh" content="0; url={u}" />
  </head>
  <body>
    <p>Opening {t}&hellip; <a href="{u}">Tap here if it doesn&rsquo;t open.</a></p>
  </body>
</html>"""
