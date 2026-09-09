from typing import Annotated, Optional

from pydantic import BaseModel, ConfigDict, Field, StringConstraints

# Ceilings, per the #100 convention. These matter more than most: `endpoint` sits under a UNIQUE
# index, and an unbounded string there raises "index row size exceeds maximum" on Postgres for a
# long Apple endpoint — a prod-only 500 SQLite will never reproduce. Real endpoints run 100-350
# characters; a P-256 public key is 65 bytes (88 base64url chars) and the auth secret is 16 (22).
# The key ceilings are generous rather than exact because they are the BROWSER'S values, not ours,
# and a spec that grows a longer key shouldn't take the endpoint down with it.
Endpoint = Annotated[str, StringConstraints(min_length=1, max_length=500)]
KeyB64 = Annotated[str, StringConstraints(min_length=1, max_length=200)]


class PushSubscriptionIn(BaseModel):
    """A browser's `PushSubscription`, flattened.

    The Push API hands the client an object with `endpoint` and `keys: {p256dh, auth}`. Flattened
    here rather than nested because the nesting buys nothing and every client would have to unwrap
    it anyway; the field names are kept verbatim so the mapping is obvious at a glance.

    Nothing is validated beyond length and presence, deliberately. All three values are opaque to
    us — a malformed key surfaces as a failed send, and a send that fails 404/410 is how a row gets
    pruned. Inventing a shape check here would only reject subscriptions a future browser mints.
    """

    endpoint: Endpoint
    p256dh: KeyB64
    auth: KeyB64
    # Recorded for debugging a device that stops working, never read in a decision. If it ever
    # becomes load-bearing, that's a bug.
    user_agent: Optional[Annotated[str, StringConstraints(max_length=300)]] = None


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


class NotificationPrefs(BaseModel):
    """The two switches plus quiet hours, as returned on the user.

    Server-owned, NOT in the client's `issei_prefs` localStorage bag where the other settings
    toggles live. That distinction is the whole point: a push is delivered with the browser closed,
    by a server that cannot read localStorage — so a preference stored there would look correct in
    every test and in local use, and a user who turned notifications OFF would keep receiving them.
    """

    model_config = ConfigDict(from_attributes=True)

    timezone: Optional[str] = None
    notify_hour: int
    notify_prompt: bool
    notify_people: bool
    quiet_from: int
    quiet_to: int


class NotificationPrefsUpdate(BaseModel):
    """Partial update. `None` means "leave it alone", as everywhere else in this app.

    Hours are bounded 0-23 rather than trusted: an out-of-range `notify_hour` is not a validation
    nicety but a user who is never due again, since the scheduler compares it against a real clock
    hour and nothing would ever match.
    """

    # An IANA name, sent by the client from Intl.DateTimeFormat().resolvedOptions().timeZone.
    # Bounded but not checked against the tz database here — an unknown zone degrades to "never
    # due" in `services/prompt.local_now()`, with a log, rather than 422ing someone whose browser
    # reports a zone this Python build hasn't heard of.
    timezone: Optional[Annotated[str, StringConstraints(max_length=64)]] = None
    notify_hour: Optional[int] = Field(default=None, ge=0, le=23)
    notify_prompt: Optional[bool] = None
    notify_people: Optional[bool] = None
    quiet_from: Optional[int] = Field(default=None, ge=0, le=23)
    quiet_to: Optional[int] = Field(default=None, ge=0, le=23)
