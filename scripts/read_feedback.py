#!/usr/bin/env python
"""Read the feedback (and, with a flag, the reports) users have sent. #101.

WHY THIS EXISTS AS A SCRIPT AND NOT AN ENDPOINT
-----------------------------------------------
`GET /feedback` is self-only and stays that way. `app/routers/feedback.py` records the reasoning at
length: an OWNER_USER_ID-gated read-everything route invents an admin role without any of the
machinery a real one needs, it fails open when the variable is unset or mistyped, and even configured
perfectly it converts one 7-day bearer token sitting in one phone's localStorage into read access
over every tester's candid words — including words about other people using the app. The owner
already holds DATABASE_URL, so such a route buys no capability, only a way to lose something.

So the read path is a local script run by whoever holds the credential. It is the same capability the
owner already has, in a form that is pleasant enough to actually use — which was the real problem:
feedback had been live since #9 and nobody had read the table, because reading it meant remembering
to open a database console and write SQL.

The push half is `services/email.py::send_feedback_notification`, which mails each new note as it
lands so this script is for catching up rather than for keeping up.

USAGE
-----
    DATABASE_URL="postgresql://..." python scripts/read_feedback.py
    DATABASE_URL="sqlite:///./recipes.db" python scripts/read_feedback.py --reports
    ... --limit 20 --json

Reads whatever DATABASE_URL points at, using the app's own engine, and NEVER writes: no session is
opened, only `Connection.execute` with SELECTs. Safe to run against production, which is the point —
though prefer a read-only Neon role if you have one.

REPORTS ARE BEHIND A FLAG, deliberately (#87 + #101). Feedback is addressed TO the owner; a report is
a live safety case about a specific pair of named people, and the two do not carry the same weight
just because both are "text in a table nobody reads". Printing someone's report as a side effect of
checking whether the copy on a button lands would be the wrong default, so it takes --reports.
"""

from __future__ import annotations

import argparse
import json
import os
import sys
import textwrap

# Import the app's engine rather than building a second one, so DATABASE_URL is interpreted exactly
# as the running service interprets it (the SQLite/Postgres connect-args branch included).
sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), ".."))

from sqlalchemy import text  # noqa: E402

# `app.database` builds the engine AT IMPORT TIME, so importing it with no DATABASE_URL set raises a
# traceback before this script can say anything useful. Deferred into main() so the missing-variable
# case gets one clear sentence instead — which is the whole difference between a tool someone uses
# and one they give up on.

FEEDBACK_SQL = text(
    """
    SELECT f.id, f.created_at, f.body, f.path, f.app_version,
           u.first_name, u.last_name, u.email
      FROM feedback f
      LEFT JOIN users u ON u.id = f.user_id
     ORDER BY f.created_at DESC, f.id DESC
     LIMIT :limit
    """
)

REPORTS_SQL = text(
    """
    SELECT r.id, r.created_at, r.reason, r.note, r.state,
           r.post_id, r.recipe_id,
           reporter.first_name AS reporter_first, reporter.last_name AS reporter_last,
           reported.first_name AS reported_first, reported.last_name AS reported_last
      FROM reports r
      LEFT JOIN users reporter ON reporter.id = r.reporter_id
      LEFT JOIN users reported ON reported.id = r.reported_user_id
     ORDER BY r.created_at DESC, r.id DESC
     LIMIT :limit
    """
)


def _name(first, last) -> str:
    return " ".join(p for p in (first, last) if p).strip() or "(no name)"


def _wrap(body: str) -> str:
    """Indent and wrap so a long note is readable in a terminal rather than one endless line."""
    out = []
    for para in (body or "").splitlines() or [""]:
        out.extend(textwrap.wrap(para, width=88) or [""])
    return "\n".join("    " + line for line in out)


def read_feedback(conn, limit: int) -> list[dict]:
    rows = conn.execute(FEEDBACK_SQL, {"limit": limit}).mappings().all()
    return [dict(r) for r in rows]


def read_reports(conn, limit: int) -> list[dict]:
    rows = conn.execute(REPORTS_SQL, {"limit": limit}).mappings().all()
    return [dict(r) for r in rows]


def main() -> int:
    ap = argparse.ArgumentParser(description="Read issei feedback (and optionally reports).")
    ap.add_argument("--limit", type=int, default=200, help="most recent N rows (default 200)")
    ap.add_argument("--reports", action="store_true", help="also print open/closed user reports")
    ap.add_argument("--json", action="store_true", help="machine-readable output")
    args = ap.parse_args()

    url = os.environ.get("DATABASE_URL", "")
    if not url:
        print("DATABASE_URL is not set. Point it at the database you want to read.", file=sys.stderr)
        return 2

    # Print the HOST, never the credential — this output gets pasted into chats and issues.
    where = url.split("@")[-1].split("?")[0] if "@" in url else url
    print(f"reading from: {where}\n")

    from app.database import engine  # noqa: PLC0415 - deferred on purpose; see the note above

    with engine.connect() as conn:
        feedback = read_feedback(conn, args.limit)
        reports = read_reports(conn, args.limit) if args.reports else []

    if args.json:
        print(json.dumps({"feedback": feedback, "reports": reports}, default=str, indent=2))
        return 0

    print(f"=== FEEDBACK ({len(feedback)}) " + "=" * 40)
    if not feedback:
        print("\n  Nothing yet.\n")
    for r in feedback:
        who = _name(r["first_name"], r["last_name"])
        print(f"\n#{r['id']}  {r['created_at']}  {who} <{r['email'] or '?'}>")
        meta = [f"screen {r['path']}" if r["path"] else None,
                f"build {r['app_version']}" if r["app_version"] else None]
        meta = [m for m in meta if m]
        if meta:
            print("  " + " · ".join(meta))
        print(_wrap(r["body"]))

    if args.reports:
        print(f"\n\n=== REPORTS ({len(reports)}) " + "=" * 41)
        print("  A report is a live case about two named people. Read it as that.\n")
        if not reports:
            print("  None.\n")
        for r in reports:
            reporter = _name(r["reporter_first"], r["reporter_last"])
            reported = _name(r["reported_first"], r["reported_last"])
            print(f"\n#{r['id']}  {r['created_at']}  [{r['state']}]  {r['reason']}")
            print(f"  {reporter}  ->  {reported}")
            # WHAT it is about, when it is about something (#87 part two). Without this a content
            # report is indistinguishable from a person report in the only tool that can read
            # either — which defeats the reason the column exists, since the whole argument for
            # keying the dedupe on the subject is that a reviewer needs to see WHICH post.
            #
            # THE BARE ID, not the dish name. Joining for it would pull user CONTENT into a script
            # whose entire design argument is that it prints as little as it can, and an operator
            # holding DATABASE_URL can look up `post #14` themselves. A None prints nothing, because
            # most reports have no subject and a column of Nones is noise.
            if r["post_id"] is not None:
                print(f"  about: post #{r['post_id']}")
            if r["recipe_id"] is not None:
                print(f"  about: recipe #{r['recipe_id']}")
            if r["note"]:
                print(_wrap(r["note"]))

    print()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
