"""Tests for `app/services/rate_limit.py` and the seven routes that use it.

WHAT THESE ARE FOR, beyond "the limiter counts": a rate limiter has two silent failure modes and
both look like working software. It can refuse people it should not (the account-lockout weapon, the
ALB-address bucket), and it can refuse nobody while appearing to (the `X-Forwarded-For` first-element
bug). Neither shows up as an error anywhere. So most of what is pinned here is the SHAPE of the
policy — which dimension is checked before the password, which one a success clears, which element of
a forwarded header is trusted — rather than the numbers.

TIME IS INJECTED, never slept. `rate_limit._now` is a module-level seam for the same reason
`prompt_scheduler` has one: patching `time.monotonic` itself reaches pytest's own machinery.
"""

import pytest

from app.config import settings
from app.services import rate_limit


@pytest.fixture
def clock(monkeypatch):
    """A fake monotonic clock. `clock.advance(seconds)` moves it; nothing ever sleeps."""

    class Clock:
        def __init__(self):
            self.t = 1_000.0

        def advance(self, seconds):
            self.t += seconds

        def __call__(self):
            return self.t

    c = Clock()
    monkeypatch.setattr(rate_limit, "_now", c)
    return c


# ---------------------------------------------------------------------------------------------
# THE WINDOW ITSELF
# ---------------------------------------------------------------------------------------------
def test_a_key_is_allowed_up_to_the_limit_and_refused_on_the_next(clock):
    for i in range(5):
        assert rate_limit.seconds_until_allowed("k", 5, 60) is None, f"attempt {i + 1} of 5"
        rate_limit.record("k", 5, 60)
    assert rate_limit.seconds_until_allowed("k", 5, 60) is not None


def test_the_window_SLIDES_rather_than_resetting_on_a_boundary(clock):
    """The whole reason this is a log and not a counter.

    A fixed window lets an attacker spend the full limit in the last second of one window and the
    full limit again in the first second of the next — a real burst of 2x the configured number,
    at every boundary, forever. Here each attempt expires on its own schedule, so five attempts
    spread over a window never free more than one slot at a time.
    """
    for _ in range(5):
        rate_limit.record("k", 5, 60)
        clock.advance(10)  # attempts at t=0,10,20,30,40; now t=50
    assert rate_limit.seconds_until_allowed("k", 5, 60) is not None

    # The FIRST attempt (t=0) expires at t=60, i.e. 10s from now — not the whole window.
    wait = rate_limit.seconds_until_allowed("k", 5, 60)
    assert wait == pytest.approx(10.0)

    clock.advance(11)
    # Exactly ONE slot freed, which is the sliding property. A fixed window would have freed five.
    assert rate_limit.seconds_until_allowed("k", 5, 60) is None
    rate_limit.record("k", 5, 60)
    assert rate_limit.seconds_until_allowed("k", 5, 60) is not None


def test_the_reported_wait_is_the_time_until_a_slot_actually_frees(clock):
    for _ in range(3):
        rate_limit.record("k", 3, 100)
    clock.advance(40)
    assert rate_limit.seconds_until_allowed("k", 3, 100) == pytest.approx(60.0)


def test_keys_do_not_share_a_budget(clock):
    for _ in range(3):
        rate_limit.record("a", 3, 60)
    assert rate_limit.seconds_until_allowed("a", 3, 60) is not None
    assert rate_limit.seconds_until_allowed("b", 3, 60) is None


def test_a_success_CLEARS_the_key(clock):
    for _ in range(3):
        rate_limit.record("k", 3, 60)
    assert rate_limit.seconds_until_allowed("k", 3, 60) is not None
    rate_limit.clear("k")
    assert rate_limit.seconds_until_allowed("k", 3, 60) is None


def test_recording_past_the_limit_cannot_grow_the_deque_without_bound(clock):
    """`record` takes `limit` precisely so a hammering caller cannot accumulate memory.

    Login records EVERY failure, including ones answered with a 429, so without the cap one
    determined attacker would store a float per guess for the whole window with no ceiling.
    """
    for _ in range(500):
        rate_limit.record("k", 10, 60)
    assert len(rate_limit._buckets["k"]) == 10


def test_the_tracked_key_map_is_bounded_and_evicts_the_LEAST_RECENTLY_USED(clock, monkeypatch):
    """An unbounded map keyed by client address is a memory-exhaustion vector.

    A distributed caller reaches this module once per address and nothing else would ever evict
    them. Eviction is least-recently-used, which is the right order: the keys worth keeping are
    the active ones.
    """
    monkeypatch.setattr(rate_limit, "MAX_TRACKED_KEYS", 3)
    for name in ("a", "b", "c"):
        rate_limit.record(name, 5, 60)
    # Touch "a" so it is no longer the oldest, then push the map over its ceiling.
    rate_limit.record("a", 5, 60)
    rate_limit.record("d", 5, 60)
    assert len(rate_limit._buckets) == 3
    assert "b" not in rate_limit._buckets, "the least-recently-used key should have gone"
    assert "a" in rate_limit._buckets, "a recently-touched key must survive"
    assert "d" in rate_limit._buckets


# ---------------------------------------------------------------------------------------------
# THE COPY
# ---------------------------------------------------------------------------------------------
@pytest.mark.parametrize(
    "seconds,expected",
    [
        (0, "in a minute"),      # never "in 0 minutes"
        (1, "in a minute"),
        (60, "in a minute"),
        (61, "in 2 minutes"),    # rounded UP: saying 1 would earn a second refusal
        (700, "in 12 minutes"),
        (900, "in 15 minutes"),
    ],
)
def test_the_wait_is_phrased_for_a_person_and_always_rounded_UP(seconds, expected):
    assert rate_limit._humanize(seconds) == expected


def test_the_429_names_the_wait_and_sets_Retry_After():
    exc = rate_limit.too_many(700)
    assert exc.status_code == 429
    assert exc.detail == "Too many attempts. Try again in 12 minutes."
    # `toUserMessage` passes a `detail` STRING through untouched, so this is the copy a user reads.
    assert exc.headers is not None and exc.headers["Retry-After"] == "700"


def test_the_noun_is_overridable_for_a_limit_that_is_not_about_attempts():
    assert "Too many recipes parsed." in rate_limit.too_many(30, "recipes parsed").detail


# ---------------------------------------------------------------------------------------------
# THE CLIENT ADDRESS — the one thing in this module that is worth more than the rest combined
# ---------------------------------------------------------------------------------------------
class _FakeRequest:
    """A stand-in carrying a REAL `starlette.datastructures.Headers`, not a dict.

    Two reasons, both found by a ship gate. `client_ip` calls `.getlist()`, which a dict does not
    have — and more importantly a dict would let this fake DIVERGE from production in exactly the
    place that matters: real headers are case-insensitive and can hold the same name twice, and the
    second of those is the whole subject of `test_a_DUPLICATE_forwarded_header_cannot_evade`. A fake
    that cannot express the attack cannot test the defence.
    """

    def __init__(self, forwarded=None, peer="10.0.0.1"):
        from starlette.datastructures import Headers

        # `forwarded` may be a single string or a LIST, which becomes one raw header line each —
        # which is precisely what a caller sending the header twice puts on the wire.
        lines = [] if forwarded is None else (
            [forwarded] if isinstance(forwarded, str) else list(forwarded)
        )
        self.headers = Headers(
            raw=[(b"x-forwarded-for", v.encode("latin-1")) for v in lines]
        )

        class _Client:
            host = peer

        self.client = _Client() if peer is not None else None


def test_the_RIGHTMOST_forwarded_entry_is_used_because_the_ALB_appends(monkeypatch):
    """THE BUG THIS TEST EXISTS FOR would make the whole feature decorative.

    An ALB APPENDS the address it saw to whatever the client sent, so a caller who sends
    `X-Forwarded-For: 1.2.3.4` produces `1.2.3.4, <their real address>`. The common form of this
    code — `xff.split(",")[0]` — reads the FIRST element, which is entirely attacker-chosen: a
    script rotating that header would get a fresh bucket on every single request, and every test
    here would still pass because tests send no proxy header at all.
    """
    monkeypatch.setattr(settings, "trusted_proxy_hops", 1)
    req = _FakeRequest("1.2.3.4, 203.0.113.9")
    assert rate_limit.client_ip(req) == "203.0.113.9"


def test_a_spoofed_forwarded_header_cannot_win_a_fresh_bucket(monkeypatch):
    """The same attacker, two requests, two different spoofed prefixes: ONE bucket."""
    monkeypatch.setattr(settings, "trusted_proxy_hops", 1)
    a = rate_limit.client_ip(_FakeRequest("9.9.9.9, 203.0.113.9"))
    b = rate_limit.client_ip(_FakeRequest("8.8.8.8, 203.0.113.9"))
    assert a == b == "203.0.113.9"


def test_a_DUPLICATE_forwarded_header_cannot_evade(monkeypatch):
    """A caller may send `X-Forwarded-For` TWICE, and `headers.get()` returns only the FIRST line.

    A ship gate found this, and it is the same class of mistake as reading element [0]: per RFC 7230
    two header lines of the same name are semantically one comma-joined list, so reading only the
    first means reading only what the CALLER wrote if the ALB's contribution arrives as its own line.
    The fix is to join every line in wire order and then take from the right — the ALB's value is last
    under both behaviours, which is what the whole design rests on.

    Here the attacker sends two lines of their own choosing and the ALB appends a third. Whatever they
    put in either of their lines, the bucket must be the ALB's value.
    """
    monkeypatch.setattr(settings, "trusted_proxy_hops", 1)
    req = _FakeRequest(["1.1.1.1", "6.6.6.6", "203.0.113.9"])
    assert rate_limit.client_ip(req) == "203.0.113.9"

    # And rotating BOTH spoofed lines must not buy a fresh bucket.
    a = rate_limit.client_ip(_FakeRequest(["9.9.9.9", "5.5.5.5", "203.0.113.9"]))
    b = rate_limit.client_ip(_FakeRequest(["4.4.4.4", "7.7.7.7", "203.0.113.9"]))
    assert a == b == "203.0.113.9"


def test_TWO_hops_reads_two_from_the_right(monkeypatch):
    """CloudFront in front of the ALB: `client, cloudfront` after the ALB appends."""
    monkeypatch.setattr(settings, "trusted_proxy_hops", 2)
    req = _FakeRequest("203.0.113.9, 70.132.0.1")
    assert rate_limit.client_ip(req) == "203.0.113.9"


def test_ZERO_hops_IGNORES_the_header_entirely(monkeypatch):
    """The correct setting with nothing in front — where every byte of that header is attacker-written."""
    monkeypatch.setattr(settings, "trusted_proxy_hops", 0)
    req = _FakeRequest("1.2.3.4", peer="10.0.0.7")
    assert rate_limit.client_ip(req) == "10.0.0.7"


def test_a_misconfigured_hop_count_clamps_instead_of_indexing_off_the_front(monkeypatch):
    """Too many hops must not start trusting the attacker-supplied end of the list.

    A negative index in Python silently wraps to the other end, which here means reading the
    element the CLIENT wrote — the exact failure the rightmost rule exists to prevent, reintroduced
    by a configuration typo.
    """
    monkeypatch.setattr(settings, "trusted_proxy_hops", 5)
    req = _FakeRequest("1.2.3.4, 203.0.113.9")
    assert rate_limit.client_ip(req) == "1.2.3.4"  # clamped to index 0, NOT wrapped to the end


def test_no_forwarded_header_falls_back_to_the_peer(monkeypatch):
    monkeypatch.setattr(settings, "trusted_proxy_hops", 1)
    assert rate_limit.client_ip(_FakeRequest(peer="10.0.0.5")) == "10.0.0.5"


def test_a_missing_client_does_not_crash(monkeypatch):
    """`request.client` is Optional in Starlette, and a 500 here would take the route down."""
    monkeypatch.setattr(settings, "trusted_proxy_hops", 1)
    assert rate_limit.client_ip(_FakeRequest(peer=None)) == "unknown"


def test_a_huge_forwarded_header_cannot_store_an_unbounded_key(monkeypatch):
    """The header is attacker-supplied and has no length limit; the key must have one."""
    monkeypatch.setattr(settings, "trusted_proxy_hops", 1)
    req = _FakeRequest("x" * 10_000)
    assert len(rate_limit.client_ip(req)) <= rate_limit.MAX_KEY_CHARS


def test_the_account_key_is_case_insensitive_because_a_shift_key_is_not_a_new_account():
    """Otherwise the per-account limit is bypassed by capitalising one letter."""
    assert rate_limit.account_key("login", "Foo@X.com") == rate_limit.account_key(
        "login", "  foo@x.com "
    )


def test_route_names_scope_the_bucket():
    """A signup must not spend a login's allowance."""
    req = _FakeRequest()
    assert rate_limit.ip_key(req, "login") != rate_limit.ip_key(req, "signup")


# ---------------------------------------------------------------------------------------------
# THE OFF SWITCH
# ---------------------------------------------------------------------------------------------
def test_the_autouse_reset_fixture_IS_ACTUALLY_WIRED(request):
    """TESTING.md says `_forget_rate_limits` "must stay that way"; nothing enforced it until now.

    A ship gate pointed out the gap: delete the import from `conftest.py` and NOTHING fails — an
    autouse fixture only applies where pytest can see it — until the thirty-first failed-login
    assertion somewhere in the suite starts getting a 429 where it expected a 401. That failure
    lands in whichever test happens to run thirty-first and moves when tests are reordered, which
    is the worst kind of failure to inherit. This makes the wiring itself the thing that breaks.
    """
    assert "_forget_rate_limits" in request.fixturenames, (
        "the autouse rate-limit reset is not applying — check the import in tests/conftest.py"
    )
    assert rate_limit._buckets == {}, "a previous test leaked limiter state into this one"


def test_the_off_switch_disables_enforcement_entirely(clock, monkeypatch):
    """The reason it exists: this is the one control whose misfire locks real users out."""
    monkeypatch.setattr(settings, "rate_limit_enabled", False)
    for _ in range(100):
        rate_limit.enforce("k", 2, 60)  # would raise on the third if enabled


def test_the_off_switch_also_covers_the_login_halves_and_the_degrading_form(clock, monkeypatch):
    """Three separate entry points, so a partial off switch would be worse than none."""
    monkeypatch.setattr(settings, "rate_limit_enabled", False)
    for _ in range(100):
        rate_limit.note_failure("k", 2, 60)
        rate_limit.refuse_if_over("k", 2, 60)
        assert rate_limit.over_limit("k", 2, 60) is False


# ---------------------------------------------------------------------------------------------
# enforce / over_limit SEMANTICS
# ---------------------------------------------------------------------------------------------
def test_enforce_does_NOT_count_a_call_it_refused(clock):
    """A client stuck in a retry loop must be able to get out.

    Recording denials slides the window forward on every retry, so the caller is never allowed
    again while they keep trying — which punishes a buggy app update exactly as hard as an
    attacker, and does not deter the attacker at all.
    """
    for _ in range(3):
        rate_limit.enforce("k", 3, 60)
    for _ in range(10):
        with pytest.raises(Exception):
            rate_limit.enforce("k", 3, 60)
    clock.advance(61)
    rate_limit.enforce("k", 3, 60)  # the window really did expire


def test_over_limit_refuses_without_raising_and_counts_only_when_allowed(clock):
    for _ in range(2):
        assert rate_limit.over_limit("k", 2, 60) is False
    assert rate_limit.over_limit("k", 2, 60) is True
    clock.advance(61)
    assert rate_limit.over_limit("k", 2, 60) is False


# ---------------------------------------------------------------------------------------------
# THE ROUTES. Everything above tests the mechanism; these test the POLICY, which is where the
# damaging mistakes live — a limiter can refuse the wrong people and still pass every unit test.
#
# Two notes on how these drive the app. (1) `TestClient` presents one client address for the whole
# run, so an `X-Forwarded-For` header is how a test pretends to be a different caller — legitimate
# here because `trusted_proxy_hops` defaults to 1, i.e. "something in front appends the real
# address". A real caller cannot do this; the unit test on spoofing covers why. (2) Several tests
# shrink a limit with `monkeypatch` rather than making thirty real requests, because bcrypt is
# deliberately slow. The NUMBERS are asserted separately, once, in
# `test_the_shipped_policy_is_what_the_owner_chose`.
# ---------------------------------------------------------------------------------------------
def _login(client, email, password, ip=None):
    headers = {"X-Forwarded-For": ip} if ip else {}
    return client.post(
        "/auth/login", data={"username": email, "password": password}, headers=headers
    )


def test_the_shipped_policy_is_what_the_owner_chose():
    """The numbers, in one place, so a change to them is a deliberate edit to a test.

    Everything else about the login pair is asserted behaviourally; this is the only place the
    figures themselves are pinned.
    """
    assert rate_limit.LOGIN_PER_ACCOUNT == (10, 15 * 60)
    assert rate_limit.LOGIN_PER_IP == (30, 15 * 60)
    assert rate_limit.SIGNUP_PER_IP == (20, 60 * 60)
    assert rate_limit.FORGOT_PER_ACCOUNT == (3, 60 * 60)
    assert rate_limit.FORGOT_PER_IP == (10, 60 * 60)
    assert rate_limit.RESET_PER_IP == (10, 15 * 60)
    assert rate_limit.INVITE_READ_PER_IP == (60, 15 * 60)
    # Much larger than the read, DELIBERATELY — the Vercel rewrite fans every genuine unfurl for the
    # whole app into a handful of edge addresses, and a 256-bit token makes 60 and 600 equally
    # hopeless for a guesser. See the constant's own comment.
    assert rate_limit.INVITE_PREVIEW_PER_IP == (600, 15 * 60)
    assert rate_limit.INVITE_CLAIM_PER_IP == (20, 15 * 60)
    assert rate_limit.ROTATE_PER_IP == (20, 60 * 60)
    assert rate_limit.CRON_TRIGGER_PER_IP == (60, 60 * 60)
    assert rate_limit.PARSE_PER_USER == (20, 60 * 60)


def test_repeated_wrong_passwords_are_eventually_refused(client, make_user, monkeypatch):
    monkeypatch.setattr(rate_limit, "LOGIN_PER_ACCOUNT", (3, 900))
    user, _ = make_user()

    for i in range(2):
        assert _login(client, user.email, "wrong").status_code == 401, f"attempt {i + 1}"
    # The attempt that FILLS the bucket is itself answered with the wait, rather than a 401 that
    # invites one more try. Nothing is lost: the password was wrong either way.
    third = _login(client, user.email, "wrong")
    assert third.status_code == 429
    assert "Too many attempts" in third.json()["detail"]
    assert third.headers["Retry-After"]


def test_A_CORRECT_PASSWORD_STILL_WORKS_AFTER_THE_ACCOUNT_LIMIT_IS_HIT(
    client, make_user, monkeypatch
):
    """THE MOST IMPORTANT TEST IN THIS FILE. It is the difference between a rate limit and a weapon.

    Every address on this app is public (#80). If the per-account limit refused BEFORE the password
    was checked — the obvious way to write it — then anyone could type a stranger's email with three
    wrong passwords and lock that person out of their own account, repeatable forever by a script. A
    safety feature that lets a stranger deny you your own account is worse than the brute-force
    exposure it closes.

    So the password is verified FIRST and a correct one is never refused. The attacker gains nothing
    by filling the bucket: their guesses are all wrong, and they are still cut off.
    """
    monkeypatch.setattr(rate_limit, "LOGIN_PER_ACCOUNT", (3, 900))
    user, _ = make_user()

    for _ in range(3):
        _login(client, user.email, "wrong")
    assert _login(client, user.email, "wrong").status_code == 429, "the account is over its limit"

    good = _login(client, user.email, "password123")
    assert good.status_code == 200, "the owner must never be locked out by someone else's guesses"
    assert good.json()["access_token"]


def test_the_PER_IP_limit_refuses_even_a_correct_password(client, make_user, monkeypatch):
    """The other half of the asymmetry, and it has to cut deeper.

    Per-address IS a hard pre-check, because bcrypt is deliberately slow (~100ms) and an unbounded
    attempt rate is a CPU exhaustion vector on a 0.5-vCPU task quite apart from the guessing. An
    address is the caller's own resource, so refusing it costs nobody else — which is exactly why
    this dimension may do what the per-account one must not.

    Unknown emails fill the bucket so no bcrypt runs (`not user` short-circuits), which also proves
    the address count includes attempts against addresses that do not exist.
    """
    monkeypatch.setattr(rate_limit, "LOGIN_PER_IP", (3, 900))
    user, _ = make_user()

    for i in range(3):
        assert _login(client, f"nobody{i}@example.com", "x").status_code == 401

    refused = _login(client, user.email, "password123")
    assert refused.status_code == 429, "the address is over its limit, so nothing gets through"


def test_a_successful_login_clears_the_ACCOUNT_bucket(client, make_user, monkeypatch):
    """Someone who fumbled and then remembered should not be one mistake from a wait.

    Signing in is positive evidence of ownership, which is what the failure count stood in for.
    """
    monkeypatch.setattr(rate_limit, "LOGIN_PER_ACCOUNT", (3, 900))
    user, _ = make_user()

    for _ in range(2):
        _login(client, user.email, "wrong")
    assert _login(client, user.email, "password123").status_code == 200
    # Two fresh failures would have hit the limit without the clear.
    assert _login(client, user.email, "wrong").status_code == 401
    assert _login(client, user.email, "wrong").status_code == 401


def test_a_successful_login_does_NOT_clear_the_IP_bucket(client, make_user, monkeypatch):
    """A HOLE THAT WOULD OTHERWISE SWALLOW THE CPU PROTECTION ENTIRELY.

    If a success cleared the address bucket, an attacker holding ONE valid credential — their own
    account, which signup hands out freely — could log into it every twenty-nine guesses and reset
    the per-address limit forever. The limit that keeps bcrypt from being run without bound would
    then bound nothing.
    """
    monkeypatch.setattr(rate_limit, "LOGIN_PER_IP", (4, 900))
    user, _ = make_user()

    for i in range(3):
        _login(client, f"nobody{i}@example.com", "x")
    assert _login(client, user.email, "password123").status_code == 200, "3 < 4, still allowed"
    # The success must NOT have reset the address count: one more failure fills it.
    assert _login(client, user.email, "wrong").status_code in (401, 429)
    assert _login(client, user.email, "password123").status_code == 429


def test_two_different_callers_do_not_share_a_login_budget(client, make_user, monkeypatch):
    """What `client_ip` buys: one attacker cannot lock out the rest of the app.

    Get this wrong — read `request.client.host` behind the ALB — and every user on earth shares one
    bucket, so the first person to hit the limit takes everyone down with them.
    """
    monkeypatch.setattr(rate_limit, "LOGIN_PER_IP", (2, 900))
    user, _ = make_user()

    for _ in range(2):
        _login(client, user.email, "wrong", ip="198.51.100.1")
    assert _login(client, user.email, "password123", ip="198.51.100.1").status_code == 429
    assert _login(client, user.email, "password123", ip="198.51.100.2").status_code == 200


def test_signup_is_limited_per_address(client, monkeypatch):
    monkeypatch.setattr(rate_limit, "SIGNUP_PER_IP", (2, 3600))

    def _signup(n):
        return client.post(
            "/auth/signup",
            json={
                "email": f"new{n}@example.com",
                "password": "password123",
                "first_name": "New",
                "last_name": "Cook",
            },
        )

    assert _signup(1).status_code == 201
    assert _signup(2).status_code == 201
    assert _signup(3).status_code == 429


def test_forgot_password_is_limited_and_the_LIMIT_ITSELF_LEAKS_NOTHING(
    client, make_user, monkeypatch
):
    """The 204 is unconditional so the route never says which addresses exist; the limiter must not
    undo that.

    Counting only addresses that resolve — or refusing only those — would make a 429 mean "this
    account is real", which is a CLEANER oracle than an error message because it is machine-readable
    and needs no parsing. So both limits are applied before the address is looked up, and a real and
    an invented address are answered identically at every step.
    """
    monkeypatch.setattr(rate_limit, "FORGOT_PER_ACCOUNT", (2, 3600))
    monkeypatch.setattr(rate_limit, "FORGOT_PER_IP", (100, 3600))
    user, _ = make_user()

    real, fake = user.email, "definitely-not-a-user@example.com"
    for _ in range(2):
        assert client.post("/auth/forgot-password", json={"email": real}).status_code == 204
        assert client.post("/auth/forgot-password", json={"email": fake}).status_code == 204

    over_real = client.post("/auth/forgot-password", json={"email": real})
    over_fake = client.post("/auth/forgot-password", json={"email": fake})
    assert over_real.status_code == over_fake.status_code == 429
    assert over_real.json()["detail"] == over_fake.json()["detail"], (
        "a 429 that differs between a real and an invented address is an existence oracle"
    )


def test_the_forgot_password_account_limit_survives_capitalisation(client, make_user, monkeypatch):
    monkeypatch.setattr(rate_limit, "FORGOT_PER_ACCOUNT", (2, 3600))
    user, _ = make_user()

    client.post("/auth/forgot-password", json={"email": user.email})
    client.post("/auth/forgot-password", json={"email": user.email.upper()})
    assert client.post("/auth/forgot-password", json={"email": user.email}).status_code == 429


def test_reset_password_is_limited_per_address(client, monkeypatch):
    monkeypatch.setattr(rate_limit, "RESET_PER_IP", (2, 900))
    body = {"token": "not-a-real-token", "new_password": "password123"}
    assert client.post("/auth/reset-password", json=body).status_code == 400
    assert client.post("/auth/reset-password", json=body).status_code == 400
    assert client.post("/auth/reset-password", json=body).status_code == 429


def test_the_rotate_write_is_limited(client, monkeypatch):
    """The app's only unauthenticated write, and its 404 is an acknowledged existence oracle.

    An oracle you can consult without limit is a different thing from one you can consult.
    """
    monkeypatch.setattr(rate_limit, "ROTATE_PER_IP", (2, 3600))
    body = {
        "old_endpoint": "https://push.example.com/old",
        "subscription": {
            "endpoint": "https://push.example.com/new",
            "p256dh": "k",
            "auth": "a",
        },
    }
    assert client.post("/notifications/subscribe/rotate", json=body).status_code == 404
    assert client.post("/notifications/subscribe/rotate", json=body).status_code == 404
    assert client.post("/notifications/subscribe/rotate", json=body).status_code == 429


def test_the_CRON_TRIGGER_is_limited_without_becoming_an_oracle_for_the_secret(client, monkeypatch):
    """The last credential-presenting surface that had no ceiling at all.

    Secret-authenticated with `compare_digest` and a 404 for a wrong key, so guessing was never a
    realistic threat — but "not realistic" and "unbounded" are different claims, and a docs gate
    noticed this route falsified the README's coverage sentence. Softening the sentence would have
    been the wrong repair for a three-line hole.

    Generous by two orders of magnitude on purpose: the real caller is `daily-prompt.yml`, which
    GitHub delivers 5-7 times a DAY, and the PRIMARY trigger is in-process and never arrives over
    HTTP at all — so this limit cannot cost anybody a nudge.

    The limit is applied BEFORE the secret comparison, which is also what keeps it from leaking:
    a right key and a wrong one are equally subject to it, so a 429 says nothing about the key.
    """
    monkeypatch.setattr(rate_limit, "CRON_TRIGGER_PER_IP", (2, 3600))
    # No secret is configured in tests, so every call 404s — which is exactly the point: the
    # refusal has to arrive on the same terms regardless.
    assert client.post("/notifications/run-daily-prompt").status_code == 404
    assert client.post("/notifications/run-daily-prompt").status_code == 404
    over = client.post("/notifications/run-daily-prompt")
    assert over.status_code == 429
    # And with a (wrong) key presented, the answer is identical — no oracle either way.
    with_key = client.post(
        "/notifications/run-daily-prompt", headers={"X-Issei-Cron-Key": "guess"}
    )
    assert with_key.status_code == 429
    assert with_key.json()["detail"] == over.json()["detail"]


def test_the_invite_READ_is_limited(client, monkeypatch):
    monkeypatch.setattr(rate_limit, "INVITE_READ_PER_IP", (2, 900))
    assert client.get("/recipes/invite/nope").status_code == 404
    assert client.get("/recipes/invite/nope").status_code == 404
    assert client.get("/recipes/invite/nope").status_code == 429


def test_the_OG_PREVIEW_degrades_to_a_card_instead_of_refusing(client, monkeypatch):
    """A 429 satisfies the limiter and breaks the route's actual contract.

    This is the crawler-facing door. Its whole promise is that a crawler never receives an error,
    because an error is a shared link that unfurls as nothing — and a 429 unfurls as nothing just as
    surely as a 500 does. Not hypothetical: Apple, Meta and Slack crawl from concentrated address
    ranges, so ONE crawler address legitimately fetches previews for many people's links.

    So it degrades to the neutral card, which is the ideal refusal: the token is never resolved, so a
    guesser learns nothing about whether it was real, and an honest crawler still gets valid OG tags.
    """
    monkeypatch.setattr(rate_limit, "INVITE_READ_PER_IP", (1, 900))
    first = client.get("/recipes/invite/nope/preview")
    assert first.status_code == 200

    over = client.get("/recipes/invite/nope/preview")
    assert over.status_code == 200, "a crawler must never get an error from this route"
    assert "og:title" in over.text, "and it must still be a usable card"


def test_the_invite_read_and_its_OG_PREVIEW_have_SEPARATE_budgets(client, monkeypatch):
    """They share a token but NOT an allowance, and the first version got this backwards.

    "Two doors onto one secret, so one budget" sounds right and is wrong here, because of where the
    traffic comes from: `frontend/vercel.json` uses a REWRITE, so Vercel's edge proxies crawler
    previews server-side and the address the ALB appends is a VERCEL edge address. Every genuine
    unfurl for the whole app therefore lands in ONE bucket — making a shared 60-per-15-min an app-wide
    cap on real link previews, past which every shared recipe unfurls as the generic card. Silently,
    at 200, on the product's signature act. A ship gate found it.

    Splitting costs nothing a guesser could use: the token is 256 bits, so 60 and 600 guesses per
    window are equally hopeless, and the preview reveals strictly less than the JSON read (dish name,
    byline, cover — never ingredients, steps or story). These limits bound abuse VOLUME; the token
    protects itself.
    """
    monkeypatch.setattr(rate_limit, "INVITE_READ_PER_IP", (1, 900))
    monkeypatch.setattr(rate_limit, "INVITE_PREVIEW_PER_IP", (1, 900))
    # Spend the READ's whole budget.
    assert client.get("/recipes/invite/nope").status_code == 404
    assert client.get("/recipes/invite/nope").status_code == 429
    # The PREVIEW is untouched by that — a crawler must not be locked out by a human's reloading.
    assert client.get("/recipes/invite/nope/preview").status_code == 200
    # ...and vice versa: spending the preview's budget does not re-refuse or un-refuse the read.
    assert client.get("/recipes/invite/nope/preview").status_code == 200  # degrades, never errors
    assert client.get("/recipes/invite/nope").status_code == 429


def test_the_LLM_endpoint_is_limited_PER_USER_not_per_address(client, make_user, monkeypatch):
    """Cost, not safety — and the only limit keyed to a person rather than a network.

    Two housemates behind one address both write recipes; neither should eat the other's allowance.
    The auth gate already stops a stranger spending OpenRouter credits, and does nothing about one
    account in a loop, which costs exactly the same.
    """
    monkeypatch.setattr(rate_limit, "PARSE_PER_USER", (2, 3600))
    _, headers_a = make_user()
    _, headers_b = make_user()
    body = {"text": "a cup of rice, a splash of oil"}

    for _ in range(2):
        assert client.post("/recipes/parse", json=body, headers=headers_a).status_code == 200
    over = client.post("/recipes/parse", json=body, headers=headers_a)
    assert over.status_code == 429
    assert "recipes parsed" in over.json()["detail"]

    # The SECOND user, on the same address, is untouched.
    assert client.post("/recipes/parse", json=body, headers=headers_b).status_code == 200


def test_with_the_limiter_OFF_every_route_behaves_exactly_as_before(
    client, make_user, monkeypatch
):
    """The off switch has to be complete, or it is a worse trap than no switch.

    An operator flipping this mid-incident must get the old behaviour on every route at once — a
    partial off switch would leave one surface still refusing people while the setting says rate
    limiting is disabled.
    """
    monkeypatch.setattr(settings, "rate_limit_enabled", False)
    monkeypatch.setattr(rate_limit, "LOGIN_PER_IP", (1, 900))
    monkeypatch.setattr(rate_limit, "LOGIN_PER_ACCOUNT", (1, 900))
    monkeypatch.setattr(rate_limit, "RESET_PER_IP", (1, 900))
    monkeypatch.setattr(rate_limit, "INVITE_READ_PER_IP", (1, 900))
    user, _ = make_user()

    for _ in range(4):
        assert _login(client, user.email, "wrong").status_code == 401
        assert client.get("/recipes/invite/nope").status_code == 404
        assert (
            client.post(
                "/auth/reset-password", json={"token": "x", "new_password": "password123"}
            ).status_code
            == 400
        )
    assert _login(client, user.email, "password123").status_code == 200
