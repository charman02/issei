from typing import Annotated, Literal, Optional

from pydantic import BaseModel, StringConstraints

# The reasons a person can pick. Short on purpose: a long taxonomy makes the reporter do the
# moderator's job, and the free-text note is where the actual grievance goes. These five cover
# what App Store Guideline 1.2 expects to see and read as plain English rather than policy
# language ("objectionable content" is a legal phrase, not something a person thinks).
#
# Kept as a Literal so an unknown reason is a 422 at the boundary rather than a mystery string
# in the table — but as a plain string in the column, so adding a sixth is a deploy and not a
# migration.
ReportReason = Literal[
    "harassment",
    "spam",
    "inappropriate",
    "impersonation",
    "other",
]

REPORT_REASONS = ("harassment", "spam", "inappropriate", "impersonation", "other")


class ReportUserIn(BaseModel):
    """Report a person for review (#87).

    No `post_id` or `recipe_id` yet — reporting a specific meal is a real thing to want, but
    there is no UI for it, and an API field nothing sends is a rule enforced nowhere.
    """

    user_id: int
    reason: ReportReason
    # The reporter's own words. Optional, because a reason alone is a valid report and demanding
    # an explanation is friction in front of someone who may be upset. 1000 is generous: this is
    # the field a moderator reads first, so it should hold an account of what happened rather
    # than a headline.
    note: Optional[Annotated[str, StringConstraints(max_length=1000)]] = None
