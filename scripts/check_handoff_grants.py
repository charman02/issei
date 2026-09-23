#!/usr/bin/env python
"""What the handoff-grant repair migration (`b9d3f07a4c81`) will actually do to THIS database.

WHY THIS EXISTS
---------------
That migration rewrites **authorization state** rather than schema: it binds handoff grants that were
stored `pending` with `to_user_id` NULL for addresses that already had an account, which made them
unreachable in every surface forever. Every other migration in this chain adds or drops a column, so
"did it run?" has no user-visible answer. This one decides who can read whose recipe, and it runs
BEFORE the new image ships (`deploy.yml` migrates, then pushes), so the blast radius is worth knowing
in advance rather than afterwards.

It answers four questions the ship gate raised and nothing on a dev machine can:

  1. **Is there a case-twin pair?** `users.email` is a plain case-SENSITIVE unique column and
     Pydantic's `EmailStr` normalises only the domain, so `ANA@x.com` and `ana@x.com` are two
     independently loginable accounts. Non-empty here means the ambiguity is LIVE, and the durable
     fix (case-insensitive uniqueness) needs a decision about which of a colliding pair wins before
     it can be applied at all. The migration itself is safe either way — it skips an ambiguous
     address rather than guessing — but a pair existing is the thing to know.
  2. **How many dead grants get repaired?** The migration's own WHERE clause, counted.
  3. **How many rows carry a stale address?** `claim_invite` and `accept_handoff` bind `to_user_id`
     without clearing `to_email`, so an accepted row can be bound to whoever held the link and still
     carry the address it was sent to. The migration leaves those alone, deliberately — this is the
     count that says how much of that shape exists.
  4. **Does any repair cross a BLOCK?** It shouldn't: the migration excludes blocked pairs, because
     the route refuses that exact act and a pending row was never a grant to begin with. A non-zero
     count here is the number of rows deliberately left dead, which is worth seeing rather than
     inferring.

USAGE
-----
    DATABASE_URL="postgresql://..." python scripts/check_handoff_grants.py
    DATABASE_URL="postgresql://..." python scripts/check_handoff_grants.py --json

SELECT ONLY. No session is opened, no transaction is committed, nothing is written — same shape as
`scripts/read_feedback.py`. Safe against production, which is the point; prefer a read-only Neon role
if you have one. It prints the HOST it connected to and never the credential.

It does NOT print any email address or any recipe content. A case-twin pair is reported as a masked
local-part plus a count, because the point is "a pair exists", not who.
"""

from __future__ import annotations

import argparse
import json
import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), ".."))

from sqlalchemy import text  # noqa: E402

# The exact predicate the migration uses, so this cannot drift into reporting on a different
# population than the one that gets repaired. Kept as a fragment rather than importing the migration's
# UPDATE, because that statement is a write and this file must contain no writes at all.
REPAIRABLE_WHERE = """
      h.to_user_id IS NULL
  AND h.to_email IS NOT NULL
  AND h.state = 'pending'
  AND (SELECT count(*) FROM users u WHERE lower(u.email) = lower(h.to_email)) = 1
  AND NOT EXISTS (
          SELECT 1 FROM users u
            JOIN blocks b
              ON (b.blocker_id = h.from_user_id AND b.blocked_id = u.id)
              OR (b.blocker_id = u.id AND b.blocked_id = h.from_user_id)
           WHERE lower(u.email) = lower(h.to_email)
      )
"""

CASE_TWINS_SQL = text(
    """
    SELECT lower(email) AS addr, count(*) AS n
      FROM users
     GROUP BY lower(email)
    HAVING count(*) > 1
     ORDER BY n DESC, addr
    """
)

REPAIRABLE_SQL = text(f"SELECT count(*) FROM handoffs h WHERE {REPAIRABLE_WHERE}")

# Everything the migration will NOT touch, broken out so a zero in one place is not read as a zero
# everywhere. "Ambiguous" and "blocked" are the two deliberate refusals.
AMBIGUOUS_SQL = text(
    """
    SELECT count(*) FROM handoffs h
     WHERE h.to_user_id IS NULL AND h.to_email IS NOT NULL AND h.state = 'pending'
       AND (SELECT count(*) FROM users u WHERE lower(u.email) = lower(h.to_email)) > 1
    """
)

BLOCKED_SQL = text(
    """
    SELECT count(*) FROM handoffs h
     WHERE h.to_user_id IS NULL AND h.to_email IS NOT NULL AND h.state = 'pending'
       AND EXISTS (
               SELECT 1 FROM users u
                 JOIN blocks b
                   ON (b.blocker_id = h.from_user_id AND b.blocked_id = u.id)
                   OR (b.blocker_id = u.id AND b.blocked_id = h.from_user_id)
                WHERE lower(u.email) = lower(h.to_email)
           )
    """
)

STALE_ADDRESS_SQL = text(
    "SELECT count(*) FROM handoffs WHERE to_user_id IS NOT NULL AND to_email IS NOT NULL"
)

STRANGER_SQL = text(
    """
    SELECT count(*) FROM handoffs h
     WHERE h.to_user_id IS NULL AND h.to_email IS NOT NULL AND h.state = 'pending'
       AND NOT EXISTS (SELECT 1 FROM users u WHERE lower(u.email) = lower(h.to_email))
    """
)

VERSION_SQL = text("SELECT version_num FROM alembic_version")


def _mask(addr: str) -> str:
    """`ana@example.com` → `a**@example.com`. Enough to tell two findings apart, not enough to be a
    disclosure in a terminal scrollback or a pasted screenshot."""
    local, _, domain = addr.partition("@")
    if not domain:
        return "***"
    head = local[:1] if local else ""
    return f"{head}{'*' * max(len(local) - 1, 1)}@{domain}"


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--json", action="store_true", help="machine-readable output")
    args = parser.parse_args()

    if not os.environ.get("DATABASE_URL"):
        print(
            "DATABASE_URL is not set. Point it at the database you want to inspect:\n"
            '  DATABASE_URL="postgresql://..." python scripts/check_handoff_grants.py',
            file=sys.stderr,
        )
        return 2

    # Imported here, not at module scope: `app.database` builds the engine at import time, so a
    # missing variable would otherwise raise a traceback before the sentence above could be printed.
    from app.database import engine  # noqa: E402

    host = engine.url.host or engine.url.database or "(local)"

    with engine.connect() as conn:
        twins = [dict(r._mapping) for r in conn.execute(CASE_TWINS_SQL)]
        result = {
            "host": host,
            "alembic_version": conn.execute(VERSION_SQL).scalar(),
            "case_twin_pairs": [{"address": _mask(t["addr"]), "accounts": t["n"]} for t in twins],
            "will_repair": conn.execute(REPAIRABLE_SQL).scalar(),
            "skipped_ambiguous": conn.execute(AMBIGUOUS_SQL).scalar(),
            "skipped_blocked": conn.execute(BLOCKED_SQL).scalar(),
            "pending_to_strangers_untouched": conn.execute(STRANGER_SQL).scalar(),
            "bound_rows_with_stale_address": conn.execute(STALE_ADDRESS_SQL).scalar(),
        }

    if args.json:
        print(json.dumps(result, indent=2, default=str))
        return 0

    print(f"database host      : {result['host']}")
    print(f"alembic_version    : {result['alembic_version']}")
    print("  (expect b9d3f07a4c81 AFTER the deploy; anything else means it has not run yet)")
    print()
    print(f"grants to be REPAIRED            : {result['will_repair']}")
    print(f"  skipped, ambiguous address     : {result['skipped_ambiguous']}")
    print(f"  skipped, block between the two : {result['skipped_blocked']}")
    print(f"left pending for a stranger      : {result['pending_to_strangers_untouched']}")
    print(f"bound rows still carrying an addr: {result['bound_rows_with_stale_address']}")
    print()
    if result["case_twin_pairs"]:
        print("CASE-TWIN ACCOUNTS EXIST — the address ambiguity is live on this database:")
        for pair in result["case_twin_pairs"]:
            print(f"  {pair['address']}  ({pair['accounts']} accounts)")
        print(
            "  Nothing will be mis-delivered (the route and the migration both refuse to guess),\n"
            "  but the durable fix — case-insensitive uniqueness on users.email — cannot be applied\n"
            "  until you decide which account of each pair keeps the address. See TECHDEBT."
        )
    else:
        print("No case-twin accounts. The address ambiguity is not live on this database.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
