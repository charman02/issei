"""Sliding-window rate limiting for the surfaces reachable without an account.

WHY THIS EXISTS. Every unauthenticated route in this app was unthrottled: `POST /auth/login` would
accept guesses as fast as bcrypt could reject them, `POST /auth/forgot-password` would send an
unbounded number of SES emails to any address, and `POST /recipes/parse` would spend OpenRouter
credits in a loop. Since #80 every account on the app is ENUMERABLE BY NAME — that was a deliberate
product decision, and it means the email side of a credential-stuffing attempt is already solved for
whoever wants it. An unthrottled login against an enumerable user list is the one combination worth
fixing first.

IN-PROCESS, IN MEMORY, ON PURPOSE (owner's call). No Redis, no table, no new dependency — the same
discipline that made `push.py` hand-roll RFC 8291 rather than add `requests`. What that costs, stated
plainly rather than discovered later:

  - counters RESET on deploy or restart, so a lockout does not survive a `main` merge;
  - `maxHealthyPercent: 200` overlaps two tasks during a rolling deploy, and each holds its own
    counters, so the effective limit is briefly DOUBLE;
  - above `desiredCount: 1` the limits become per-task rather than per-service.

All three are acceptable at this scale and none is a silent failure: the limiter still bounds the
attack, just less tightly for a few minutes a week. If the app ever scales out, this module is the
one place to repoint at a shared store, and the function signatures are what the routers depend on.

THE ALGORITHM IS A SLIDING-WINDOW LOG, not a fixed window, and the difference is not academic: a
fixed window lets an attacker spend the whole limit in the last second of one window and the whole
limit again in the first second of the next, so the real burst is 2x the configured number at every
boundary. A deque of timestamps per key is exact, and it is bounded by the limit itself — at most
`limit` floats per key, because nothing is appended once the key is over.

WALL CLOCK VS MONOTONIC. `time.monotonic`, deliberately. These are DURATIONS ("has 15 minutes
passed"), and the wall clock can step backwards (NTP, a suspended host) — which would extend a
lockout by however far it jumped. `prompt_scheduler` needs the opposite (`time.time`, because it
aligns to wall-clock boundaries an operator can name). Different question, different clock.
"""

import logging
import math
import threading
import time
from collections import OrderedDict, deque

from fastapi import HTTPException, Request, status

from app.config import settings

logger = logging.getLogger(__name__)

# A TEST SEAM, for the same reason `prompt_scheduler` has two: patching `time.monotonic` itself
# reaches the whole process, including anyio's threadpool and pytest's own timing. Patch this name.
_now = time.monotonic

# THE LIMITS, in (attempts, window_seconds), named here rather than spelled at each call site so the
# whole policy is readable in one place — and so a test can assert the policy rather than re-deriving
# it. Owner's choice on the login pair; the rest follow from what each route actually costs.
#
# LOGIN counts FAILURES ONLY. 10 wrong guesses per account per 15 minutes is ~960 a day, which is
# hopeless against a password of any strength, while leaving a real person who has forgotten which
# password they used ten tries before they have to wait. 30 per IP allows a household or an office
# behind one NAT to fumble independently.
LOGIN_PER_IP = (30, 15 * 60)
LOGIN_PER_ACCOUNT = (10, 15 * 60)

# SIGNUP is about mass account creation, not guessing: since #80 a created account is publicly listed,
# so the cost of abuse lands on every user's directory. Raised from 10 to 20 after a ship gate pointed
# at this project's own history — user testing happens in PERSON, in batches, and a dozen people
# signing up in one room share one address. The eleventh would have read "Too many attempts. Try again
# in 54 minutes." with nothing in the copy hinting it was a per-network signup cap, and nothing to
# diagnose it with in the moment. 20 covers a realistic room; a bigger session wants the off switch,
# which `infra/RUNBOOK.md` now names as exactly that case.
SIGNUP_PER_IP = (20, 60 * 60)

# FORGOT-PASSWORD is the only route where a stranger can cause a THIRD PARTY's phone to buzz: it
# sends mail to an address the caller names. So it is the tightest per-account limit in the file —
# three an hour is enough for someone whose first email went to spam, and not enough to use as a
# harassment channel. It also costs real SES quota.
FORGOT_PER_IP = (10, 60 * 60)
FORGOT_PER_ACCOUNT = (3, 60 * 60)

# RESET-PASSWORD consumes a token. uuid4 is 122 random bits, so guessing is not the threat; this is
# here so a script cannot hammer the route for free while we find out.
RESET_PER_IP = (10, 15 * 60)

# THE INVITE PAIR. The token IS the capability (see `CLAUDE.md` — the whole recipe is readable
# unauthenticated), which makes these the two routes where a successful guess is worth the most. The
# read limit is generous because a real recipient reloads, forwards, and comes back to a recipe they
# were sent; 60 in 15 minutes is 240 an hour against a 256-bit `secrets.token_urlsafe(32)` space,
# buying an attacker nothing. (NOT a uuid4 — that is the RESET token above, and conflating the two
# understates this one by 134 bits. POSITIONING.md names it correctly; a gate caught me not.)
INVITE_READ_PER_IP = (60, 15 * 60)
INVITE_CLAIM_PER_IP = (20, 15 * 60)

# THE OG PREVIEW GETS ITS OWN, MUCH LARGER BUDGET — and the first version sharing the read's bucket
# was wrong for a reason worth writing down, because the comment justifying it was wrong about WHERE
# THE TRAFFIC COMES FROM. `frontend/vercel.json` uses a REWRITE, not a redirect: Vercel's edge proxies
# crawler traffic to this route server-side. So the address the ALB appends is a VERCEL EDGE address,
# not the crawler's — which means every genuine unfurl for the entire app fans into a handful of
# Vercel PoP addresses and lands in ONE bucket. At 60 per 15 minutes that is an app-wide ceiling on
# real link previews, past which every shared recipe unfurls as the generic card instead of the dish,
# at 200 with only an INFO line to show it. Silent degradation on the product's signature act. (The
# docstring's original reasoning — "Apple and Meta crawl from concentrated ranges" — was right about
# the risk and wrong about the cause; the real cause is tighter and worse. A ship gate found it.)
#
# WHY A BIGGER NUMBER COSTS NOTHING, which is what makes this the easy fix rather than a trade: the
# invite token is `secrets.token_urlsafe(32)`, i.e. 256 bits. 60 guesses per 15 minutes and 600
# guesses per 15 minutes are both so far past astronomical that neither protects the token — the token
# protects itself. These limits exist to bound ABUSE VOLUME (bandwidth, database reads, log noise),
# not to make guessing infeasible, so the door a guesser would "shop" for is worth nothing extra to
# them. And this door reveals strictly LESS than the JSON read: OG tags carry the dish name, byline
# and cover photo, never the ingredients, steps or story.
INVITE_PREVIEW_PER_IP = (600, 15 * 60)

# THE ROTATE WRITE — the app's only deliberately unauthenticated write, where the old endpoint is the
# credential. A browser rotates a subscription rarely; twenty an hour is far above real use.
ROTATE_PER_IP = (20, 60 * 60)

# THE CRON TRIGGER. Secret-authenticated (`compare_digest`, 404 on a wrong key AND on an unset one),
# so guessing is not a realistic threat -- but "not realistic" and "unbounded" are different claims,
# and this was the one unauthenticated-by-secret surface with no ceiling at all. Deliberately VERY
# generous: the legitimate caller is `.github/workflows/daily-prompt.yml`, which GitHub delivers 5-7
# times A DAY in total, so 60 an hour from one address is two orders of magnitude above real use and
# cannot cost anybody a nudge. Added after a docs gate pointed out that it falsified the README's
# claim that every unauthenticated surface is bounded; softening the sentence would have been the
# wrong repair when the hole is three lines wide.
CRON_TRIGGER_PER_IP = (60, 60 * 60)

# THE LLM CALL. This one is COST, not security, and it is keyed per USER rather than per IP because
# the route requires a session: the spender is identified, so charge the limit to them rather than to
# whatever network they happen to share. Twenty parses an hour is far more than anyone writing
# recipes by hand will reach.
PARSE_PER_USER = (20, 60 * 60)

# A CEILING ON THE DICT ITSELF, because an unbounded map keyed by client address is a memory
# exhaustion vector: a distributed caller reaches this module once per address, and nothing else
# would ever evict them. Least-recently-used goes first (an `OrderedDict` moved to the end on every
# touch), which is the right eviction order here — the keys worth remembering are the active ones.
# 20k keys of at most 30 floats is a few megabytes, well inside the task's 512MB.
MAX_TRACKED_KEYS = 20_000

# A KEY IS TRUNCATED, because part of it comes from a request header. `X-Forwarded-For` is
# attacker-supplied in the general case and there is no length limit on it, so an unbounded key would
# let one request store kilobytes. 64 characters is longer than any real IPv6 address or email.
MAX_KEY_CHARS = 64

_lock = threading.Lock()
_buckets: "OrderedDict[str, deque[float]]" = OrderedDict()


def reset() -> None:
    """Forget every bucket. For tests — and the reason `tests/conftest.py` calls it autouse.

    Module state outlives a test. Without this, one test's failed logins count against the next
    one's, so a suite that grows past the per-IP limit starts failing in whichever test happens to
    run tenth — a failure that moves when you reorder tests and looks like flakiness.
    """
    with _lock:
        _buckets.clear()


def _prune(bucket: "deque[float]", window: int, now: float) -> None:
    """Drop timestamps that have aged out of the window. Caller holds the lock."""
    cutoff = now - window
    while bucket and bucket[0] <= cutoff:
        bucket.popleft()


def _touch(key: str) -> "deque[float]":
    """Fetch (or create) a bucket and mark it recently used. Caller holds the lock."""
    bucket = _buckets.get(key)
    if bucket is None:
        bucket = deque()
        _buckets[key] = bucket
        # Evict only when we have just GROWN the map, since that is the only moment it can cross the
        # ceiling. `last=False` pops the least-recently-touched key.
        while len(_buckets) > MAX_TRACKED_KEYS:
            evicted, _ = _buckets.popitem(last=False)
            if evicted == key:  # pragma: no cover - only reachable at MAX_TRACKED_KEYS == 0
                break
    else:
        _buckets.move_to_end(key)
    return bucket


def try_acquire(key: str, limit: int, window: int) -> float | None:
    """Check AND record under ONE lock hold. None = allowed (and counted). A float = refused.

    THE WHOLE POINT IS THE SINGLE LOCK HOLD. The obvious composition —
    `seconds_until_allowed()` then `record()` — releases the lock between the two, so two callers can
    both observe `len(bucket) < limit` and both append. A ship gate measured that: with
    `sys.setswitchinterval(1e-9)` and 30 threads against a limit of 3, a worst run let SEVEN through.
    At Python's default 5ms switch interval it never overshot, because the gap contains no I/O and the
    GIL almost never preempts inside it — so the race was LATENT, not exploitable.

    Closed anyway, for three reasons: this is a security control and "almost always correct" is the
    wrong bar; the routes are sync `def` and therefore run on anyio's threadpool, so genuine
    concurrency is the normal case rather than the exotic one; and the limit it would loosen first is
    the tightest in the file (`FORGOT_PER_ACCOUNT`, three an hour, guarding a stranger's inbox).

    Note `login` was never affected — it calls `note_failure` then `refuse_if_over`, each individually
    atomic, and a lost interleaving there can only OVERCOUNT a failure, never undercount it.
    """
    with _lock:
        now = _now()
        bucket = _touch(key)
        _prune(bucket, window, now)
        if len(bucket) >= limit:
            return (bucket[0] + window) - now
        bucket.append(now)
        return None


def seconds_until_allowed(key: str, limit: int, window: int) -> float | None:
    """How long until `key` may act, or None if it may act right now. RECORDS NOTHING.

    The read-only half, for `POST /auth/login`, which must decide whether to spend a bcrypt
    comparison BEFORE it knows whether the attempt will fail.
    """
    with _lock:
        now = _now()
        bucket = _touch(key)
        _prune(bucket, window, now)
        if len(bucket) < limit:
            return None
        # The oldest attempt in the window is the one whose expiry frees a slot.
        return (bucket[0] + window) - now


def record(key: str, limit: int, window: int) -> None:
    """Note one attempt against `key`.

    `limit` is taken so the deque cannot grow past what the policy could ever need — a caller that
    keeps recording against an already-full key (every failed login, say) would otherwise accumulate
    one float per attempt for the whole window with no upper bound.
    """
    with _lock:
        now = _now()
        bucket = _touch(key)
        _prune(bucket, window, now)
        bucket.append(now)
        while len(bucket) > limit:
            bucket.popleft()


def clear(key: str) -> None:
    """Forget `key` entirely — used when a login SUCCEEDS.

    Someone who fumbled nine passwords and then got it right should not be one mistake from a wait.
    A success is positive evidence that this is the account's owner, which is exactly the evidence
    the failure count was standing in for.
    """
    with _lock:
        _buckets.pop(key, None)


def _humanize(seconds: float) -> str:
    """"in a minute" / "in 12 minutes" — the only part of this module a user ever sees.

    Rounded UP to the minute, deliberately: telling someone to come back in 12 minutes when it is
    really 12 minutes 40 seconds earns a second refusal and reads as a lie. Never "in 0 minutes".
    """
    minutes = max(1, math.ceil(max(seconds, 0) / 60))
    return "in a minute" if minutes == 1 else f"in {minutes} minutes"


def too_many(
    seconds: float, what: str = "attempts", message: str | None = None
) -> HTTPException:
    """The 429, with the wait named.

    NAMES THE WAIT AND NOTHING ELSE (owner's call). It must read identically whether or not the
    account exists, or the limiter becomes the account-existence oracle that `forgot_password`'s
    unconditional 204 exists to avoid — which is why every caller keys on the SUBMITTED address
    rather than on a resolved user.

    `Retry-After` is set because it is the correct HTTP answer and costs nothing. Note the browser
    cannot READ it cross-origin unless CORS exposes it, which this app does not do — the client gets
    the wait from `detail`, which `toUserMessage` passes through untouched. The header is for
    proxies, scripts and curl.
    """
    lead = message if message is not None else f"Too many {what}."
    return HTTPException(
        status_code=status.HTTP_429_TOO_MANY_REQUESTS,
        detail=f"{lead} Try again {_humanize(seconds)}.",
        headers={"Retry-After": str(int(math.ceil(max(seconds, 0))))},
    )


def enforce(
    key: str,
    limit: int,
    window: int,
    what: str = "attempts",
    message: str | None = None,
) -> None:
    """Check and record in one step; raise 429 if `key` is already over.

    For every route where the ATTEMPT ITSELF is the thing being limited — signup, a reset email, an
    invite read, a model call. Login is the exception and does not use this (see `routers/auth.py`).

    A DENIED CALL IS NOT RECORDED, and that is deliberate. Recording denials would mean a client
    stuck in a retry loop slides its own window forward forever and can never get out — which
    punishes a buggy app update exactly as hard as an attacker, and an attacker is not deterred by it
    anyway. So the window measures real attempts, and the wait a caller is told is the wait they
    actually have.
    """
    if not settings.rate_limit_enabled:
        return
    # ONE lock hold for the check and the record together — see `try_acquire`. The composed version
    # (check, release, record) let concurrent callers both pass the check; a ship gate measured it.
    wait = try_acquire(key, limit, window)
    if wait is not None:
        logger.info("rate limit hit: %s (limit %s/%ss)", key, limit, window)
        raise too_many(wait, what, message)


def over_limit(key: str, limit: int, window: int) -> bool:
    """`enforce` without the exception: True when refused, and the attempt is counted only if allowed.

    For the ONE caller that must not fail — `GET /recipes/invite/{token}/preview`, whose whole
    contract is that a crawler never receives an error, because an error is a shared link that unfurls
    as nothing. It degrades to the generic card instead, which happens to be the ideal refusal here:
    the guesser learns nothing about whether the token was real, and a crawler that legitimately
    exceeded the limit still renders something honest.
    """
    if not settings.rate_limit_enabled:
        return False
    if try_acquire(key, limit, window) is not None:
        logger.info("rate limit hit (degraded, not refused): %s", key)
        return True
    return False


def refuse_if_over(key: str, limit: int, window: int, what: str = "attempts") -> None:
    """Raise 429 if `key` is already over. RECORDS NOTHING — the check half, for login.

    Login cannot use `enforce`, because `enforce` counts the attempt and login must count only the
    attempts that FAIL. This is the half that runs before bcrypt.
    """
    if not settings.rate_limit_enabled:
        return
    wait = seconds_until_allowed(key, limit, window)
    if wait is not None:
        logger.info("rate limit hit: %s (limit %s/%ss)", key, limit, window)
        raise too_many(wait, what)


def note_failure(key: str, limit: int, window: int) -> None:
    """Record one failed attempt, honouring the off switch. The record half, for login."""
    if not settings.rate_limit_enabled:
        return
    record(key, limit, window)


def client_ip(request: Request) -> str:
    """The caller's address, as trustworthy as this deployment can make it.

    THE ONE THING TO GET RIGHT IN THIS FILE. `request.client.host` behind the ALB is the LOAD
    BALANCER's private address, identical for every user on earth — a limiter keyed on it puts the
    whole app in one bucket, so the first attacker to hit the login limit locks out every real user.
    That failure is worse than having no limiter at all, and it would not show up in any test that
    runs without a proxy in front.

    So `X-Forwarded-For`, and specifically the RIGHTMOST entries. An ALB APPENDS the address it saw
    to whatever the client sent, so a caller who sends `X-Forwarded-For: 1.2.3.4` produces
    `1.2.3.4, <their real address>` — the last element is the only one the infrastructure wrote. The
    common form of this code, `xff.split(",")[0]`, reads the FIRST element, which is entirely
    attacker-chosen: a script rotating that header would get a fresh bucket on every request and the
    limiter would be decorative while looking correct.

    `trusted_proxy_hops` is how many appending proxies sit in front (1 = just the ALB), so the client
    is at `len(parts) - hops`. Set it to 0 to ignore the header completely, which is the right value
    for a deployment with nothing in front — because with no proxy to append the real address, every
    element of that header is attacker-written and trusting any of it is evasion by request header.
    """
    hops = settings.trusted_proxy_hops
    if hops > 0:
        # EVERY `X-Forwarded-For` LINE, JOINED IN ORDER — not `headers.get()`, which returns only the
        # FIRST matching line. A ship gate caught that, and the distinction decides whether this
        # function works: a caller may send the header TWICE, and per RFC 7230 two lines are
        # semantically one comma-joined list, so reading only the first means reading only what the
        # caller wrote if the ALB ever emits its value as a separate line. `getlist` preserves wire
        # order and the ALB's contribution arrives last either way, so the rightmost element is the
        # infrastructure's under both behaviours — which is the property the whole design rests on.
        #
        # The one arrangement this still gets wrong is an ALB that inserts its value into the MIDDLE
        # of a multi-line header set. That would contradict the ordering semantics of every proxy
        # spec, so it is recorded as an assumption rather than defended against. The counterpart
        # assumption is verified in `infra/lib/issei-stack.ts`: the service security group accepts
        # ingress ONLY from the ALB's, so this header is always ALB-touched and the task cannot be
        # reached around it despite `assignPublicIp: true`.
        forwarded = ",".join(request.headers.getlist("x-forwarded-for"))
        if forwarded:
            parts = [p.strip() for p in forwarded.split(",") if p.strip()]
            if parts:
                # Clamp: a misconfigured hop count must not index off the front of the list and
                # silently start trusting the attacker-supplied end of it.
                return parts[max(len(parts) - hops, 0)][:MAX_KEY_CHARS]
    peer = request.client.host if request.client else ""
    return (peer or "unknown")[:MAX_KEY_CHARS]


def ip_key(request: Request, name: str) -> str:
    """`name` scopes the bucket to one route, so a signup does not spend a login's allowance."""
    return f"{name}:ip:{client_ip(request)}"


def account_key(name: str, email: str) -> str:
    """Keyed on the SUBMITTED address, lowercased, whether or not an account exists.

    LOWERCASED because `Foo@x.com` and `foo@x.com` would otherwise be separate buckets, which makes
    the per-account limit bypassable with a shift key. (Note `login` itself still matches email
    case-sensitively in SQL — a pre-existing behaviour this does not change; the KEY has to be
    case-insensitive regardless, or the limit is decorative.)

    And on the submitted address rather than a resolved user id, so a request for an address with no
    account is counted and answered identically to one for an address with an account. Resolving
    first would make the limiter leak exactly what `forgot_password` refuses to say.
    """
    return f"{name}:account:{email.strip().lower()[:MAX_KEY_CHARS]}"


def user_key(name: str, user_id: int) -> str:
    """For a route behind a session, where the person spending the resource is already known."""
    return f"{name}:user:{user_id}"
