"""Split notify_posts into notify_prompt_me + notify_friend_posts

THE NUDGE WAS SPECIFIED AS A PROMPT AND BUILT AS A DIGEST, and the drift is visible in one line of
#89's own code: `notify_prompt = the app nudging YOU ("3 friends posted since you last looked")`.
"Nudging YOU", followed by a parenthetical entirely about other people. Task #89's title says
"BeReal-style prompt to post". Nothing caught it because everything downstream was consistent with
the wrong version.

The consequence was circular, which is worse than a mismatch:

    goal:         get people to post
    mechanism:    notify you when friends post
    precondition: friends have posted

So the retention engine only worked once the thing it existed to cause was already happening. It
could amplify activity; it could not start it. A beta with no posts got no nudges, which produced
no posts — reported by the owner as "the nudge didn't arrive", and correct behaviour by the code as
written.

WHY TWO BOOLEANS AND NOT A THREE-VALUE CADENCE. `notify_posts` (instant | daily | off) modelled the
per-post push and the daily digest as ALTERNATIVES, and that was right about a digest — the 18:00
line summarised exactly the posts an instant push had already announced. But the digest shouldn't
exist. Once "daily" means "prompt me to post", the two stop being alternatives and become different
notifications about different subjects: one is about YOU, one is about THEM. Alternatives collapse
into one field; independent things do not.

    notify_prompt_me     remind me to share a meal, at notify_hour        (about you)
    notify_friend_posts  tell me when a friend shares, immediately        (about them)

THE BACKFILL INVENTS INTENT, AND THERE IS NO WAY AROUND THAT. It invents as little as it can, and
one asymmetry is worth naming rather than glossed, because the ship gate caught the docstring
claiming more honesty than the mapping has.

Nobody has ever declined a prompt-to-post, because none existed — so for `notify_prompt_me` the only
thing anyone expressed is "am I reachable about this at all". Fine. But `'daily'` DID say something
about per-post pushes: under the cadence UI the options were mutually exclusive and the top one read
"Right away — A notification each time a friend shares a meal", so choosing "Once a day" meant *not
those*, and mapping it to `friend_posts = TRUE` reverses that person's choice.

It is done anyway, deliberately, for two reasons. The cohort is almost certainly empty: the field
existed for about a day, and `'daily'` was also the value every untouched account was backfilled to,
so the database genuinely cannot distinguish "chose daily" from "never looked". And the owner's call
is that hearing about a friend's meal is on by default. So this is an accepted reversal rather than a
preserved intent — recorded here so nobody later reads the mapping as neutral:

    'daily'   -> prompt_me = TRUE,  friend_posts = TRUE
    'instant' -> prompt_me = TRUE,  friend_posts = TRUE
    'off'     -> prompt_me = FALSE, friend_posts = FALSE

`off -> prompt_me = FALSE` is the deliberate one. Strictly, a prompt is not "about friends' meals",
so it falls outside what that person declined — but switching a NEW interrupting notification ON for
someone who turned notifications off is a betrayal, and the conservative reading of an ambiguous
input is the right one. (Same principle as `push.in_quiet_hours` reading equal bounds as "don't
bother" rather than a 24-hour blackout.)

ADDS ONLY. `notify_posts` and `notify_prompt` are both left in place and still declared on the
model, because the deploy pipeline runs `alembic upgrade head` BEFORE it ships the image — so the
old task serves traffic against the new schema, and dropping a column its model still selects is
`ProgrammingError` 500s across the whole API with `/health` still green. Removing a column takes
three releases under this pipeline; both old columns are cleaned up together in the same follow-up
sequence rather than two interleaved ones. See TECHDEBT.

Revision ID: c4d5e6f7a8b9
Revises: b3c4d5e6f7a8
"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision = "c4d5e6f7a8b9"
down_revision = "b3c4d5e6f7a8"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def _users():
    return sa.table(
        "users",
        sa.column("notify_posts", sa.String()),
        sa.column("notify_prompt_me", sa.Boolean()),
        sa.column("notify_friend_posts", sa.Boolean()),
    )


def upgrade() -> None:
    # Both default TRUE: the prompt is the retention mechanism and a default-off switch means it
    # never happens, and hearing that a friend cooked is the Instagram-shaped behaviour people
    # already expect. Bounded by quiet hours, which is what makes on-by-default defensible.
    op.add_column(
        "users",
        sa.Column("notify_prompt_me", sa.Boolean(), nullable=False, server_default="1"),
    )
    op.add_column(
        "users",
        sa.Column("notify_friend_posts", sa.Boolean(), nullable=False, server_default="1"),
    )
    # Only the 'off' case needs writing — the server_default already covers the other two.
    users = _users()
    op.execute(
        users.update()
        .where(users.c.notify_posts == "off")
        .values(notify_prompt_me=sa.false(), notify_friend_posts=sa.false())
    )


def downgrade() -> None:
    # Re-derive the cadence so a downgrade doesn't silently revert anyone who changed a switch
    # after the upgrade: `notify_posts` was left in place but nothing has written it since.
    #
    # THE MAPPING BACK IS LOSSY, unavoidably — three of the four boolean combinations have no
    # cadence that means them. It preserves the most consequential bit, which is whether the person
    # wanted to hear about friends' meals at all, and takes the permissive reading otherwise:
    #   friend_posts TRUE  -> 'instant'  (they want to hear as it happens; the closest cadence)
    #   friend_posts FALSE -> 'off'
    # `notify_prompt_me` has nowhere to go, and a downgrade cannot conjure one.
    users = _users()
    op.execute(
        users.update()
        .where(users.c.notify_friend_posts == sa.true())
        .values(notify_posts="instant")
    )
    op.execute(
        users.update()
        .where(users.c.notify_friend_posts == sa.false())
        .values(notify_posts="off")
    )
    # batch_alter_table because SQLite cannot DROP COLUMN in place on older versions.
    with op.batch_alter_table("users") as batch:
        batch.drop_column("notify_friend_posts")
        batch.drop_column("notify_prompt_me")
