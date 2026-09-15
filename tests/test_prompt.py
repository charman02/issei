"""The daily prompt's due-check and its count (#89).

The count is the whole reason this file is careful. The obvious query —

    SELECT COUNT(*) FROM posts WHERE user_id IN (friends) AND id > mark

— mirrors the feed's own SQL, which makes it look like reuse. It isn't: the feed's correctness
lives in the Python `can_view_post` filter two lines AFTER that SQL, so the aggregate version
counts a friend's PRIVATE post and a BLOCKED person's post. Both of those are tested here, and
both would pass silently against a naive implementation.

It also counts PEOPLE, not posts — the copy says "3 friends posted" — which is one character apart
from `COUNT(*)` and invisible in any fixture that gives each friend exactly one post. Which is
every other fixture in this repo, hence `test_one_friend_posting_three_times_is_ONE_friend`.
"""

from datetime import datetime, timedelta, timezone as dt_timezone
from zoneinfo import ZoneInfo

from app.models.block import Block
from app.models.friendship import Friendship
from app.models.post import Post
from app.services import prompt


def _befriend(db, a, b):
    lo, hi = sorted([a.id, b.id])
    db.add(
        Friendship(
            requester_id=a.id,
            addressee_id=b.id,
            pair_low=lo,
            pair_high=hi,
            state="accepted",
        )
    )
    db.commit()


def _post(db, author, visibility="friends", dish="Adobo"):
    p = Post(
        user_id=author.id,
        photo_url="https://res.cloudinary.com/demo/image/upload/a.jpg",
        dish_name=dish,
        visibility=visibility,
    )
    db.add(p)
    db.commit()
    db.refresh(p)
    return p


# --- the count, and the two ways the obvious query gets it wrong ---


def test_it_counts_a_friends_visible_post(db_session, make_user):
    me, _ = make_user()
    friend, _ = make_user()
    _befriend(db_session, me, friend)
    _post(db_session, friend)
    assert prompt.friends_who_posted(me, db_session) == 1


def test_it_does_NOT_count_a_friends_PRIVATE_post(db_session, make_user):
    """`visibility` is per-post: being friends does not make a private post readable, and the
    naive aggregate has no visibility predicate at all."""
    me, _ = make_user()
    friend, _ = make_user()
    _befriend(db_session, me, friend)
    _post(db_session, friend, visibility="private")
    assert prompt.friends_who_posted(me, db_session) == 0


def test_it_does_NOT_count_a_BLOCKED_persons_post(db_session, make_user):
    """A block deletes the friendship, so in principle a blocked person can't be a friend — but
    two block rows can exist per pair, unblocking removes only your own, and the friendship is
    never restored. "A blocked person isn't a friend" is DERIVED, not enforced, so this is a
    reachable state and a prompt that counted it would leak exactly what #85 closes."""
    me, _ = make_user()
    them, _ = make_user()
    _befriend(db_session, me, them)
    _post(db_session, them, visibility="public")
    db_session.add(Block(blocker_id=me.id, blocked_id=them.id))
    db_session.commit()
    assert prompt.friends_who_posted(me, db_session) == 0


def test_it_does_NOT_count_a_post_from_someone_who_blocked_ME(db_session, make_user):
    """The effect is symmetric even though the row is directional."""
    me, _ = make_user()
    them, _ = make_user()
    _befriend(db_session, me, them)
    _post(db_session, them, visibility="public")
    db_session.add(Block(blocker_id=them.id, blocked_id=me.id))
    db_session.commit()
    assert prompt.friends_who_posted(me, db_session) == 0


def test_one_friend_posting_three_times_is_ONE_friend(db_session, make_user):
    """The copy says "3 friends posted". COUNT(*) would make that sentence false, and every
    fixture in this repo gives each friend exactly one post — so nothing else would catch it."""
    me, _ = make_user()
    friend, _ = make_user()
    _befriend(db_session, me, friend)
    for i in range(3):
        _post(db_session, friend, dish=f"Dish {i}")
    assert prompt.friends_who_posted(me, db_session) == 1


def test_three_friends_posting_once_each_is_three(db_session, make_user):
    me, _ = make_user()
    for _ in range(3):
        friend, _ = make_user()
        _befriend(db_session, me, friend)
        _post(db_session, friend)
    assert prompt.friends_who_posted(me, db_session) == 3


def test_it_ignores_posts_at_or_below_the_read_mark(db_session, make_user):
    """"Since you last looked" is the whole claim. IDs, not timestamps — same reasoning as #97."""
    me, _ = make_user()
    friend, _ = make_user()
    _befriend(db_session, me, friend)
    old = _post(db_session, friend, dish="already seen")
    me.last_feed_seen_post_id = old.id
    db_session.commit()
    assert prompt.friends_who_posted(me, db_session) == 0

    _post(db_session, friend, dish="new")
    assert prompt.friends_who_posted(me, db_session) == 1


def test_a_user_who_has_never_looked_counts_everything(db_session, make_user):
    me, _ = make_user()
    friend, _ = make_user()
    _befriend(db_session, me, friend)
    _post(db_session, friend)
    assert me.last_feed_seen_post_id is None
    assert prompt.friends_who_posted(me, db_session) == 1


def test_your_own_posts_dont_count(db_session, make_user):
    """You were there when you made it. The prompt is about other people cooking."""
    me, _ = make_user()
    _post(db_session, me)
    assert prompt.friends_who_posted(me, db_session) == 0


def test_a_stranger_does_not_count(db_session, make_user):
    me, _ = make_user()
    stranger, _ = make_user()
    _post(db_session, stranger, visibility="public")
    assert prompt.friends_who_posted(me, db_session) == 0


def test_someone_with_no_friends_gets_zero_without_a_query(db_session, make_user):
    me, _ = make_user()
    assert prompt.friends_who_posted(me, db_session) == 0


# --- the copy: zero says nothing at all ---


def test_zero_produces_NO_notification(db_session, make_user):
    """A prompt firing on an empty feed has to fall back on something generic ("open issei!"),
    which is the species of notification people mute an app over. Consistent with every other
    absence in this app: a request count is hidden at zero, so is a keeper count, and an empty
    Blocked list isn't rendered."""
    assert prompt.prompt_payload(0) is None
    assert prompt.prompt_payload(-1) is None


def test_one_friend_is_SINGULAR():
    """The app writes "1 person asked for this", not "1 person(s)"."""
    body = prompt.prompt_payload(1)["body"]
    assert body == "1 friend posted since you last looked."


def test_more_than_one_is_plural():
    assert prompt.prompt_payload(3)["body"] == "3 friends posted since you last looked."


def test_the_payload_lands_on_the_feed_and_collapses_with_itself():
    p = prompt.prompt_payload(2)
    assert p["url"] == "/", "the message is about the feed, so that's where the tap goes"
    assert p["tag"] == "daily-prompt", "so two unopened days don't stack into a pile"


def test_the_prompt_copy_claims_nothing_forbidden():
    """POSITIONING: no voice/audio, and it must not imply anything expires or was missed in a way
    that suggests it's gone. "Since you last looked" is a position, not a deadline."""
    banned = ("voice", "audio", "record", "listen", "expire", "disappear", "last chance")
    body = prompt.prompt_payload(5)["body"].lower()
    for word in banned:
        assert word not in body, word


# --- who is due ---


def _local(tz, hour):
    """A tz-aware 'now' in `tz` at `hour`."""
    base = datetime.now(dt_timezone.utc).astimezone(ZoneInfo(tz))
    return base.replace(hour=hour, minute=30)


def test_a_user_with_no_timezone_is_NEVER_due(db_session, make_user):
    """Every account predating #89 has none, and no backfill can invent one. Skipping is the
    honest behaviour — guessing UTC would nudge someone at 3am."""
    me, _ = make_user()
    assert me.timezone is None
    assert prompt.local_now(me) is None
    assert prompt.is_due(me, prompt.local_now(me)) is False


def test_an_unknown_timezone_degrades_to_not_due(db_session, make_user):
    """A junk value can't crash a scheduled run for everyone else."""
    me, _ = make_user()
    me.timezone = "Mars/Olympus_Mons"
    db_session.commit()
    assert prompt.local_now(me) is None


def test_the_tz_database_is_actually_present():
    """A CONTAINER-ONLY failure otherwise: python:3.13-slim may ship without tzdata, so every
    lookup raises in prod while passing on a dev box and in CI. This is the assertion that belongs
    in the image, and `local_now` swallows the error so a missing database degrades to "nobody is
    due" rather than crashing."""
    assert ZoneInfo("Asia/Manila") is not None
    assert ZoneInfo("America/Los_Angeles") is not None


def test_not_due_BEFORE_their_hour(db_session, make_user):
    """The half of the hour check that survived catch-up. Being due once the hour has PASSED is
    covered by test_due_ONCE_THEIR_HOUR_HAS_PASSED_not_only_during_it, which explains why."""
    me, _ = make_user()
    me.timezone = "Asia/Manila"
    me.notify_hour = 18
    db_session.commit()
    assert prompt.is_due(me, _local("Asia/Manila", 18)) is True
    assert prompt.is_due(me, _local("Asia/Manila", 17)) is False
    assert prompt.is_due(me, _local("Asia/Manila", 9)) is False


def test_the_same_hour_in_two_timezones_is_two_different_moments(db_session, make_user):
    """The reason a timezone column exists at all. 18:00 in Manila and 18:00 in California are ten
    hours apart, and a single global send hour would reach one of them in the middle of the night —
    which matters here specifically, because this app's premise is a recipe crossing that distance.
    """
    manila, _ = make_user()
    manila.timezone = "Asia/Manila"
    cali, _ = make_user()
    cali.timezone = "America/Los_Angeles"
    db_session.commit()

    now = datetime.now(dt_timezone.utc)
    offset_manila = now.astimezone(ZoneInfo("Asia/Manila")).utcoffset()
    offset_cali = now.astimezone(ZoneInfo("America/Los_Angeles")).utcoffset()
    assert offset_manila != offset_cali
    assert abs((offset_manila - offset_cali) / timedelta(hours=1)) >= 10


def test_the_nudge_switch_turns_it_off(db_session, make_user):
    me, _ = make_user()
    me.timezone = "Asia/Manila"
    me.notify_posts = "off"
    db_session.commit()
    assert prompt.is_due(me, _local("Asia/Manila", 18)) is False


def test_INSTANT_is_not_daily_and_that_is_the_whole_point(db_session, make_user):
    """The exclusivity, in the one line that implements it.

    Someone on "instant" is pushed as each friend posts, so the 18:00 nudge would be a fourth
    notification summarising three they have already been shown. `is_due` tests `== "daily"`; the
    tempting `!= "off"` reads as equivalent and ships exactly that double delivery. Which is why
    this test exists rather than only the on/off pair above.
    """
    me, _ = make_user()
    me.timezone = "Asia/Manila"
    me.notify_posts = "instant"
    db_session.commit()
    assert prompt.is_due(me, _local("Asia/Manila", 18)) is False


def test_quiet_hours_beat_the_send_hour(db_session, make_user):
    """A user whose notify_hour sits inside their own quiet window is never nudged. That's a
    coherent configuration, not a bug to route around — and quiet hours are checked even though
    sending is already local, because a person's day isn't the same as their timezone's."""
    me, _ = make_user()
    me.timezone = "Asia/Manila"
    me.notify_hour = 23
    me.quiet_from = 22
    me.quiet_to = 8
    db_session.commit()
    assert prompt.is_due(me, _local("Asia/Manila", 23)) is False


def test_the_people_switch_does_not_affect_the_daily_nudge(db_session, make_user):
    """Two settings, two meanings: `notify_people` is a person reaching you, `notify_posts` is the
    app bringing you the feed. Turning off one must not silently turn off the other."""
    me, _ = make_user()
    me.timezone = "Asia/Manila"
    me.notify_people = False
    db_session.commit()
    assert prompt.is_due(me, _local("Asia/Manila", 18)) is True


# --- catch-up semantics: what makes an unreliable trigger acceptable ---


def test_due_ONCE_THEIR_HOUR_HAS_PASSED_not_only_during_it(db_session, make_user):
    """The decision that makes a GitHub Actions cron a defensible trigger.

    Exact-hour matching quietly requires the job to run inside the right hour, every hour, forever
    — and nothing can promise that: Actions cron drifts 5-30 minutes and drops runs under load,
    EventBridge is at-least-once rather than on-time, and any tick misses an hour during a deploy.
    Under exact-hour, a late run means that timezone gets NOTHING that day and nobody finds out,
    because the failure is an absence.
    """
    me, _ = make_user()
    me.timezone = "Asia/Manila"
    me.notify_hour = 18
    db_session.commit()

    assert prompt.is_due(me, _local("Asia/Manila", 17)) is False, "not yet"
    assert prompt.is_due(me, _local("Asia/Manila", 18)) is True, "on time"
    assert prompt.is_due(me, _local("Asia/Manila", 19)) is True, "40 min late still catches"
    assert prompt.is_due(me, _local("Asia/Manila", 21)) is True, "hours late still catches"


def test_catch_up_still_STOPS_at_quiet_hours(db_session, make_user):
    """Quiet hours now do real work: someone missed at 18:00 is not caught up at 23:00 if 22:00 is
    their boundary. They get nothing that day, which is the correct outcome — and the reason the
    two settings have to be separate."""
    me, _ = make_user()
    me.timezone = "Asia/Manila"
    me.notify_hour = 18
    me.quiet_from = 22
    me.quiet_to = 8
    db_session.commit()
    assert prompt.is_due(me, _local("Asia/Manila", 21)) is True
    assert prompt.is_due(me, _local("Asia/Manila", 22)) is False
    assert prompt.is_due(me, _local("Asia/Manila", 23)) is False


# --- the runner ---


def _sub(db, user, endpoint="https://push.example/a"):
    from app.models.push_subscription import PushSubscription

    s = PushSubscription(
        user_id=user.id, endpoint=endpoint, p256dh="pubkey", auth="authsecret"
    )
    db.add(s)
    db.commit()
    return s


def _due_user(db, make_user, tz="Asia/Manila"):
    """A user who is due right now: notify_hour 0 so any local hour has passed, and quiet hours
    disabled by equal bounds so the test does not depend on what time it happens to run."""
    u, _ = make_user()
    u.timezone = tz
    u.notify_hour = 0
    u.quiet_from = 9
    u.quiet_to = 9
    db.commit()
    return u


def test_the_runner_sends_once_and_records_the_day(db_session, make_user, monkeypatch):
    from app.models.prompt_send import PromptSend

    calls = []
    monkeypatch.setattr(prompt, "friends_who_posted", lambda user, db: 3)
    monkeypatch.setattr("app.services.push.is_configured", lambda: True)
    monkeypatch.setattr("app.services.push.send", lambda *a, **k: calls.append(a) or 201)

    me = _due_user(db_session, make_user)
    _sub(db_session, me)

    summary = prompt.run_daily_prompt(db_session)
    assert summary["sent"] == 1
    assert len(calls) == 1
    rows = db_session.query(PromptSend).filter(PromptSend.user_id == me.id).all()
    assert len(rows) == 1
    assert rows[0].friend_count == 3


def test_a_SECOND_run_the_same_day_sends_NOTHING(db_session, make_user, monkeypatch):
    """The whole reason `prompt_sends` exists. A re-triggered cron, an overlapping deploy, an
    at-least-once schedule — none of them can double-send, because the database refuses the
    duplicate rather than this function remembering to check."""
    calls = []
    monkeypatch.setattr(prompt, "friends_who_posted", lambda user, db: 2)
    monkeypatch.setattr("app.services.push.is_configured", lambda: True)
    monkeypatch.setattr("app.services.push.send", lambda *a, **k: calls.append(a) or 201)

    me = _due_user(db_session, make_user)
    _sub(db_session, me)

    assert prompt.run_daily_prompt(db_session)["sent"] == 1
    second = prompt.run_daily_prompt(db_session)
    assert second["sent"] == 0
    assert second["skipped"] == 1
    assert len(calls) == 1, "sent twice"


def test_an_empty_feed_sends_nothing_AND_does_not_burn_the_day(db_session, make_user, monkeypatch):
    """Deliberately not recorded as sent: if a friend posts later today this person should still be
    reachable. Recording it would mean an empty feed at 18:00 costs them the whole evening."""
    from app.models.prompt_send import PromptSend

    calls = []
    monkeypatch.setattr(prompt, "friends_who_posted", lambda user, db: 0)
    monkeypatch.setattr("app.services.push.is_configured", lambda: True)
    monkeypatch.setattr("app.services.push.send", lambda *a, **k: calls.append(a) or 201)

    me = _due_user(db_session, make_user)
    _sub(db_session, me)

    assert prompt.run_daily_prompt(db_session)["sent"] == 0
    assert calls == []
    assert db_session.query(PromptSend).count() == 0, "the day must stay claimable"

    monkeypatch.setattr(prompt, "friends_who_posted", lambda user, db: 1)
    monkeypatch.setattr("app.services.push.is_configured", lambda: True)
    assert prompt.run_daily_prompt(db_session)["sent"] == 1


def test_a_user_with_no_timezone_is_never_a_candidate(db_session, make_user, monkeypatch):
    calls = []
    monkeypatch.setattr(prompt, "friends_who_posted", lambda user, db: 5)
    monkeypatch.setattr("app.services.push.is_configured", lambda: True)
    monkeypatch.setattr("app.services.push.send", lambda *a, **k: calls.append(a) or 201)
    me, _ = make_user()
    _sub(db_session, me)
    assert prompt.run_daily_prompt(db_session)["candidates"] == 0
    assert calls == []


def test_the_nudge_switch_excludes_them_in_SQL(db_session, make_user, monkeypatch):
    monkeypatch.setattr(prompt, "friends_who_posted", lambda user, db: 5)
    monkeypatch.setattr("app.services.push.is_configured", lambda: True)
    monkeypatch.setattr("app.services.push.send", lambda *a, **k: 201)
    me = _due_user(db_session, make_user)
    me.notify_posts = "off"
    db_session.commit()
    assert prompt.run_daily_prompt(db_session)["candidates"] == 0


def test_an_INSTANT_user_is_excluded_from_the_daily_run_in_SQL(
    db_session, make_user, monkeypatch
):
    """The same exclusivity as `is_due`, but at the candidate query — because the SQL filter and
    the Python predicate are two separate places that both have to agree, and the SQL one is the
    cheap-looking `.is_(True)` that a rename would quietly turn into "everyone"."""
    monkeypatch.setattr(prompt, "friends_who_posted", lambda user, db: 5)
    monkeypatch.setattr("app.services.push.is_configured", lambda: True)
    monkeypatch.setattr("app.services.push.send", lambda *a, **k: 201)
    me = _due_user(db_session, make_user)
    me.notify_posts = "instant"
    db_session.commit()
    assert prompt.run_daily_prompt(db_session)["candidates"] == 0


def test_a_DEAD_subscription_is_pruned(db_session, make_user, monkeypatch):
    from app.models.push_subscription import PushSubscription

    monkeypatch.setattr(prompt, "friends_who_posted", lambda user, db: 1)
    monkeypatch.setattr("app.services.push.is_configured", lambda: True)
    monkeypatch.setattr("app.services.push.send", lambda *a, **k: 410)
    me = _due_user(db_session, make_user)
    _sub(db_session, me)
    prompt.run_daily_prompt(db_session)
    assert db_session.query(PushSubscription).count() == 0


def test_a_BAD_KEY_does_not_prune_anything(db_session, make_user, monkeypatch):
    """401/403 mean OUR key is wrong, not that the device is gone. Pruning on those would empty the
    whole table on the first botched rotation — and a subscription can only be recreated by the user
    re-granting permission on that device, so there is no recovery path."""
    from app.models.push_subscription import PushSubscription

    monkeypatch.setattr(prompt, "friends_who_posted", lambda user, db: 1)
    monkeypatch.setattr("app.services.push.is_configured", lambda: True)
    monkeypatch.setattr("app.services.push.send", lambda *a, **k: 403)
    me = _due_user(db_session, make_user)
    _sub(db_session, me)
    summary = prompt.run_daily_prompt(db_session)
    assert db_session.query(PushSubscription).count() == 1, "pruned on the wrong status"
    assert summary["failed"] == 1


def test_all_of_a_users_devices_get_it(db_session, make_user, monkeypatch):
    sent_to = []
    monkeypatch.setattr(prompt, "friends_who_posted", lambda user, db: 1)
    monkeypatch.setattr("app.services.push.is_configured", lambda: True)
    monkeypatch.setattr(
        "app.services.push.send",
        lambda endpoint, *a, **k: sent_to.append(endpoint) or 201,
    )
    me = _due_user(db_session, make_user)
    _sub(db_session, me, "https://push.example/phone")
    _sub(db_session, me, "https://push.example/laptop")
    prompt.run_daily_prompt(db_session)
    assert sorted(sent_to) == ["https://push.example/laptop", "https://push.example/phone"]


def test_a_due_user_with_NO_devices_is_not_an_error(db_session, make_user, monkeypatch):
    """Preferences on, zero subscriptions — someone who has not installed it anywhere. The day is
    still claimed, because they were genuinely due and nothing here can install an app for them."""
    monkeypatch.setattr(prompt, "friends_who_posted", lambda user, db: 4)
    monkeypatch.setattr("app.services.push.is_configured", lambda: True)
    _due_user(db_session, make_user)
    summary = prompt.run_daily_prompt(db_session)
    assert summary["sent"] == 0
    assert summary["failed"] == 1


# --- the review findings, each with the failure it reproduced ---


def test_the_cap_cannot_SUPPRESS_the_prompt(db_session, make_user):
    """Review reproduced this: five friends post normally, ONE chatty friend then posts 30 private
    meals, and the count came back ZERO — no push that evening or any evening until the person
    opened the feed, because a zero is deliberately not recorded so every retry recomputed it.

    The cause was applying the 30-row cap in SQL BEFORE the Python visibility filter, which is
    exactly the bug this module's docstring says it exists to avoid: an SQL-side truncation the
    filter cannot see past. The exclusions live in the SQL now, so the cap only ever drops rows
    that would have counted.
    """
    me, _ = make_user()
    visible_friends = []
    for i in range(5):
        f, _ = make_user()
        _befriend(db_session, me, f)
        _post(db_session, f, dish=f"Real meal {i}")
        visible_friends.append(f)

    chatty, _ = make_user()
    _befriend(db_session, me, chatty)
    for i in range(prompt.PROMPT_SCAN_LIMIT + 5):
        _post(db_session, chatty, visibility="private", dish=f"Private {i}")

    assert prompt.friends_who_posted(me, db_session) == 5


def test_the_cap_cannot_be_swamped_by_a_BLOCKED_persons_posts(db_session, make_user):
    """Same shape, other exclusion. A blocked author whose friendship row survived is the state
    `test_it_does_NOT_count_a_BLOCKED_persons_post` establishes is reachable."""
    me, _ = make_user()
    friend, _ = make_user()
    _befriend(db_session, me, friend)
    _post(db_session, friend, dish="the one that counts")

    blocked, _ = make_user()
    _befriend(db_session, me, blocked)
    for i in range(prompt.PROMPT_SCAN_LIMIT + 5):
        _post(db_session, blocked, visibility="public", dish=f"Noise {i}")
    db_session.add(Block(blocker_id=me.id, blocked_id=blocked.id))
    db_session.commit()

    assert prompt.friends_who_posted(me, db_session) == 1


def test_one_chatty_friend_does_not_hide_the_others(db_session, make_user):
    """The milder, likelier form of the same bug: it kept the copy true but undercounted, so it
    would never have been noticed."""
    me, _ = make_user()
    chatty, _ = make_user()
    _befriend(db_session, me, chatty)
    for i in range(prompt.PROMPT_SCAN_LIMIT):
        _post(db_session, chatty, dish=f"Chatter {i}")
    for i in range(5):
        f, _ = make_user()
        _befriend(db_session, me, f)
        _post(db_session, f, dish=f"Quiet {i}")
    assert prompt.friends_who_posted(me, db_session) == 6


def test_an_UNCONFIGURED_deploy_does_not_burn_everyones_day(db_session, make_user, monkeypatch):
    """The day is claimed BEFORE the send is attempted, which is right for a transient failure (one
    missed nudge) and wrong for a configuration one that persists across every run.

    Without the is_configured() guard, the first deploy that has timezones but not keys would claim
    a prompt_sends row for every due user, send nothing, and spend that local date permanently.
    """
    from app.models.prompt_send import PromptSend
    from app.services import push

    assert push.is_configured() is False
    monkeypatch.setattr(prompt, "friends_who_posted", lambda user, db: 3)
    me = _due_user(db_session, make_user)
    _sub(db_session, me)

    summary = prompt.run_daily_prompt(db_session)
    assert summary["sent"] == 0
    assert summary.get("configured") is False
    assert db_session.query(PromptSend).count() == 0, "claimed a day it could not deliver"
