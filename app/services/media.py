"""The one place that decides whether a client-supplied image URL is one of ours.

Every photo in issei is uploaded through `POST /upload/*`, which hands the client back a
Cloudinary URL that the client then sends in a JSON write. That keeps recipe and post writes as
JSON instead of multipart — but it also means a caller can send ANY string, so each write that
accepts a URL has to check it.

WHY THIS IS A SERVICE AND NOT AN INLINE `if`. It was inline in `PATCH /auth/me`, and the very
next write that accepted a photo URL (`PATCH /posts/{id}`) shipped with **no check at all** and
had the field removed in review for exactly that reason. A rule enforced in one router is a rule
the second router will not have. Two callers is the moment to extract it.

WHAT THE RULE PROTECTS. A `photo_url` is rendered as `<img src>` to everyone who can see the
post or the person. An arbitrary URL is not XSS — an `<img src>` won't run `javascript:` — but it
is a real privacy leak: point it at a server you control and every viewer's IP, user agent and
approximate location arrives in your logs, on a feed of people who never chose to contact you.
Pinning the host to Cloudinary means the only images the app serves are ones it stored itself.
"""

from urllib.parse import urlsplit

from fastapi import HTTPException, status

# PARSE THE URL; DO NOT SUBSTRING IT. The first version of this function was
# `value.startswith("https://") and ".cloudinary.com/" in value`, lifted from the inline check it
# replaced, on the reasoning that requiring the trailing slash meant the path separator had to
# follow the domain. It does — but nothing said the MATCH had to be in the host at all, so
#
#     https://evil.test/.cloudinary.com/a.jpg
#
# passed: `.cloudinary.com/` sits in the PATH, which an attacker controls completely. The test
# written alongside this file caught it before it shipped, which is the argument for testing a
# predicate directly rather than only through the two routers that call it.
_ALLOWED_HOST_SUFFIX = ".cloudinary.com"


def is_our_image_url(value: str) -> bool:
    """True when `value` is an HTTPS URL whose HOST is Cloudinary — i.e. one our upload produced.

    HTTPS only: plain HTTP on the right host is both mixed content on an HTTPS page and
    interceptable, and our uploads are never HTTP.
    """
    try:
        parts = urlsplit(value)
    except ValueError:
        # A malformed URL (e.g. a bad IPv6 literal) is not one of ours.
        return False
    if parts.scheme != "https":
        return False
    host = (parts.hostname or "").lower()
    # `endswith(".cloudinary.com")` — so `res.cloudinary.com` passes and
    # `res.cloudinary.com.evil.test` does not, since the suffix has to terminate the host.
    return host.endswith(_ALLOWED_HOST_SUFFIX) or host == _ALLOWED_HOST_SUFFIX.lstrip(".")


def require_our_image_url(value: str, *, what: str) -> str:
    """Return the trimmed URL, or 422 with copy naming what the caller was trying to set.

    `what` goes straight into the message a person reads, so it is a noun phrase from their
    vocabulary ("photo", "profile photo") rather than a field name — the message reaches the UI
    through `toUserMessage`, which passes a router's deliberate `detail` string through untouched.
    """
    url = (value or "").strip()
    if not is_our_image_url(url):
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=f"A {what} must be uploaded through issei.",
        )
    return url
