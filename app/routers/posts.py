from typing import Literal, Optional

from fastapi import APIRouter, Depends, HTTPException, Query, Response, status
from sqlalchemy import func, or_
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session, selectinload

from app.database import get_db
from app.auth import get_current_user
from app.models.user import User
from app.models.recipe import Recipe
from app.models.post import Post
from app.models.handoff import Handoff
from app.models.recipe_request import RecipeRequest
from app.schemas.post import FeedSeenIn, PostCreate, PostResponse, PostUpdate, PostWithRequesters
from app.schemas.notification import FulfillRequest, RequesterSummary
from app.services.friends import are_friends, friend_ids
from app.services.notifications import notify
from app.services.blocks import blocked_ids, is_blocked
from app.services.media import require_our_image_url
from app.services.sharing import can_view, can_view_post

router = APIRouter(prefix="/posts", tags=["posts"])

# Feed page size — bounded so one request can't pull an unbounded history on a phone.
FEED_PAGE = 30


def _to_response(
    post: Post,
    author: User,
    viewable_recipe_ids: set,
    *,
    viewer_id: Optional[int] = None,
    request_counts: Optional[dict] = None,
    my_requested_post_ids=frozenset(),
    last_seen_post_id: Optional[int] = None,
    mark_new: bool = False,
) -> PostResponse:
    # Expose the recipe link ONLY when the viewer can actually open it. A post links
    # a recipe the AUTHOR owns, but the viewer is usually a friend — and the author
    # may have made that recipe private, or soft-deleted it, after posting. Surfacing
    # recipe_id anyway gives a "See the recipe" link that dead-ends on a 404
    # (get_recipe → can_view denies a non-owner on a private recipe, and filters out
    # soft-deleted rows). Nulling it here means the card just omits the link instead.
    recipe_id = post.recipe_id if post.recipe_id in viewable_recipe_ids else None
    return PostResponse(
        id=post.id,
        user_id=post.user_id,
        author_first_name=author.first_name,
        author_last_name=author.last_name,
        author_photo_url=author.photo_url,
        photo_url=post.photo_url,
        dish_name=post.dish_name,
        description=post.description,
        recipe_id=recipe_id,
        visibility=post.visibility,
        requested_by_me=post.id in my_requested_post_ids,
        # The count is the AUTHOR'S alone (see PostResponse.request_count). Not "0 for
        # others" — None, so the client can't render a zero it was never given.
        request_count=(
            (request_counts or {}).get(post.id, 0)
            if viewer_id is not None and post.user_id == viewer_id
            else None
        ),
        # Only the feed asks for this (#97). Elsewhere it stays None rather than False, so a
        # client can tell "not new" from "this surface doesn't have the concept".
        is_new=(
            _is_new(post, viewer_id, last_seen_post_id) if mark_new else None
        ),
        created_at=post.created_at,
    )


def _is_new(post: Post, viewer_id: Optional[int], last_seen_post_id: Optional[int]) -> bool:
    """Whether this post arrived after the viewer last read their feed (#97).

    Compares IDs, not timestamps: `created_at` is second-granular on SQLite, so a post made in
    the same second as the mark would be wrongly counted as already-read. Ids are monotonic —
    the same reasoning that makes the feed's pagination keyset on `id`.

    Your own post is never new to you — you were there when you made it, and marking it new
    would put your own meal above the divider every time you post.

    A viewer who has never opened the feed (None) sees everything as new: they've read none of it.
    """
    if viewer_id is not None and post.user_id == viewer_id:
        return False
    if last_seen_post_id is None:
        return True
    return post.id > last_seen_post_id


def _viewable_recipe_ids(posts, viewer: User, db: Session) -> set:
    """The subset of the posts' linked recipe_ids that `viewer` may actually read, by
    the single recipe rule (services.sharing.can_view: owner OR the visibility rule
    allows the viewer OR an accepted handoff), minus soft-deleted recipes. Callers pass
    the result to _to_response, which nulls any recipe_id not in the set so a
    "See the recipe" link is only shown when it would resolve.

    Loads the Recipe rows with their owner (for can_view's profile check) in one query;
    can_view's handoff lookup is per-recipe, but a feed page links few distinct recipes
    so this stays cheap."""
    recipe_ids = {p.recipe_id for p in posts if p.recipe_id is not None}
    if not recipe_ids:
        return set()
    recipes = (
        db.query(Recipe)
        .options(selectinload(Recipe.user))
        .filter(Recipe.id.in_(recipe_ids), Recipe.deleted_at.is_(None))
        .all()
    )
    # One blocks lookup for the page rather than one per linked recipe (#85). A public
    # recipe used to short-circuit with zero queries; the block check runs before the
    # `public` branch, so without this precompute every card costs a round trip.
    hidden = blocked_ids(viewer.id, db)
    return {
        r.id
        for r in recipes
        if can_view(r, viewer, db, blocked=r.user_id in hidden)
    }


def _request_context(posts, viewer: User, db: Session):
    """Two bulk lookups for a page of posts (#79), so neither field costs a query per card:

    - `counts`: pending-request counts, computed ONLY for posts the viewer authored. Asking
      for anyone else's would be building the public tally the product rule forbids.
    - `mine`: the post ids the viewer has themself asked about, so the button can show
      "Asked ✓" without leaking anything about other people's asks.
    """
    ids = [p.id for p in posts]
    if not ids:
        return {}, frozenset()
    own_ids = [p.id for p in posts if p.user_id == viewer.id]
    counts = {}
    if own_ids:
        counts = dict(
            db.query(RecipeRequest.post_id, func.count(RecipeRequest.id))
            .filter(
                RecipeRequest.post_id.in_(own_ids),
                RecipeRequest.state == "pending",
            )
            .group_by(RecipeRequest.post_id)
            .all()
        )
    mine = {
        row.post_id
        for row in db.query(RecipeRequest.post_id).filter(
            RecipeRequest.post_id.in_(ids),
            RecipeRequest.requester_id == viewer.id,
            RecipeRequest.state == "pending",
        )
    }
    return counts, frozenset(mine)


@router.post("", response_model=PostResponse, status_code=status.HTTP_201_CREATED)
def create_post(
    body: PostCreate,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Share a meal: photo + dish name (+ optional line, + optional link to a recipe
    you OWN). Not a recipe — carries no ingredients/steps."""
    recipe_id = None
    if body.recipe_id is not None:
        # Only link a recipe the caller owns and hasn't deleted — never someone
        # else's, and never a tombstone.
        recipe = (
            db.query(Recipe)
            .filter(
                Recipe.id == body.recipe_id,
                Recipe.user_id == current_user.id,
                Recipe.deleted_at.is_(None),
            )
            .first()
        )
        if recipe is None:
            raise HTTPException(status_code=404, detail="Recipe not found")
        recipe_id = recipe.id

    post = Post(
        user_id=current_user.id,
        photo_url=body.photo_url,
        dish_name=body.dish_name.strip(),
        description=(body.description or "").strip() or None,
        recipe_id=recipe_id,
        visibility=body.visibility,
    )
    db.add(post)
    db.commit()
    db.refresh(post)
    # The author owns any linked recipe (verified above), so it's viewable to them.
    return _to_response(
        post, current_user, {recipe_id} if recipe_id else set(), viewer_id=current_user.id
    )


@router.get("/feed", response_model=list[PostResponse])
def feed(
    scope: Literal["friends", "everyone"] = Query(
        default="friends",
        description="'friends' (default) = your accepted friends' posts + your own. "
        "'everyone' = public posts from people you're NOT friends with (discovery); "
        "your own and your friends' posts stay in the 'friends' scope, so the two views "
        "don't overlap.",
    ),
    before_id: int | None = Query(
        default=None,
        description="Cursor: id of the last post on the previous page. Returns the "
        "page of posts older than it.",
    ),
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """The presence feed, in one of two scopes (the friends/everyone toggle, #70).

    KEYSET pagination on `id`, not `created_at`. `id` is a monotonic insertion
    counter and a post's created_at is server-set at that same insert (never
    backdated), so `id DESC` IS reverse-chronological — the same order a
    (created_at DESC, id DESC) sort would give, but from a single exact key. That
    matters because a created_at cursor is fragile: SQLite stores the column as a
    second-granularity TEXT string ("…12:34:56") while a bound datetime renders
    padded ("…12:34:56.000000"), so the string compare mis-orders posts that share
    a second and can skip or repeat one at a page boundary. An integer id cursor has
    none of that — it can't skip or duplicate, on SQLite or Postgres.

    SCOPE = 'friends' (the Phase-1a default): posts by the caller's ACCEPTED friends,
    plus the caller's own, newest first. Own posts are included so an active poster with
    few friends still sees a feed rather than a blank screen (BeReal shows yours too). A
    friend's PRIVATE post is excluded even here — the scope is friends, but a private post
    is theirs alone (can_view_post). friends/public posts show normally.

    SCOPE = 'everyone' (discovery): PUBLIC posts from people the caller is NOT friends
    with, and not their own — the friends scope already covers those, so the two views
    don't overlap. `visibility == "public"` is enforced in SQL (not app-side), because
    that is EXACTLY what can_view_post grants a non-friend viewer (public only — never a
    stranger's 'friends' post, never a 'private' one). So a friends-visibility post can
    never leak into the everyone feed, even though both scopes read the same table."""
    friends = set(friend_ids(current_user.id, db))
    q = db.query(Post).options(selectinload(Post.user))
    if scope == "everyone":
        # Public posts from strangers only: exclude the caller and every accepted friend,
        # so 'everyone' is pure discovery and never duplicates the 'friends' scope. The
        # visibility=='public' predicate is the real privacy boundary — see docstring.
        excluded = friends | {current_user.id}
        q = q.filter(Post.visibility == "public", Post.user_id.notin_(excluded))
    else:
        q = q.filter(Post.user_id.in_(friends | {current_user.id}))
    if before_id is not None:
        q = q.filter(Post.id < before_id)
    posts = q.order_by(Post.id.desc()).limit(FEED_PAGE).all()
    # Defense-in-depth: re-gate every row through the single read rule regardless of
    # scope. In 'friends' scope every author is the caller or an accepted friend, so the
    # viewer↔author friendship is known — pass it in so a "friends" post isn't re-queried
    # per row (this still drops a friend's PRIVATE post). In 'everyone' scope the authors
    # are non-friends, so is_friend is False and only their 'public' posts pass — which
    # the SQL already guaranteed; the check is a belt-and-suspenders assertion of that.
    hidden = blocked_ids(current_user.id, db)
    posts = [
        p
        for p in posts
        if can_view_post(
            p, current_user, db, is_friend=p.user_id in friends, blocked=p.user_id in hidden
        )
    ]
    viewable = _viewable_recipe_ids(posts, current_user, db)
    counts, mine = _request_context(posts, current_user, db)
    # The feed is the only surface where "new" means anything (#97). Read the caller's mark
    # here and pass it down; advancing it is a separate explicit call (POST /posts/feed/seen),
    # never a side effect of this GET — a read that mutates would mark posts seen on a stray
    # prefetch or a retry, and being accurate about what you actually looked at is the point.
    last_seen = current_user.last_feed_seen_post_id
    return [
        _to_response(
            p, p.user, viewable,
            viewer_id=current_user.id, request_counts=counts, my_requested_post_ids=mine,
            # Friends scope only. On `everyone` the client deliberately never advances the
            # mark (it isn't a feed you catch up on), so an is_new computed there would be
            # measured against the FRIENDS watermark and freeze in one place forever — a
            # "caught up" claim about a tab you never caught up on.
            last_seen_post_id=last_seen, mark_new=(scope != "everyone"),
        )
        for p in posts
    ]


@router.post("/feed/seen", status_code=status.HTTP_204_NO_CONTENT)
def mark_feed_seen(
    body: FeedSeenIn | None = None,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Advance the caller's feed read-mark (#97).

    A separate call rather than a side effect of GET /posts/feed, for the same reason
    POST /notifications/read exists: a GET that mutates marks things seen on a prefetch, a
    retry or a back-navigation, and this only has value if it is accurate. It also lets the
    client choose the moment.

    FORWARD ONLY. The mark is monotonic — a stale or out-of-order call (two tabs, a retried
    request, a client sending an older page) can never rewind it and resurface posts the user
    already read as new. That also means this endpoint is safely idempotent.

    Note what this does NOT do: nothing is deleted, hidden or expired. The feed returns exactly
    the same posts afterwards; they just stop being flagged `is_new`.
    """
    mark = body.through_post_id if body is not None else None
    if mark is None:
        # No id, nothing to do. Deliberately NOT "mark everything that exists": that branch
        # would watermark past strangers' and blocked users' posts, suppressing is_new for a
        # backlog the caller has never been shown. The client never calls without an id.
        return None

    # CLAMP to a real post id. Two distinct problems, both reachable by any authenticated
    # caller: the column is int4 on Postgres, so an id above 2^31 raises NumericValueOutOfRange
    # — a 500 that no SQLite test can catch, since SQLite has no such ceiling. And because the
    # mark is forward-only BY DESIGN, a single call with a huge id would permanently leave that
    # account with "nothing is ever new", unfixable without a manual database edit. Clamping
    # keeps the no-404 decision (an out-of-range id is still not confirmed either way) while
    # making the value harmless. `ge=1` on the schema handles negatives and zero.
    newest = db.query(func.max(Post.id)).scalar()
    if newest is None:
        return None  # no posts exist at all; nothing to mark
    mark = min(mark, newest)

    # FORWARD ONLY, enforced in the UPDATE rather than by read-then-write. Two tabs both
    # reading `current` and then writing could otherwise land the lower value last — harmless
    # (a re-shown divider) but it made the docstring's "can never rewind it" merely usually
    # true. One conditional statement makes it literally true.
    db.query(User).filter(
        User.id == current_user.id,
        or_(
            User.last_feed_seen_post_id.is_(None),
            User.last_feed_seen_post_id < mark,
        ),
    ).update({"last_feed_seen_post_id": mark}, synchronize_session=False)
    db.commit()
    return None


@router.get("/browse", response_model=list[PostResponse])
def browse_posts(
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Public posts for discovery in Browse (#71) — the post counterpart of
    GET /recipes/browse, and deliberately the same SHAPE as it: return every public post
    (newest first) and let the client filter/search, rather than paginating. Scoped in SQL
    to `visibility == "public"`, the same public-only boundary Browse uses for recipes and
    the everyone-feed uses for posts: a 'friends' or 'private' post can never surface here,
    whoever the viewer is. Unlike the feed's 'everyone' scope this does NOT exclude the
    caller's own or friends' public posts — Browse is discovery of what's public, not a
    social feed, so there's no overlap rule to keep.

    NOT capped: the Meals tab searches client-side, so a cap would silently hide older
    public meals from search (the #71 review caught exactly this). Load-all matches
    /recipes/browse; both share the "loads everything, filters in Python, wants pagination
    + server-side search once the corpus grows" debt (see TECHDEBT.md), accepted at
    current scale.

    Registered ABOVE /{post_id} so the literal 'browse' path isn't captured as an id."""
    posts = (
        db.query(Post)
        .options(selectinload(Post.user))
        .filter(Post.visibility == "public")
        .order_by(Post.id.desc())
        .all()
    )
    # Belt-and-suspenders: re-gate through the single read rule. Every row is already
    # public, so can_view_post passes each regardless of the viewer — but routing all
    # reads through one rule keeps "who can see a post" defined in exactly one place.
    # `/posts/browse` is deliberately uncapped, so a per-row block query would grow with the
    # whole public corpus. One lookup for the page (#85).
    hidden = blocked_ids(current_user.id, db)
    posts = [
        p
        for p in posts
        if can_view_post(p, current_user, db, blocked=p.user_id in hidden)
    ]
    viewable = _viewable_recipe_ids(posts, current_user, db)
    counts, mine = _request_context(posts, current_user, db)
    return [
        _to_response(
            p, p.user, viewable,
            viewer_id=current_user.id, request_counts=counts, my_requested_post_ids=mine,
        )
        for p in posts
    ]


@router.get("/requests/incoming", response_model=list[PostWithRequesters])
def incoming_requests(
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """The cook's asks: every post of THEIRS with at least one pending request, and who asked.

    Scoped to `Post.user_id == current_user.id`, which is what makes returning requester
    names here consistent with keeping the count private everywhere else — the cook is the
    one audience entitled to it.

    Declared BEFORE `/{post_id}` so the literal path isn't parsed as a post id.
    """
    rows = (
        db.query(RecipeRequest, Post, User)
        .join(Post, Post.id == RecipeRequest.post_id)
        .join(User, User.id == RecipeRequest.requester_id)
        .filter(Post.user_id == current_user.id, RecipeRequest.state == "pending")
        .order_by(RecipeRequest.created_at.desc(), RecipeRequest.id.desc())
        .all()
    )
    by_post: dict = {}
    for req, post, requester in rows:
        entry = by_post.setdefault(post.id, {"post": post, "requesters": []})
        entry["requesters"].append(
            RequesterSummary(
                user_id=requester.id,
                first_name=requester.first_name,
                last_name=requester.last_name,
                photo_url=requester.photo_url,
                created_at=req.created_at,
            )
        )
    if not by_post:
        return []
    posts = [e["post"] for e in by_post.values()]
    viewable = _viewable_recipe_ids(posts, current_user, db)
    counts, mine = _request_context(posts, current_user, db)
    return [
        PostWithRequesters(
            post=_to_response(
                e["post"], current_user, viewable,
                viewer_id=current_user.id, request_counts=counts, my_requested_post_ids=mine,
            ),
            requesters=e["requesters"],
        )
        for e in by_post.values()
    ]


@router.post(
    "/{post_id}/request", response_model=PostResponse, status_code=status.HTTP_201_CREATED
)
def request_recipe(
    post_id: int,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Ask the cook for the recipe behind this meal (#79) — the app's premise as a mechanic.

    WHO MAY ASK: anyone who can already SEE the post (`can_view_post`). Deliberately not
    friends-only: #71 put public meals in Browse precisely so a stranger could find your
    dish, and a dead end there would undo that. So the guard is "can you see it", not a
    second rule.

    WHAT MAY BE ASKED FOR: any post where the CALLER cannot currently read a recipe for it.
    That is one state, not two — the post response nulls `recipe_id` for a recipe the caller
    may not read, so "the cook never wrote it down" and "the cook wrote it and kept it
    private" are indistinguishable from outside, and the button carries no information
    either way. No copy anywhere says a recipe exists but is withheld; that sentence is the
    social pressure this design avoids. The cook keeps control: ignore the ask, or fulfil it
    — and fulfilling a private recipe mints grants WITHOUT changing its visibility.

    Rejected when the caller can already read the linked recipe: there is nothing to ask
    for, and the request could never be satisfied by fulfilment.

    Idempotent — asking twice returns the post unchanged rather than adding a row (unique on
    the pair), and the IntegrityError branch covers two taps racing.
    """
    post = db.query(Post).filter(Post.id == post_id).first()
    if post is None or not can_view_post(post, current_user, db):
        # 404 not 403 — never confirm a post exists to someone not entitled to it.
        raise HTTPException(status_code=404, detail="Post not found")
    if post.user_id == current_user.id:
        raise HTTPException(status_code=400, detail="It's your own recipe to write.")

    viewable = _viewable_recipe_ids([post], current_user, db)
    if post.recipe_id is not None and post.recipe_id in viewable:
        raise HTTPException(status_code=400, detail="The recipe for this is already here.")

    existing = (
        db.query(RecipeRequest)
        .filter(
            RecipeRequest.post_id == post.id,
            RecipeRequest.requester_id == current_user.id,
        )
        .first()
    )
    # Three states, not two. The unique (post, requester) pair means a FULFILLED row is
    # still there after delivery — and treating that as "already asked" left the button
    # permanently dead: `_request_context` counts only pending rows, so the card re-rendered
    # as "Ask for the recipe" while this endpoint returned 201 and did nothing, forever,
    # with no error and no notification to the cook. Reachable purely through the UI: ask →
    # cook fulfils → the cook later fulfils the same post with a DIFFERENT recipe you can't
    # read → your card offers the ask again. Re-opening the existing row is the fix (a second
    # row is impossible), and it is also the correct meaning: you are asking again.
    if existing is None:
        db.add(RecipeRequest(post_id=post.id, requester_id=current_user.id))
        notify(
            db,
            user_id=post.user_id,
            type="recipe_request",
            actor_id=current_user.id,
            post_id=post.id,
            # An unread "X asked for your Y" already in the inbox says everything a second
            # one would. Without this, ask/retract/ask is an unbounded inbox flood.
            dedupe=True,
        )
        try:
            db.commit()
        except IntegrityError:
            # Two taps raced the unique pair constraint. One request is the right outcome.
            db.rollback()
    elif existing.state == "fulfilled":
        existing.state = "pending"
        notify(
            db,
            user_id=post.user_id,
            type="recipe_request",
            actor_id=current_user.id,
            post_id=post.id,
            # An unread "X asked for your Y" already in the inbox says everything a second
            # one would. Without this, ask/retract/ask is an unbounded inbox flood.
            dedupe=True,
        )
        db.commit()
    counts, mine = _request_context([post], current_user, db)
    return _to_response(
        post, post.user, viewable,
        viewer_id=current_user.id, request_counts=counts, my_requested_post_ids=mine,
    )


@router.delete(
    "/{post_id}/request",
    response_model=PostResponse,
    # 204 is the no-read case below: the caller withdrew an ask on a post they can no longer
    # see, so there is nothing to hand back. Declared here so the schema says so.
    responses={204: {"description": "Withdrawn; the post is no longer visible to you"}},
)
def retract_request(
    post_id: int,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Take back your ask. Only ever removes the CALLER'S OWN row, and only a pending one —
    a fulfilled request is the record that a recipe was handed over, not a live ask.

    Deliberately does NOT delete the cook's notification: they were told something true, and
    un-telling it would be rewriting history inside someone else's inbox.

    NO READ CHECK, unlike every other route on a post — deliberately, and it's the one place
    that asymmetry is right. `can_view_post` guarded this until review pointed out what that
    costs: ask on a public meal, watch the cook set it to friends-only or private (one tap since
    `PATCH /posts/{id}`, and already possible via the profile-wide sweep), and your own pending
    ask becomes permanent — 404 on the post AND 404 on withdrawing it, with the cook still
    looking at your name on /requests forever. Taking back a row you created is not a read of
    someone else's content, so it doesn't answer to their visibility. The delete is still scoped
    to `requester_id == caller` and `state == "pending"`.

    It is a PENDING ROW **or** read access, though — not neither. Dropping the check outright
    would have turned this route into a peephole: anyone could poll DELETE on any id and read a
    private post's dish name, photo and author out of the response body. Holding a pending ask is
    the credential.

    AND WHEN THE ROW IS THE ONLY CREDENTIAL, THERE IS NO BODY — 204, not 200. The tempting
    argument is that you could see the post when you asked, so handing the same body back
    discloses nothing new. `PATCH /posts/{id}` made that false in the very same branch that
    made this route reachable: the cook can now rename the dish and rewrite the description in
    the same call that hides it, so the body you'd get back is content that was never on your
    screen. Nothing needs it anyway — both clients read exactly one field off this response
    (`requested_by_me`), and after a successful retract that field is false, which is what an
    absent body already means to them.
    """
    post = db.query(Post).filter(Post.id == post_id).first()
    if post is None:
        raise HTTPException(status_code=404, detail="Post not found")
    my_ask = (
        db.query(RecipeRequest)
        .filter(
            RecipeRequest.post_id == post.id,
            RecipeRequest.requester_id == current_user.id,
            RecipeRequest.state == "pending",
        )
        .first()
    )
    readable = can_view_post(post, current_user, db)
    if my_ask is None and not readable:
        raise HTTPException(status_code=404, detail="Post not found")
    if my_ask is not None:
        db.delete(my_ask)
    db.commit()
    if not readable:
        return Response(status_code=204)
    viewable = _viewable_recipe_ids([post], current_user, db)
    counts, mine = _request_context([post], current_user, db)
    return _to_response(
        post, post.user, viewable,
        viewer_id=current_user.id, request_counts=counts, my_requested_post_ids=mine,
    )


@router.post("/{post_id}/fulfill", response_model=PostResponse)
def fulfill_post(
    post_id: int,
    body: FulfillRequest,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Answer the asks on your own post with one of your recipes (#79).

    The delivery mechanism is the EXISTING handoff grant: for each pending requester, mint
    `Handoff(recipe_id, from_user_id=author, to_user_id=requester, state='accepted')`. That
    is why this works on a private recipe without touching its visibility — a grant is
    orthogonal to `visibility` in `can_view`, exactly as a hand-off has always been. The
    recipe also lands at the top of each requester's Kept shelf (which sorts by when it was
    shelved), so delivery is visible even before the notification is read.

    Author-only, and the recipe must be the author's own — a `user_id` filter, not
    `can_view`: read is not write, and you can only hand over what's yours.

    Idempotent: an existing accepted grant is never duplicated, and already-fulfilled
    requests are skipped.

    Attaching the recipe to the post is part of the same act, so later viewers who CAN read
    it get the "See the recipe" link rather than a request button. Nothing here widens the
    recipe's own visibility.

    A post links ONE recipe while grants are per-person, so fulfilling the same post twice
    with different recipes repoints the link: the first requester keeps their grant and finds
    the dish on their Kept shelf, but the post's link now names the newer recipe, which they
    may not be able to read. Deliberate — the link should show the cook's latest answer — and
    survivable, because the grant, not the link, is what carries access.
    """
    post = db.query(Post).filter(Post.id == post_id, Post.user_id == current_user.id).first()
    if post is None:
        raise HTTPException(status_code=404, detail="Post not found")
    recipe = (
        db.query(Recipe)
        .filter(
            Recipe.id == body.recipe_id,
            Recipe.user_id == current_user.id,
            Recipe.deleted_at.is_(None),
        )
        .first()
    )
    if recipe is None:
        raise HTTPException(status_code=404, detail="Recipe not found")

    pending = (
        db.query(RecipeRequest)
        .filter(RecipeRequest.post_id == post.id, RecipeRequest.state == "pending")
        .all()
    )
    # Who already holds a grant for this recipe, so a re-run can't stack duplicates.
    already = {
        row.to_user_id
        for row in db.query(Handoff.to_user_id).filter(
            Handoff.recipe_id == recipe.id,
            Handoff.state == "accepted",
            Handoff.to_user_id.isnot(None),
        )
    }
    for req in pending:
        if req.requester_id != current_user.id and req.requester_id not in already:
            db.add(
                Handoff(
                    recipe_id=recipe.id,
                    from_user_id=current_user.id,
                    to_user_id=req.requester_id,
                    state="accepted",
                )
            )
            already.add(req.requester_id)
        req.state = "fulfilled"
        notify(
            db,
            user_id=req.requester_id,
            type="request_fulfilled",
            actor_id=current_user.id,
            post_id=post.id,
            recipe_id=recipe.id,
        )
    post.recipe_id = recipe.id
    db.commit()
    db.refresh(post)
    counts, mine = _request_context([post], current_user, db)
    return _to_response(
        post, current_user, {recipe.id},
        viewer_id=current_user.id, request_counts=counts, my_requested_post_ids=mine,
    )


@router.get("/{post_id}", response_model=PostResponse)
def get_post(
    post_id: int,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """A single post — visible per the one post rule (can_view_post): the author, a
    friend on an inherit/private-profile post, or ANYONE on a force-public post (that's
    how a private-profile user surfaces one meal). A viewer who fails the rule gets 404,
    not 403 — don't confirm the post exists to someone not entitled to see it."""
    post = (
        db.query(Post)
        .options(selectinload(Post.user))
        .filter(Post.id == post_id)
        .first()
    )
    if post is None or post.user is None:
        # The FK cascade means a surviving post always has an author; guard anyway.
        raise HTTPException(status_code=404, detail="Post not found")
    if not can_view_post(post, current_user, db):
        raise HTTPException(status_code=404, detail="Post not found")
    viewable = _viewable_recipe_ids([post], current_user, db)
    counts, mine = _request_context([post], current_user, db)
    return _to_response(
        post, post.user, viewable,
        viewer_id=current_user.id, request_counts=counts, my_requested_post_ids=mine,
    )


@router.patch("/{post_id}", response_model=PostResponse)
def update_post(
    post_id: int,
    body: PostUpdate,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Edit your own meal. Author-only; a non-author (or unknown id) gets 404, not 403 — same
    answer `delete_post` gives, so neither confirms the post exists to someone not entitled.

    READ IS NOT WRITE: a friend can see this post and can never edit it. The ownership filter
    here is the whole authorization question, exactly as in `delete_post` and `patch_recipe`.

    What editing does NOT do:
      - It does not change the author. A post is "I made this"; reassigning it makes that false.
      - It does not touch the read-mark. An edit is not a new post, so it must not resurface in
        anyone's "new since you last looked" (#97) — `is_new` keys on the post's id, which
        doesn't move, so this is true by construction rather than by a guard.
      - It does not notify anyone. Nobody asked to hear that a caption changed.
      - It does not touch the attached recipe. Attaching one to a post people ASKED about is
        answering them — which is `POST /{post_id}/fulfill`'s whole job, grants and
        notifications included. Attaching here would leave every ask pending behind an
        already-attached recipe.

    THE PHOTO *IS* EDITABLE, since #106, reversing #98 on the owner's call. What changed is not
    the argument — a different photo really can be a different meal — but which failure it was
    optimising for. Delete-and-repost was the only remedy for a photo that came out badly, and it
    throws away the post's date, its position in every feed, and any recipe asks already on it;
    that cost lands on the person who was ALREADY sharing. The #98 objection that the field had
    no host check is answered rather than dodged: it goes through
    `services/media.require_our_image_url`, the same rule `PATCH /auth/me` uses, which is now one
    function instead of two inline copies. There is deliberately no way to CLEAR the photo —
    `Post.photo_url` is `nullable=False`, so a blank value is a 422, not a removal.

    One thing it CAN do that's worth knowing: lowering visibility (public -> private) hides the
    post from anyone who asked and isn't a friend. Their ask survives, and `fulfill` still
    delivers to them — the cook chose to answer, and a grant is orthogonal to visibility. What
    they lose is the post, not the recipe; `retract_request` deliberately doesn't require read
    access so they can still withdraw the ask.
    """
    post = db.query(Post).filter(Post.id == post_id).first()
    if post is None or post.user_id != current_user.id:
        raise HTTPException(status_code=404, detail="Post not found")

    if body.dish_name is not None:
        post.dish_name = body.dish_name.strip()
    if body.description is not None:
        # "" clears it back to NULL; None above meant "unchanged".
        post.description = body.description.strip() or None
    if body.visibility is not None:
        post.visibility = body.visibility
    if body.photo_url is not None:
        # Host-checked, because this string is rendered as an <img src> to every friend who sees
        # the post. Raises 422 for anything that isn't one of our own uploads — including a blank
        # value, which would otherwise violate the column's NOT NULL.
        post.photo_url = require_our_image_url(body.photo_url, what="photo")

    db.commit()
    db.refresh(post)
    viewable = _viewable_recipe_ids([post], current_user, db)
    counts, mine = _request_context([post], current_user, db)
    return _to_response(
        post, current_user, viewable,
        viewer_id=current_user.id, request_counts=counts, my_requested_post_ids=mine,
    )


@router.delete("/{post_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_post(
    post_id: int,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Author-only. Read is not write — a friend can see a post, never delete it.
    A non-author (or unknown id) gets 404, not 403."""
    post = db.query(Post).filter(Post.id == post_id).first()
    if post is None or post.user_id != current_user.id:
        raise HTTPException(status_code=404, detail="Post not found")

    # NOTE the asks on this post cascade away with it (RecipeRequest.post_id is CASCADE) but
    # their NOTIFICATIONS deliberately do not: `Notification.post_id` is SET NULL because the
    # ask genuinely happened, so the line stays and merely stops being a link (#79, pinned by
    # test_a_notification_survives_its_post_being_deleted). The client is what has to honour
    # that — a `recipe_request` row with a null `post_id` must not link to /requests, which
    # would now be empty.
    db.delete(post)
    db.commit()
    return None


@router.get("/users/{user_id}", response_model=list[PostResponse])
def user_posts(
    user_id: int,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """A user's posts, for their profile grid, filtered by the one post rule
    (can_view_post): your own → all; a friend → their friends + public posts (never a
    private one); a non-friend → only the user's public posts (a private-profile user's
    public meals still show on their profile). A non-friend on a fully-private profile
    just sees an empty grid — not a 404, since the profile itself is reachable."""
    author = db.query(User).filter(User.id == user_id).first()
    if author is None:
        raise HTTPException(status_code=404, detail="User not found")
    posts = (
        db.query(Post)
        .options(selectinload(Post.user))
        .filter(Post.user_id == user_id)
        # id DESC == reverse-chron here too (see feed()); one consistent ordering key.
        .order_by(Post.id.desc())
        .limit(FEED_PAGE)
        .all()
    )
    # The viewer↔profile-owner friendship is invariant across every post — resolve it
    # once (or trivially for one's own profile) rather than per row.
    is_friend = user_id == current_user.id or are_friends(current_user.id, user_id, db)
    # One author, so the block is invariant across the grid — resolve it once (#85).
    blocked = is_blocked(current_user.id, user_id, db)
    posts = [
        p
        for p in posts
        if can_view_post(p, current_user, db, is_friend=is_friend, blocked=blocked)
    ]
    viewable = _viewable_recipe_ids(posts, current_user, db)
    counts, mine = _request_context(posts, current_user, db)
    return [
        _to_response(
            p, p.user, viewable,
            viewer_id=current_user.id, request_counts=counts, my_requested_post_ids=mine,
        )
        for p in posts
    ]
