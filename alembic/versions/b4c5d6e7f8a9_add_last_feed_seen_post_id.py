"""add users.last_feed_seen_post_id — the feed read-mark (#97)

Revision ID: b4c5d6e7f8a9
Revises: a3b4c5d6e7f8
Create Date: 2026-09-08

How far the user has read their feed: the ID of the newest post they have seen. NULL = never
looked, so every post reads as new, which is correct for a new account.

AN ID, NOT A TIMESTAMP. `created_at` is second-granular on SQLite, so two posts a moment apart
can share one — and a post published in the same second as the mark would never be flagged new.
Post ids are monotonic, so the comparison has no ties. Same reasoning that already makes the
feed's pagination keyset on `id`; a test caught the timestamp version failing exactly that way.

Deliberately NOT a foreign key: this is a watermark, not a reference. A FK to posts.id would
SET NULL when that post is deleted, resetting the user to "never looked" and resurfacing their
whole feed as new.

Deliberately a column on `users` rather than a `post_view` table. A timestamp answers all
three things that needed read-state — the "new since you last looked" divider, the
"you're all caught up" state, and the content of a push prompt ("3 friends posted since you
last looked", #89) — without a row per user per post. Per-post precision buys nothing anyone
has asked for, and it would grow with users x posts.

Purely additive and nullable, so existing rows need no backfill: every current user simply
starts as "hasn't read the feed yet".
"""

from alembic import op
import sqlalchemy as sa

revision = "b4c5d6e7f8a9"
down_revision = "a3b4c5d6e7f8"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("users", sa.Column("last_feed_seen_post_id", sa.Integer(), nullable=True))


def downgrade() -> None:
    op.drop_column("users", "last_feed_seen_post_id")
