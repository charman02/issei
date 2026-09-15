from typing import Annotated, Optional

from pydantic import BaseModel, StringConstraints, field_validator

# Ceilings, per the #100 convention. These matter more than most: `endpoint` sits under a UNIQUE
# index, and an unbounded string there raises "index row size exceeds maximum" on Postgres for a
# long Apple endpoint — a prod-only 500 SQLite will never reproduce. Real endpoints run 100-350
# characters; a P-256 public key is 65 bytes (88 base64url chars) and the auth secret is 16 (22).
# The key ceilings are generous rather than exact because they are the BROWSER'S values, not ours,
# and a spec that grows a longer key shouldn't take the endpoint down with it.
# https ONLY, and the pattern is doing real work. `endpoint` is not like the two keys beside it:
# the keys are opaque values we hand back to a browser, but the endpoint is a URL THIS SERVER
# DIALS from inside the VPC. Unvalidated, it was an authenticated SSRF primitive — review confirmed
# `http://169.254.169.254/latest/meta-data/`, `http://127.0.0.1:8000/health` and `file:///etc/passwd`
# were all accepted at the boundary, and the hourly job would have POSTed to whichever one a
# signed-in user stored.
#
# Blind (no redirects followed, the body only ever reaches CloudWatch) and unreachable while
# unconfigured — but the repo already sets the opposite precedent: `AccountUpdate.photo_url` is
# validated down to a Cloudinary HTTPS host. A scheme check plus a host denylist costs nothing and
# cannot reject a future browser minting a new push host, because every real push service is
# https on a public name.
Endpoint = Annotated[
    str,
    StringConstraints(
        min_length=1, max_length=500, pattern=r"^https://[^\s/@]+\.[^\s/@]+(/|$)"
    ),
]
KeyB64 = Annotated[str, StringConstraints(min_length=1, max_length=200)]

# Hosts a push endpoint may never point at. The pattern above already excludes anything without a
# dot (so bare `localhost` and any single-label internal name are out) and anything non-https, which
# together cover the link-local metadata address and loopback-by-name. This is the belt to that
# braces: an explicit refusal of the IPv4 forms that DO contain dots.
BLOCKED_HOST_PREFIXES = (
    "127.",
    "169.254.",  # link-local, incl. the cloud metadata endpoint
    "10.",
    "192.168.",
    "0.",
)


class PushSubscriptionIn(BaseModel):
    """A browser's `PushSubscription`, flattened.

    The Push API hands the client an object with `endpoint` and `keys: {p256dh, auth}`. Flattened
    here rather than nested because the nesting buys nothing and every client would have to unwrap
    it anyway; the field names are kept verbatim so the mapping is obvious at a glance.

    THE TWO KEYS ARE OPAQUE; THE ENDPOINT IS NOT. `p256dh` and `auth` are values we only ever hand
    back to a browser, so nothing beyond length and presence is checked on them — a malformed key
    surfaces as a failed send, and a 404/410 is how the row gets pruned. Inventing a shape check
    there would only reject subscriptions a future browser mints.

    The endpoint is different in kind: it is a URL THIS SERVER DIALS. That is why it carries a
    scheme+host pattern and the validator below, and why the first version of this docstring —
    "nothing is validated beyond length and presence" — was a good argument applied to the wrong
    field.
    """

    endpoint: Endpoint
    p256dh: KeyB64
    auth: KeyB64
    # Recorded for debugging a device that stops working, never read in a decision. If it ever
    # becomes load-bearing, that's a bug.
    user_agent: Optional[Annotated[str, StringConstraints(max_length=300)]] = None

    @field_validator("endpoint")
    @classmethod
    def _no_private_hosts(cls, value: str) -> str:
        """Refuse the private/link-local IPv4 forms the pattern can't express.

        Not a complete SSRF defence, and not pretending to be one — DNS can still resolve a public
        name to a private address, which only an egress policy stops. What this closes is the
        direct, obvious version: storing `https://169.254.169.254/...` and letting an hourly job
        dial it. The scheme+host pattern does most of the work (it rejects every non-https URL and
        every single-label host, so `localhost` and internal names are already out); this catches
        the dotted quads, which look like ordinary hostnames to a regex.
        """
        host = value.split("://", 1)[1].split("/", 1)[0].split(":", 1)[0].lower()
        # 172.16-172.31 is the private range; matching "172.1"/"172.2"/"172.3" over-blocks a little
        # (172.1.x, 172.40.x) and that is the right direction to err for a URL we will POST to.
        if host.startswith(BLOCKED_HOST_PREFIXES) or host.startswith(("172.1", "172.2", "172.3")):
            raise ValueError("that is not a push endpoint")
        return value


class PushSubscriptionRotate(BaseModel):
    """Replace a subscription the BROWSER rotated, without a bearer token.

    Chrome fires `pushsubscriptionchange` inside the service worker, where there is no page, no
    localStorage and therefore no JWT — the axios auth interceptor cannot help, because there is no
    axios. So this route authenticates on the OLD ENDPOINT instead: presenting it proves you hold a
    secret only the browser and this server had.

    If it required auth instead, a rotated endpoint would mean a device that silently stops
    receiving anything, forever, with no signal to either side. That is the failure this shape
    exists to prevent, and it is worth the unusual authentication story.
    """

    old_endpoint: Endpoint
    subscription: PushSubscriptionIn


class VapidKeyResponse(BaseModel):
    """The application server's PUBLIC key, which the browser needs to subscribe at all.

    Not a secret — it is handed to every client by design. It lives here rather than baked into the
    frontend bundle so rotating the keypair is a deploy rather than a rebuild, and so a
    misconfigured environment reports `configured: false` instead of minting subscriptions against
    an empty string that can never be delivered to.
    """

    public_key: str
    configured: bool


# NOTHING LIVES HERE FOR NOTIFICATION PREFERENCES, deliberately.
#
# #89 defined `NotificationPrefs` and `NotificationPrefsUpdate` in this file and then put the
# preferences on `UserResponse` / `AccountUpdate` instead — which is right, because they are facts
# about a PERSON and the client already reconciles the user object on every app start. The two
# models here were never imported by any router or any test: dead code that read like an API.
#
# They were removed rather than migrated when `notify_prompt` became `notify_posts`, because the
# alternative was updating a second, unreachable copy of the same vocabulary and hoping the next
# person noticed which one the app actually reads. See `app/schemas/user.py` for the real ones.
