import logging
from functools import lru_cache

import boto3
from botocore.exceptions import ClientError

from app.config import settings

_SES_REGION = "us-west-2"

logger = logging.getLogger(__name__)

# Set once the "feedback notifications are off" warning has been emitted, so a deploy with no SES
# address says so once at startup-ish rather than on every note. Reset by tests via monkeypatch.
_WARNED_NO_RECIPIENT = False


def send_password_reset_email(to_email: str, token: str) -> None:
    """Send a password-reset link via AWS SES.

    Uses the task's IAM role credentials automatically — no keys in config.
    Raises ClientError if SES rejects the send (caller logs and swallows it
    so the endpoint stays silent on success regardless of delivery outcome).
    """
    reset_url = f"{settings.app_url}/reset-password?token={token}"
    client = boto3.client("ses", region_name=_SES_REGION)
    client.send_email(
        Source=settings.sender_email,
        Destination={"ToAddresses": [to_email]},
        Message={
            "Subject": {"Data": "Reset your issei password"},
            "Body": {
                "Html": {
                    "Data": (
                        f"<p>Someone (hopefully you) requested a password reset for "
                        f"your issei account.</p>"
                        f"<p><a href=\"{reset_url}\">Reset my password</a></p>"
                        f"<p>This link expires in 1 hour. If you didn't request this, "
                        f"you can ignore this email — your password won't change.</p>"
                    )
                },
                "Text": {
                    "Data": (
                        f"Someone (hopefully you) requested a password reset for your "
                        f"issei account.\n\n"
                        f"Reset your password: {reset_url}\n\n"
                        f"This link expires in 1 hour. If you didn't request this, "
                        f"you can ignore this email."
                    )
                },
            },
        },
    )


def feedback_recipient() -> str:
    """Where a new feedback note gets emailed, or "" for nowhere.

    DEFAULTS TO `sender_email`, which is the whole reason this needs no new secret. SES requires
    the SENDER to be a verified identity, and — while the account is still in the SES sandbox —
    every RECIPIENT to be verified too. `sender_email` is by definition already verified, so
    mailing it works today with nothing added to SSM or the task definition. Set
    FEEDBACK_NOTIFY_EMAIL to redirect it at a real inbox once that address is verified.
    """
    return (settings.feedback_notify_email or settings.sender_email or "").strip()


def send_feedback_notification(
    body: str,
    *,
    from_name: str,
    from_email: str,
    path: str | None,
    app_version: str | None,
) -> bool:
    """Email the owner one new piece of feedback. Returns True if a send was attempted.

    WHY PUSH RATHER THAN PULL (#101). `GET /feedback` is deliberately self-only — the read path is
    where the absence of an admin role matters most, and `routers/feedback.py` records why an
    OWNER_USER_ID-gated read-everything endpoint was rejected: it invents an admin role without any
    of the machinery a real one needs, and converts one 7-day bearer token in one phone's
    localStorage into read access over every tester's candid words. That reasoning still holds. So
    the fix is not a new way to READ the table; it is the table telling the owner when something
    lands. "Remember to check the database" is what produced a beta's worth of unread notes.

    DEGRADES, NEVER RAISES. Same discipline as `services/push.py` and the opposite of
    `send_password_reset_email` above, which raises and leans on its one HTTP caller: this is called
    from a user-facing write, and a note that saved fine must never surface as a failure because SES
    was unhappy. With no recipient configured it is a logged no-op, so a deploy without SES behaves
    exactly as it did before this existed.

    The sender's identity is included because feedback is not anonymous to the owner — they may need
    to reply — and because "which build was this?" is the first question a bug report raises, which
    is what `app_version` is for.
    """
    to = feedback_recipient()
    if not to:
        # ONCE PER PROCESS, at WARNING. An INFO line here was invisible in practice — the root
        # logger sits at WARNING under uvicorn, so "it's logged" was a claim with nothing behind it,
        # which is the worst kind of degradation: silent AND believed to be observable. WARNING
        # surfaces it; once-per-process keeps it from repeating on every note, because the condition
        # is a property of the deploy, not of the note.
        global _WARNED_NO_RECIPIENT
        if not _WARNED_NO_RECIPIENT:
            _WARNED_NO_RECIPIENT = True
            logger.warning(
                "feedback notifications are OFF: neither FEEDBACK_NOTIFY_EMAIL nor SENDER_EMAIL is "
                "set. Notes are still saved; read them with scripts/read_feedback.py."
            )
        return False

    where = path or "(unknown screen)"
    build = app_version or "(no version stamped)"
    subject = f"issei feedback from {from_name}".strip()

    text = (
        f"{body}\n\n"
        f"—\n"
        f"From: {from_name} <{from_email}>\n"
        f"Screen: {where}\n"
        f"Build: {build}\n"
    )
    try:
        client = boto3.client("ses", region_name=_SES_REGION)
        client.send_email(
            Source=settings.sender_email,
            Destination={"ToAddresses": [to]},
            # Replies go to the person who wrote it, so answering a tester is one tap rather than a
            # copy-paste out of the footer.
            ReplyToAddresses=[from_email] if from_email else [],
            Message={
                "Subject": {"Data": subject},
                "Body": {"Text": {"Data": text}},
            },
        )
        return True
    except Exception:
        # DELIBERATELY BROAD, and broader than `ClientError`. The realistic failures here are not
        # only SES rejections: no IAM credentials at all (every local dev run), no network, a
        # botocore config error, an endpoint that can't be resolved. Every one of them must end the
        # same way — logged, swallowed, feedback still saved — so narrowing this would only create
        # a class of failure that turns a working write into a 500.
        logger.warning("feedback email failed", exc_info=True)
        return False


# --- announcements (#107) -------------------------------------------------------------------------


class AnnouncementUnavailable(RuntimeError):
    """No verified sender is configured, so no announcement can be sent from this deploy."""


def announcement_sender() -> str:
    """The verified SES identity every announcement is sent FROM, or "" for nowhere.

    Same single source as the other two senders: SES requires the Source to be a verified identity,
    and `SENDER_EMAIL` is the one address the deploy is certain about.
    """
    return (settings.sender_email or "").strip()


def unsubscribe_address() -> str:
    """Where an unsubscribe reply goes -- and it has to be a mailbox somebody READS.

    THIS IS THE FEATURE'S ONE PROMISE, and the first version pointed it at the wrong thing. It used
    `announcement_sender()`, which prod sets to `noreply@issei.app` (`.aws/task-definition.json`,
    `infra/lib/issei-stack.ts`). Both ship gates spelled out the consequence independently: a person
    taps their mail client's Unsubscribe, a message goes to `noreply@`, nobody reads it, they stay on
    the list, and the next broadcast reaches them -- the opt-out failing silently for the only person
    who used the mechanism this whole `send_raw_email` path exists to support.

    So it points at `feedback_recipient()` instead: the address #101 already sends real user feedback
    to, i.e. one the owner has a reason to read. `FEEDBACK_NOTIFY_EMAIL` is now SET in the prod task
    definition to `feedback@issei.app` (#87 part two) -- a ROLE address forwarding to a person rather
    than the person's own, because this repo is public and because the value appears in the headers of
    every announcement anyway, so it wants to be an address that can be retired.

    TWO THINGS STILL HAVE TO BE TRUE OUTSIDE THIS REPO, and neither is visible from here: that address
    must FORWARD to an inbox somebody reads, and it must be a VERIFIED SES identity in us-west-2 (the
    account is still sandboxed, which requires the recipient to be verified too). If it forwards
    nowhere the opt-out fails silently; if it is unverified, the #101 feedback mail degrades to a
    logged no-op while notes keep saving. `scripts/send_announcement.py` still REFUSES TO SEND when
    this address looks unmonitored, which is now a check on the *shape* of the name rather than a
    standing block -- `feedback@` passes it, so the block that was stopping a broadcast is lifted and
    the verification is what stands between here and a real send.
    """
    return feedback_recipient()


def looks_unmonitored(addr: str) -> bool:
    """True for an address whose local part announces that nobody reads it.

    A heuristic, deliberately, and used only to REFUSE or to warn -- never to rewrite an address. The
    alternative to a heuristic here is nothing, and nothing is how the first version shipped a
    `noreply@` unsubscribe target alongside a comment correctly explaining why that was wrong.
    """
    local = addr.partition("@")[0].strip().lower()
    for ch in ".-_+":
        local = local.replace(ch, "")
    return local.startswith(("noreply", "donotreply", "nomail")) or local == ""


def build_announcement(
    *,
    to_email: str,
    subject: str,
    body: str,
    from_email: str,
    unsubscribe_to: str | None = None,
):
    """Build the MIME message, separately from sending it, so the headers can be tested.

    WHY `send_raw_email` AND NOT `send_email`. SES's simple `send_email` API accepts a Subject and a
    Body and nothing else -- there is no way to attach `List-Unsubscribe`. That header is the whole
    unsubscribe mechanism chosen for this feature (owner's call): a mail client renders its own
    unsubscribe control from it, and since 2024 Gmail and Yahoo expect it from anything that looks
    like bulk mail. Without it an announcement is filtered harder, which is the feature silently not
    working rather than failing. So the message is assembled here and sent raw.

    THERE IS NO `List-Unsubscribe-Post`, AND ITS ABSENCE IS A CORRECTION. The first version paired one
    with this `mailto:`, which claims ONE-CLICK -- and RFC 8058's one-click flow specifies an
    **https:** URI, so the pairing was outside the spec (a conforming client ignores the header and
    falls back to ordinary mailto behaviour) while also advertising an automation nothing here
    performs. Both ship gates caught it. The plain `List-Unsubscribe` deliverability argument survives
    intact; it was only the word "one-click" that was never earned. A real HTTPS one-click route was
    considered and declined -- a new unauthenticated write surface with its own token scheme and rate
    limit -- because the in-app switch is the primary control and this is the convenience layer.

    `Reply-To` goes to the same read inbox. A reply to a broadcast is the most engaged response a beta
    can get, and the first version aimed it at `noreply@`.

    `Date` and `Message-ID` are set HERE rather than left to SES. `Date` is mandatory under RFC 5322
    and its absence is a spam-scoring signal; SES may well add both, but "may well" is not a thing to
    rest deliverability on when two lines settle it.
    """
    from email.message import EmailMessage
    from email.utils import formatdate, make_msgid

    unsubscribe_to = unsubscribe_to or from_email
    message = EmailMessage()
    message["Subject"] = subject
    message["From"] = from_email
    message["To"] = to_email
    message["Date"] = formatdate(localtime=False, usegmt=True)
    message["Message-ID"] = make_msgid(domain=from_email.partition("@")[2] or "issei.app")
    message["Reply-To"] = unsubscribe_to
    message["List-Unsubscribe"] = "<mailto:" + unsubscribe_to + "?subject=unsubscribe>"
    message.set_content(
        body + "\n\n"
        "--\n"
        "You are getting this because you have an issei account.\n"
        "Turn these off any time: open issei, go to You, then Notifications.\n"
    )
    return message


def announcement_bytes(message) -> bytes:
    """Serialise for the wire, and the line-length cap is the load-bearing part.

    Under the default policy a `List-Unsubscribe` value longer than ~48 characters gets folded, and
    past that threshold the whole header is emitted as an RFC 2047 encoded-word
    (`=?utf-8?q?=3Cmailto=3A...?=`) which no RFC 2369 parser reads as a URI -- the unsubscribe control
    simply vanishes. `noreply@issei.app` is 17 characters so it cannot fire today, but the obvious
    next change (adding an https: URI beside the mailto) crosses it immediately. A ship gate measured
    the threshold at exactly 49. `policy.SMTP` also gives CRLF line endings, which is what the wire
    format actually calls for.

    Separate from `build_announcement` so a test can assert the BYTES rather than the in-memory
    object -- the first version's header tests read the header back off the object, which round-trips
    regardless of how it serialises, so they passed on output a mail client could not parse.
    """
    from email import policy

    return message.as_bytes(policy=policy.SMTP.clone(max_line_length=0))


@lru_cache(maxsize=1)
def _ses_client():
    """One SES client, not one per recipient.

    `boto3.client` resolves credentials on every call, which is invisible at a dozen users and wrong
    at four hundred -- a broadcast would spend a credential lookup per message. Cached lazily rather
    than built at import time so a deploy with no AWS role still imports this module cleanly.
    """
    return boto3.client("ses", region_name=_SES_REGION)


def send_announcement(
    *, to_email: str, subject: str, body: str, unsubscribe_to: str | None = None
) -> bool:
    """Send ONE announcement to ONE address. Returns True if SES accepted it.

    **THIS FUNCTION DOES NOT CHECK `announcement_emails`, AND CANNOT.** It takes a bare address and
    has no session. The opt-out is enforced one level up, by `RECIPIENTS_SQL` in
    `scripts/send_announcement.py`, its only caller -- and a ship gate correctly named the shape that
    makes that fragile: it is exactly how #98 shipped an unvalidated photo field, because "the inline
    copy in the first router never reached the second". So the contract is stated here in the loudest
    place available rather than assumed:

        ANY NEW CALLER MUST FILTER ON `User.announcement_emails` ITSELF.

    A welcome email, an owner-gated route, a re-send helper -- none of them would get a guard from
    this function and none would fail a test. `TESTING.md` invariant 18 records the same rule, and the
    honest fix if a second caller ever appears is to move the check inside by taking a `User` row
    instead of a string.

    RAISES `AnnouncementUnavailable` when no sender is configured, deliberately the OPPOSITE of
    `send_feedback_notification`'s degrade-to-no-op. The difference is the caller: that one runs
    inside a user-facing write where a silent skip is the kind thing to do, while this one is called
    by a script whose whole output is "who did this reach" -- a run printing "sent to 14 people"
    having sent to nobody is worse than one that stops.

    A per-recipient SES failure is NOT raised: it returns False so the caller can carry on down the
    list and report the failures at the end. One bad address must not strand the other thirteen, and
    in the SES sandbox every unverified recipient fails exactly this way, so this is the NORMAL path
    until production access is granted.
    """
    from_email = announcement_sender()
    if not from_email:
        raise AnnouncementUnavailable(
            "SENDER_EMAIL is not set, so there is no verified SES identity to send from."
        )
    message = build_announcement(
        to_email=to_email,
        subject=subject,
        body=body,
        from_email=from_email,
        unsubscribe_to=unsubscribe_to or unsubscribe_address(),
    )
    try:
        _ses_client().send_raw_email(
            Source=from_email,
            Destinations=[to_email],
            RawMessage={"Data": announcement_bytes(message)},
        )
        return True
    except ClientError as exc:
        # NAMED, because in the SES sandbox this is the expected failure for every recipient who is
        # not a verified identity, and the operator needs to tell that apart from a genuine problem.
        code = exc.response.get("Error", {}).get("Code", "?")
        logger.warning("announcement to %s failed: %s", redact_address(to_email), code)
        return False
    except Exception:
        logger.warning("announcement to %s failed", redact_address(to_email), exc_info=True)
        return False


def redact_address(addr: str) -> str:
    """`ana@example.com` -> `a**@example.com`.

    Exported rather than duplicated: announcements are bulk, so a failure loop would otherwise write
    every recipient's address into CloudWatch in plain text, and two copies of a redaction rule is how
    one of them ends up not redacting (the `services/media.py` lesson).

    NOT used for the send script's own failure list, which prints in full on purpose -- the operator
    already holds `DATABASE_URL`, and a redacted address cannot be passed back to `--only`.
    """
    local, _, domain = addr.partition("@")
    if not domain:
        return "***"
    return local[:1] + "*" * max(len(local) - 1, 1) + "@" + domain
