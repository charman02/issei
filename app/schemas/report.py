from typing import Annotated, Literal, Optional, get_args

from pydantic import BaseModel, StringConstraints, model_validator

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

# DERIVED, not retyped. This started as a hand-written tuple beside the Literal, which meant a
# sixth reason added to one and not the other would be accepted by the API and never exercised —
# `test_every_reason_in_the_vocabulary_is_accepted` iterates this.
REPORT_REASONS = get_args(ReportReason)


class ReportUserIn(BaseModel):
    """Report a person for review (#87), optionally naming the post or recipe it is about.

    A report is always about a PERSON — `user_id` stays required. The subject is what prompted it,
    and it is optional because the founding case has no subject: someone's behaviour, reported from
    their profile. Guideline 1.2 wants both, which is why the content half arrived (#87 part two).

    AT MOST ONE SUBJECT, enforced here rather than in the router, because "which thing is this about"
    has to have an answer and the reviewer has no interface in which to disambiguate two. A 422 at
    the boundary is the right place for a shape error; the router's job is the dedupe rule.

    The id is NOT checked for existence or visibility here. Existence is the router's (it 404s an
    unknown person), and visibility is deliberately never checked at all: a report is not a read, so
    someone shown a post in a feed that was then made private — or who was blocked immediately after
    — must still be able to report it. See the model docstring, decision 1.
    """

    user_id: int
    reason: ReportReason
    # WHAT it is about, at most one. Both optional: a report about a person needs neither.
    post_id: Optional[int] = None
    recipe_id: Optional[int] = None

    @model_validator(mode="after")
    def _one_subject_at_most(self):
        if self.post_id is not None and self.recipe_id is not None:
            raise ValueError("A report names a post or a recipe, not both.")
        return self
    # The reporter's own words. Optional, because a reason alone is a valid report and demanding
    # an explanation is friction in front of someone who may be upset. 1000 is generous: this is
    # the field a moderator reads first, so it should hold an account of what happened rather
    # than a headline.
    note: Optional[Annotated[str, StringConstraints(max_length=1000)]] = None
