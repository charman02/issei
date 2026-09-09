from typing import Literal

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import func, or_
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.database import get_db
from app.auth import get_current_user
from app.models.user import User
from app.models.recipe import Recipe
from app.models.post import Post
from app.models.handoff import Handoff
from app.models.friendship import Friendship
from app.models.block import Block
from app.models.report import Report
from app.schemas.friend import (
    BlockRequestIn,
    BlockedPerson,
    DiscoverPerson,
    FriendRequestIn,
    FriendResponse,
    FriendSuggestion,
    ProfileResponse,
)
from app.schemas.report import ReportUserIn
from app.services.blocks import blocked_ids, is_blocked
from app.services.friends import existing_friendship, friend_ids
from app.services.notifications import ANONYMOUS_TYPES, notify
from app.services.sharing import can_view, can_view_post

router = APIRouter(prefix="/friends", tags=["friends"])

# Cap on the app-wide directory (GET /friends/discover). Generous at today's scale and a
# hard ceiling on the response either way; the search box is what makes a longer list
# navigable, so this never needs to grow into "return everyone".
DISCOVER_LIMIT = 50


def _to_friend_response(f: Friendship, me_id: int, users_by_id: dict) -> FriendResponse:
    """Render a Friendship from the caller's perspective: the OTHER person, and
    whether the caller sent it (so a pending outgoing request shows 'Requested'
    rather than an accept button)."""
    other_id = f.addressee_id if f.requester_id == me_id else f.requester_id
    u = users_by_id[other_id]
    return FriendResponse(
        id=f.id,
        state=f.state,
        user_id=other_id,
        first_name=u.first_name,
        last_name=u.last_name,
        photo_url=u.photo_url,
        outgoing=f.requester_id == me_id,
        created_at=f.created_at,
    )


def _users_by_id(ids, db):
    if not ids:
        return {}
    rows = db.query(User).filter(User.id.in_(set(ids))).all()
    return {u.id: u for u in rows}


@router.post("/request", response_model=FriendResponse, status_code=status.HTTP_201_CREATED)
def request_friend(
    body: FriendRequestIn,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Send a friend request. Idempotent-ish and safe against races:
    - can't friend yourself,
    - if a row already exists in EITHER direction, return it (a reverse-direction
      pending request from the other person is effectively accepted by requesting
      back — mirrors how a mutual intent should resolve),
    - target must exist.
    """
    if body.to_user_id == current_user.id:
        raise HTTPException(status_code=400, detail="You can’t friend yourself.")
    target = db.query(User).filter(User.id == body.to_user_id).first()
    if target is None:
        raise HTTPException(status_code=404, detail="User not found")
    # A block, either direction, and the answer is the same 404 a missing user gets (#85).
    # Never a distinct code or message: a blocked person must not be able to tell a block
    # from a deleted account, which is the whole point of blocking silently.
    if is_blocked(current_user.id, body.to_user_id, db):
        raise HTTPException(status_code=404, detail="User not found")

    existing = existing_friendship(current_user.id, body.to_user_id, db)
    if existing is not None:
        # A reverse pending request already waiting from them → requesting back
        # accepts it, so both intents are honoured without a second row.
        if existing.state == "pending" and existing.addressee_id == current_user.id:
            existing.state = "accepted"
            # Requesting back is an accept, so the original requester hears the same thing
            # they'd hear from the accept endpoint (#79's one inbox).
            notify(
                db,
                user_id=existing.requester_id,
                type="friend_accept",
                actor_id=current_user.id,
            )
            db.commit()
            db.refresh(existing)
        return _to_friend_response(
            existing, current_user.id, _users_by_id([current_user.id, body.to_user_id], db)
        )

    f = Friendship(
        requester_id=current_user.id, addressee_id=body.to_user_id, state="pending"
    )
    f.set_pair()
    db.add(f)
    notify(db, user_id=body.to_user_id, type="friend_request", actor_id=current_user.id)
    try:
        db.commit()
    except IntegrityError:
        # A concurrent request for the same unordered pair won the race and tripped
        # uq_friendship_pair. Roll back and return whichever row exists now, so a
        # double-tap or a simultaneous reverse request resolves to one friendship
        # instead of a 500 or a duplicate. (The DB constraint is the real guard;
        # the earlier existing_friendship check just avoids the round-trip.)
        db.rollback()
        winner = existing_friendship(current_user.id, body.to_user_id, db)
        if winner is None:
            raise  # genuinely unexpected — don't swallow it
        return _to_friend_response(
            winner, current_user.id, _users_by_id([current_user.id, body.to_user_id], db)
        )
    db.refresh(f)
    return _to_friend_response(
        f, current_user.id, _users_by_id([current_user.id, body.to_user_id], db)
    )


@router.post("/{friendship_id}/accept", response_model=FriendResponse)
def accept_friend(
    friendship_id: int,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Accept a pending request. ONLY the addressee may accept — the requester
    accepting their own request would be a self-grant."""
    f = db.query(Friendship).filter(Friendship.id == friendship_id).first()
    if f is None:
        raise HTTPException(status_code=404, detail="Request not found")
    if f.addressee_id != current_user.id:
        # 404 not 403 — don't reveal a request exists to someone not party to it.
        raise HTTPException(status_code=404, detail="Request not found")
    # `request_friend` refuses across a block and `block_user` deletes pending rows, but the
    # two aren't serialized — a request that landed between the two statements would still be
    # sitting here. No content leaks either way (can_view checks the block before the friends
    # branch), but a blocked person would show up in `GET /friends` as an accepted friend.
    if is_blocked(current_user.id, f.requester_id, db):
        raise HTTPException(status_code=404, detail="Request not found")
    if f.state != "accepted":
        f.state = "accepted"
        notify(db, user_id=f.requester_id, type="friend_accept", actor_id=current_user.id)
        db.commit()
        db.refresh(f)
    return _to_friend_response(
        f, current_user.id, _users_by_id([f.requester_id, f.addressee_id], db)
    )


@router.delete("/{friendship_id}", status_code=status.HTTP_204_NO_CONTENT)
def remove_friend(
    friendship_id: int,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Unfriend, decline a request, or cancel one you sent. Either party may do it;
    a non-party gets a 404 (can't probe for others' friendships)."""
    f = db.query(Friendship).filter(Friendship.id == friendship_id).first()
    if f is None:
        raise HTTPException(status_code=404, detail="Not found")
    if current_user.id not in (f.requester_id, f.addressee_id):
        raise HTTPException(status_code=404, detail="Not found")
    db.delete(f)
    db.commit()
    return None


@router.get("", response_model=list[FriendResponse])
def list_friends(
    order: Literal["recent", "active"] = Query(
        default="recent",
        description="'recent' (default) = newest friendship first, for the Friends "
        "management page. 'active' = friends who posted most recently first (the Feed's "
        "presence strip); friends with no visible post fall back to friendship recency.",
    ),
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """The caller's ACCEPTED friends.

    Two orderings, same rows. `recent` sorts by when the friendship formed (what the
    Friends page has always shown). `active` sorts by each friend's most recent VISIBLE
    post, so the Feed's avatar strip surfaces who's been cooking lately (#75).

    Privacy — enforced here at the query layer, not the UI: the activity scan counts only
    posts with `visibility != 'private'`. Every row is an ACCEPTED friend, and for an
    accepted friend that is exactly what `can_view_post` permits (their public + friends
    posts, never their private ones). So a friend's private post can never move them up
    the caller's strip — which would itself leak that a hidden post exists. This endpoint
    stays a re-presentation of friendships the caller is already party to; no post content
    or count is returned, only the sort changes."""
    rows = (
        db.query(Friendship)
        .filter(
            Friendship.state == "accepted",
            or_(
                Friendship.requester_id == current_user.id,
                Friendship.addressee_id == current_user.id,
            ),
        )
        .order_by(Friendship.created_at.desc())
        .all()
    )
    ids = [f.addressee_id if f.requester_id == current_user.id else f.requester_id for f in rows]
    users = _users_by_id(ids, db)

    if order == "active" and ids:
        # Each friend's latest visible post, keyed by MAX(Post.id) not MAX(created_at):
        # ids are monotonic and posts are never backdated, so the largest id IS the most
        # recent post (the same reasoning the feed's keyset pagination relies on), and it
        # comes back as a plain int on both SQLite and Postgres — no aggregate-over-
        # datetime dialect surprises. `visibility != 'private'` is the read-authorization
        # filter (see the docstring); a friend with no visible post isn't in this map.
        latest = dict(
            db.query(Post.user_id, func.max(Post.id))
            .filter(
                Post.user_id.in_(ids),
                Post.visibility != "private",
            )
            .group_by(Post.user_id)
            .all()
        )
        # Sort friends by (has a visible post, then how recent it is) — both descending —
        # so recent posters lead and quiet friends keep their friendship-recency order
        # behind them. `rows` is already friendship-newest-first, and Python's sort is
        # stable, so friends who tie on activity (e.g. all the never-posted ones at 0)
        # preserve that original order for free.
        rows = sorted(
            rows,
            key=lambda f: latest.get(
                f.addressee_id if f.requester_id == current_user.id else f.requester_id,
                0,
            ),
            reverse=True,
        )

    return [_to_friend_response(f, current_user.id, users) for f in rows]


@router.get("/requests", response_model=list[FriendResponse])
def list_incoming_requests(
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Pending requests addressed TO the caller — the ones they can accept."""
    rows = (
        db.query(Friendship)
        .filter(
            Friendship.state == "pending",
            Friendship.addressee_id == current_user.id,
        )
        .order_by(Friendship.created_at.desc())
        .all()
    )
    users = _users_by_id([f.requester_id for f in rows], db)
    return [_to_friend_response(f, current_user.id, users) for f in rows]


@router.get("/suggestions", response_model=list[FriendSuggestion])
def friend_suggestions(
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """People to suggest friending, drawn from the HANDOFF GRAPH — anyone the caller
    handed a recipe to (accepted handoff, to_user_id set) or received one from — who
    isn't already a friend or in a pending request with them. This is the cold-start
    seed: the people you've exchanged recipes with are a real trust graph. Nobody
    else is suggested (no stranger discovery)."""
    # Recipes I own, handed to someone (I → them).
    sent_rows = (
        db.query(Handoff.to_user_id)
        .join(Recipe, Recipe.id == Handoff.recipe_id)
        .filter(
            Recipe.user_id == current_user.id,
            Handoff.to_user_id.isnot(None),
            Handoff.to_user_id != current_user.id,
            Handoff.state == "accepted",
        )
        .all()
    )
    # Recipes handed TO me by their owner (them → I).
    received_rows = (
        db.query(Handoff.from_user_id)
        .filter(
            Handoff.to_user_id == current_user.id,
            Handoff.from_user_id != current_user.id,
            Handoff.state == "accepted",
        )
        .all()
    )

    # Reason: 'sent' takes precedence if both (you cooked for them AND vice versa).
    reason_by_id: dict[int, str] = {}
    for (uid,) in received_rows:
        reason_by_id.setdefault(uid, "received")
    for (uid,) in sent_rows:
        reason_by_id[uid] = "sent"

    # Drop anyone already a friend or in a pending request (either direction).
    existing = (
        db.query(Friendship.requester_id, Friendship.addressee_id)
        .filter(
            or_(
                Friendship.requester_id == current_user.id,
                Friendship.addressee_id == current_user.id,
            )
        )
        .all()
    )
    entangled = set()
    for r_id, a_id in existing:
        entangled.add(a_id if r_id == current_user.id else r_id)
    # ...and anyone blocked either way (#85). This is the one friend endpoint where the block
    # is easy to miss: blocking deletes the friendship and the pending asks, but deliberately
    # does NOT delete handoffs — and handoffs are exactly what this list is seeded from. So
    # the block REMOVES the only thing that was excluding them, and the person you blocked
    # reappears here as a suggestion precisely BECAUSE you once handed them a recipe.
    entangled |= blocked_ids(current_user.id, db)

    candidate_ids = [uid for uid in reason_by_id if uid not in entangled]
    users = _users_by_id(candidate_ids, db)
    out = []
    for uid in candidate_ids:
        u = users.get(uid)
        if u is None:
            continue
        out.append(
            FriendSuggestion(
                user_id=uid,
                first_name=u.first_name,
                last_name=u.last_name,
                photo_url=u.photo_url,
                reason=reason_by_id[uid],
            )
        )
    return out


@router.post("/reports", status_code=status.HTTP_204_NO_CONTENT)
def report_user(
    body: ReportUserIn,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Report a person for review (#87). The other half of blocking.

    A block is something you do FOR YOURSELF and it works instantly; a report goes to whoever
    runs the app and works when a human looks. Only having the first leaves someone free to move
    on to the next person, which is why both exist and why they live side by side in the UI.
    It's also a hard App Store requirement (Guideline 1.2) for an app carrying user content.

    THREE THINGS HERE ARE DELIBERATE, and each looks wrong from one angle:

    1. **No block check, in either direction.** Every other route in this file consults
       `is_blocked`; this one must not. Otherwise someone harasses you, blocks you, and becomes
       permanently unreportable — the block becoming cover for the person who earned it. That is
       the single most important case this endpoint serves, so it is pinned by a test.

    2. **204, and the reported person is never told.** No notification, nothing. Telling them
       turns a safety mechanism into an escalation trigger, and the person most likely to
       retaliate is the person most likely to be reported. Same reasoning that keeps a block
       silent and a keep anonymous: the app doesn't manufacture contact nobody asked for.

    3. **One OPEN report per reporter per person.** A second tap while one is still open is
       accepted and thrown away rather than stored, so the table can't be flooded and a
       moderator sees one row per grievance. Deduped in Python rather than by a UNIQUE
       constraint, because the rule has a state predicate in it (`state == "open"`) and a
       constraint can't express that — the same reason `notify()` dedupes here rather than in
       the schema. A report filed after the first was CLOSED is a new report, correctly: it
       means it happened again.

    404 for an unknown user id, matching `/friends/profile/{id}`. 400 for reporting yourself —
    not a 404, because there is nothing to hide about your own existence and a silent success
    would be a worse answer than an honest refusal.
    """
    if body.user_id == current_user.id:
        raise HTTPException(status_code=400, detail="You can’t report yourself")

    target = db.query(User).filter(User.id == body.user_id).first()
    if target is None:
        raise HTTPException(status_code=404, detail="User not found")

    already = (
        db.query(Report.id)
        .filter(
            Report.reporter_id == current_user.id,
            Report.reported_user_id == body.user_id,
            Report.state == "open",
        )
        .first()
    )
    if already is None:
        note = (body.note or "").strip() or None
        db.add(
            Report(
                reporter_id=current_user.id,
                reported_user_id=body.user_id,
                reason=body.reason,
                note=note,
            )
        )
        db.commit()
    # Either way the caller gets the same 204. Whether this was their first report or their
    # fifth is not information the UI needs, and "you already reported this person" is a
    # sentence that makes someone doubt the first one landed.
    return None


@router.get("/blocks", response_model=list[BlockedPerson])
def list_blocks(
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """People the CALLER has blocked — their own list, so they can undo it.

    Only rows where the caller is the blocker. Deliberately NOT "everyone you're blocked
    from": telling you who has blocked you is information you're not entitled to, and it
    would make blocking useless as protection.
    """
    rows = (
        db.query(Block, User)
        .join(User, User.id == Block.blocked_id)
        .filter(Block.blocker_id == current_user.id)
        .order_by(Block.created_at.desc(), Block.id.desc())
        .all()
    )
    return [
        BlockedPerson(
            user_id=u.id,
            first_name=u.first_name,
            last_name=u.last_name,
            photo_url=u.photo_url,
            created_at=b.created_at,
        )
        for b, u in rows
    ]


@router.post("/blocks", status_code=status.HTTP_204_NO_CONTENT)
def block_user(
    body: BlockRequestIn,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Block someone (#85). issei had no block, mute or report at all before this, while
    #79 opened recipe requests to any signed-in stranger on a public post — so unfriending
    was the only lever, and it stopped neither discovery nor asking.

    What it does, all in one transaction:
    - records the block (idempotent — blocking twice is not a second row),
    - **deletes any friendship** in either direction. You can't be friends with someone
      you've blocked, and a dormant "accepted" row would leave friends-only content readable
      until something else noticed. Unblocking does NOT restore it; they'd have to ask again.
    - drops the caller's own pending recipe-requests toward them and theirs toward the caller,
      so neither is left holding an ask that can never be answered.

    What it deliberately does NOT do: revoke an accepted handoff grant. You gave them that
    recipe; see `can_view`'s docstring and the Block model.

    Returns 204 either way — no body, and no distinct answer for "already blocked", so the
    endpoint leaks nothing about prior state.
    """
    if body.user_id == current_user.id:
        raise HTTPException(status_code=400, detail="You can’t block yourself.")
    target = db.query(User).filter(User.id == body.user_id).first()
    if target is None:
        raise HTTPException(status_code=404, detail="User not found")

    existing = (
        db.query(Block)
        .filter(Block.blocker_id == current_user.id, Block.blocked_id == body.user_id)
        .first()
    )
    if existing is None:
        db.add(Block(blocker_id=current_user.id, blocked_id=body.user_id))

    # The friendship goes, in whichever direction it was formed.
    db.query(Friendship).filter(
        or_(
            (Friendship.requester_id == current_user.id)
            & (Friendship.addressee_id == body.user_id),
            (Friendship.requester_id == body.user_id)
            & (Friendship.addressee_id == current_user.id),
        )
    ).delete(synchronize_session=False)

    # Pending asks between the two, both directions. A fulfilled one is history and stays.
    from app.models.notification import Notification
    from app.models.post import Post
    from app.models.recipe_request import RecipeRequest

    mine_to_them = (
        db.query(RecipeRequest.id)
        .join(Post, Post.id == RecipeRequest.post_id)
        .filter(
            RecipeRequest.requester_id == current_user.id,
            RecipeRequest.state == "pending",
            Post.user_id == body.user_id,
        )
    )
    theirs_to_mine = (
        db.query(RecipeRequest.id)
        .join(Post, Post.id == RecipeRequest.post_id)
        .filter(
            RecipeRequest.requester_id == body.user_id,
            RecipeRequest.state == "pending",
            Post.user_id == current_user.id,
        )
    )
    doomed = [r.id for r in mine_to_them] + [r.id for r in theirs_to_mine]
    if doomed:
        db.query(RecipeRequest).filter(RecipeRequest.id.in_(doomed)).delete(
            synchronize_session=False
        )

    # Notifications between the two, both directions. Deliberately NOT the same call as #79's
    # "retracting an ask keeps the cook's notification": there, the notification is history the
    # other person is entitled to. Here the recipient has explicitly asked never to see this
    # person again, and the confirm copy promises "you won't see each other anywhere" — which a
    # lingering name would make false. The inbox is also the one surface where a blocked
    # person's name and photo would keep appearing, because `list_notifications` resolves the
    # actor directly and has no `can_view` to lean on.
    #
    # EXCEPT the anonymous ones (#96). This sweep's justification is that "a lingering NAME
    # would make 'you won't see each other anywhere' false" — and a `recipe_kept` row carries
    # no name, so the rationale doesn't reach it. Worse, deleting it LEAKS: a cook with one
    # unread "Someone kept your Adobo" who blocks a person and watches that line vanish (while
    # keeper_count stays put, since the save survives a block by design) has just learned who
    # the keeper was, by inference, through the server. That is the exact channel this feature
    # closes everywhere else.
    db.query(Notification).filter(
        Notification.type.notin_(ANONYMOUS_TYPES),
        or_(
            (Notification.user_id == current_user.id)
            & (Notification.actor_id == body.user_id),
            (Notification.user_id == body.user_id)
            & (Notification.actor_id == current_user.id),
        ),
    ).delete(synchronize_session=False)

    try:
        db.commit()
    except IntegrityError:
        # Two taps raced uq_block_pair. One block is the correct outcome, so a lost race is a
        # success — but only if the winner's row is actually there. Re-verify rather than
        # reporting 204 for any integrity failure at all (same shape as `save_recipe` and
        # `request_friend`), or a genuine constraint bug would look like a working block.
        db.rollback()
        if not is_blocked(current_user.id, body.user_id, db):
            raise HTTPException(
                status_code=500, detail="Couldn't block them just now. Please try again."
            )
    return None


@router.delete("/blocks/{user_id}", status_code=status.HTTP_204_NO_CONTENT)
def unblock_user(
    user_id: int,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Remove the caller's OWN block. If the other person also blocked the caller, their row
    stays and the pair remains invisible to each other — you can only undo your own.

    Does not restore the friendship that blocking deleted. 204 whether or not a row existed.
    """
    db.query(Block).filter(
        Block.blocker_id == current_user.id, Block.blocked_id == user_id
    ).delete(synchronize_session=False)
    db.commit()
    return None


@router.get("/discover", response_model=list[DiscoverPerson])
def discover_people(
    q: str | None = Query(
        default=None,
        # 80 = UserCreate's name ceiling, so a term longer than the longest storable name
        # can never match anything. Validated at the boundary like `order` on GET /friends.
        max_length=80,
        description="Optional name search (case-insensitive, matches first or last name).",
    ),
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Everyone else on issei, so a new user can actually find someone (#80).

    Reported by a real user: she couldn't work out how to find people. Before this the
    only routes to a friend were the feed's "everyone" tab or somebody having handed you
    a recipe, and `/friends/suggestions` — the "People you've shared recipes with" list —
    is seeded purely from the handoff graph, so a user with no handoffs was shown nothing
    at all. A directory is the blunt fix that works at this scale.

    WHAT THIS DISCLOSES, stated plainly: a first name, last name and photo, to any signed
    -in user. That is not new information — the same three already appear on posts, on
    recipe bylines, on `/u/{id}`, and on `GET /friends/profile/{id}`, all of which any
    signed-in user can already reach. What IS new is that they become ENUMERABLE: you no
    longer need to know an id to see who exists. That was an explicit owner decision, with
    no opt-out for now.

    Deliberately NOT gated on `profile_visibility`. That field is `private` by DEFAULT and
    #68 established it is never consulted at read time; using it here would both break
    that rule and leave the directory empty, fixing nothing. If an opt-out is ever wanted
    it needs its own column.

    Excludes yourself, your ACCEPTED friends (they're in `GET /friends`), anyone whose request
    is pending TOWARDS you (they're in `GET /friends/requests`, which the Friends page renders
    above this section — listing them here too showed one request twice, with two live Accept
    buttons), and anyone in a block relationship.

    What deliberately STAYS is someone the caller has themselves asked: the row carries
    `friend_state="requested"` and shows "Requested" rather than vanishing, because a person
    disappearing the moment you tap Add reads as "did that work? did I just delete them?" —
    which is what a real user reported. That case had no other home; an incoming request does.

    Newest accounts first (the people most likely to be looking for someone too), capped at
    DISCOVER_LIMIT — but the cap applies ONLY to people the caller could still add. Anyone they
    already asked is returned outside it. Otherwise the two halves of this endpoint fight each
    other once the app passes 50 users: keeping requested people on the list would spend cap
    slots on rows nobody can act on, and letting the cap drop them would reintroduce the exact
    disappearance this design exists to prevent. The exempt set is bounded by how many people
    the caller has personally asked, so it can't be used to page past the cap. Both halves still
    honour `?q=`. The real fix at scale is making `q` required (see FUTURE) — this just stops
    the cap and the label contradicting each other in the meantime.

    Declared BEFORE /profile/{user_id} so the literal path isn't captured as a user id.
    """
    # Hidden entirely: yourself, anyone blocked either way (#85 — mutual invisibility, and
    # this path has no can_view to lean on so the exclusion is explicit), and accepted friends.
    hidden = {current_user.id}
    hidden |= blocked_ids(current_user.id, db)
    # The caller's OWN pending request annotates the row rather than hiding it; a request
    # pointing AT the caller hides it, because /friends/requests already shows that one.
    pending_out: set[int] = set()
    for r_id, a_id, state in db.query(
        Friendship.requester_id, Friendship.addressee_id, Friendship.state
    ).filter(
        or_(
            Friendship.requester_id == current_user.id,
            Friendship.addressee_id == current_user.id,
        )
    ):
        other = a_id if r_id == current_user.id else r_id
        if state == "accepted" or r_id != current_user.id:
            hidden.add(other)
        else:
            pending_out.add(other)

    query = db.query(User).filter(User.id.notin_(hidden))
    if q and q.strip():
        # Match either name part, so "ana" finds "Ana Cruz" and "Cruz" does too. ilike is
        # the portable case-insensitive contains (SQLite LIKE is already case-insensitive
        # for ASCII; Postgres ilike is explicitly so). Email is NOT searchable — letting
        # anyone probe addresses would turn the directory into an address-book oracle.
        #
        # The user's text is ESCAPED before it becomes a LIKE pattern: unescaped, a typed
        # `%` or `_` would be read as a wildcard, so searching for someone whose name has
        # an underscore silently matches any single character, and a lone `%` reads as
        # "everyone". This is a correctness fix, not an injection one — the value is still
        # a bound parameter either way, so nothing here is interpolated into SQL.
        term = q.strip().replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")
        pattern = f"%{term}%"
        query = query.filter(
            or_(
                User.first_name.ilike(pattern, escape="\\"),
                User.last_name.ilike(pattern, escape="\\"),
            )
        )
    newest_first = (User.created_at.desc(), User.id.desc())
    if pending_out:
        # Cap the addable strangers; return everyone the caller asked regardless.
        people = (
            query.filter(User.id.notin_(pending_out))
            .order_by(*newest_first)
            .limit(DISCOVER_LIMIT)
            .all()
        )
        people += query.filter(User.id.in_(pending_out)).order_by(*newest_first).all()
        # One list, one ordering, so an exempt row isn't visibly bolted to the end. created_at
        # can be NULL on an old row, hence the fallback rather than a bare sort key.
        people.sort(key=lambda u: (u.created_at is not None, u.created_at, u.id), reverse=True)
    else:
        people = query.order_by(*newest_first).limit(DISCOVER_LIMIT).all()
    return [
        DiscoverPerson(
            user_id=u.id,
            first_name=u.first_name,
            last_name=u.last_name,
            photo_url=u.photo_url,
            friend_state=("requested" if u.id in pending_out else "none"),
        )
        for u in people
    ]


@router.get("/profile/{user_id}", response_model=ProfileResponse)
def user_profile(
    user_id: int,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """A read-only profile of another user: name, profile visibility, friendship
    status from the caller's side, and a count of their recipes + posts the caller may
    see under the profile-visibility model.

    "May see" = exactly what can_view / can_view_post allow: everything if it's your own
    profile or the target's profile is public; friends-visible items if you're friends;
    plus any item the target force-marked public. The counts deliberately never leak the
    existence of items the caller can't open."""
    target = db.query(User).filter(User.id == user_id).first()
    if target is None:
        raise HTTPException(status_code=404, detail="User not found")
    # Mutual invisibility (#85): a blocked pair can't open each other's profile, and the
    # answer is the same 404 as a user who doesn't exist.
    if is_blocked(current_user.id, user_id, db):
        raise HTTPException(status_code=404, detail="User not found")

    friend_state = None
    friend_can_accept = False
    if user_id != current_user.id:
        f = existing_friendship(current_user.id, user_id, db)
        if f is not None:
            friend_state = f.state
            friend_can_accept = f.state == "pending" and f.addressee_id == current_user.id

    # Visible recipe + post counts, decided by the single read rules (not a bespoke
    # query filter — one source of truth for "can see"). Two optimizations for a
    # profile that may hold many items, without forking the rule:
    #   - attach the already-loaded target as each item's `user` so the profile check
    #     reads profile_visibility with no per-item query;
    #   - the viewer↔target friendship is invariant across every item, so resolve it
    #     ONCE and pass it in (is_friend) instead of letting each can_view* re-query.
    is_friend = friend_state == "accepted"
    recipes = (
        db.query(Recipe)
        .filter(Recipe.user_id == user_id, Recipe.deleted_at.is_(None))
        .all()
    )
    for r in recipes:
        r.user = target
    # The viewer's accepted grants among THIS owner's recipes, in one query, so the
    # per-recipe handoff branch of can_view doesn't fire a lookup each. (A grant is
    # per-recipe, so this is a set-membership test, not a single boolean.)
    granted_ids = set()
    if recipes:
        granted_ids = {
            row.recipe_id
            for row in db.query(Handoff.recipe_id).filter(
                Handoff.recipe_id.in_([r.id for r in recipes]),
                Handoff.to_user_id == current_user.id,
                Handoff.state == "accepted",
            )
        }
    recipe_count = sum(
        1
        for r in recipes
        # blocked=False is established, not assumed: this endpoint 404s above if either
        # party has blocked the other, so reaching here means there is no block (#85).
        if can_view(
            r, current_user, db, is_friend, is_grantee=r.id in granted_ids, blocked=False
        )
    )

    posts = db.query(Post).filter(Post.user_id == user_id).all()
    for p in posts:
        p.user = target
    post_count = sum(
        1 for p in posts if can_view_post(p, current_user, db, is_friend, blocked=False)
    )

    # Friend count is a public, symmetric fact about the target — not gated by the
    # caller (unlike recipe/post counts). Reuse friend_ids so there's one definition of
    # "who is an accepted friend"; the list is small, so len() is fine.
    friend_count = len(friend_ids(user_id, db))

    return ProfileResponse(
        user_id=user_id,
        first_name=target.first_name,
        last_name=target.last_name,
        photo_url=target.photo_url,
        profile_visibility=target.profile_visibility,
        friend_state=friend_state,
        friend_can_accept=friend_can_accept,
        recipe_count=recipe_count,
        post_count=post_count,
        friend_count=friend_count,
    )
