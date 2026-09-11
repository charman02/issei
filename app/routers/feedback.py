import logging

from fastapi import APIRouter, Depends, status
from sqlalchemy.orm import Session

from app.auth import get_current_user
from app.database import get_db
from app.models.feedback import Feedback
from app.models.user import User
from app.schemas.feedback import FeedbackCreate, FeedbackResponse
from app.services.email import send_feedback_notification

router = APIRouter(prefix="/feedback", tags=["feedback"])

logger = logging.getLogger(__name__)


@router.post("", response_model=FeedbackResponse, status_code=status.HTTP_201_CREATED)
def send_feedback(
    feedback_in: FeedbackCreate,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Store one note about the app.

    No HTTPException here on purpose. Every rule this endpoint has is structural —
    a body that's blank after trimming, a body past the cap, an over-long path —
    so all of it lives in FeedbackCreate and comes back as a 422 the frontend
    normalizer already renders (schemas/user.py sets the same precedent). Routers
    in this codebase raise only for semantic failures that need a database read to
    detect ("Email already registered", a recipe the caller can't see), and this
    path has none: any authenticated user may send any number of notes, and
    rate-limiting a beta of a handful of people would cost a real report to prevent
    a problem nobody has.
    """
    entry = Feedback(
        user_id=current_user.id,
        body=feedback_in.body,
        path=feedback_in.path,
        app_version=feedback_in.app_version,
    )
    db.add(entry)
    db.commit()
    # Re-read for the server-generated id and created_at, matching signup.
    db.refresh(entry)

    # TELL THE OWNER (#101). Everything above this line worked for months and produced a beta's
    # worth of notes nobody read, because reading them meant remembering to open a database console.
    # The read path stays self-only (see `my_feedback` below for why an admin endpoint was rejected);
    # what changed is that the note now announces itself.
    #
    # AFTER the commit, and never able to fail the request: the note is already saved and returned,
    # so a send that goes wrong must be invisible to the person who wrote it. `email.py` swallows its
    # own errors and returns a bool; the belt-and-braces try here covers an unexpected raise from the
    # notification path itself, because "your feedback failed" on feedback that saved fine would be
    # the most self-defeating error message in the app.
    try:
        send_feedback_notification(
            entry.body,
            from_name=f"{current_user.first_name} {current_user.last_name}".strip(),
            from_email=current_user.email,
            path=entry.path,
            app_version=entry.app_version,
        )
    except Exception:  # pragma: no cover - defence in depth; email.py already swallows
        logger.warning("feedback notification raised unexpectedly", exc_info=True)

    return entry


@router.get("", response_model=list[FeedbackResponse])
def my_feedback(
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """The caller's OWN notes, newest first. Never anyone else's.

    This app has no admin role, and the read path is where that matters most:
    feedback is the one place a tester writes candidly, sometimes about another
    person using the app, and a list endpoint any signed-in account could call
    would hand every beta tester everyone else's complaints. So the scope here is
    self-only, enforced by the same `user_id ==` filter the rest of the app uses,
    with no flag or role that could widen it.

    The owner reads the table directly (a SELECT against the production database),
    which is the honest answer for a beta run by one person — and the rejected
    alternative is worth recording, because it looks safer than it is:

      An OWNER_USER_ID env var gating a read-everything endpoint invents an admin
      role without any of the machinery a real one needs. It fails open in the
      obvious ways (unset, blank, or a value that parses to something unintended),
      and even configured perfectly it converts one 7-day bearer token sitting in
      one phone's localStorage into read access over every tester's private words.
      The owner already holds DATABASE_URL, so it buys no capability they lack —
      it only adds a way to lose something.

    Self-only, by contrast, earns its keep in the product: someone can see the note
    they sent is still on file, which is the thing that makes a feedback form feel
    worth using twice.
    """
    return (
        db.query(Feedback)
        .filter(Feedback.user_id == current_user.id)
        .order_by(Feedback.created_at.desc(), Feedback.id.desc())
        .all()
    )
