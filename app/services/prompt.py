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
from datetime import datetime, timezone as dt_timezone
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
    """
    # `== "daily"` IS THE EXCLUSIVITY. Someone on "instant" already hears about each friend's
    # post as it lands, so nudging them at 18:00 about the same posts is a fourth notification
    # describing three they were already shown. `!= "off"` would look equivalent and would ship
    # exactly that; a test pins the difference.
    if now_local is None or user.notify_posts != "daily":
        return False
    if now_local.hour < user.notify_hour:
        return False
    return not in_quiet_hours(now_local.hour, user.quiet_from, user.quiet_to)


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


def prompt_payload(count: int) -> Optional[dict]:
    """The notification body, or None if there is nothing worth saying.

    ZERO SENDS NOTHING. A prompt that fires with an empty feed has to fall back on something
    generic — "open issei!" — and that is the exact species of notification people mute an app
    over: it asks for attention without offering anything. Returning None here means the daily
    nudge is genuinely conditional on a friend having cooked, which also makes it self-limiting for
    a new account with no friends yet.

    This is consistent with how the rest of the app treats an absence: a request count is hidden
    at zero, a keeper count is hidden at zero, an empty Blocked list isn't rendered.

    The copy names PEOPLE, not posts, and singular/plural is handled rather than papered over with
    "(s)" — the app writes "1 person asked for this", not "1 person(s)".
    """
    if count <= 0:
        return None
    who = "friend" if count == 1 else "friends"
    return {
        "title": "issei",
        "body": f"{count} {who} posted since you last looked.",
        # Where the tap lands: the feed, which is what the message is about.
        "url": "/",
        # Collapses with itself on the device, so two days of unopened prompts don't stack into a
        # pile of near-identical lines.
        "tag": "daily-prompt",
    }


def run_daily_prompt(db: Session) -> dict:
    """Send the daily nudge to everyone who is due. Returns a summary for the caller's logs.

    ONE PASS OVER USERS WHO COULD POSSIBLY BE DUE, then a per-user check. Not one clever query:
    the timezone predicate would have to be `now() AT TIME ZONE u.timezone`, which is
    Postgres-only, so the selection itself would be untestable on SQLite and would first run for
    real against Neon. This repo has already lost time to exactly that shape of prod-only bug, so
    the arithmetic stays in Python where a test can see it.

    Every send is recorded BEFORE it is attempted, and the ordering is deliberate: if the row is
    written after, a crash between send and record means the next run sends again. A recorded
    send that then fails to deliver is the better failure — the person misses one nudge, rather
    than getting two.

    IDEMPOTENT BY THE DATABASE, not by this function. The insert is what fails on a duplicate, so
    two concurrent runs (a manually re-triggered cron, an overlapping deploy) cannot both send.
    Checking first and inserting after would leave exactly the window this exists to close.
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
        return {"candidates": 0, "sent": 0, "skipped": 0, "failed": 0, "configured": False}

    sent = skipped = failed = 0
    # Only users who could be due at all. `timezone IS NOT NULL` and the switch are cheap SQL
    # predicates that need no clock arithmetic, so they belong here rather than in Python.
    candidates = (
        db.query(User)
        .filter(User.timezone.isnot(None), User.notify_posts == "daily")
        .all()
    )

    for user in candidates:
        now_local = local_now(user)
        if not is_due(user, now_local):
            skipped += 1
            continue

        count = friends_who_posted(user, db)
        payload = prompt_payload(count)
        if payload is None:
            # Nothing worth saying. Deliberately NOT recorded as sent: if a friend posts later
            # today, this person should still be reachable — recording it would mean an empty
            # feed at 18:00 costs them the whole evening.
            skipped += 1
            continue

        # Claim the day first. A duplicate here means another run already has it.
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
            skipped += 1
            continue

        subs = (
            db.query(PushSubscription)
            .filter(PushSubscription.user_id == user.id)
            .all()
        )
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
    }
    log.info("prompt: daily run %s", summary)
    return summary
