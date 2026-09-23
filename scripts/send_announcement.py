#!/usr/bin/env python
# Every printed string in this file is ASCII. A Windows console defaults to cp1252, and one arrow or
# em dash in a `print` raises UnicodeEncodeError from inside the print itself — which reads as the
# tool being broken. `scripts/check_handoff_grants.py` learned that the expensive way.
r"""Email every user one announcement (#107). DRY RUN unless you ask for a real send.

WHY A SCRIPT AND NOT AN ENDPOINT
--------------------------------
Same reasoning `routers/feedback.py` records for the read path, and it applies harder here. An
owner-gated "mail everyone" route would invent an admin role without any of the machinery a real one
needs, fail open if its environment variable were unset or mistyped, and turn one 7-day bearer token
in one phone's localStorage into the ability to mail the entire user base in someone else's name.
The owner already holds DATABASE_URL and the AWS role; a route buys no capability, only a way to
lose one. So this is a local script, run deliberately, by a person.

THE SES SANDBOX IS THE GATE, AND IT IS NOT MINE TO LIFT
------------------------------------------------------
While the AWS account is in the SES sandbox, SES will only deliver to VERIFIED identities. Sending
to an unverified address fails per-recipient with `MessageRejected` — it does not raise globally, so
this script keeps going and reports the failures at the end. That means: until the sandbox is lifted,
a real send reaches only addresses you have verified, and the summary will honestly say so rather
than claiming a delivery that did not happen. Request production access in the SES console first.

WHAT IT WILL NOT DO
-------------------
  · It will not send without `--send`. The default is a dry run that prints the recipient count and
    the exact message, and touches SES not at all.
  · With `--send` it still refuses until you type the recipient count back. A mistyped flag is the
    one failure here that cannot be taken back: mail does not have an undo, and "I meant to dry-run"
    is the likeliest mistake anyone will make with this file.
  · It will not mail anyone whose `announcement_emails` is false. That switch is the opt-out, it
    defaults to true, and this query is the only thing that honours it.
  · It writes NOTHING. No column is updated, no send is recorded. Which is a real limitation, stated
    plainly: re-running it mails everyone AGAIN. There is no `announcement_sends` table the way
    `prompt_sends` makes the daily nudge idempotent, because a one-off broadcast has no natural key
    to dedupe on and inventing one ("subject line"?) would be worse than the honest constraint. Send
    once, and check the summary rather than re-running to be sure.

USAGE
-----
    # see who it would reach and exactly what they would get -- sends nothing
    ./venv/Scripts/python.exe scripts/send_announcement.py --subject "issei: what's new" --body-file note.txt

    # actually send (asks you to type the count back first)
    ./venv/Scripts/python.exe scripts/send_announcement.py --subject "..." --body-file note.txt --send

    # one address only, for testing the real thing against yourself
    ./venv/Scripts/python.exe scripts/send_announcement.py --subject "..." --body-file note.txt --only you@example.com --send

DATABASE_URL is read from the environment, or prompted for (not echoed). The copies in the working
copy's `.env` and in the shell profile are ROTATED and will fail with "password authentication
failed" -- get a fresh connection string from the Neon console and use `--prompt`. Per-shell env-var
syntax, if you prefer it that way:

    bash/git-bash : DATABASE_URL="postgresql://..." ./venv/Scripts/python.exe scripts/send_announcement.py ...
    PowerShell    : $env:DATABASE_URL="postgresql://..."; .\venv\Scripts\python.exe scripts\send_announcement.py ...
    cmd.exe       : set DATABASE_URL=postgresql://...
                    venv\Scripts\python.exe scripts\send_announcement.py ...

The body is read from a FILE rather than an argument, on purpose: an announcement is a few
paragraphs, shell quoting mangles apostrophes and newlines, and a long argument lands in shell
history in full.
"""

from __future__ import annotations

import argparse
import getpass
import os
import sys
import time

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), ".."))

from sqlalchemy import text  # noqa: E402
from sqlalchemy.exc import SQLAlchemyError  # noqa: E402

# Only accounts that have not opted out. `announcement_emails` defaults to true, so this is
# everybody minus the people who said no -- and this query is the ONLY place that promise is kept.
RECIPIENTS_SQL = text(
    """
    SELECT id, email, first_name
      FROM users
     WHERE announcement_emails = true
     ORDER BY id
    """
)

OPTED_OUT_SQL = text("SELECT count(*) FROM users WHERE announcement_emails = false")

# Paced, not blasted. SES enforces a per-second send rate (14/s on a fresh production account, 1/s
# in the sandbox), and exceeding it returns Throttling errors that would show up here as a pile of
# per-recipient failures for no reason. A beta's worth of users takes a few seconds either way.
SECONDS_BETWEEN_SENDS = 0.2


def _redact(addr: str) -> str:
    local, _, domain = addr.partition("@")
    if not domain:
        return "***"
    return f"{local[:1]}{'*' * max(len(local) - 1, 1)}@{domain}"


def _show(chunk: str) -> None:
    """Print text that may contain ANY character, on a console that may not be able to encode it.

    Everything this file writes itself is ASCII, but the announcement BODY is not ours — it is
    whatever the owner typed into a file, and they will type an em dash, a curly quote, or the 💛
    from the invite message. On a Windows console (cp1252 by default) `print` raises
    UnicodeEncodeError on any of those, from inside the print, which would crash the DRY RUN — the
    one mode whose entire job is to show you the message before you commit to sending it. Losing the
    preview to a punctuation mark would be the worst possible place for this to break.

    So the body is encoded to whatever the terminal can take, with un-encodable characters replaced.
    The EMAIL is unaffected: `set_content` encodes UTF-8 and SES carries the real bytes. This only
    softens what the terminal is asked to draw, and a `?` in the preview where an emoji will appear
    is a fair trade for the preview existing at all.
    """
    encoding = getattr(sys.stdout, "encoding", None) or "utf-8"
    sys.stdout.write(chunk.encode(encoding, errors="replace").decode(encoding, errors="replace"))
    sys.stdout.write("\n")


def _ask_for_url(reason: str) -> str | None:
    if not sys.stdin.isatty():
        print(f"{reason}\nNo terminal to ask on -- set DATABASE_URL first.", file=sys.stderr)
        return None
    print(reason)
    print("Paste a connection string (not echoed), or press Enter to give up.")
    supplied = getpass.getpass("DATABASE_URL: ").strip()
    return supplied or None


def main() -> int:
    parser = argparse.ArgumentParser(
        description=(
            "Email every user who has not opted out one announcement. DRY RUN unless --send. "
            "See the docstring at the top of this file for the full account."
        )
    )
    parser.add_argument("--subject", required=True, help="the email subject line")
    parser.add_argument(
        "--body-file", required=True, help="path to a UTF-8 text file holding the message body"
    )
    parser.add_argument(
        "--send",
        action="store_true",
        help="actually send. Without this nothing touches SES.",
    )
    parser.add_argument(
        "--only",
        action="append",
        default=[],
        help="restrict to these addresses (repeatable). Use to test a real send on yourself.",
    )
    parser.add_argument(
        "--prompt", action="store_true", help="ask for DATABASE_URL even if one is set"
    )
    args = parser.parse_args()

    try:
        body = open(args.body_file, encoding="utf-8").read().strip()
    except OSError as exc:
        print(f"Could not read {args.body_file}: {exc}", file=sys.stderr)
        return 2
    if not body:
        print(f"{args.body_file} is empty. Nothing to send.", file=sys.stderr)
        return 2

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
    if override:
        os.environ["DATABASE_URL"] = override

    from app.database import engine  # noqa: E402
    from app.services.email import (  # noqa: E402
        AnnouncementUnavailable,
        announcement_sender,
        build_announcement,
        send_announcement,
    )

    sender = announcement_sender()
    host = engine.url.host or engine.url.database or "(local)"

    try:
        conn_ctx = engine.connect()
    except SQLAlchemyError as exc:
        detail = str(getattr(exc, "orig", exc)).strip().splitlines()
        print(f"Could not connect to {host}.", file=sys.stderr)
        if detail:
            print(f"  {detail[0]}", file=sys.stderr)
        if "password authentication failed" in str(exc).lower():
            print(
                "\nThat is a rotated or wrong credential, not a problem with this script.\n"
                "Get a fresh connection string from the Neon console and re-run with --prompt.",
                file=sys.stderr,
            )
        return 1

    with conn_ctx as conn:
        rows = [dict(r._mapping) for r in conn.execute(RECIPIENTS_SQL)]
        opted_out = conn.execute(OPTED_OUT_SQL).scalar()

    if args.only:
        wanted = {a.strip().lower() for a in args.only}
        rows = [r for r in rows if r["email"].lower() in wanted]
        missing = wanted - {r["email"].lower() for r in rows}
        for addr in sorted(missing):
            print(
                f"NOTE: {addr} is not a recipient -- no such account, or they opted out.",
                file=sys.stderr,
            )

    print(f"database host : {host}")
    print(f"sender        : {sender or '(NONE -- SENDER_EMAIL is not set, a real send will refuse)'}")
    print(f"recipients    : {len(rows)}")
    print(f"opted out     : {opted_out}")
    print()
    print("--- the message, exactly as it will arrive ---")
    preview = build_announcement(
        to_email=(rows[0]["email"] if rows else "nobody@example.com"),
        subject=args.subject,
        body=body,
        from_email=sender or "unset@example.com",
    )
    _show(f"Subject: {preview['Subject']}")
    print(f"List-Unsubscribe: {preview['List-Unsubscribe']}")
    print()
    _show(preview.get_content())
    print("--- end of message ---")
    print()

    if not rows:
        print("Nobody to send to. Stopping.")
        return 0

    if not args.send:
        print("DRY RUN -- nothing was sent. Re-run with --send to send it for real.")
        return 0

    # THE CONFIRMATION IS A TYPED NUMBER, not y/N. A single keystroke is too easy to give to a
    # question you did not read, and mail has no undo: this is the only action in the repo that
    # reaches every user at once and cannot be reversed by a follow-up deploy. Typing the count back
    # forces the number above to be looked at, which is also the number most likely to be wrong if
    # the connection string points somewhere unexpected.
    print(f"About to email {len(rows)} people from {sender!r}. This cannot be undone.")
    answer = input(f"Type the recipient count ({len(rows)}) to confirm, anything else to abort: ")
    if answer.strip() != str(len(rows)):
        print("Aborted. Nothing was sent.")
        return 1

    sent, failed = 0, []
    for row in rows:
        try:
            ok = send_announcement(to_email=row["email"], subject=args.subject, body=body)
        except AnnouncementUnavailable as exc:
            print(f"\nStopping: {exc}", file=sys.stderr)
            break
        if ok:
            sent += 1
        else:
            failed.append(row["email"])
        time.sleep(SECONDS_BETWEEN_SENDS)

    print()
    print(f"sent    : {sent}")
    print(f"failed  : {len(failed)}")
    for addr in failed:
        print(f"  {_redact(addr)}")
    if failed:
        print(
            "\nIn the SES sandbox every unverified recipient fails this way. If that is where you\n"
            "are, these are not lost messages -- they were never deliverable. Request production\n"
            "access in the SES console and re-run with --only against the ones that failed."
        )
    return 0 if sent and not failed else 1


if __name__ == "__main__":
    raise SystemExit(main())
