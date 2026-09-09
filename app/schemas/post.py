from datetime import datetime
from typing import Annotated, Literal, Optional
from pydantic import BaseModel, Field, ConfigDict, StringConstraints


# Strip first, then require a character — so "" and "   " fail by the same rule
# (min_length alone would let a spaces-only name through, which the router then
# strips to empty). Same strip-then-validate pattern as PersonName in schemas/user.
DishName = Annotated[
    str, StringConstraints(strip_whitespace=True, min_length=1, max_length=120)
]


# Same 500-char ceiling recipe URLs got (#100). A real Cloudinary URL is ~120; the point is
# that an unbounded string rendered into an `<img src>` is a place to hide a payload, and a
# post's photo is rendered to every friend. This was missed in the first pass — the caps went
# on `schemas/recipe.py` and this file's URL was left as it was.
PhotoUrl = Annotated[str, StringConstraints(min_length=1, max_length=500)]


class PostCreate(BaseModel):
    photo_url: PhotoUrl
    # The dish name is required — a photo with no name is a picture, not "what I
    # made". Bounded so it stays a name, not a caption.
    dish_name: DishName
    description: Optional[str] = Field(default=None, max_length=500)
    # Optionally attach an existing recipe the caller owns. Ownership is enforced
    # in the router; a post never links a recipe that isn't yours.
    recipe_id: Optional[int] = None
    # Concrete: "public" (everyone-feed/Browse) | "friends" (accepted friends only) |
    # "private" (only me). The create UI auto-selects from the author's profile, but the
    # value is stored literally. Same three states and rule as a recipe
    # (services/sharing.can_view_post). Default "friends" if the client omits it.
    visibility: Literal["public", "friends", "private"] = "friends"


class PostUpdate(BaseModel):
    """Edit a meal you posted. Every field optional — a client sends only what changed.

    `None` means "leave it alone", which is why `description` can't be cleared by sending null;
    send `""` for that (the router strips it back to NULL). That ambiguity is the cost of a
    partial update, and the alternative — a sentinel — is worse to read.

    THREE fields, matching exactly what the edit form on PostPage offers. Two things a client
    might expect here are deliberately absent, and both were removed after review flagged that
    the schema was wider than any rule or UI backing it:

      - `photo_url`. A different photo is a different meal, so re-shooting it is a NEW post, not
        an edit — the UI, the README and CLAUDE.md all said so while the schema quietly accepted
        the field, with no Cloudinary-host check of the kind `PATCH /auth/me` applies. A rule
        enforced only in the client isn't enforced.
      - `recipe_id`. Attaching a recipe to a post people have ASKED about is answering them, and
        answering already has an endpoint that does the whole job: `POST /posts/{id}/fulfill`
        mints a grant per pending requester, marks the asks fulfilled and notifies them. A quiet
        `recipe_id` here would attach the recipe while leaving every ask pending — the cook's own
        card would keep reading "1 person asked for this" about a recipe already on the post.
        Attaching to an EXISTING post that nobody asked about has no home yet; that's a feature
        with a UI, not a field to leave half-wired in a schema.

    Also not editable: the author. A post is somebody saying "I made this", so transferring one
    would make the sentence false.
    """

    dish_name: Optional[DishName] = None
    description: Optional[str] = Field(default=None, max_length=500)
    visibility: Optional[Literal["public", "friends", "private"]] = None


class FeedSeenIn(BaseModel):
    """How far the caller has read their feed (#97).

    `through_post_id` is the NEWEST post they actually received, and the mark is stored as that
    ID. Two reasons it is an id and not a time. It records "I read up to HERE" rather than "I
    opened the app at this time" — with a wall-clock mark, anything posted while the feed was on
    screen would be silently marked seen. And ids are monotonic, whereas `created_at` is
    second-granular on SQLite, so a timestamp mark misses a post made in the same second.

    Omit it and the mark goes to the newest post that exists — the honest reading when the page
    came back empty, since there was nothing to miss.
    """

    # ge=1 because a post id is always positive; the router additionally CLAMPS to the newest
    # existing id, since the column is int4 on Postgres (an oversized value is a 500 there and
    # nothing on SQLite) and the mark is forward-only, so one bad call would otherwise leave an
    # account permanently unable to see anything as new.
    through_post_id: Optional[int] = Field(default=None, ge=1)


class PostResponse(BaseModel):
    """A post as the feed/profile renders it: the meal, plus who made it (name +
    id, never email). recipe_id is exposed so the card can link through when the
    post has a recipe attached."""

    id: int
    user_id: int
    author_first_name: str
    author_last_name: str
    # The author's profile picture (or None → monogram), so a feed/profile post shows a
    # face beside the name.
    author_photo_url: Optional[str] = None
    photo_url: str
    dish_name: str
    description: Optional[str] = None
    recipe_id: Optional[int] = None
    visibility: str = "friends"
    # Whether the CALLER has asked the cook for this recipe (#79). Per-viewer, so the button
    # can read "Asked ✓" without a second round trip.
    requested_by_me: bool = False
    # How many people have asked — **only ever populated for the post's own author**, None
    # for everyone else. This is the deliberate product line: a public "N people want this"
    # is a like count wearing a different noun, and it would print a visible zero under the
    # ordinary meal this app exists to make postable. The cook gets it as a private nudge;
    # demand becomes public later by RANK (a "most asked for" row), which shows the dishes
    # that have demand without ever rendering an absence.
    request_count: Optional[int] = None
    # NEW SINCE THE CALLER LAST READ THEIR FEED (#97) — set on the feed only, None everywhere
    # else (Browse, a permalink, a profile grid), where "new" has no meaning. Drives the
    # divider, so the client can show where you got to without anything being removed.
    #
    # Your OWN post is never new to you: you were there when you made it.
    is_new: Optional[bool] = None
    created_at: datetime

    model_config = ConfigDict(from_attributes=True)


class PostWithRequesters(BaseModel):
    """A post of the CALLER'S OWN plus who asked for its recipe — the cook's requests page.

    Only ever built for posts the caller authored (the endpoint filters on `user_id`), which
    is what makes returning names here consistent with the count rule above.
    """

    post: PostResponse
    requesters: list["RequesterSummary"]


from app.schemas.notification import RequesterSummary  # noqa: E402

PostWithRequesters.model_rebuild()
