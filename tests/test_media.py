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
