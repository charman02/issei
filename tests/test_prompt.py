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
        photo_url="https://img.test/a.jpg",
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


def test_due_only_at_their_own_hour(db_session, make_user):
    me, _ = make_user()
    me.timezone = "Asia/Manila"
    me.notify_hour = 18
    db_session.commit()
    assert prompt.is_due(me, _local("Asia/Manila", 18)) is True
    assert prompt.is_due(me, _local("Asia/Manila", 17)) is False
    assert prompt.is_due(me, _local("Asia/Manila", 19)) is False


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
    me.notify_prompt = False
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
    """Two switches, two meanings: `notify_people` is a person reaching you, `notify_prompt` is the
    app nudging you. Turning off one must not silently turn off the other."""
    me, _ = make_user()
    me.timezone = "Asia/Manila"
    me.notify_people = False
    db_session.commit()
    assert prompt.is_due(me, _local("Asia/Manila", 18)) is True
