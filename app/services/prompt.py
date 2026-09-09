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

from sqlalchemy.orm import Session, selectinload

from app.models.post import Post
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

    Four gates, and the order is only for readability — all four must pass:
      - they have a timezone at all (so we know what "18:00 their time" means)
      - the daily nudge is switched on
      - it is their hour
      - it is not inside their quiet window

    Quiet hours are checked even though the send is already local, because a person's day is not
    the same as their timezone's: someone who works nights inverts the default. It also makes the
    two settings compose honestly — a user whose `notify_hour` sits inside their own quiet window
    is never nudged, which is a coherent thing to have configured and not a bug to route around.
    """
    if now_local is None or not user.notify_prompt:
        return False
    if now_local.hour != user.notify_hour:
        return False
    return not in_quiet_hours(now_local.hour, user.quiet_from, user.quiet_to)


def friends_who_posted(user: User, db: Session) -> int:
    """How many DISTINCT friends have posted something this person hasn't seen.

    Deliberately not one clever aggregate. Rows are fetched and then re-gated through
    `can_view_post`, exactly as `GET /posts/feed` does, because that gate is where the feed's
    correctness lives — see the module docstring for the two bugs the aggregate version has.

    Bounded by the same page size as the feed, because the answer is a sentence: "3 friends" and
    "30 friends" are the same message, and nobody needs an exact count of a backlog they will
    scroll rather than read.
    """
    mark = user.last_feed_seen_post_id
    friends = set(friend_ids(user.id, db))
    if not friends:
        return 0

    q = (
        db.query(Post)
        .options(selectinload(Post.user))
        .filter(Post.user_id.in_(friends))
    )
    if mark is not None:
        q = q.filter(Post.id > mark)
    # Newest first and capped: a person with a thousand unseen posts gets the same sentence as one
    # with fifty, so reading a thousand rows to say "50+" would be work for nothing.
    posts = q.order_by(Post.id.desc()).limit(PROMPT_SCAN_LIMIT).all()

    hidden = blocked_ids(user.id, db)
    authors = {
        p.user_id
        for p in posts
        if can_view_post(p, user, db, is_friend=True, blocked=p.user_id in hidden)
    }
    return len(authors)


# How many recent posts to look at when counting. The count is a sentence, not a statistic, so
# this only needs to be big enough that the number is right for any plausible day. Matches the
# feed's own page size.
PROMPT_SCAN_LIMIT = 30


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
