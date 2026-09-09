"""add push subscriptions, the daily-prompt send log, and notification prefs (#89)

Revision ID: d6e7f8a9b0c1
Revises: c5d6e7f8a9b0
Create Date: 2026-09-09

The backend half of push notifications. Two new tables and six columns on `users`, all purely
additive — no existing column is altered, so nothing needs `batch_alter_table` and nothing needs
backfilling beyond the server_defaults below.

WHY TWO TABLES RATHER THAN ONE.

`push_subscriptions` is PER DEVICE. A person with the app on a phone and a laptop has two rows
and gets the push on both; a unique constraint on `user_id` would quietly mean "only the last
device you allowed". `endpoint` is the identity because the BROWSER mints it, so UNIQUE on
endpoint makes re-subscribing the same device an update rather than a duplicate.

`prompt_sends` is the at-most-once record for the daily nudge, and it exists BEFORE any scheduler
does, deliberately. None of the trigger options are once-per-day on their own: an in-process tick
double-fires during a rolling deploy (minHealthyPercent 100 / maxHealthyPercent 200 overlaps the
old and new task) and breaks outright above `desiredCount: 1`; an EventBridge schedule is
at-least-once by contract; a GitHub Actions cron can be re-run by a human. Correctness therefore
cannot live in the trigger, so it lives in a UNIQUE index here.

The key is (user_id, LOCAL_DATE) — the calendar date where the RECIPIENT is, not UTC. The prompt
fires at a fixed local hour, so 18:30 in Manila is 10:30 UTC the same day while 18:30 in
California is 01:30 UTC the NEXT day. A UTC-dated key would let one of them be nudged twice across
one evening and skipped across another.

THE SIX COLUMNS, and why each has the default it has:

  timezone      NULLABLE, no default. An IANA name from the browser. No backfill can invent one,
                and guessing UTC would wake someone at 3am — so an account with NULL is simply
                never due for the prompt until they next sign in. That is the honest behaviour and
                it means this migration cannot break anyone's existing experience.
  notify_hour   NOT NULL default 18. A column rather than a constant so the hour can move without
                another migration.
  notify_prompt NOT NULL default true  — the app nudging you.
  notify_people NOT NULL default true  — a person reaching you.
                Defaults ON because the notification is the retention mechanism and a default-off
                switch means it never happens; the user can turn either off, and quiet hours
                bound both. Two switches rather than one (one forces an all-or-nothing choice
                people resolve as "off") and rather than five (a settings page for an app that
                sends nobody anything today).
  quiet_from    NOT NULL default 22
  quiet_to      NOT NULL default 8
                Hours-of-day in `timezone`. The range WRAPS MIDNIGHT in the default configuration,
                which is the common case, not the edge one.

server_default on the five NOT NULL columns is the backfill: every existing row gets the value
without a data migration step. Booleans are written as "1"/"0" strings — SQLite has no native
boolean and this is what the rest of this chain does.

The indexes are declared on the MODELS as well as here. That is not redundancy: an index that
exists only in a migration is invisible to SQLAlchemy's MetaData, so `alembic check` reports it as
a stray index in the database and the next routine `--autogenerate` writes a DROP for it. That
nearly shipped for `ix_handoffs_grant_lookup`, and `main` runs migrations against Neon on push.

`endpoint` is bounded to 500 in the SCHEMA (app/schemas/push.py) rather than as a column type
here, matching how every other ceiling in this app works. Worth knowing why it matters more than
usual: an unbounded string under a Postgres UNIQUE index raises "index row size exceeds maximum"
for a long endpoint — a prod-only 500 SQLite will never reproduce.
"""

from alembic import op
import sqlalchemy as sa

revision = "d6e7f8a9b0c1"
down_revision = "c5d6e7f8a9b0"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "push_subscriptions",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column(
            "user_id",
            sa.Integer(),
            sa.ForeignKey("users.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("endpoint", sa.String(), nullable=False),
        sa.Column("p256dh", sa.String(), nullable=False),
        sa.Column("auth", sa.String(), nullable=False),
        sa.Column("user_agent", sa.String(), nullable=True),
        sa.Column(
            "created_at", sa.DateTime(), nullable=False, server_default=sa.func.now()
        ),
        sa.Column("last_sent_at", sa.DateTime(), nullable=True),
        # Inline, not an ALTER: SQLite has no ADD CONSTRAINT and this chain must replay there.
        sa.UniqueConstraint("endpoint", name="uq_push_subscription_endpoint"),
    )
    op.create_index("ix_push_subscriptions_user", "push_subscriptions", ["user_id"])

    op.create_table(
        "prompt_sends",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column(
            "user_id",
            sa.Integer(),
            sa.ForeignKey("users.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("local_date", sa.Date(), nullable=False),
        sa.Column("friend_count", sa.Integer(), nullable=False, server_default="0"),
        sa.Column(
            "created_at", sa.DateTime(), nullable=False, server_default=sa.func.now()
        ),
        sa.UniqueConstraint("user_id", "local_date", name="uq_prompt_send_user_day"),
    )

    op.add_column("users", sa.Column("timezone", sa.String(), nullable=True))
    op.add_column(
        "users",
        sa.Column("notify_hour", sa.Integer(), nullable=False, server_default="18"),
    )
    op.add_column(
        "users",
        sa.Column("notify_prompt", sa.Boolean(), nullable=False, server_default="1"),
    )
    op.add_column(
        "users",
        sa.Column("notify_people", sa.Boolean(), nullable=False, server_default="1"),
    )
    op.add_column(
        "users",
        sa.Column("quiet_from", sa.Integer(), nullable=False, server_default="22"),
    )
    op.add_column(
        "users", sa.Column("quiet_to", sa.Integer(), nullable=False, server_default="8")
    )


def downgrade() -> None:
    op.drop_column("users", "quiet_to")
    op.drop_column("users", "quiet_from")
    op.drop_column("users", "notify_people")
    op.drop_column("users", "notify_prompt")
    op.drop_column("users", "notify_hour")
    op.drop_column("users", "timezone")
    op.drop_table("prompt_sends")
    op.drop_index("ix_push_subscriptions_user", table_name="push_subscriptions")
    op.drop_table("push_subscriptions")
