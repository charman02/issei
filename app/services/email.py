import logging

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


def build_announcement(
    *,
    to_email: str,
    subject: str,
    body: str,
    from_email: str,
) -> "EmailMessage":
    """Build the MIME message, separately from sending it, so the headers can be tested.

    WHY `send_raw_email` AND NOT `send_email`. SES's simple `send_email` API accepts a Subject and a
    Body and nothing else — there is no way to attach `List-Unsubscribe`. That header is the whole
    unsubscribe mechanism chosen for this feature (owner's call): Gmail and Apple Mail render their
    own native "unsubscribe" control from it, and since 2024 Gmail and Yahoo expect it from anything
    that looks like bulk mail. Without it an announcement is filtered harder, which is the feature
    silently not working rather than failing. So the message is assembled here and sent raw.

    `List-Unsubscribe-Post` is what makes a mail client treat the control as ONE-CLICK rather than
    "open this link and figure it out". It is paired with a `mailto:` target on purpose: a real
    one-click HTTP endpoint would be a new unauthenticated write surface with its own token scheme
    and rate limit, and this beta does not need that to honour an opt-out — the in-app switch is the
    primary control, and a mailto lands in an inbox the owner already reads.

    The footer names the in-app switch, because the header is invisible to anyone whose mail client
    doesn't surface it, and "how do I stop these" must have an answer inside the message.
    """
    from email.message import EmailMessage

    message = EmailMessage()
    message["Subject"] = subject
    message["From"] = from_email
    message["To"] = to_email
    # `mailto` rather than an HTTPS endpoint — see the docstring.
    message["List-Unsubscribe"] = f"<mailto:{from_email}?subject=unsubscribe>"
    message["List-Unsubscribe-Post"] = "List-Unsubscribe=One-Click"
    message.set_content(
        f"{body}\n\n"
        "--\n"
        "You are getting this because you have an issei account.\n"
        "Turn these off any time: open issei, go to You, then Notifications.\n"
    )
    return message


def send_announcement(*, to_email: str, subject: str, body: str) -> bool:
    """Send ONE announcement. Returns True if SES accepted it.

    RAISES `AnnouncementUnavailable` when no sender is configured, and that is deliberately the
    OPPOSITE of `send_feedback_notification`'s degrade-to-no-op. The difference is the caller: that
    one runs inside a user-facing write where a silent skip is the kind thing to do, while this one
    is called by `scripts/send_announcement.py`, a deliberate manual act whose whole output is "who
    did this reach". A script that prints "sent to 14 people" having sent to nobody is worse than a
    script that stops — this is the same reasoning `services/push.py` records for why IT degrades
    and `email.py` does not.

    A per-recipient SES failure is NOT raised: it returns False so the caller can carry on down the
    list and report the failures at the end. One bad address must not strand the other thirteen.
    """
    from_email = announcement_sender()
    if not from_email:
        raise AnnouncementUnavailable(
            "SENDER_EMAIL is not set, so there is no verified SES identity to send from."
        )
    message = build_announcement(
        to_email=to_email, subject=subject, body=body, from_email=from_email
    )
    try:
        client = boto3.client("ses", region_name=_SES_REGION)
        client.send_raw_email(
            Source=from_email,
            Destinations=[to_email],
            RawMessage={"Data": message.as_bytes()},
        )
        return True
    except ClientError as exc:
        # NAMED, because in the SES sandbox this is the expected failure for every recipient who is
        # not a verified identity, and the operator needs to be able to tell that apart from a
        # genuine problem. The script surfaces the code.
        code = exc.response.get("Error", {}).get("Code", "?")
        logger.warning("announcement to %s failed: %s", _redact(to_email), code)
        return False
    except Exception:
        logger.warning("announcement to %s failed", _redact(to_email), exc_info=True)
        return False


def _redact(addr: str) -> str:
    """`ana@example.com` -> `a**@example.com`. Announcements are bulk, so a failure loop would
    otherwise write every recipient's address into CloudWatch in plain text."""
    local, _, domain = addr.partition("@")
    if not domain:
        return "***"
    return f"{local[:1]}{'*' * max(len(local) - 1, 1)}@{domain}"
