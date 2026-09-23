#!/usr/bin/env python
# The docstring is a RAW string because the per-shell usage examples below contain Windows paths, and
# `\v` in `.\venv\...` is a vertical tab as far as Python is concerned.
r"""What the handoff-grant repair migration (`b9d3f07a4c81`) will actually do to THIS database.

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
Simplest — run it with no arguments and paste the connection string when it asks. It is read with
`getpass`, so it is not echoed to the screen and never enters shell history:

    ./venv/Scripts/python.exe scripts/check_handoff_grants.py

Or set the variable yourself, if you prefer. The syntax differs per shell, which is worth spelling
out because `VAR=value command` is bash-only and fails silently-ish in the other two:

    bash/git-bash : DATABASE_URL="postgresql://..." ./venv/Scripts/python.exe scripts/check_handoff_grants.py
    PowerShell    : $env:DATABASE_URL="postgresql://..."; .\venv\Scripts\python.exe scripts\check_handoff_grants.py
    cmd.exe       : set DATABASE_URL=postgresql://...
                    venv\Scripts\python.exe scripts\check_handoff_grants.py

Add `--json` for machine-readable output, and `--prompt` to be asked even when `DATABASE_URL` is
already set. Run it from the repository root either way.

READ THIS IF IT SAYS "password authentication failed". That is the most likely first outcome and it is
not a problem with the script. Both the working copy's `.env` and the exported `DATABASE_URL` on the
machine this was written on hold a **rotated** Neon credential, so the default path connects to the
right host with the wrong password. Get a fresh connection string from the Neon console and re-run
with `--prompt`. The script reports that failure as one sentence rather than forty frames of
psycopg2, because the traceback is what "it isn't working" looks like.

It never falls back to `.env` silently: if nothing is set and nothing is pasted, it exits without
connecting. Reporting "0 rows to repair" from a database it never reached is the one failure mode
worth designing out of a tool whose whole job is to tell you a count.

SELECT ONLY. No session is opened, no transaction is committed, nothing is written — same shape as
`scripts/read_feedback.py`. Safe against production, which is the point; prefer a read-only Neon role
if you have one. It prints the HOST it connected to and never the credential.

It does NOT print any email address or any recipe content. A case-twin pair is reported as a masked
local-part plus a count, because the point is "a pair exists", not who.
"""

from __future__ import annotations

import argparse
import getpass
import json
import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), ".."))

from sqlalchemy import text  # noqa: E402
from sqlalchemy.exc import SQLAlchemyError  # noqa: E402

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
    """`ana@example.com` -> `a**@example.com`. Enough to tell two findings apart, not enough to be a
    disclosure in a terminal scrollback or a pasted screenshot."""
    local, _, domain = addr.partition("@")
    if not domain:
        return "***"
    head = local[:1] if local else ""
    return f"{head}{'*' * max(len(local) - 1, 1)}@{domain}"


def _ask_for_url(reason: str) -> str | None:
    """Prompt for a connection string, or return None if there is no terminal to ask on.

    ASKING rather than making the caller get their shell's env-var syntax right. `VAR=value command`
    is bash-only; PowerShell needs `$env:VAR=`, cmd needs a separate `set` on its own line. That was
    the first thing to go wrong with this script in practice, and the failure reads as the script
    being broken rather than as a quoting problem. `getpass` also keeps the credential off the screen
    and out of shell history, which is a better answer than the env var either way.
    """
    if not sys.stdin.isatty():
        print(
            f"{reason}\nNo terminal to ask on -- set DATABASE_URL yourself. The syntax differs per\n"
            "shell; see the usage note at the top of this file.",
            file=sys.stderr,
        )
        return None
    print(reason)
    print("Paste a connection string (it will not be echoed), or press Enter to give up.")
    print("Neon console -> your project -> Connection string, if the local copy has been rotated.")
    supplied = getpass.getpass("DATABASE_URL: ").strip()
    return supplied or None


def _build_engine(url: str | None):
    """Build the app's engine, optionally against an overriding URL.

    `app.database` reads the setting at IMPORT time, so an override has to be in `os.environ` before
    the import -- and on a re-try the module is already imported, which is why this reaches for
    `create_engine` directly the second time rather than trying to re-import.
    """
    if url is not None:
        os.environ["DATABASE_URL"] = url
    if "app.database" in sys.modules and url is not None:
        from sqlalchemy import create_engine

        kwargs = {}
        if url.startswith("sqlite"):
            kwargs["connect_args"] = {"check_same_thread": False}
        return create_engine(url, **kwargs)
    from app.database import engine  # noqa: E402

    return engine


def main() -> int:
    # A SHORT ASCII description rather than `__doc__`. argparse prints the description on --help, and
    # a Windows console defaults to cp1252 — one em dash in the module docstring would turn `--help`
    # into a UnicodeEncodeError traceback. The full reasoning stays in the docstring, where it is read
    # in an editor rather than encoded to a terminal.
    parser = argparse.ArgumentParser(
        description=(
            "Report what the handoff-grant repair migration (b9d3f07a4c81) will do to a database. "
            "SELECT-only. Reads DATABASE_URL, or asks for a connection string. "
            "See the docstring at the top of this file for the full account."
        )
    )
    parser.add_argument("--json", action="store_true", help="machine-readable output")
    parser.add_argument(
        "--prompt",
        action="store_true",
        help="ask for the connection string even if DATABASE_URL is already set "
        "(use when the exported one is stale)",
    )
    args = parser.parse_args()

    override = None
    if args.prompt or not os.environ.get("DATABASE_URL"):
        reason = (
            "DATABASE_URL is already set; --prompt overrides it."
            if args.prompt
            else "DATABASE_URL is not set."
        )
        override = _ask_for_url(reason)
        if override is None and not os.environ.get("DATABASE_URL"):
            return 2

    engine = _build_engine(override)
    host = engine.url.host or engine.url.database or "(local)"

    # ONE SENTENCE ON A FAILED CONNECTION, not a hundred lines of psycopg2 and SQLAlchemy frames.
    # The traceback is what "the script isn't working" looks like, and the single most likely cause
    # here is a rotated credential -- the working copy's `.env` holds one, and so does the exported
    # variable on the machine this was written on, so the default path lands on it.
    try:
        conn_ctx = engine.connect()
    except SQLAlchemyError as exc:
        detail = str(getattr(exc, "orig", exc)).strip().splitlines()
        print(f"Could not connect to {host}.", file=sys.stderr)
        if detail:
            print(f"  {detail[0]}", file=sys.stderr)
        if "password authentication failed" in str(exc).lower():
            print(
                "\nThat is a rotated or wrong credential rather than a problem with this script.\n"
                "Get a fresh connection string from the Neon console and re-run with --prompt.",
                file=sys.stderr,
            )
        return 1

    with conn_ctx as conn:
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
        print("CASE-TWIN ACCOUNTS EXIST -- the address ambiguity is live on this database:")
        for pair in result["case_twin_pairs"]:
            print(f"  {pair['address']}  ({pair['accounts']} accounts)")
        print(
            "  Nothing will be mis-delivered (the route and the migration both refuse to guess),\n"
            "  but the durable fix -- case-insensitive uniqueness on users.email -- cannot be applied\n"
            "  until you decide which account of each pair keeps the address. See TECHDEBT."
        )
    else:
        print("No case-twin accounts. The address ambiguity is not live on this database.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
