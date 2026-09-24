from datetime import datetime
from typing import Optional

from sqlalchemy import DateTime, ForeignKey, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column
from sqlalchemy.sql import func

from app.database import Base


class PassOnRequest(Base):
    """Someone who can read a recipe has asked the cook if they may PASS IT ON (#78).

    The other half of keeping (#57). You can bookmark someone else's recipe and you can hand on
    a recipe you wrote; until now you could not hand on one that was handed to you. FUTURE.md's
    case is the common one: *Lola's adobo reached you and your sibling asks for it.*

    **WHY THIS TABLE EXISTS AT ALL — the permission question, and the line that was drawn.**
    A re-share is a READER creating access for a third party, which is the opposite of every other
    rule in this app. `GET /recipes/invite/{token}` returns the WHOLE recipe with no account, so if
    any reader could mint a token, anyone holding a grant could make the cook's `private` recipe
    world-readable one link at a time, and "Only me" would stop meaning only-me-plus-who-I-chose.

    So the rule is: **a resharer may never grant more than they could cause by other means.**
      · A `public` recipe is already in Browse, so passing it on is a shortcut, not a widening.
        That needs no row here and no permission — `handoff_recipe` allows it outright.
      · Anything NARROWER (`friends`, `private`) is the cook's to widen, and this table is how
        they are asked. The cook approves, and the asker may then re-share exactly as if the
        recipe were public.

    This is also what the industry converged on and for the same reason: in Google Docs a viewer
    cannot grant access to anyone, and "Request access" exists precisely because "a reader wants
    to widen" is common while "a reader may widen" is not acceptable. Instagram blocks resharing
    content from private accounts outright. The messaging apps gave up only because the content is
    on the recipient's device and they have nothing left to enforce — issei serves the invite page
    from its own server, so that excuse does not apply here.

    **WHAT THE APPROVAL GRANTS, precisely.** Permission to re-share — *not* a re-share. The cook
    does not mint anything and does not name the third party; approving simply lets the asker use
    the ordinary link-only handoff path, minting a grant **from themselves** with a **fresh token**.
    That keeps three things true: attribution stays pointed at the cook, the cook's own token is
    never echoed to anyone (the security tripwire recorded in the #57 review), and the third party's
    contact details never travel to the cook — the asker forwards the link themselves.

    **AND IT IS NOT LINEAGE.** No chain is stored and none is shown: no ancestry, no "passed through
    N kitchens", no child counts. A row here is a permission between two people about one recipe,
    and once used it says nothing about where the recipe went. The removed lineage model is exactly
    what this must not grow back into — a `passed_to_id` column would BE it.

    `state`: 'pending' | 'approved' | 'declined'. Unique on (recipe_id, requester_id), so asking
    twice is idempotent rather than a second row — the same shape as `recipe_requests` and the
    friendship pair.

    **A DECLINE IS KEPT RATHER THAN DELETED, and it is never shown to the asker.** Kept because the
    cook answered and re-asking must not be free: a row in `declined` is what makes a second ask a
    no-op instead of a fresh notification, so "no" cannot be worn down by repetition. Never shown,
    for the reason a block is silent (#85) and a report tells the reported person nothing: the cook
    said no about a recipe carrying their own family's name on it, and putting "Lola declined" on
    the asker's screen turns a quiet boundary into a social event between two people who are
    probably related. The asker's button simply goes back to its resting state. `resolved_at`
    records WHEN, because that is what a cook changing their mind later needs to be legible.
    """

    __tablename__ = "pass_on_requests"
    __table_args__ = (
        # Inline, not an ALTER: SQLite has no ADD CONSTRAINT and the migration chain replays there.
        UniqueConstraint("recipe_id", "requester_id", name="uq_pass_on_recipe_requester"),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    # CASCADE on both, unlike `reports`' content FKs. A report is a live case that must outlive the
    # thing it is about (deleting the post is what a reported person does). A pass-on permission is
    # the opposite: it is meaningless without the recipe it is about and without both people, and
    # there is nothing for a human to read later. If the recipe is gone there is nothing to pass on.
    recipe_id: Mapped[int] = mapped_column(
        ForeignKey("recipes.id", ondelete="CASCADE"), index=True, nullable=False
    )
    requester_id: Mapped[int] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), index=True, nullable=False
    )
    state: Mapped[str] = mapped_column(server_default="pending", nullable=False)
    created_at: Mapped[datetime] = mapped_column(
        DateTime, server_default=func.now(), nullable=False
    )
    # When the cook answered, either way. NULL while pending.
    resolved_at: Mapped[Optional[datetime]] = mapped_column(DateTime, nullable=True)
