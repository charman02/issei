"""The daily prompt: who should hear from us, and what it should say (#89).

"3 friends posted since you last looked" — the whole content of the nudge, and the reason #97's
feed read-mark had to exist first. FUTURE.md says #97 "shipped the count"; that is half true. It
shipped the WATERMARK (`users.last_feed_seen_post_id`) the count is derivable from. There is no
aggregate anywhere in the app: the mark is read in exactly one place and written in one, and the
only thing derived from it is a per-post boolean.

THE OBVIOUS QUERY IS WRONG TWICE OVER, and it is wrong in a way that looks like reuse:

    SELECT COUNT(*) FROM posts WHERE user_id IN (friends) AND id > mark

That mirrors the feed's own SQL almost exactly — which is the trap. The feed's correctness is not
in its SQL; it is in the Python filter two lines later, where every row is re-gated through
`can_view_post` with a precomputed block set. So the query above counts:

  1. A friend's PRIVATE post. `visibility` is per-post, and "we're friends" does not make a
     friends-only-or-private post readable — `private` means the owner only.
  2. A BLOCKED person's post. A block deletes the friendship, so in principle a blocked person
     can't be a friend — but two block rows can exist for one pair and unblocking removes only
     your own, while the friendship is never restored. "A blocked person isn't a friend" is a
     derived property, not an enforced one, and a prompt that counts their post leaks exactly
     what #85 closes.

So this module goes through the same gate the feed does, deliberately paying a per-row check
rather than trusting a clever aggregate. The volume is one query per due user per day.

AND IT COUNTS PEOPLE, NOT POSTS. The copy says "3 friends posted", so the number is
COUNT(DISTINCT author) — one friend who posted three times is one friend. `COUNT(*)` is one
character away and would make the sentence false, invisibly, in any test whose fixtures give each
friend a single post (which is every fixture in this repo).
"""

import logging
from datetime import datetime, timedelta, timezone as dt_timezone
from typing import Optional
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from sqlalchemy.orm import Session

from app.models.post import Post
# Imported at MODULE level, not inside the function that uses them. A model reached only by a
# lazy import is never registered on `Base.metadata`, so `create_all` silently omits its table
# and every test touching it fails with "no such table" — which is exactly how this was found.
from app.models.prompt_send import PromptSend
from app.models.push_subscription import PushSubscription
from app.models.user import User
from app.services.blocks import blocked_ids
from app.services.friends import friend_ids
from app.services.push import in_quiet_hours
from app.services.sharing import can_view_post

log = logging.getLogger(__name__)


def local_now(user: User) -> Optional[datetime]:
    """What time it is where this person is, or None if we can't know.

    None for a user with no `timezone` — every account that predates #89, until they next sign
    in. That is deliberately a "skip", not a fallback to UTC: guessing would nudge someone at 3am,
    which is worse than not nudging them at all.

    ZoneInfoNotFoundError is caught rather than allowed to propagate because it is a
    CONTAINER-ONLY failure: `python:3.13-slim` may ship without a tz database, so every lookup
    would raise in prod while working on a dev box and in CI (ubuntu-latest has tzdata). Swallowing
    it means a missing tzdata degrades to "nobody is due" plus a loud log, rather than crashing a
    scheduled run. `tests/test_prompt.py` asserts the tz database is actually present, which is
    the check that belongs in the image.
    """
    if not user.timezone:
        return None
    try:
        return datetime.now(dt_timezone.utc).astimezone(ZoneInfo(user.timezone))
    except (ZoneInfoNotFoundError, ValueError):
        log.warning("prompt: unknown timezone %r for user %s", user.timezone, user.id)
        return None


def is_due(user: User, now_local: Optional[datetime]) -> bool:
    """Should this person be nudged at this moment?

    CATCH-UP, NOT EXACT-HOUR — and this is the decision that makes the whole thing robust.

    The obvious test is `now_local.hour == user.notify_hour`, and it quietly requires the job to
    run inside the right hour, every hour, forever. Nothing we can trigger it with promises that:
    GitHub Actions cron routinely drifts 5-30 minutes and drops runs entirely under load,
    EventBridge is at-least-once rather than on-time, and any hourly tick misses an hour during a
    deploy. Under exact-hour, a late run means that timezone gets NOTHING that day, and nobody
    finds out — the failure is an absence.

    So the question is "has their hour PASSED today, and have they not been sent yet?" A run at
    19:40 still catches the 18:00 people. A run that never happens catches them next time. The
    trigger becomes a liveness concern rather than a correctness one, which is the only sane place
    for it to be.

    "Not sent yet" is `prompt_sends`, whose UNIQUE (user, local_date) is what makes catch-up safe:
    without it, this reading would nudge someone every hour from 18:00 until midnight.

    Quiet hours are still checked, and now they do real work: someone missed at 18:00 will not be
    caught up at 23:00 if 22:00 is their quiet boundary — they simply get nothing that day, which
    is the correct outcome and the reason the two settings are separate. It also means a
    `notify_hour` sitting inside a user's own quiet window is a coherent "not for now" rather than
    a bug to route around.

    WHAT THIS FUNCTION DELIBERATELY DOES NOT ASK is whether anyone else has posted. It used to,
    via the caller, and that was the circularity: the mechanism for getting people to post required
    people to have already posted, so it amplified activity and could never start it. The
    caller now asks `posted_today(user)` — the recipient's OWN absence — which bootstraps from zero
    users and goes quiet for people who are already active. See `posted_today`.
    """
    if now_local is None or not user.notify_prompt_me:
        return False
    if now_local.hour < user.notify_hour:
        return False
    return not in_quiet_hours(now_local.hour, user.quiet_from, user.quiet_to)


def days_since_last_prompt(user: User, now_local: datetime, db: Session) -> Optional[int]:
    """How many of this person's own local days since their last nudge, or None if never nudged.

    Reads the same `prompt_sends` rows the insert below relies on. It does NOT replace that insert —
    two concurrent runs must still be settled by the database rather than by a check-then-act — it
    exists so the run can honour the person's chosen FREQUENCY and so the summary can say which of
    the two "not yet" answers applied.
    """
    last = (
        db.query(PromptSend.local_date)
        .filter(PromptSend.user_id == user.id)
        .order_by(PromptSend.local_date.desc())
        .first()
    )
    if last is None:
        return None
    return (now_local.date() - last[0]).days


def prompt_window_reason(user: User, now_local: datetime, db: Session) -> Optional[str]:
    """None if the person's chosen frequency allows a nudge now; otherwise which "not yet" it is.

    THE FREQUENCY IS A MINIMUM GAP IN LOCAL DAYS (`notify_prompt_every_days`), and the
    at-most-once-a-day rule is this same rule at its floor — 1 means "the last one must have been
    yesterday or earlier", which is exactly what the per-day UNIQUE already enforced. Generalising
    the existing predicate rather than adding a second one beside it is the point: there is one
    place that decides "is it too soon", and `notify_prompt_every_days = 1` is the old behaviour.

    TWO REASONS RATHER THAN ONE, because they mean different things to whoever is reading the log:
    `already_sent_today` is ordinary idempotence and shows up on every re-run of the cron, while
    `nudged_recently` means the person's own frequency setting is doing its job. Collapsing them
    would make a deliberate weekly cadence look like a duplicate-send guard.
    """
    gap = days_since_last_prompt(user, now_local, db)
    if gap is None:
        return None
    if gap <= 0:
        return "already_sent_today"
    # NO FLOOR ON THE STORED VALUE HERE, and the first version had one — `max(1, ...)` — with a
    # comment claiming it stopped a nonsensical row meaning "several times a day". A mutation test
    # deleted it and nothing went red, which was correct: the `gap <= 0` branch above already
    # guarantees `gap >= 1`, so any stored value of 1 or less permits exactly the same set of days.
    # The floor could not change an outcome. Defensive code that defends nothing, carrying a comment
    # that says it does, is worse than none — the next person budgets for a risk that isn't there.
    #
    # What actually bounds this: `gap <= 0` above (never twice in one local day), `prompt_sends`'
    # UNIQUE (user, local_date) in the database, and `ge=1` on the schema.
    if gap < user.notify_prompt_every_days:
        return "nudged_recently"
    return None


def posted_today(user: User, now_local: datetime, db: Session) -> bool:
    """Has this person shared a meal during THEIR OWN local day?

    THE ONE SUBSTITUTION THAT MAKES THE NUDGE WORK. It replaced `friends_who_posted(user) > 0` as
    the gate, and the difference is the direction of causation:

        old:  fire if MY FRIENDS have posted   -> requires the outcome it exists to cause
        new:  fire if I HAVE NOT posted        -> bootstraps from nothing

    A prompt is only a prompt if it can fire when nothing has happened yet. The old gate meant a
    beta with no posts got no nudges, which produced no posts (#89 was specified as a BeReal-style
    prompt to post and built as a digest of friends' activity — see the note on `User.notify_prompt_me`).

    Also self-limiting in the right direction: it goes quiet for exactly the people who don't need
    prompting, without a rule that says so.

    LOCAL DAY, NOT 24 HOURS. Someone who posted at 23:50 last night has not posted TODAY, and
    should be prompted this evening — a rolling window would swallow that. `Post.created_at` is
    naive UTC, so the local day's boundaries are converted to UTC before comparing; getting that
    backwards silently mis-slices the day for everyone whose offset crosses midnight, which is most
    of this app's audience. The arithmetic stays in Python for the same reason the candidate
    selection does: `now() AT TIME ZONE u.timezone` is Postgres-only and would first run for real
    against Neon.
    """
    # A NAIVE datetime here would be silently wrong rather than loudly: `.astimezone()` would
    # assume the container's zone — UTC in the image, so accidentally right in prod and wrong on
    # every dev box. Raised, not asserted, and BEFORE the arithmetic it guards: an `assert` after
    # the fact is stripped under `python -O` and fires too late to matter either way.
    if now_local.tzinfo is None:
        raise ValueError("posted_today needs an aware datetime; use local_now(user)")

    local_midnight = now_local.replace(hour=0, minute=0, second=0, microsecond=0)
    start_utc = local_midnight.astimezone(dt_timezone.utc).replace(tzinfo=None)
    end_utc = (local_midnight + timedelta(days=1)).astimezone(dt_timezone.utc).replace(
        tzinfo=None
    )
    return (
        db.query(Post.id)
        .filter(
            Post.user_id == user.id,
            Post.created_at >= start_utc,
            Post.created_at < end_utc,
        )
        .first()
        is not None
    )


# How many recent posts to look at when counting. The count is a sentence, not a statistic, so
# this only needs to be big enough that the number is right for any plausible day. Matches the
# feed's own page size. Defined ABOVE its only caller, which the first version got wrong.
PROMPT_SCAN_LIMIT = 30


def friends_who_posted(user: User, db: Session) -> int:
    """How many DISTINCT friends have posted something this person hasn't seen.

    THE CAP HAS TO COME AFTER THE EXCLUSIONS, NOT BEFORE. The first version fetched the newest 30
    unseen posts in SQL and only then filtered them through `can_view_post` — and review reproduced
    what that costs: one chatty friend posts 30 PRIVATE meals, five other friends each post a
    normal one, and the count comes back ZERO. No push at all, and because a zero is deliberately
    not recorded, every hourly retry recomputes the same zero. The prompt is suppressed that
    evening and every evening until the person opens the feed.

    It is precisely the bug the module docstring says this function exists to avoid: an SQL-side
    truncation the Python filter cannot see past. The milder and far more likely form just
    undercounts — one friend with 30 unseen posts reads as "1 friend posted" when six did.

    So the two cheap predicates move INTO the SQL, where they can shrink the candidate set before
    the cap applies:
      - `visibility IN ('public','friends')` — a friend can read those two and not `private`.
      - the author is not in the caller's block set.
    Both are exactly what `can_view_post` would decide for a friend, so nothing new is being
    asserted here; the Python re-gate below is kept as defence-in-depth, and it is now a no-op
    rather than the thing doing the work. That ordering is what makes the cap safe: the rows it
    drops are rows that would have counted.
    """
    mark = user.last_feed_seen_post_id
    friends = set(friend_ids(user.id, db))
    if not friends:
        return 0

    hidden = blocked_ids(user.id, db)
    q = db.query(Post).filter(
        Post.user_id.in_(friends),
        # A friend sees `public` and `friends`; `private` is the owner's alone.
        Post.visibility.in_(("public", "friends")),
    )
    if hidden:
        q = q.filter(Post.user_id.notin_(hidden))
    if mark is not None:
        q = q.filter(Post.id > mark)
    # Newest first and capped — safe now, because every row that reaches here is one that counts.
    posts = q.order_by(Post.id.desc()).limit(PROMPT_SCAN_LIMIT).all()

    # Belt and braces: the single read rule still gets the last word, so a future visibility value
    # can't slip through the SQL above. No `selectinload` — this gate reads only `post.user_id`,
    # and eager-loading the author was one extra query per due user per hour for nothing.
    authors = {
        p.user_id
        for p in posts
        if can_view_post(p, user, db, is_friend=True, blocked=p.user_id in hidden)
    }
    return len(authors)


def prompt_payload(count: int) -> dict:
    """The nudge's body. ASKS FOR AN ACTION, and that is the whole point of it.

    It used to say "3 friends posted since you last looked" and return None at zero, on the
    reasoning that a nudge with nothing to report would have to fall back on "open issei!" — which
    asks for attention without offering anything, and is what people mute an app over. That
    reasoning is sound and it still holds; it was aimed at the wrong thing. The fix isn't a better
    digest, it's not being a digest: a prompt to post doesn't ask for attention, it asks the person
    to give something, and it is the app's own core act. So it has nothing to report by design and
    no zero to be silent about.

    ZERO STILL SENDS NOTHING — the rule moved rather than went away. The caller checks
    `posted_today` and sends nothing when the answer is yes, because there is nothing to prompt
    someone about who has already done it. Same discipline as a request count hidden at zero and an
    empty Blocked list not being rendered; different subject.

    The friend count is now GARNISH, not a gate: when friends have cooked, saying so makes the
    prompt more worth opening, and when they haven't, the prompt is still worth sending. Copy names
    PEOPLE, not posts, and handles singular/plural rather than papering over it with "(s)" — the
    app writes "1 person asked for this", not "1 person(s)".

    "YOU HAVEN'T SEEN" IS NOT DECORATION — it is what makes the number true. `friends_who_posted`
    counts distinct friends with posts newer than `last_feed_seen_post_id`, and that mark has NO
    time bound: someone who never opens Home keeps a month-old mark, so the count can describe
    activity from weeks ago. The first version of this rewrite dropped the qualifier and kept the
    data, producing "What did you cook today? 2 friends have shared something." every evening for
    a month about two posts from a month ago — a sentence about today followed by a stale claim.
    The old copy carried its own qualifier ("since you last looked") and was therefore honest; the
    rewrite has to carry one too. Found by the ship gate, and it is the one sentence in this change
    that POSITIONING's rewritten rule 2 directly governs: what a notification reports must be true.
    """
    body = "What did you cook today?"
    if count > 0:
        who = "friend has" if count == 1 else "friends have"
        body += f" {count} {who} shared something you haven't seen."
    return {
        "title": "issei",
        "body": body,
        # Where the tap lands. The composer, not the feed: the message is asking for a post, so it
        # should open the thing that makes one. Sending someone to the feed to be asked for a photo
        # is the same mismatch this whole change is fixing, one screen smaller.
        "url": "/add/meal",
        # Collapses with itself on the device, so two days of unopened prompts don't stack into a
        # pile of near-identical lines.
        "tag": "daily-prompt",
    }


# WHY SOMEBODY DIDN'T GET NUDGED. A vocabulary, because the first version of `run_daily_prompt`
# returned one `skipped` counter covering five unrelated situations — and the day the owner asked
# "why didn't the nudge arrive last night?" the honest answer was that the log could not tell you.
# Answering it took reading the GitHub Actions API, computing per-timezone send windows, and
# re-deriving `is_due` by hand. That is archaeology for a question the job should just answer.
#
# Same discipline as `tests/test_deploy_config.py`: when a question keeps costing an hour, make the
# system state the answer instead of making the next person derive it.
SKIP_REASONS = (
    # is_due said no:
    "hour_not_reached",  # their local hour hasn't come round yet today
    "quiet_hours",  # their hour HAS passed, but the catch-up landed inside their quiet window
    # ...and past is_due, in the order they are checked:
    "already_sent_today",  # an earlier run in this local day already claimed it
    "nudged_recently",  # their own frequency setting says not yet (notify_prompt_every_days)
    "already_posted_today",  # nothing to prompt: they have already shared a meal today
    "no_device",  # notifications on, nothing installed anywhere yet
)


def _skip_reason(user: User, now_local: datetime) -> str:
    """Which half of `is_due` refused. Only called when `is_due` is already False."""
    if now_local.hour < user.notify_hour:
        return "hour_not_reached"
    return "quiet_hours"


def run_daily_prompt(db: Session) -> dict:
    """Send the daily nudge to everyone who is due. Returns a summary for the caller's logs.

    ONE PASS OVER USERS WHO COULD POSSIBLY BE DUE, then a per-user check. Not one clever query:
    the timezone predicate would have to be `now() AT TIME ZONE u.timezone`, which is
    Postgres-only, so the selection itself would be untestable on SQLite and would first run for
    real against Neon. This repo has already lost time to exactly that shape of prod-only bug, so
    the arithmetic stays in Python where a test can see it.

    WHAT DECIDES WHETHER SOMEONE IS NUDGED, in order: the prompt switch and the clock (`is_due`),
    then whether their chosen frequency allows one yet (`prompt_window_reason`, which subsumes the
    old at-most-once-a-day check), then whether they have already shared a meal today
    (`posted_today`), then whether they have a device at all. Their friends' activity decides only what the line SAYS, never
    whether it is sent — that inversion is the fix, and reversing it re-creates the circularity
    described on `User.notify_prompt_me`.

    Every send is recorded BEFORE it is attempted, and the ordering is deliberate: if the row is
    written after, a crash between send and record means the next run sends again. A recorded
    send that then fails to deliver is the better failure — the person misses one nudge, rather
    than getting two.

    IDEMPOTENT BY THE DATABASE, not by this function. The insert is what fails on a duplicate, so
    two concurrent runs (a manually re-triggered cron, an overlapping deploy) cannot both send.
    Checking first and inserting after would leave exactly the window this exists to close.

    THE SUMMARY NAMES EVERY SKIP (`reasons`), and that is not cosmetic. A single `skipped` count
    made "the nudge didn't arrive" unanswerable from the logs — the five situations it covered
    range from "working exactly as designed" (they already shared a meal today) to "this person can
    never receive anything" (no device registered), and telling them apart needed the database. See
    SKIP_REASONS.
    """
    from sqlalchemy.exc import IntegrityError

    from app.services import push as push_service
    from app.services.push import DEAD_SUBSCRIPTION_CODES, send

    # NOTHING CONFIGURED, NOTHING CLAIMED. Without this the unconfigured case is not merely inert:
    # the day is recorded BEFORE the send is attempted (deliberately — see below), so every due
    # user would have their `prompt_sends` row claimed, `send()` would return 0, and that local
    # date would be permanently spent on a notification that never left the building. Record-before-
    # send is right for a TRANSIENT failure, where the cost is one missed nudge; it is wrong for a
    # configuration failure that persists across every run. This is the difference between "push
    # isn't switched on yet" and "everyone silently loses today".
    if not push_service.is_configured():
        log.info("prompt: VAPID not configured, daily run is a no-op")
        return {
            "candidates": 0,
            "sent": 0,
            "skipped": 0,
            "failed": 0,
            "reasons": {},
            "configured": False,
        }

    sent = skipped = failed = 0
    reasons: dict[str, int] = {}

    def note(reason: str) -> None:
        nonlocal skipped
        skipped += 1
        reasons[reason] = reasons.get(reason, 0) + 1
    # Only users who could be due at all. `timezone IS NOT NULL` and the switch are cheap SQL
    # predicates that need no clock arithmetic, so they belong here rather than in Python.
    candidates = (
        db.query(User)
        .filter(User.timezone.isnot(None), User.notify_prompt_me.is_(True))
        .all()
    )

    for user in candidates:
        now_local = local_now(user)
        if not is_due(user, now_local):
            # `now_local` cannot be None here: the SQL above requires a timezone, and an
            # unparseable one already returned None from `local_now` and logged.
            note(_skip_reason(user, now_local) if now_local else "hour_not_reached")
            continue

        # ALREADY SENT IS CHECKED FIRST, and the ordering is about the SUMMARY rather than about
        # correctness — the UNIQUE constraint below would refuse a second send either way. From the
        # moment someone is nudged and then posts, every later run today would otherwise report
        # them as `already_posted_today`, which reads as "they were never nudged" in a summary whose
        # whole purpose is answering "why didn't it arrive" — when for that person it did arrive.
        # It is also the cheapest of the three checks, so the run stops doing four queries per
        # already-handled user, 144 times a day. Found by the ship gate.
        too_soon = prompt_window_reason(user, now_local, db)
        if too_soon is not None:
            note(too_soon)
            continue

        # NOTHING TO PROMPT SOMEONE WHO HAS ALREADY DONE IT. Deliberately NOT recorded as sent —
        # the day stays unclaimed, which costs nothing here (they posted, so they won't be prompted
        # again today anyway) and keeps this branch consistent with the one below it.
        if posted_today(user, now_local, db):
            note("already_posted_today")
            continue

        # Garnish, not a gate. This used to decide whether anything was sent at all, which is what
        # made the nudge circular; see `posted_today`.
        count = friends_who_posted(user, db)
        payload = prompt_payload(count)

        # NO DEVICE IS CHECKED BEFORE THE DAY IS CLAIMED, and that ordering is the same argument
        # the `posted_today` branch above makes for itself. Record-before-send is right for a
        # TRANSIENT failure — one missed nudge beats two nudges. "Nobody has registered a phone"
        # is not transient and is knowable before claiming, so claiming it would mean someone who
        # installs the app at 19:00 has already spent that evening. It was previously counted as a
        # `failed` delivery, which was doubly wrong: it isn't a failure, and it burned the day.
        subs = (
            db.query(PushSubscription)
            .filter(PushSubscription.user_id == user.id)
            .all()
        )
        if not subs:
            note("no_device")
            continue

        # Claim the day. A duplicate here means another run already has it.
        try:
            db.add(
                PromptSend(
                    user_id=user.id,
                    local_date=now_local.date(),
                    friend_count=count,
                )
            )
            db.commit()
        except IntegrityError:
            db.rollback()
            note("already_sent_today")
            continue

        delivered = False
        for sub in subs:
            status = send(sub.endpoint, sub.p256dh, sub.auth, payload)
            if status in DEAD_SUBSCRIPTION_CODES:
                # The browser has moved on. ONLY these two codes — 401/403 mean our key is wrong,
                # and pruning on those would empty the table on the first botched rotation.
                db.delete(sub)
            elif status in (200, 201):
                sub.last_sent_at = datetime.now(dt_timezone.utc).replace(tzinfo=None)
                delivered = True
        db.commit()

        if delivered:
            sent += 1
        else:
            failed += 1

    summary = {
        "candidates": len(candidates),
        "sent": sent,
        "skipped": skipped,
        "failed": failed,
        # Named, so the Actions log answers "why didn't it arrive" without a database.
        "reasons": reasons,
    }
    log.info("prompt: daily run %s", summary)
    return summary
