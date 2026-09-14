import pytest
from fastapi import HTTPException

from app.services.media import is_our_image_url, require_our_image_url

# THE HOST RULE, tested directly, because it now guards TWO routes (`PATCH /auth/me` and
# `PATCH /posts/{id}`) and the reason it became a service is that the first inline copy did not
# reach the second caller: #98 shipped a post photo field with no check at all and had to remove
# it. A rule with two callers gets its own test, so neither router is the only place it's exercised.
#
# What it protects: a photo_url is rendered as `<img src>` to everyone who can see the post or the
# person. An arbitrary URL is not XSS — an `<img src>` will not run `javascript:` — but it is a
# privacy leak, because pointing it at a server you control puts every viewer's IP and user agent
# in your logs, on a feed of people who never chose to contact you.

OURS = "https://res.cloudinary.com/demo/image/upload/v1/issei/a.jpg"


@pytest.mark.parametrize(
    "url",
    [
        OURS,
        "https://res.cloudinary.com/x/image/upload/issei/avatars/b.png",
        # A different Cloudinary subdomain is still Cloudinary.
        "https://api.cloudinary.com/v1_1/demo/resources/image/c.jpg",
    ],
)
def test_accepts_our_own_uploads(url):
    assert is_our_image_url(url) is True
    assert require_our_image_url(url, what="photo") == url


@pytest.mark.parametrize(
    "url",
    [
        "",
        "   ",
        # Plain HTTP, even on the right host: a mixed-content image on an HTTPS page, and
        # interceptable.
        "http://res.cloudinary.com/demo/image/upload/a.jpg",
        # The whole point of the rule.
        "https://evil.test/tracker.gif",
        # A LOOKALIKE HOST — the suffix has to TERMINATE the host, so a suffixed domain fails.
        "https://res.cloudinary.com.evil.test/a.jpg",
        # Cloudinary's name in the PATH rather than the host. THIS ONE CAUGHT A REAL HOLE: the
        # first version of the rule was a substring check for ".cloudinary.com/", and the path is
        # entirely attacker-controlled, so this passed. It is why the rule parses the URL now.
        "https://evil.test/.cloudinary.com/a.jpg",
        "https://evil.test/?x=https://res.cloudinary.com/a.jpg",
        # Credentials in the userinfo, an old trick for making the host look like something else.
        "https://res.cloudinary.com@evil.test/a.jpg",
        # A scheme that is not a fetch of an image we stored.
        "data:image/png;base64,iVBORw0KGgo=",
        "javascript:alert(1)",
        # Protocol-relative: no scheme, so the browser would use the page's — and it is not ours.
        "//res.cloudinary.com/demo/a.jpg",
    ],
)
def test_refuses_everything_else(url):
    assert is_our_image_url(url.strip()) is False
    with pytest.raises(HTTPException) as exc:
        require_our_image_url(url, what="photo")
    assert exc.value.status_code == 422


def test_the_message_names_what_the_person_was_setting_not_the_field():
    """The `detail` reaches the UI verbatim through `toUserMessage`, so it has to read as English.

    Two callers pass two different nouns, which is the whole reason `what` is a parameter rather
    than a constant in here.
    """
    with pytest.raises(HTTPException) as exc:
        require_our_image_url("https://evil.test/x.gif", what="profile photo")
    assert exc.value.detail == "A profile photo must be uploaded through issei."

    with pytest.raises(HTTPException) as exc:
        require_our_image_url("https://evil.test/x.gif", what="photo")
    assert exc.value.detail == "A photo must be uploaded through issei."
    # No field names, no "URL", no schema vocabulary.
    assert "photo_url" not in exc.value.detail


def test_a_valid_url_comes_back_TRIMMED():
    """Whitespace is stripped on the way through, so the stored value is what gets rendered.

    A trailing newline in an `<img src>` is harmless; a stored one that later gets compared to a
    fresh upload's URL is not, and "did the photo change?" is a comparison the post edit form makes.
    """
    assert require_our_image_url(f"  {OURS}\n", what="photo") == OURS


def test_none_is_refused_rather_than_crashing():
    """Callers guard for None themselves, but this must not be the thing that raises AttributeError.

    `PATCH /auth/me` treats blank as "clear the photo" and never reaches here with None; a future
    caller might. A 422 is the safe failure.
    """
    with pytest.raises(HTTPException):
        require_our_image_url(None, what="photo")  # type: ignore[arg-type]


# ============================================================================================
# THE BACKSLASH BYPASS. Found by the ship gate on the FIRST version of this file, which trusted
# `urlsplit(...).hostname` alone. Python and the WHATWG parser browsers use disagree about where
# the authority ends when it contains a backslash, and a validator that trusts the wrong one is
# worse than none: it says yes, and the browser then fetches from somewhere else.
#
# Verified against the real function before the fix — both of these returned True:
#   https://evil.test\@res.cloudinary.com/x.jpg   (urlsplit host: 'res.cloudinary.com')
#   https://evil.test\.cloudinary.com/a.jpg       (urlsplit host: 'evil.test\.cloudinary.com')
# Node's `new URL()` reports the host of both as `evil.test`.
# ============================================================================================


@pytest.mark.parametrize(
    "url",
    [
        # A backslash read as userinfo by Python, as an authority terminator by browsers.
        "https://evil.test\@res.cloudinary.com/x.jpg",
        "https://evil.test\@a.cloudinary.com/x.jpg?w=1",
        "https://evil.test\\@res.cloudinary.com/x.jpg",
        # A backslash left INSIDE the hostname, which a bare suffix check accepted.
        "https://evil.test\.cloudinary.com/a.jpg",
        # Userinfo without a backslash — the other half of the same trick.
        "https://res.cloudinary.com@evil.test/a.jpg",
        "https://user:pw@evil.test/a.jpg",
    ],
)
def test_refuses_a_url_two_parsers_would_disagree_about(url):
    assert is_our_image_url(url) is False
    with pytest.raises(HTTPException) as exc:
        require_our_image_url(url, what="photo")
    assert exc.value.status_code == 422


def test_credentials_are_refused_even_on_the_RIGHT_host():
    """Our uploads never carry credentials, so an `@` in the authority is not one of ours."""
    assert is_our_image_url("https://user:pw@res.cloudinary.com/a.jpg") is False


def test_the_host_must_look_like_a_hostname():
    """The belt to the braces: any residual parser disagreement leaves a stray delimiter behind,
    and a strict charset refuses it whatever it turns out to be."""
    assert is_our_image_url("https://res.cloudinary.com/a.jpg") is True
    for bad in (
        "https://res.cloudinary.com\u200b/a.jpg",   # zero-width space in the host
        "https://res.cloudinary\u3002com/a.jpg",     # ideographic full stop (IDNA lookalike)
        "https://res%2ecloudinary.com/a.jpg",        # percent-encoded dot
    ):
        assert is_our_image_url(bad) is False, bad


def test_an_uppercase_host_is_still_ours():
    """Hostnames are case-insensitive, and a client that shouts is not an attacker."""
    assert is_our_image_url("https://RES.CLOUDINARY.COM/demo/a.jpg") is True

def test_a_tab_or_newline_in_the_authority_is_NOT_a_parser_disagreement():
    """I first wrote these as expected FAILURES, and that was wrong — worth recording why.

    `urlsplit` strips ASCII tab and newline from a URL, and so does the WHATWG parser browsers
    use. The two AGREE, and what they agree on is `evil.test.cloudinary.com` — genuinely a
    subdomain of cloudinary.com, not of anything an attacker owns (Cloudinary does not hand out
    arbitrary subdomains). So accepting it is correct.

    The backslash cases above are different in kind: there the two parsers resolve to DIFFERENT
    hosts and one of them IS attacker-controlled. Kept as a test rather than deleted, because the
    next person hardening this function will reach for the same idea.
    """
    from urllib.parse import urlsplit

    tabbed = "https://evil.test" + chr(9) + ".cloudinary.com/a.jpg"
    newlined = "https://evil.test" + chr(10) + ".cloudinary.com/a.jpg"
    assert urlsplit(tabbed).hostname == "evil.test.cloudinary.com"
    assert is_our_image_url(tabbed) is True
    assert is_our_image_url(newlined) is True
