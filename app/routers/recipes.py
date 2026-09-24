from typing import Optional
import secrets
from dataclasses import dataclass

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, Request, status
from fastapi.responses import HTMLResponse
from sqlalchemy import and_, func, or_
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session, selectinload

from app.config import settings
from app.database import get_db
from app.auth import get_current_user, get_current_user_optional
from app.models.user import User
from app.models.recipe import Recipe
from app.models.ingredient_section import IngredientSection
from app.models.ingredient import Ingredient
from app.models.step import Step
from app.models.cook_event import CookEvent
from app.models.handoff import Handoff
from app.models.recipe_save import RecipeSave
from app.models.pass_on_request import PassOnRequest
from app.schemas.recipe import (
    RecipeCreate,
    RecipeResponse,
    RecipeUpdate,
    KeptShelf,
    RecipeExport,
    IngredientResponse,
    IngredientSectionResponse,
    IngredientSuggestions,
    FieldSuggestions,
    ParseTextIn,
    ParsedRecipe,
    StepResponse,
    CookIn,
    HandoffIn,
    HandoffResponse,
    PassOnRequestOut,
    InvitePreview,
)
from app.services.scaling import scale_ingredient
from app.services.blocks import blocked_ids, is_blocked
from app.services.media import require_our_image_url
from app.services import notify_push
from app.services import rate_limit
from app.services.notifications import notify
from app.services.sharing import effective_visibility, can_view
from app.services.friends import are_friends
from app.services.growth import soul_count, growth_stage, growth_vitality
from app.services.recipe_ai import RecipeAIUnavailable, extract_recipe
from app.services.invite_og import build_invite_meta, render_invite_og_document

from datetime import datetime, timezone

router = APIRouter(prefix="/recipes", tags=["recipes"])

# Cap on a profile's recipe grid (GET /recipes/users/{id}) — matches the posts feed's
# FEED_PAGE so the two tabs on one profile behave alike under a prolific user.
PROFILE_GRID_LIMIT = 30


def _keeper_count(recipe, viewer, db) -> Optional[int]:
    """How many people have kept this recipe — **the cook's alone** (#96).

    `None` for everyone who isn't the owner, never `0`: a client can't render a number it was
    never given, which is the same discipline as `request_count` (#79). What POSITIONING forbids
    is a PUBLIC keeper count and a list of keepers ANYWHERE — the cook-only number is the single
    carve-out, and it exists because a recipe written without a post has no other feedback
    channel at all (the ask/fulfil loop only lives on posts).

    Note this reads RecipeSave for DISPLAY only. `can_view` must never consult it — a save row
    is created by the READER, so trusting it for authorization would be a self-grant.
    `services/sharing.py` does not import RecipeSave and must not start.
    """
    if viewer is None or recipe.user_id != viewer.id:
        return None
    return (
        db.query(func.count(RecipeSave.id))
        .filter(RecipeSave.recipe_id == recipe.id)
        .scalar()
        or 0
    )


def _check_recipe_image_urls(payload) -> None:
    """Host-check every image URL on a recipe write — the cover and each step's photo.

    #106 shipped the shared rule and applied it to `PATCH /posts/{id}` and `PATCH /auth/me`, and the
    ship gate then pointed out that the "Change photo" control #106 added to the RECIPE form writes
    through `PATCH /recipes/{id}`, which had no check at all. So the feature that introduced the
    rule was itself writing past it. Both recipe write paths go through here now, which closes the
    class rather than the instance: five write surfaces accept an image URL, and five validate.

    `None` is untouched — for a cover it means "no photo", which is legitimate. A blank string is
    refused by the rule, which is correct here: a recipe cover is cleared by sending `null`.
    """
    if getattr(payload, "cover_photo_url", None) is not None:
        payload.cover_photo_url = require_our_image_url(payload.cover_photo_url, what="photo")
    for step in getattr(payload, "steps", None) or []:
        if getattr(step, "photo_url", None) is not None:
            step.photo_url = require_our_image_url(step.photo_url, what="photo")


def _attach_growth_fields(recipe, db):
    """Compute the growth-state counts the frontend reads. Small N per request."""
    cooks = db.query(CookEvent).filter(CookEvent.recipe_id == recipe.id).all()
    recipe.cook_count = len(cooks)
    recipe.owner_cook_count = sum(1 for c in cooks if c.user_id == recipe.user_id)
    recipe.last_cooked_at = max((c.cooked_at for c in cooks), default=None)
    recipe.shared_with_count = (
        db.query(Handoff)
        .filter(Handoff.recipe_id == recipe.id, Handoff.state == "accepted")
        .count()
    )
    soul = soul_count(recipe)
    recipe.soul_count = soul
    recipe.growth_stage = growth_stage(soul, recipe.cook_count)
    recipe.growth_vitality = growth_vitality(recipe.cook_count, recipe.shared_with_count)
    return recipe


@router.post("", response_model=RecipeResponse, status_code=status.HTTP_201_CREATED)
def create_recipe(
    recipe_in: RecipeCreate,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    _check_recipe_image_urls(recipe_in)
    new_recipe = Recipe(
        user_id=current_user.id,
        name=recipe_in.name,
        cover_photo_url=recipe_in.cover_photo_url,
        description=recipe_in.description,
        story=recipe_in.story,
        servings=recipe_in.servings,
        prep_time_minutes=recipe_in.prep_time_minutes,
        cuisine=recipe_in.cuisine,
        diet=recipe_in.diet,
        source=recipe_in.source,
        notes=recipe_in.notes,
        language=recipe_in.language,
        visibility=recipe_in.visibility,
    )
    db.add(new_recipe)
    # flush to get new_recipe.id before committing
    db.flush()

    # Origin attribution — "from Lola Remedios · Cebu" — is the byline, and it
    # STAYS. It used to also write a `ghost_ancestor` row so recipe #1 read as a
    # two-generation lineage; with no trees that row had no reader, so the
    # attribution string on the recipe is the whole feature now.
    if recipe_in.origin is not None:
        o = recipe_in.origin
        parts = [o.name] + [p for p in (o.place, o.year) if p]
        new_recipe.origin_attribution = " · ".join(parts)

    for section_in in recipe_in.ingredient_sections:
        new_section = IngredientSection(
            recipe_id=new_recipe.id,
            name=section_in.name,
            position=section_in.position,
        )
        db.add(new_section)
        db.flush()

        for ing_in in section_in.ingredients:
            db.add(
                Ingredient(
                    recipe_id=new_recipe.id,
                    section_id=new_section.id,
                    name=ing_in.name,
                    quantity_text=ing_in.quantity_text,
                    quantity_value=ing_in.quantity_value,
                    unit=ing_in.unit,
                    quantity_type=ing_in.quantity_type,
                    notes=ing_in.notes,
                    position=ing_in.position,
                )
            )

    for ing_in in recipe_in.ingredients:
        db.add(
            Ingredient(
                recipe_id=new_recipe.id,
                section_id=None,
                name=ing_in.name,
                quantity_text=ing_in.quantity_text,
                quantity_value=ing_in.quantity_value,
                unit=ing_in.unit,
                quantity_type=ing_in.quantity_type,
                notes=ing_in.notes,
                position=ing_in.position,
            )
        )

    for step_in in recipe_in.steps:
        db.add(
            Step(
                recipe_id=new_recipe.id,
                position=step_in.position,
                content=step_in.content,
                section_header=step_in.section_header,
                voice_note=step_in.voice_note,
                photo_url=step_in.photo_url,
            )
        )

    db.commit()
    db.refresh(new_recipe)
    _attach_growth_fields(new_recipe, db)
    return new_recipe


@router.post(
    "/{recipe_id}/handoff", response_model=HandoffResponse, status_code=status.HTTP_201_CREATED
)
def handoff_recipe(
    recipe_id: int,
    handoff_in: HandoffIn,
    background_tasks: BackgroundTasks,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    recipe = (
        db.query(Recipe)
        .filter(Recipe.id == recipe_id, Recipe.deleted_at == None)
        .first()
    )
    if not recipe:
        raise HTTPException(status_code=404, detail="Recipe not found")

    # OWNERSHIP IS NO LONGER THE WHOLE AUTHORIZATION QUESTION (#78). It was until now, and the note
    # that used to sit here said so. What changed: a reader may PASS ON a recipe that reached them,
    # which is the other half of keeping (#57) and the thing FUTURE.md describes — Lola's adobo
    # reached you, your sibling asks for it, and routing them back to Lola was the dead end.
    #
    # THE BRANCH IS DELIBERATELY IN THIS FUNCTION rather than in a route of its own, because this is
    # the ONE place in the app that mints a grant and a token. Two token-minting paths is exactly the
    # pattern this codebase keeps paying for — `services/media.py` exists because an inline host
    # check in the first router never reached the second, `lib/shareLink.js` for the same reason, and
    # `SafetyMenu` was extracted mid-#87 to stop it happening a third time.
    #
    # A NON-OWNER IS BOUND THREE WAYS, and each one closes something specific:
    is_owner = recipe.user_id == current_user.id
    if not is_owner:
        #   1. THEY MUST BE ABLE TO READ IT. Ordinary `can_view`, so a stranger cannot mint a grant
        #      to a recipe they have no access to in the first place.
        if not can_view(recipe, current_user, db):
            raise HTTPException(status_code=404, detail="Recipe not found")
        #   2. THE COOK MUST NOT HAVE BLOCKED THEM — and this check is NOT redundant with the one
        #      inside `can_view`, which is the subtle part. `_resource_is_visible` checks the block
        #      FIRST, so a blocked person fails the `public` branch; but `can_view`'s GRANT branch
        #      deliberately survives a block (#85 — you genuinely handed them that dish). So a
        #      person the cook blocked, holding an older grant plus an older approval, would still
        #      read the recipe and reach this line. Reading what you were given is the #85 rule;
        #      becoming a distributor of it after being blocked is not.
        if is_blocked(recipe.user_id, current_user.id, db):
            raise HTTPException(status_code=404, detail="Recipe not found")
        #   3. THEY MUST BE ALLOWED TO WIDEN IT — `public`, or the cook has approved their ask.
        #      Same 404 as everything else here, so a refusal never distinguishes "not yours",
        #      "not public" and "not approved".
        if not may_pass_on(recipe, current_user, db):
            raise HTTPException(status_code=404, detail="Recipe not found")
        #   4. AND IT IS LINK-ONLY. A non-owner may not PRE-ADDRESS a grant to a named person or an
        #      email, for two independent reasons. #105's `invite_permission` ("only friends can
        #      send me recipes") is checked against the SENDER, so letting a resharer address a
        #      third party would be a fresh channel straight past a setting someone deliberately
        #      turned on. And the third party's contact details are not the resharer's to hand over
        #      to a cook who never asked for them — the resharer forwards the link themselves, which
        #      is also what keeps the ask out of the cook's inbox. 400 rather than 404: the recipe
        #      is genuinely there and the caller may genuinely share it, so this is a shape error
        #      about the request, not an entitlement answer to hide.
        if handoff_in.to_user_id is not None or handoff_in.to_email:
            raise HTTPException(
                status_code=400,
                detail="A recipe you didn’t write can only be passed on as a link.",
            )
        # A LINK-ONLY GRANT NEVER REACHES THE DEDUPE PATH BELOW, which is what neutralises the
        # security tripwire recorded in the #57 review: that path returns the existing row WHOLE,
        # including its live token, so a resharer hitting it would be handed the COOK's token. Two
        # things keep that impossible — dedupe only runs when there is a recipient (link-only
        # handoffs are deliberately independent grants, see below), and (4) refuses a recipient from
        # a non-owner. The token minted here is always fresh and always `from_user_id` = the
        # resharer. FUTURE.md required exactly this and it falls out of the existing structure.

    # Resolve grantee: an in-app user (instant-accept) or an email invite (pending).
    to_user_id = handoff_in.to_user_id
    to_email = handoff_in.to_email
    resolved_user = None
    if to_user_id is not None:
        resolved_user = db.query(User).filter(User.id == to_user_id).first()
        if resolved_user is None:
            raise HTTPException(status_code=404, detail="User not found")

    # WHO THE RECIPIENT IS. An address that belongs to an account resolves to that account, and
    # from here on it is treated exactly as if the sender had passed `to_user_id`.
    #
    # THIS USED TO BE TWO VARIABLES, AND THE SPLIT WAS A BUG. The email lookup arrived with #105,
    # which needed it for the two checks below — the block check fires on a resolved user, so
    # addressing a handoff by EMAIL walked straight past #85, and anyone who knew a blocker's
    # address could keep minting grants onto their Kept shelf. That fix deliberately kept the
    # resolution OUT of the stored row, on the reasoning that binding the grant would change what
    # the app's signature endpoint STORES and was therefore a decision of its own. It was — and the
    # decision was that the old behaviour was broken:
    #
    #   An email-addressed grant was stored `pending` with `to_user_id` NULL no matter whose
    #   address it was. `GET /recipes/shared` filters on `to_user_id`; `can_view`'s grant branch
    #   requires BOTH `accepted` AND a matching `to_user_id`; and the signup auto-accept in
    #   `routers/auth.py` matches on account CREATION, which for an existing account ran long
    #   before this row existed. So handing a recipe to the address of someone who is ALREADY on
    #   issei delivered nothing, in every surface, permanently — and #107 correctly declined to
    #   notify them, because the notification would have linked to a recipe they 404 on. The app's
    #   one signature act, silently doing nothing, with a 201 and a "sent ✓" on the sender's screen.
    #
    # An address with NO account behind it still has nobody to bind to, so it stays a pending email
    # invite and signup claims it later — the #88 rule: an invite minted BEFORE a restriction stays
    # claimable, because the sender chose to send it. That branch is what the pending state is FOR,
    # and it is untouched.
    #
    # Case-insensitive, because an email address is: a sender typing "Ana@x.com" for "ana@x.com"
    # would otherwise resolve to nobody, skip both checks, and mint a row no signup ever claims.
    #
    # AND THE CASE-INSENSITIVE MATCH CAN RETURN MORE THAN ONE ACCOUNT, which is why this is a list
    # and not a `.first()`. `users.email` carries a plain case-SENSITIVE unique index, signup's
    # duplicate check is `User.email == user_in.email`, and Pydantic's `EmailStr` normalises only the
    # DOMAIN ("Ana@X.com" → "Ana@x.com"). So `ANA@x.com` and `ana@x.com` are two separate,
    # independently loginable accounts, and nothing in the app prevents that — an honest duplicate
    # signup produces it, and so does anyone who wants it deliberately.
    #
    # A ship gate found what that did once the grant was bound to the match: `.first()` over a
    # `lower()` predicate cannot use the btree index, so the winner follows physical row order, and
    # a PRIVATE recipe — dish name, byline, story, per-step notes, photos — was delivered to the
    # case twin with a `recipe_arrived` naming the cook, while the person the sender actually
    # addressed got nothing and the sender saw "sent ✓". Reproduced end to end before this fix.
    #
    # So the two questions are answered from the same list, differently, and the asymmetry is the
    # point:
    #   · WHO THE GRANT BINDS TO must be unambiguous — an exact match (the column is unique, so an
    #     exact hit is by definition one account), else the sole case-insensitive match. On a genuine
    #     tie it binds to NOBODY and stays a pending invite: delivering to a coin flip is the one
    #     outcome worse than not delivering, and the cook still has the link, which is the capability
    #     this product is built on.
    #   · WHO THE CHECKS CONSULT is EVERY candidate. Ambiguity must not become a way to skip a
    #     block: if any account behind that address has blocked the cook, or restricts invites, the
    #     send is refused. #105 added those checks precisely because an email-addressed handoff used
    #     to walk past #85, and a tie must not reopen that door.
    candidates: list[User] = []
    if resolved_user is not None:
        candidates = [resolved_user]
    elif to_email:
        typed = to_email.strip()
        candidates = (
            db.query(User).filter(func.lower(User.email) == typed.lower()).all()
        )
        exact = next((u for u in candidates if u.email == typed), None)
        resolved_user = exact or (candidates[0] if len(candidates) == 1 else None)
    recipient = resolved_user

    # EVERY CANDIDATE, not just the one the grant binds to — see the note above. With two case-twin
    # accounts behind one address, checking only the bound one would let a tie (or an arbitrary
    # `.first()`) decide whose block gets consulted, which is the #105 hole reopened by accident.
    # Refusing if ANY of them refuses is the conservative direction and costs an honest sender
    # nothing, since a tie needs two accounts differing only in the case of one address.
    for person in candidates:
        if person.id == current_user.id:
            continue
        # No NEW grant across a block (#85), either direction. The locked decision is that a grant
        # which ALREADY EXISTED at block time survives — you genuinely gave them that dish and a
        # block means "no new contact", not "unsend". Minting one AFTER the block is the opposite:
        # because can_view's grant branch waves a grant through regardless of visibility or
        # friendship, without this check a blocked person could put arbitrary text (name, story,
        # byline, step notes) plus their own name straight onto the blocker's Kept shelf, once per
        # recipe they care to write. Same 404 body as an unknown user, so the block is undetectable.
        if is_blocked(current_user.id, person.id, db):
            raise HTTPException(status_code=404, detail="User not found")
        # WHO MAY PRE-ADDRESS A HANDOFF TO THIS PERSON (#105). "friends" requires an accepted
        # friendship; "anyone" (the default, and today's behaviour) checks nothing.
        #
        # The 404 BODY is byte-identical to a block's and to an unknown user's, so a refusal never
        # says WHICH of those it was. Be precise about what that does and does not hide, because
        # the first version of this comment claimed more than it delivers: a refusal is a 404 while
        # an address with NO account behind it gets a 201 and a pending invite, so the pair does
        # tell a sender "this address belongs to an account that restricts invites". That is a real
        # signal and it is accepted rather than hidden — the app already discloses account
        # existence more directly (signup answers "Email already registered", and since #80 every
        # user is listed in the directory by name), so paying for it here with a fake 201 would
        # mean telling a sender their recipe was delivered when it was not. Lying to the sender is
        # the worse trade.
        #
        # The LINK-ONLY handoff is deliberately untouched: no recipient means nothing to check,
        # and the token is the capability this product is built on.
        if person.invite_permission == "friends" and not are_friends(
            current_user.id, person.id, db
        ):
            raise HTTPException(status_code=404, detail="User not found")

    # Idempotent per (root, grantee): return the existing grant if present.
    # Link-only handoffs (no recipient at all) are deliberately NOT deduped — each
    # is an independent shareable grant, so two links can be claimed by two people
    # without the second stealing the first's access.
    handoff = None
    email_key = to_email.strip().lower() if to_email else None
    if recipient is not None or email_key:
        existing_q = db.query(Handoff).filter(Handoff.recipe_id == recipe.id)
        if recipient is not None:
            # EITHER SHAPE, and the second half is what keeps this fix from creating duplicates.
            # Every email-addressed grant minted before it sits in the database `pending` with
            # `to_user_id` NULL, so a lookup keyed only on the id would miss one and mint a SECOND
            # row for the same (recipe, person) — two grants where this route promises one.
            # Case-insensitively, because the sender may have typed the address differently then.
            existing = existing_q.filter(
                or_(
                    Handoff.to_user_id == recipient.id,
                    # THE SECOND DISJUNCT IS CONSTRAINED TO UNBOUND ROWS, and the `and_` is the whole
                    # correctness of it. `claim_invite` and `accept_handoff` both set `to_user_id`
                    # WITHOUT clearing `to_email`, so a row can be accepted, bound to Carla, and
                    # still carry ben@x.com — that is the documented mismatched-email orphan flow (a
                    # link addressed to one person, claimed by whoever actually held it). Without
                    # `to_user_id IS NULL` here, a cook re-sending to Ben would match CARLA's grant,
                    # skip the heal (it is already bound), and return it — so Ben gets a 201 and
                    # nothing else, permanently, for that (recipe, address) pair. That is the exact
                    # defect this branch exists to remove, reintroduced one shape over. Found by a
                    # ship gate, reproduced end to end.
                    and_(
                        Handoff.to_user_id.is_(None),
                        func.lower(Handoff.to_email) == recipient.email.lower(),
                    ),
                )
            ).first()
        else:
            existing = existing_q.filter(
                func.lower(Handoff.to_email) == email_key
            ).first()
        if existing is not None:
            if existing.to_user_id is None and recipient is not None:
                # HEAL A DEAD ROW RATHER THAN RETURNING IT. One found here is unreachable — that is
                # the whole bug — so answering the cook's re-send with it unchanged would repeat the
                # first send's silence. Binding it makes a re-send the manual repair for any grant
                # the migration below did not reach, and it falls through to the notify/commit path
                # instead of returning, because until this moment the recipe had never arrived.
                existing.to_user_id = recipient.id
                existing.to_email = None
                existing.state = "accepted"
                handoff = existing
            else:
                return existing

    if handoff is None:
        handoff = Handoff(
            recipe_id=recipe.id,
            from_user_id=current_user.id,
            to_user_id=(recipient.id if recipient else None),
            to_email=(None if recipient else to_email),
            state=("accepted" if recipient else "pending"),
            token=secrets.token_urlsafe(32),
        )
        db.add(handoff)
    # TELL THE RECIPIENT. Until this line the app's signature act was the only one that
    # happened in silence: a grant appeared on someone's Kept shelf and nothing anywhere said
    # so. Same transaction as the grant, per notify()'s contract.
    #
    # ONLY WHERE THE GRANT IS ACCEPTED — i.e. bound to a user id, which since this round is every
    # grant addressed to a person the app can identify, whether the sender named them by id or by
    # email. A notification must never outrun the access it describes: `can_view`'s grant branch
    # requires BOTH `accepted` AND a matching `to_user_id`, so telling someone a recipe arrived
    # while the row is still `pending` links them to a 404. The remaining `pending` case is an
    # address with NO account, where there is nobody to tell and signup will claim the row.
    #
    # (This condition used to read `resolved_user`, and pairing it with a row the email path left
    # unbound is what made the bug invisible: the notification was correctly suppressed, so the
    # silence looked deliberate rather than like a delivery that never happened.)
    #
    # The idempotent early-return above already makes a second grant per (recipe, grantee)
    # impossible, so `dedupe` is not load-bearing here; it is set for consistency with every
    # other repeatable-act notification, and so that a future change to that idempotency can't
    # turn re-sending into an inbox flood.
    arrival = None
    if recipient is not None:
        arrival = notify(
            db,
            user_id=recipient.id,
            type="recipe_arrived",
            actor_id=current_user.id,
            recipe_id=recipe.id,
            dedupe=True,
        )
    # TELL THE COOK THEIR RECIPE IS TRAVELLING (#78). Only for a non-owner — the owner sending their
    # own recipe is not news to themselves, and `notify()` would refuse it anyway.
    #
    # NAMED, not anonymous like `recipe_kept`. The two look similar and are not: a keep is a
    # bookmark addressed to nobody, so naming the keeper would change what keeping MEANS and could
    # chill it. Passing a recipe on is an act on the cook's behalf that creates access they did not
    # create, so who did it is the substance of the notification rather than a detail of it — and
    # for a `public` recipe this is the ONLY signal the cook gets that it moved.
    #
    # `dedupe=True`, so passing the same recipe on repeatedly while the cook hasn't read the last
    # one collapses to one row rather than filling their inbox — the same guard `recipe_kept` needs
    # because a keep/unkeep loop is free. It is honest here too: the news is "your recipe is being
    # passed around by Ana", which is as true of the fourth link as of the first.
    passed = None
    if not is_owner:
        passed = notify(
            db,
            user_id=recipe.user_id,
            type="recipe_passed_on",
            actor_id=current_user.id,
            recipe_id=recipe.id,
            dedupe=True,
        )
    db.commit()
    notify_push.queue(background_tasks, [arrival, passed])
    db.refresh(handoff)
    return handoff


def may_pass_on(recipe: Recipe, user: User, db: Session) -> bool:
    """May this person hand someone else's recipe on (#78)?

    THE ONE RULE: **a resharer may never grant more than they could cause by other means.**

    A `public` recipe is already in Browse and readable by any signed-in person, so passing it on is
    a shortcut rather than a widening — what the link adds is account-free reading, which is the
    founding act of this product, not a technicality. Anything NARROWER is the cook's to widen,
    because `GET /recipes/invite/{token}` returns the WHOLE recipe with no account: if any reader
    could mint a token, one trusted recipient could make a `private` recipe world-readable a link at
    a time and "Only me" would stop meaning only-me-plus-who-I-chose. So `friends` and `private`
    require an APPROVED `PassOnRequest`, which is the cook saying yes.

    NOT `can_view` — read is not write, and this is the third question in that family after
    "can you read it" and "can you edit it". A grantee reads a private recipe; that does not make
    them a distributor of it.

    The caller is assumed to have passed `can_view` already; this answers only the widening question.
    """
    if recipe.user_id == user.id:
        # The owner doesn't pass their own recipe on, they SEND it. Different screen, different verb.
        return True
    if recipe.visibility == "public":
        return True
    return (
        db.query(PassOnRequest.id)
        .filter(
            PassOnRequest.recipe_id == recipe.id,
            PassOnRequest.requester_id == user.id,
            PassOnRequest.state == "approved",
        )
        .first()
        is not None
    )


def pass_on_state(recipe: Recipe, user: Optional[User], db: Session) -> Optional[str]:
    """What the client should draw for this viewer (#78). See `RecipeResponse.pass_on_state`.

    **A DECLINED ROW READS AS `"pending"`, NOT `"ask"` — and the difference is the whole
    invariant.** Reporting `ask` was the first version and a ship gate showed it leaked the decline
    without ever saying the word: the asker taps, sees "Asked Lola ✓" from local state, reloads, and
    the control REVERTS to "Ask Lola if you can pass it on". Pending never reverts. So "tap, then
    reload" was a reliable decline oracle needing no tooling — and for an ordinary user the reverted
    button reads as "she said no" or "my ask vanished", either of which is the social event this rule
    exists to prevent.

    `pending` is honest about what the asker can observe and silent about the rest: they asked, they
    have not been told yes. The row still makes a re-ask a no-op, `may_pass_on` is untouched (so the
    permission is genuinely absent), and a later flip to `public` short-circuits to `allowed` above
    before this row is ever consulted, so nobody can get stuck. Same discipline as a silent block.
    """
    if user is None or recipe.user_id == user.id:
        return None
    # A BLOCK MAKES THIS None RATHER THAN A WORKING-LOOKING BUTTON. `get_recipe` gates on `can_view`,
    # whose grant branch survives a block (#85), so a person blocked AFTER their approval still opens
    # the recipe — and without this they were drawn a "Pass it on" button that 404s on a recipe
    # visibly on their screen. Since there is no revoke, a 404 there is explicable only by a block,
    # which is a detection channel on a state #85 otherwise keeps undetectable. Fails closed either
    # way; this makes it silent as well.
    if is_blocked(recipe.user_id, user.id, db):
        return None
    if recipe.visibility == "public":
        return "allowed"
    row = (
        db.query(PassOnRequest)
        .filter(
            PassOnRequest.recipe_id == recipe.id,
            PassOnRequest.requester_id == user.id,
        )
        .first()
    )
    if row is not None and row.state == "approved":
        return "allowed"
    # Pending AND declined both answer "pending" — see the docstring. The asker is never told no,
    # and a control that reverted would say it without words.
    if row is not None:
        return "pending"
    return "ask"


@router.post("/{recipe_id}/cook")
def cook_recipe(
    recipe_id: int,
    cook_in: CookIn | None = None,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    recipe = db.query(Recipe).filter(Recipe.id == recipe_id, Recipe.deleted_at == None).first()
    if not recipe:
        raise HTTPException(status_code=404, detail="Recipe not found")
    if not can_view(recipe, current_user, db):
        raise HTTPException(status_code=404, detail="Recipe not found")

    db.add(
        CookEvent(
            recipe_id=recipe_id,
            user_id=current_user.id,
            photo_url=(cook_in.photo_url if cook_in else None),
            note=(cook_in.note if cook_in else None),
        )
    )
    db.commit()
    count = db.query(CookEvent).filter(CookEvent.recipe_id == recipe_id).count()
    return {"cook_count": count}


@router.get("", response_model=list[RecipeResponse])
def list_recipes(current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    recipes = (
        db.query(Recipe)
        .filter(Recipe.user_id == current_user.id, Recipe.deleted_at == None)
        .options(
            selectinload(Recipe.ingredient_sections).selectinload(IngredientSection.ingredients),
            selectinload(Recipe.ingredients),
            selectinload(Recipe.steps),
            selectinload(Recipe.user),
        )
        .all()
    )
    for r in recipes:
        _attach_growth_fields(r, db)
    return recipes


@router.get("/browse", response_model=list[RecipeResponse])
def browse_recipes(
    db: Session = Depends(get_db),
    viewer=Depends(get_current_user_optional),
):
    """Public recipes, newest first. Deliberately readable without an account.

    But a SIGNED-IN reader must not be shown recipes by someone they've blocked (#85), so the
    viewer is resolved optionally: anonymous callers get the plain public feed, and a signed-in
    one gets it minus anyone they're blocked from either way. `/posts/browse` already required
    auth, which made this the one public surface where a block didn't hold.
    """
    hidden = blocked_ids(viewer.id, db) if viewer is not None else set()
    recipes = (
        db.query(Recipe)
        .filter(Recipe.deleted_at == None)
        .options(
            selectinload(Recipe.ingredient_sections).selectinload(IngredientSection.ingredients),
            selectinload(Recipe.ingredients),
            selectinload(Recipe.steps),
            selectinload(Recipe.user),
        )
        .order_by(Recipe.created_at.desc())
        .all()
    )
    recipes = [
        r
        for r in recipes
        if effective_visibility(r, db) == "public" and r.user_id not in hidden
    ]
    for r in recipes:
        _attach_growth_fields(r, db)
        # Browse is unauthenticated — don't leak per-owner activity on the public
        # feed. The growth badge only needs cook_count/child_count/has_grandchildren.
        r.owner_cook_count = 0
        r.last_cooked_at = None
        r.shared_with_count = 0
    return recipes


@router.get("/shared", response_model=list[RecipeResponse])
def shared_with_me(
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    # Declared BEFORE get_recipe so the literal "/shared" path is matched first;
    # otherwise GET /recipes/{recipe_id} would capture recipe_id="shared".
    granted_ids = [
        h.recipe_id
        for h in db.query(Handoff)
        .filter(Handoff.to_user_id == current_user.id, Handoff.state == "accepted")
        .all()
    ]
    if not granted_ids:
        return []
    recipes = (
        db.query(Recipe)
        .filter(
            Recipe.id.in_(granted_ids),
            Recipe.user_id != current_user.id,
            Recipe.deleted_at == None,
        )
        .options(
            selectinload(Recipe.ingredient_sections).selectinload(IngredientSection.ingredients),
            selectinload(Recipe.ingredients),
            selectinload(Recipe.steps),
            selectinload(Recipe.user),
        )
        .all()
    )
    for r in recipes:
        _attach_growth_fields(r, db)
    return recipes


# --- ASKING TO PASS A RECIPE ON (#78) ------------------------------------------------------------
#
# DECLARED BEFORE `/{recipe_id}`, like `/export` and `/browse` below, or FastAPI matches the literal
# path against the id route and answers 422 for "pass-on-requests". Same lesson as
# `/friends/discover` vs `/friends/profile/{id}`.
#
# WHY THESE EXIST AT ALL: a reader may pass on a `public` recipe outright (already in Browse, so it
# widens nothing), but `friends` and `private` are the cook's to widen, because
# `GET /recipes/invite/{token}` serves a whole recipe with NO ACCOUNT. These three routes are how the
# cook is asked. See `app/models/pass_on_request.py` for the full reasoning, including why this is
# the shape Google Docs and Instagram both landed on.


@router.post("/{recipe_id}/pass-on-request", status_code=status.HTTP_204_NO_CONTENT)
def request_pass_on(
    recipe_id: int,
    background_tasks: BackgroundTasks,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Ask the cook whether you may pass their recipe on (#78).

    204 on every outcome that is not an entitlement refusal, deliberately, and there are three of
    them the caller cannot tell apart:

      · a new ask was recorded;
      · you had already asked and it is still pending (idempotent — the UNIQUE constraint on
        (recipe, requester) makes asking twice one row, not two);
      · the cook already DECLINED. Nothing happens and nothing is said. That is the point: the
        asker is never told no (see the model docstring), and the stored row is what makes a second
        ask free for them to send and silent for the cook to receive, so "no" cannot be worn down
        by repetition.

    It is NOT an ask for the recipe — the asker can already read it. It is an ask about PERMISSION,
    and approving grants nothing to any third party: it lets the asker use the ordinary link-only
    handoff, minting their OWN token. The cook never learns who the recipe is going to, which is
    deliberate — that person's contact details are not the resharer's to hand over.
    """
    recipe = (
        db.query(Recipe).filter(Recipe.id == recipe_id, Recipe.deleted_at == None).first()
    )
    if not recipe:
        raise HTTPException(status_code=404, detail="Recipe not found")
    # Read access first, then the block — same pair, same reasons, as `handoff_recipe`'s non-owner
    # branch: `can_view`'s grant branch survives a block (#85), so the explicit check is not
    # redundant. A person the cook blocked must not be able to put a request in their inbox; that is
    # a contact channel, and a block means no new contact.
    if not can_view(recipe, current_user, db):
        raise HTTPException(status_code=404, detail="Recipe not found")
    if is_blocked(recipe.user_id, current_user.id, db):
        raise HTTPException(status_code=404, detail="Recipe not found")
    # Asking about your OWN recipe is meaningless rather than forbidden, and a 400 says which.
    if recipe.user_id == current_user.id:
        raise HTTPException(
            status_code=400, detail="This is your recipe — you can send it to anyone."
        )
    # Nothing to ask for: already allowed. A 400 rather than a silent 204, because a client that
    # gets here has drawn the wrong button and a silent success would hide that.
    if may_pass_on(recipe, current_user, db):
        raise HTTPException(
            status_code=400, detail="You can already pass this one on."
        )

    existing = (
        db.query(PassOnRequest)
        .filter(
            PassOnRequest.recipe_id == recipe.id,
            PassOnRequest.requester_id == current_user.id,
        )
        .first()
    )
    if existing is not None:
        # Pending or declined — either way, nothing to do and nothing to say. Re-notifying on a
        # pending row would let a determined asker flood the cook's inbox one tap at a time, and
        # re-notifying on a declined one would make "no" cost the cook something every time.
        return None

    db.add(PassOnRequest(recipe_id=recipe.id, requester_id=current_user.id))
    # Named, and it wants an answer — so nothing about this is anonymous. `dedupe=True` for the
    # same reason every repeatable act carries it: the row above already makes a second ask a no-op,
    # but a future change to that idempotency must not turn asking into an inbox flood.
    asked = notify(
        db,
        user_id=recipe.user_id,
        type="pass_on_request",
        actor_id=current_user.id,
        recipe_id=recipe.id,
        dedupe=True,
    )
    db.commit()
    notify_push.queue(background_tasks, [asked])
    return None


@router.get("/pass-on-requests/incoming", response_model=list[PassOnRequestOut])
def incoming_pass_on_requests(
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Who has asked to pass one of YOUR recipes on (#78). Pending only.

    The one place an asker's NAME is returned, mirroring `GET /posts/requests/incoming` exactly:
    identity reaches the cook only on the screen where they answer. Declined and approved rows are
    not listed — this is a to-do list, not a history, and there is no surface that wants the past
    tense. Blocked people are filtered out: a block after the ask should take the ask with it,
    exactly as `POST /friends/blocks` drops pending friend requests both ways.
    """
    hidden = blocked_ids(current_user.id, db)
    rows = (
        db.query(PassOnRequest, Recipe, User)
        .join(Recipe, Recipe.id == PassOnRequest.recipe_id)
        .join(User, User.id == PassOnRequest.requester_id)
        .filter(
            Recipe.user_id == current_user.id,
            Recipe.deleted_at == None,
            PassOnRequest.state == "pending",
        )
        .order_by(PassOnRequest.id.desc())
        .all()
    )
    return [
        PassOnRequestOut(
            id=req.id,
            recipe_id=recipe.id,
            recipe_name=recipe.name,
            requester_id=asker.id,
            requester_name=asker.first_name,
            requester_photo_url=asker.photo_url,
            created_at=req.created_at,
        )
        for req, recipe, asker in rows
        if asker.id not in hidden
    ]


@router.post(
    "/pass-on-requests/{request_id}/{decision}",
    status_code=status.HTTP_204_NO_CONTENT,
)
def answer_pass_on_request(
    request_id: int,
    decision: str,
    background_tasks: BackgroundTasks,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """The cook answers: `approve` or `decline` (#78). Owner-only, 404 for anyone else.

    ONE ROUTE FOR BOTH ANSWERS rather than two, because everything except the stored word and the
    notification is identical — the same ownership check, the same already-answered guard, the same
    404 body. Two routes would be two places to keep that in step, which is the pattern this
    codebase keeps extracting away from.

    THE ASYMMETRY IS THE WHOLE DESIGN: approving notifies the asker, declining notifies NOBODY. A
    decline is silent for the reason a block is silent (#85) and a report tells the reported person
    nothing — the cook said no about a recipe carrying their own family's name, often to a relative,
    and "Lola declined" on that person's screen turns a quiet boundary into a social event. The
    asker's button simply returns to its resting state. The row is KEPT rather than deleted so a
    second ask is silently a no-op.

    APPROVING GRANTS NOTHING TO A THIRD PARTY. It only lets the asker use the link-only handoff path,
    minting their own fresh token. The cook does not mint anything here and never learns who the
    recipe is going to.
    """
    if decision not in ("approve", "decline"):
        raise HTTPException(status_code=404, detail="Not found")

    row = (
        db.query(PassOnRequest)
        .join(Recipe, Recipe.id == PassOnRequest.recipe_id)
        .filter(
            PassOnRequest.id == request_id,
            Recipe.user_id == current_user.id,
            Recipe.deleted_at == None,
        )
        .first()
    )
    if row is None:
        raise HTTPException(status_code=404, detail="Request not found")
    # THE TELLING, NOT THE GRANTING. Approving after blocking the asker is already inert —
    # `handoff_recipe` 404s for them — but `notify()` would write a `pass_on_approved` FROM the
    # blocker TO the blocked person and push it to their lock screen, which is the exact channel
    # `_notify_cook_of_claim` is hand-gated to close. Only reachable from a stale tab, since
    # `/pass-on-requests/incoming` filters blocked askers out. Answer stored, nobody told.
    if is_blocked(current_user.id, row.requester_id, db):
        row.state = "approved" if decision == "approve" else "declined"
        row.resolved_at = func.now()
        db.commit()
        return None
    if row.state != "pending":
        # Already answered. Idempotent rather than an error: two taps on a slow connection, or the
        # cook answering on their phone and then on a stale laptop tab, must not be a 400 — and it
        # must not re-notify. Deliberately does NOT let an answer be changed: re-approving after a
        # decline is a new decision the cook can make by being asked again, and silently flipping a
        # stored "no" to "yes" from a stale tab is the wrong direction to fail in.
        return None

    row.state = "approved" if decision == "approve" else "declined"
    row.resolved_at = func.now()
    granted = None
    if decision == "approve":
        granted = notify(
            db,
            user_id=row.requester_id,
            type="pass_on_approved",
            actor_id=current_user.id,
            recipe_id=row.recipe_id,
            dedupe=True,
        )
    db.commit()
    notify_push.queue(background_tasks, [granted])
    return None


@router.get("/export", response_model=RecipeExport)
def export_my_recipes(
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Every recipe the caller WROTE, as JSON — the honest answer to "what if issei goes away?".

    Declared before `get_recipe` so the literal "/export" isn't captured as a recipe id, same as
    "/shared" and "/kept" above.

    THREE decisions worth keeping.

    **Own recipes only, not the Kept shelf.** A kept recipe is someone else's record of their dish
    — it is on your shelf by their grant, and a grant is permission to read, not to take a copy
    away (read is not write, the same rule `patch_recipe` enforces). Exporting them would make
    "keep" mean the copy it has never meant, and it would hand you text that stops being yours the
    moment they delete it or block you. What this exports is what you typed.

    **JSON, not a PDF or a printable cookbook.** A keepsake artefact is the legacy-archive product
    POSITIONING deliberately keeps issei out of; a machine-readable file is the one that answers
    the actual question, because it can be re-imported somewhere else. It is also why the imprecise
    amounts matter here more than anywhere: a recipe whose "a good splash" is preserved verbatim in
    the app has to leave it that way, so the export carries `quantity_text` and `quantity_type`
    exactly as stored and does no formatting of its own.

    **Deleted recipes are excluded.** `deleted_at IS NULL`, like every other read. A soft-deleted
    row is one the person chose to remove; an export that quietly resurrected it would be a
    surprise, not a service.
    """
    recipes = (
        db.query(Recipe)
        .filter(Recipe.user_id == current_user.id, Recipe.deleted_at == None)
        .options(
            selectinload(Recipe.ingredient_sections).selectinload(IngredientSection.ingredients),
            selectinload(Recipe.ingredients),
            selectinload(Recipe.steps),
            selectinload(Recipe.user),
        )
        .order_by(Recipe.created_at.asc())
        .all()
    )
    for r in recipes:
        _attach_growth_fields(r, db)
    return RecipeExport(
        exported_at=datetime.now(timezone.utc),
        recipe_count=len(recipes),
        recipes=recipes,
    )


@router.get("/kept", response_model=KeptShelf)
def kept_recipes(
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """The "Kept" shelf (#57): recipes in your kitchen that are not yours.

    Declared BEFORE get_recipe so the literal "/kept" path is matched first; otherwise
    GET /recipes/{recipe_id} would capture recipe_id="kept".

    ONE shelf, merging two independent sources on the server:
      - recipes someone HANDED you (an accepted handoff grant), and
      - recipes you KEPT yourself (a RecipeSave bookmark).
    Merging here rather than in the client is what makes un-keeping a bookmark unable to
    hide a recipe somebody actually sent you: the grant stands on its own.

    A save is NOT a permission. Every row is re-checked through `can_view` on every read,
    so if the cook has since made the recipe private, unfriended the keeper, or deleted
    it, it drops out — and is counted in `unreachable_count` instead. That count is a
    bare number on purpose (see KeptShelf).

    Your OWN recipes are excluded even if an id reaches this set (e.g. a handoff to
    yourself): they live in the Recipes tab, and showing them here would double-count
    your kitchen.
    """
    # Keep each source's timestamp: the shelf is ordered by when a recipe landed on YOUR
    # shelf, not when the cook wrote it. Keeping a dish someone wrote two years ago must
    # put it at the TOP — sorting by Recipe.created_at would bury it under everything
    # authored more recently, which reads as "keeping didn't work" on first use.
    granted_at = {}
    for rid, ts in db.query(Handoff.recipe_id, Handoff.created_at).filter(
        Handoff.to_user_id == current_user.id, Handoff.state == "accepted"
    ):
        # Several grants can exist for one recipe; the most recent one is when it
        # (re)arrived.
        if ts is not None and (granted_at.get(rid) is None or ts > granted_at[rid]):
            granted_at[rid] = ts
    saved_at = {
        rid: ts
        for rid, ts in db.query(RecipeSave.recipe_id, RecipeSave.created_at).filter(
            RecipeSave.user_id == current_user.id
        )
    }
    granted_ids = set(granted_at) | {
        row.recipe_id
        for row in db.query(Handoff.recipe_id).filter(
            Handoff.to_user_id == current_user.id, Handoff.state == "accepted"
        )
    }
    saved_ids = set(saved_at)
    wanted = granted_ids | saved_ids
    if not wanted:
        return KeptShelf(recipes=[], unreachable_count=0)

    # Fetch WITHOUT the soft-delete filter so a deleted recipe still counts as
    # unreachable rather than silently vanishing from the total.
    rows = (
        db.query(Recipe)
        .filter(Recipe.id.in_(wanted))
        .options(
            selectinload(Recipe.ingredient_sections).selectinload(IngredientSection.ingredients),
            selectinload(Recipe.ingredients),
            selectinload(Recipe.steps),
            selectinload(Recipe.user),
        )
        .all()
    )
    # Drop the caller's own recipes from the shelf AND from the denominator.
    own_ids = {r.id for r in rows if r.user_id == current_user.id}
    wanted -= own_ids

    # One blocks lookup for the whole shelf instead of one per row (#85). Used twice below:
    # to answer can_view without a query per recipe, and to keep a block from triggering the
    # permanent prune.
    blocked_owners = blocked_ids(current_user.id, db)

    visible = [
        r
        for r in rows
        if r.id in wanted
        and r.deleted_at is None
        and can_view(r, current_user, db, blocked=r.user_id in blocked_owners)
    ]
    def _shelved_at(r):
        """When this recipe landed on the caller's shelf — the later of "you kept it" and
        "someone handed it to you". Falls back to the recipe's own date only if neither
        timestamp survived (an old row with a NULL created_at)."""
        stamps = [t for t in (saved_at.get(r.id), granted_at.get(r.id)) if t is not None]
        return max(stamps) if stamps else r.created_at

    visible.sort(key=_shelved_at, reverse=True)
    for r in visible:
        _attach_growth_fields(r, db)
        # Every row here belongs to someone ELSE, so blank the owner-only activity
        # numbers, mirroring what browse_recipes does for anonymous callers. Left in,
        # `shared_with_count` would tell a keeper how many people the cook handed this
        # recipe to — and on a shelf labelled "Kept" that reads as "how many people keep
        # this", which is the removed child_count wearing a new noun.
        r.owner_cook_count = 0
        r.shared_with_count = 0
        r.last_cooked_at = None
    # Anything wanted that isn't visible is unreachable: restricted, unfriended, soft- or
    # hard-deleted. LOSING ACCESS IS PERMANENT — the bookmark is deleted here, not merely
    # hidden, so it can never reappear if the cook later re-opens the recipe. That is the
    # product rule: a deleted recipe is gone for everyone forever, a restricted one stops
    # being yours, and if the cook wants you to have it again they share it again.
    #
    # Only the caller's OWN RecipeSave rows are pruned. Handoff grants are never touched:
    # a grant is the cook's record that they gave you the dish (and `can_view` honours it
    # regardless of visibility), so the only way a handed recipe leaves this shelf is the
    # cook deleting the recipe — at which point the soft-delete filter keeps it gone
    # without deleting anyone's history.
    #
    # `unreachable_count` is therefore how many bookmarks were just REMOVED, reported once
    # so a shrinking shelf is explained rather than mysterious; the next load returns 0.
    unreachable_ids = wanted - {r.id for r in visible}

    # ...with ONE exception: a block (#85). Every other reason a recipe becomes unreachable is
    # the cook's doing and outside the caller's control — restricted, unfriended, deleted — so
    # deleting the bookmark is right. A block is the caller's OWN choice and is reversible from
    # the You page, so pruning for it would make unblocking silently lossy in a way nothing
    # warned them about: you'd unblock and your bookmarks of their recipes would simply be gone.
    # They're dropped from `unreachable_count` too — the shelf shrank for a reason this person
    # just caused deliberately, and "2 recipes are gone" would read as data loss.
    #
    # Note this affects SAVES only. A recipe they were HANDED stays on the shelf outright,
    # because can_view's grant branch survives a block (locked decision 3) and it therefore
    # never reaches this set at all.
    if blocked_owners:
        unreachable_ids -= {r.id for r in rows if r.user_id in blocked_owners}

    pruned = 0
    if unreachable_ids:
        pruned = (
            db.query(RecipeSave)
            .filter(
                RecipeSave.user_id == current_user.id,
                RecipeSave.recipe_id.in_(unreachable_ids),
            )
            .delete(synchronize_session=False)
        )
        db.commit()
    # Count every unreachable entry, not just the pruned bookmarks: an entry that was only
    # ever a handoff grant has no save row to delete, but the shelf still shrank by one and
    # the person deserves to be told.
    return KeptShelf(recipes=visible, unreachable_count=len(unreachable_ids) or pruned)


@router.post("/{recipe_id}/save", response_model=RecipeResponse, status_code=status.HTTP_201_CREATED)
def save_recipe(
    recipe_id: int,
    background_tasks: BackgroundTasks,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Keep a recipe you did not write (#57) — a bookmark, never a copy.

    You may only keep what you can already READ: this gates on `can_view`, the single
    read rule, and 404s otherwise. That direction matters — the save row is created by
    the READER, so it must never be able to widen access. `can_view` does not consult
    saves (services/sharing.py must never import RecipeSave), which is what stops
    "bookmark a private recipe to grant yourself read" from working.

    Idempotent: keeping twice returns the same shelf entry rather than erroring, and the
    UNIQUE(user_id, recipe_id) constraint backs that at the database for a double POST.
    """
    recipe = (
        db.query(Recipe)
        .options(selectinload(Recipe.user))
        .filter(Recipe.id == recipe_id, Recipe.deleted_at == None)
        .first()
    )
    if recipe is None or not can_view(recipe, current_user, db):
        # 404, not 403 — don't confirm a recipe exists to someone who can't read it.
        raise HTTPException(status_code=404, detail="Recipe not found")
    if recipe.user_id == current_user.id:
        raise HTTPException(
            status_code=400, detail="This one is already yours — it's in your recipes."
        )

    existing = (
        db.query(RecipeSave)
        .filter(RecipeSave.user_id == current_user.id, RecipeSave.recipe_id == recipe.id)
        .first()
    )
    if existing is None:
        db.add(RecipeSave(user_id=current_user.id, recipe_id=recipe.id))
        # Tell the cook, in the SAME transaction as the save (#96). notify() deliberately
        # doesn't commit, precisely so it lands with its cause — a keep that committed without
        # its notification would be a signal silently lost.
        #
        # Only on a NEW row, so re-POSTing an already-kept recipe stays silent: the endpoint is
        # idempotent and the notification has to be too. And dedupe=True because keep → unkeep →
        # keep is one tap each way; without it a cook's inbox fills with the same line, the
        # exact flood already fixed on the ask path (#79). While it's unread, one line stands
        # for "this got kept", however many times it was toggled.
        kept = notify(
            db,
            user_id=recipe.user_id,
            type="recipe_kept",
            actor_id=current_user.id,
            recipe_id=recipe.id,
            dedupe=True,
        )
        try:
            db.commit()
            # Only once the row is really there. The IntegrityError branch below rolls the
            # notification back with the save that lost the race, and a push for a row that no
            # longer exists would be the one notification nobody could ever open.
            notify_push.queue(background_tasks, [kept])
        except IntegrityError:
            # A concurrent keep for the same (user, recipe) won the race and tripped
            # uq_recipe_save_user_recipe. The check above only avoids a round-trip; the
            # DB constraint is the real guard, so absorb its error and treat the winner's
            # row as ours — otherwise a slow POST that the user retries (or a second tab)
            # 500s while the recipe IS in fact kept. Same shape as request_friend's
            # handler in app/routers/friends.py.
            db.rollback()
            if (
                db.query(RecipeSave.id)
                .filter(RecipeSave.user_id == current_user.id, RecipeSave.recipe_id == recipe.id)
                .first()
                is None
            ):
                raise  # genuinely unexpected — don't swallow it
    _attach_growth_fields(recipe, db)
    recipe.kept_by_me = True
    # No keeper_count here on purpose: the owner is rejected with a 400 above ("already
    # yours"), so the caller of THIS endpoint is never the owner and the count would be None
    # every time. The cook reads it from GET /recipes/{id}, their own recipe page.
    return recipe


@router.delete("/{recipe_id}/save", status_code=status.HTTP_204_NO_CONTENT)
def unsave_recipe(
    recipe_id: int,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Stop keeping a recipe. Only ever touches the CALLER's own shelf row — a keeper can
    remove their bookmark and nothing else; the cook's recipe is untouched, and one
    keeper un-keeping cannot affect another's shelf.

    Note this deliberately does NOT remove a handoff grant: if someone handed you the
    recipe, it stays on your shelf because they gave it to you. Un-keeping is only about
    the bookmark you added yourself.
    """
    row = (
        db.query(RecipeSave)
        .filter(RecipeSave.user_id == current_user.id, RecipeSave.recipe_id == recipe_id)
        .first()
    )
    if row is None:
        raise HTTPException(status_code=404, detail="Not kept")
    db.delete(row)
    db.commit()
    return None


@router.get("/users/{user_id}", response_model=list[RecipeResponse])
def user_recipes(
    user_id: int,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """A user's recipes, for their profile grid — the recipe half of #69 (the post half
    is GET /posts/users/{id}). Filtered by the ONE recipe read rule, can_view: your own →
    all; a friend → their public + friends recipes; a non-friend → only their public ones
    (never a private one, never one merely handed to you individually — that surfaces
    under /recipes/shared, not on someone's public grid). A non-friend on a private
    profile with nothing public just gets an empty list, not a 404 — the profile itself
    is reachable, mirroring GET /posts/users/{id}.

    Authorization note (privacy-sensitive): the query pre-filters to this owner's
    non-deleted rows, but the actual visibility decision is can_view — the single
    read-authorization rule (services/sharing.py). We do NOT write a second visibility
    filter here; a bespoke `WHERE visibility=...` could drift from can_view and leak.
    The viewer↔owner friendship is invariant across all their recipes, so it's resolved
    ONCE and passed to can_view as is_friend (avoids an are_friends query per recipe).

    NOTE: declared before GET /{recipe_id} so the literal "users" prefix isn't captured
    as recipe_id="users"."""
    author = db.query(User).filter(User.id == user_id).first()
    if author is None:
        raise HTTPException(status_code=404, detail="User not found")

    recipes = (
        db.query(Recipe)
        .filter(Recipe.user_id == user_id, Recipe.deleted_at == None)
        .options(
            selectinload(Recipe.ingredient_sections).selectinload(IngredientSection.ingredients),
            selectinload(Recipe.ingredients),
            selectinload(Recipe.steps),
            selectinload(Recipe.user),
        )
        .order_by(Recipe.created_at.desc())
        .all()
    )
    is_friend = user_id == current_user.id or are_friends(current_user.id, user_id, db)
    # Every recipe here has the same author, so the block is invariant across the grid —
    # resolve it once instead of per row (#85).
    blocked = is_blocked(current_user.id, user_id, db)
    # Handoff grants are per-recipe and orthogonal to friendship, but they don't belong
    # on a public profile grid (a recipe handed to you privately isn't "their profile"
    # content — it's in your /shared). So pass is_grantee=False to keep can_view's grant
    # branch from surfacing individually-shared recipes here.
    visible = [
        r
        for r in recipes
        if can_view(r, current_user, db, is_friend=is_friend, is_grantee=False, blocked=blocked)
    ]
    # Cap the RESPONSE, not the query: slicing after the can_view filter (rather than a
    # SQL LIMIT before it) means a stranger still gets the owner's public recipes even if
    # the newest rows are private — a pre-filter LIMIT could return an empty grid for a
    # prolific private user. The owner's own recipe count bounds the rows we load.
    visible = visible[:PROFILE_GRID_LIMIT]
    for r in visible:
        _attach_growth_fields(r, db)
    return visible


@router.post("/parse", response_model=ParsedRecipe)
async def parse_recipe_text(
    payload: ParseTextIn,
    current_user: User = Depends(get_current_user),
):
    """Structure whatever someone said about a recipe into the app's fields.

    Nothing is saved. The client shows the result for correction before anything is
    written, because the model is allowed to be wrong — see PasteRecipe.jsx.

    Auth-gated even though it touches no rows: it spends money per call, so it must not
    be reachable by anyone who happens to find the URL.

    RATE-LIMITED PER USER, and it is the one limit in this app about MONEY rather than safety. The
    auth gate above stops a stranger spending OpenRouter credits; it does nothing about one signed-in
    account calling this in a loop, which costs exactly as much. Keyed per USER rather than per
    address precisely because the route has a session: the spender is known, so the allowance belongs
    to them rather than to whatever network they share — two housemates writing recipes should not eat
    into each other's. Twenty an hour is far past anyone typing recipes by hand.

    NEVER 500s on the model's account. A missing key, a timeout, a rate limit or
    malformed JSON all return ai=False with empty fields, and the client falls back to
    its own line-based parser. That keeps /add working exactly as it did before this
    endpoint existed, which is the difference between adding a feature and adding a
    dependency.
    """
    rate_limit.enforce(
        rate_limit.user_key("parse", current_user.id),
        *rate_limit.PARSE_PER_USER,
        what="recipes parsed",
    )
    try:
        data = await extract_recipe(payload.text)
    except RecipeAIUnavailable:
        return ParsedRecipe(ai=False)
    return ParsedRecipe(**data, ai=True)


@router.get("/ingredient-suggestions", response_model=IngredientSuggestions)
def ingredient_suggestions(
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """The signed-in user's own ingredient vocabulary, for the add-form autosuggest.

    Declared BEFORE get_recipe so the literal path wins; otherwise
    GET /recipes/{recipe_id} captures recipe_id="ingredient-suggestions" (same
    reason /shared and /browse sit up here).

    SCOPE IS THE SECURITY PROPERTY. The join is pinned to
    `Recipe.user_id == current_user.id`, so a suggestion can only ever be a word
    this user typed themselves. Deliberately NOT widened to public recipes or to
    recipes handed off to this user, even though they're readable: an ingredient
    list is a behavioural trace, and a name that appears here because someone
    ELSE cooked with it tells you about their kitchen while looking like it came
    from yours. Autocomplete is exactly the surface where that inference is
    cheapest to make and hardest to notice, so the "readable" set and the
    "suggestible" set are kept different on purpose. Soft-deleted recipes drop
    out too — a deleted recipe shouldn't keep whispering its contents back.
    """
    rows = (
        db.query(Ingredient.name)
        .join(Recipe, Recipe.id == Ingredient.recipe_id)
        .filter(Recipe.user_id == current_user.id, Recipe.deleted_at == None)
        .all()
    )

    # Fold case/whitespace in Python rather than SQL: picking a representative
    # spelling for a case-insensitive group needs dialect-specific tricks, and
    # this set is one user's own ingredients — small enough that clarity and
    # SQLite/Postgres portability are worth more than pushing it down.
    counts: dict[str, int] = {}
    spellings: dict[str, dict[str, int]] = {}
    for (raw,) in rows:
        name = (raw or "").strip()
        if not name:
            continue
        key = name.casefold()
        counts[key] = counts.get(key, 0) + 1
        spellings.setdefault(key, {})
        spellings[key][name] = spellings[key].get(name, 0) + 1

    # Most-used first so the words someone reaches for daily are the ones they
    # never have to finish typing; alphabetical within a tie for a stable order.
    ordered = sorted(counts, key=lambda k: (-counts[k], k))
    names = [max(spellings[k].items(), key=lambda kv: (kv[1], kv[0]))[0] for k in ordered]
    # Bounded: past a few hundred the tail is never reached by a prefix match, and
    # the whole list is downloaded once on a phone.
    return IngredientSuggestions(names=names[:300])


def _rank_by_use(raw_values, limit=200):
    """Dedupe free-text values case-insensitively, most-used first, keeping the
    user's own most-common spelling of each. Shared by the autosuggest endpoints:
    picking a representative spelling for a case-insensitive group is fiddly enough
    that doing it once in Python beats a dialect-specific SQL trick per field."""
    counts: dict[str, int] = {}
    spellings: dict[str, dict[str, int]] = {}
    for raw in raw_values:
        value = (raw or "").strip()
        if not value:
            continue
        key = value.casefold()
        counts[key] = counts.get(key, 0) + 1
        spellings.setdefault(key, {})
        spellings[key][value] = spellings[key].get(value, 0) + 1
    ordered = sorted(counts, key=lambda k: (-counts[k], k))
    return [max(spellings[k].items(), key=lambda kv: (kv[1], kv[0]))[0] for k in ordered][:limit]


@router.get("/field-suggestions", response_model=FieldSuggestions)
def field_suggestions(
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """The signed-in user's OWN past values for the form's "Passed down from" and
    "Cuisine" fields, most-used first.

    Declared BEFORE get_recipe so the literal path wins (same reason as
    /ingredient-suggestions, /shared, /browse). SAME SCOPE = SAME SECURITY: every
    row is filtered to Recipe.user_id == current_user.id and non-deleted, so a
    suggestion can only be a word THIS user typed. Not widened to public or
    handed-off recipes even though they're readable — a source/cuisine that appears
    because someone else used it would leak their kitchen into this user's
    autocomplete. `origin_attribution` is the stored byline; its leading segment
    (before " · place/year") is the person's name the "Passed down from" field holds.
    """
    rows = (
        db.query(Recipe.origin_attribution, Recipe.cuisine)
        .filter(Recipe.user_id == current_user.id, Recipe.deleted_at == None)
        .all()
    )
    sources = _rank_by_use((r[0].split(" · ")[0] if r[0] else None) for r in rows)
    cuisines = _rank_by_use(r[1] for r in rows)
    return FieldSuggestions(sources=sources, cuisines=cuisines)


def _notify_cook_of_claim(db: Session, *, handoff: Handoff, claimer: User):
    """Tell the cook their recipe landed — the return half of the handoff (#32).

    **IT GOES TO THE RECIPE'S OWNER, NOT TO `handoff.from_user_id` (#78).** For every token the
    cook minted themselves those are the same person, so nothing about the original path changes.
    For a RESHARER's token they are not, and sending it to the resharer was wrong twice: the copy
    renders "{claimer} has your {dish} now" and it is not the resharer's dish — contradicting
    POSITIONING's "attribution stays on the cook" and CLAUDE.md's "never call it sharing *your*
    recipe" in the same breath as shipping them — and the COOK, whose recipe actually moved, learned
    nothing at all. Before #78 a cook always found out when their link was claimed; routing this to
    the owner keeps that true. Found by the ship gate.

    The resharer is deliberately told NOTHING here. Their feedback was the share sheet, and inventing
    a fourth notification type for "the person you sent it to opened it" is a separate feature with
    its own copy — ledgered rather than smuggled in.

    A sender has never had any way to know. They mint a grant, text the link, and that is the
    end of the information they get: `handoff_recipe` returns, and whether the person ever
    opened it is invisible from every surface in the app. This is the one notification the
    product's own reason for existing implies, and it was missing.

    Extracted because THREE code paths claim a grant — `accept_handoff`, and two of
    `claim_invite`'s branches — and each has a different way of deciding it just happened.
    Getting the "just happened" test wrong in one of them means either a silent claim or a
    notification on every idempotent re-claim, so the message itself lives in one place and
    each caller only answers the state question.

    NAMED, not anonymous. Claiming is addressed TO the cook: you are accepting something they
    chose to send you. That is the opposite of `recipe_kept`, where a stranger bookmarks a
    recipe you published and the identity is deliberately withheld. For a LINK-ONLY invite this
    means the cook learns the name of whoever claimed the link, which may be someone they
    didn't send it to directly — that is the intended signal, not a leak: the claimer took an
    action on the cook's recipe, and the cook is the one who put the link into the world.

    No `dedupe`: each caller has already established that this grant was unaccepted a moment
    ago, so the act happens exactly once per grant by construction.

    **BLOCK-GATED BY HAND, and this is the only notification in the app that needs to be.**
    Every other producer is already behind a block check by the time it can fire: `handoff_recipe`
    checks `is_blocked` explicitly, `save_recipe` and `request_recipe` gate on
    `can_view`/`can_view_post`, `request_friend`/`accept_friend` check by hand, and `block_user`
    deletes the pending asks that would otherwise reach `fulfill_post`. `claim_invite` and
    `accept_handoff` deliberately carry NO block check — #88's locked decision is that a token
    minted BEFORE a block stays claimable, because the token is the capability and the cook chose
    to send it — which was harmless for as long as those two routes called `notify()` zero times.
    Making them producers turned that exemption into a channel from a blocked person INTO the
    blocker's inbox, carrying their name and photo, and onto their lock screen where it cannot be
    recalled. `block_user`'s own sweep deletes existing notifications between the pair precisely
    because "you won't see each other anywhere" would otherwise be false; minting a new one after
    the block is the same falsehood, later.
    Found by the ship gate, which reproduced it end to end.

    **The claim still succeeds — only the telling is suppressed.** That keeps #88 intact: the
    grant is minted, the recipe is readable, and the person who was blocked is not told anything
    either (they get their normal 200). Returning None here is the same shape as `notify()`'s own
    self-notify suppression.
    """
    recipe = db.query(Recipe).filter(Recipe.id == handoff.recipe_id).first()
    if recipe is None:
        return None
    # The COOK, not the sender — see the note above. Identical for a cook-minted token.
    cook_id = recipe.user_id
    if is_blocked(cook_id, claimer.id, db):
        return None
    return notify(
        db,
        user_id=cook_id,
        type="recipe_claimed",
        actor_id=claimer.id,
        recipe_id=handoff.recipe_id,
    )


@router.post("/handoffs/{handoff_id}/accept", response_model=HandoffResponse)
def accept_handoff(
    handoff_id: int,
    background_tasks: BackgroundTasks,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    h = db.query(Handoff).filter(Handoff.id == handoff_id).first()
    if h is None:
        raise HTTPException(status_code=404, detail="Invite not found")
    # Only the intended recipient may accept. Two ways to be that person: the grant
    # already names your user id, or it was addressed to your email and has NOT yet
    # been bound to a user.
    #
    # The email branch is deliberately narrower than "the email matches": once
    # to_user_id is set the grant belongs to that user, and an email match must not be
    # able to re-point it. The previous form OR'd the two checks and then overwrote
    # to_user_id unconditionally, so a second person whose address matched to_email
    # could take over an already-claimed grant and silently revoke the first
    # recipient's access — the same grant-stealing shape claim_invite was rewritten to
    # avoid (see the comment there).
    if h.to_user_id is not None:
        is_recipient = h.to_user_id == current_user.id
    else:
        # CASE-INSENSITIVE, like both other halves of this feature. This route now serves only
        # pre-2026-09-23 rows, which makes it the place a case mismatch is MOST likely to be
        # sitting — the send side lower-cased from #105, the signup loop did not until this
        # round, so a row addressed to "Ana@x.com" for an account opened as "ana@x.com" is
        # exactly the shape that survived here. A third half disagreeing about case is how the
        # first two came to disagree.
        is_recipient = (
            h.to_email is not None
            and h.to_email.lower() == current_user.email.lower()
        )
    if not is_recipient:
        raise HTTPException(status_code=404, detail="Invite not found")
    # Read the state BEFORE mutating it, so the cook is told once — when the grant actually
    # changes hands — and not again on every idempotent re-accept.
    was_unaccepted = h.state != "accepted"
    h.to_user_id = current_user.id
    h.state = "accepted"
    claimed = (
        _notify_cook_of_claim(db, handoff=h, claimer=current_user) if was_unaccepted else None
    )
    db.commit()
    notify_push.queue(background_tasks, [claimed])
    db.refresh(h)
    return h


@router.get("/invite/{token}", response_model=InvitePreview)
def preview_invite(token: str, request: Request, db: Session = Depends(get_db)):
    # RATE-LIMITED BECAUSE THE TOKEN IS THE CAPABILITY. This route returns a WHOLE recipe with no
    # account, which makes a correct guess worth more here than anywhere else in the app — so it is
    # the one place where an unlimited guess rate matters even against a `secrets.token_urlsafe(32)` token. Generous on
    # purpose (60 in 15 minutes): a real recipient reloads the page, forwards the link, and comes back
    # to a dish days later, and the person this route exists for must never meet the limit.
    rate_limit.enforce(rate_limit.ip_key(request, "invite"), *rate_limit.INVITE_READ_PER_IP)
    # Unauthenticated read of a handed-off recipe. The token IS the capability:
    # whoever holds the link was given the dish, so they can read all of it
    # without an account — that's the handoff. What stays out of reach is bounded
    # by InvitePreview (no private `notes`, no account ids), not by a signup gate.
    h = db.query(Handoff).filter(Handoff.token == token).first()
    if h is None:
        raise HTTPException(status_code=404, detail="Invite not found")
    recipe = (
        db.query(Recipe)
        .filter(Recipe.id == h.recipe_id, Recipe.deleted_at == None)
        .options(
            selectinload(Recipe.ingredient_sections).selectinload(IngredientSection.ingredients),
            selectinload(Recipe.ingredients),
            selectinload(Recipe.steps),
            selectinload(Recipe.user),
        )
        .first()
    )
    if recipe is None:
        raise HTTPException(status_code=404, detail="Invite not found")
    _attach_growth_fields(recipe, db)
    from_name = None
    if recipe.user is not None:
        from_name = (
            " ".join(p for p in [recipe.user.first_name, recipe.user.last_name] if p) or None
        )
    return InvitePreview(
        recipe_id=recipe.id,
        name=recipe.name,
        from_name=from_name,
        origin_attribution=recipe.origin_attribution,
        story=recipe.story,
        growth_stage=recipe.growth_stage,
        growth_vitality=recipe.growth_vitality,
        cover_photo_url=recipe.cover_photo_url,
        description=recipe.description,
        servings=recipe.servings,
        prep_time_minutes=recipe.prep_time_minutes,
        cuisine=recipe.cuisine,
        diet=recipe.diet,
        ingredient_sections=[
            IngredientSectionResponse.model_validate(s) for s in recipe.ingredient_sections
        ],
        ingredients=[IngredientResponse.model_validate(i) for i in recipe.ingredients],
        steps=[StepResponse.model_validate(s) for s in recipe.steps],
    )


def _invite_from_name(recipe) -> str | None:
    """The name of the person the recipe is FROM — always its OWNER, which since #78 is no longer necessarily whoever minted the token: a resharer's link still unfurls and reads as the cook's, because attribution stays on the cook — for the byline
    'Charlie passed you…'. Shared by the JSON preview and the OG card."""
    if recipe.user is None:
        return None
    return " ".join(p for p in [recipe.user.first_name, recipe.user.last_name] if p) or None


@dataclass
class _InviteCard:
    """Just the fields the OG card needs — passed to build_invite_meta so it never
    touches an ORM object's lazy relationships or private columns."""

    name: str
    origin_attribution: str | None
    from_name: str | None
    description: str | None
    cover_photo_url: str | None


@router.get("/invite/{token}/preview", response_class=HTMLResponse)
def preview_invite_card(token: str, request: Request, db: Session = Depends(get_db)):
    """Link-preview (Open Graph) HTML for a shared /invite/{token} link.

    LIMITED ON ITS OWN, MUCH LARGER BUDGET (600 per 15 min), and the reasoning corrects a real error.
    The first version shared the JSON read's 60 — "two doors onto the same secret" — which is sound
    about the threat and wrong about the traffic. `frontend/vercel.json` uses a REWRITE: Vercel's edge
    proxies crawler traffic here server-side, so the address the ALB appends is a VERCEL EDGE address
    and every genuine unfurl for the whole app fans into one bucket. 60 per 15 minutes was therefore
    an app-wide cap on real link previews, past which every shared recipe unfurls as the generic card
    — silently, at 200. On the product's signature act. A ship gate found it.
    A bigger number costs nothing because the token is 256 bits (`secrets.token_urlsafe(32)`): 60 and
    600 are equally hopeless for a guesser, so these limits bound abuse VOLUME rather than protecting
    the token, and this door reveals strictly less than the JSON read (OG tags carry the dish name,
    byline and cover — never ingredients, steps or story).

    Crawlers (iMessage, WhatsApp, Slack, …) don't run the SPA's JS, so the recipe's
    OG tags have to be in the raw HTML. Vercel routes ONLY crawler user-agents on
    /invite/:token here (frontend/vercel.json); humans stay on the SPA. This returns
    the actual recipe's card (name, 'from {byline}', sender, cover photo) instead of
    the generic site card, then meta-refreshes any human who lands here to the real
    /invite/{token} page.

    A crawler must NEVER get a 5xx (that yields no preview at all), so a missing
    token or any load failure degrades to a generic-but-honest card, never an error.
    """
    site_origin = settings.app_url.rstrip("/")
    recipe = None
    reached = True
    # THE LIMIT HERE DEGRADES INSTEAD OF REFUSING, which is why this is `over_limit` and not the
    # `enforce` every other route uses. A 429 would satisfy the limiter and break the route's actual
    # contract — the docstring's "a crawler must NEVER get an error" is about the OUTCOME, and a 429
    # unfurls as nothing just as surely as a 500 does. That matters in a case that is not
    # hypothetical: Apple, Meta and Slack crawl from concentrated address ranges, so ONE crawler
    # address legitimately fetches previews for many different people's links, and a per-address limit
    # is the wrong shape for them even though it is the right shape for a guesser.
    #
    # `reached = False` is the existing neutral-card path (below), and it is the ideal refusal: the
    # token is never resolved, so a guesser learns nothing about whether it was real, while anyone
    # who hit the limit honestly still gets a valid "open on issei" card.
    if rate_limit.over_limit(
        rate_limit.ip_key(request, "invite-preview"), *rate_limit.INVITE_PREVIEW_PER_IP
    ):
        reached = False
    else:
        try:
            h = db.query(Handoff).filter(Handoff.token == token).first()
            if h is not None:
                recipe = (
                    db.query(Recipe)
                    .filter(Recipe.id == h.recipe_id, Recipe.deleted_at == None)
                    .options(selectinload(Recipe.user))
                    .first()
                )
            # h is None, or the recipe was deleted → recipe stays None with reached=True
            # → the builder shows the honest "this link isn't here" card. (Not "expired or moved":
            #   that copy was removed because nothing in issei expires, and a test forbids the word.)
        except Exception:
            # A DB blip: we could NOT confirm the token is gone, so this is distinct from
            # a 404. reached=False makes the builder show a neutral 'open on issei' card
            # rather than falsely calling a live link expired.
            reached = False

    from_name = _invite_from_name(recipe) if recipe is not None else None
    # Hand the builder a lightweight object carrying just the card fields, so it
    # never touches lazy relationships or private columns.
    card_recipe = None
    if recipe is not None:
        card_recipe = _InviteCard(
            name=recipe.name,
            origin_attribution=recipe.origin_attribution,
            from_name=from_name,
            description=recipe.description,
            cover_photo_url=recipe.cover_photo_url,
        )
    meta = build_invite_meta(
        card_recipe, site_origin=site_origin, token=token, reached=reached
    )
    html = render_invite_og_document(meta)
    # Short edge/CDN cache: previews are re-fetched on every share and change rarely.
    return HTMLResponse(
        content=html,
        headers={"Cache-Control": "public, max-age=300, stale-while-revalidate=86400"},
    )


@router.post("/invite/{token}/claim", response_model=HandoffResponse)
def claim_invite(
    token: str,
    request: Request,
    background_tasks: BackgroundTasks,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    # KEYED PER ADDRESS RATHER THAN PER USER even though this route has a session, because the threat
    # is token guessing and an attacker can hold as many accounts as they like — signup is cheap (and
    # now limited separately). Per-user would let them reset the allowance by making another account;
    # the address is the thing that costs them something. Its own bucket rather than the read's,
    # because a claim WRITES a grant, so it deserves the tighter number.
    rate_limit.enforce(
        rate_limit.ip_key(request, "invite-claim"), *rate_limit.INVITE_CLAIM_PER_IP
    )
    # Authenticated claim: the token IS the authorization to accept, so any
    # signed-in user holding the link can claim it — this resolves the
    # mismatched-email orphan (an invite to a@x claimed by someone who signed up
    # as b@y). Idempotent: re-claiming returns the same accepted grant.
    h = db.query(Handoff).filter(Handoff.token == token).first()
    if h is None:
        raise HTTPException(status_code=404, detail="Invite not found")

    # #88'S BLOCK EXEMPTION IS RESTRICTED TO COOK-MINTED TOKENS (#78, found by the ship gate,
    # reproduced end to end). Read the exemption's own justification carefully: a token minted
    # before a block stays claimable "because the token is the capability AND THE COOK CHOSE TO SEND
    # IT". #78 falsified the second clause — a resharer mints tokens the cook never chose, and can
    # mint them AFTER the block, without limit.
    #
    # What that bought, measured: Lola blocks Ben; Ana (any reader) mints a link on Lola's recipe;
    # Ben claims it and `GET /recipes/{id}` returns 200 IN-APP, permanently, surviving Lola later
    # making the recipe private. On an approved `friends`/`private` recipe it is worse — Ben reads a
    # private recipe including its story. That is precisely the hole CLAUDE.md says #85 closes: "a
    # NEW grant cannot cross a block, or the grant branch would be an uncapped channel into a
    # blocker's kitchen." #78 reopened it through a third party, and uncapped.
    #
    # WHY IT COULD NOT BE CAUGHT UPSTREAM: `handoff_recipe` refuses when the cook has blocked the
    # RESHARER, but a link-only grant has no named recipient, so there is nobody to check the cook
    # against at mint time. This is the first moment the claimer is known.
    #
    # THE COOK-MINTED CASE IS UNTOUCHED, byte for byte: when `from_user_id` IS the recipe's owner,
    # no check runs and #88 holds exactly as before. `accept_handoff` needs nothing — a resharer's
    # row carries `to_user_id=None` and `to_email=None`, so its recipient test already 404s.
    #
    # The unauthenticated READ (`preview_invite`) is deliberately not gated: there is no viewer to
    # check, and the durable grant is the harm rather than the glance.
    _claim_recipe = (
        db.query(Recipe).filter(Recipe.id == h.recipe_id, Recipe.deleted_at == None).first()
    )
    if (
        _claim_recipe is not None
        and h.from_user_id != _claim_recipe.user_id
        and is_blocked(_claim_recipe.user_id, current_user.id, db)
    ):
        # Same 404 body an unknown token gets, so a blocked person cannot distinguish "no such
        # invite" from "the cook blocked you" — #85's every-denial-is-identical rule.
        raise HTTPException(status_code=404, detail="Invite not found")

    # Already this user's grant (or an unclaimed one) → accept it in place.
    if h.to_user_id is None or h.to_user_id == current_user.id:
        # An UNCLAIMED grant is the one being taken for the first time; `to_user_id == me`
        # is a re-claim of my own, which must stay silent (this endpoint is idempotent, and
        # so is its notification). Tested as the state question rather than folded into the
        # branch above, because that branch deliberately serves both cases.
        was_unclaimed = h.to_user_id is None
        h.to_user_id = current_user.id
        h.state = "accepted"
        claimed = (
            _notify_cook_of_claim(db, handoff=h, claimer=current_user) if was_unclaimed else None
        )
        db.commit()
        notify_push.queue(background_tasks, [claimed])
        db.refresh(h)
        return h

    # A DIFFERENT user already claimed this link. Do NOT overwrite to_user_id —
    # that silently revoked the first claimer's access (can_view matches on
    # to_user_id). Instead give this user their own grant on the same recipe, so a
    # link shared with several people works for all of them.
    mine = (
        db.query(Handoff)
        .filter(Handoff.recipe_id == h.recipe_id, Handoff.to_user_id == current_user.id)
        .first()
    )
    if mine is not None:
        if mine.state != "accepted":
            mine.state = "accepted"
            claimed = _notify_cook_of_claim(db, handoff=mine, claimer=current_user)
            db.commit()
            notify_push.queue(background_tasks, [claimed])
            db.refresh(mine)
        return mine

    grant = Handoff(
        recipe_id=h.recipe_id,
        from_user_id=h.from_user_id,
        to_user_id=current_user.id,
        to_email=None,
        state="accepted",
        token=secrets.token_urlsafe(32),
    )
    db.add(grant)
    claimed = _notify_cook_of_claim(db, handoff=grant, claimer=current_user)
    db.commit()
    notify_push.queue(background_tasks, [claimed])
    db.refresh(grant)
    return grant


@router.get("/{recipe_id}", response_model=RecipeResponse)
def get_recipe(
    recipe_id: int, current_user: User = Depends(get_current_user), db: Session = Depends(get_db)
):
    # Viewable by the owner, by anyone if the recipe's effective visibility
    # (its root's visibility) is public, or by an accepted grantee on the root;
    # otherwise 404. Editing/deleting remains owner-only — see patch_recipe.
    recipe = (
        db.query(Recipe)
        .filter(Recipe.id == recipe_id, Recipe.deleted_at == None)
        .options(
            selectinload(Recipe.ingredient_sections).selectinload(IngredientSection.ingredients),
            selectinload(Recipe.ingredients),
            selectinload(Recipe.steps),
            selectinload(Recipe.user),
        )
        .first()
    )
    if not recipe:
        raise HTTPException(status_code=404, detail="Recipe not found")
    if not can_view(recipe, current_user, db):
        raise HTTPException(status_code=404, detail="Recipe not found")
    _attach_growth_fields(recipe, db)
    # Whether the CALLER keeps this one (#57), so the page can draw Keep vs Kept. Only
    # here — the single-recipe read — because this is the one screen with that control;
    # list endpoints leave it False rather than firing a query per row.
    if recipe.user_id != current_user.id:
        recipe.kept_by_me = (
            db.query(RecipeSave.id)
            .filter(RecipeSave.user_id == current_user.id, RecipeSave.recipe_id == recipe.id)
            .first()
            is not None
        )
    # ...and, for the OWNER only, how many people keep it (#96). This is the screen the cook
    # looks at, so it's where the count belongs. `_keeper_count` returns None for anyone else —
    # never 0 — so a non-owner client is given no number to render. Still no keeper NAMES and
    # no keeper list, anywhere, ever: the cook learns how many, never who.
    recipe.keeper_count = _keeper_count(recipe, current_user, db)
    # ...and whether this viewer may PASS IT ON, or where they are in asking (#78). Same placement
    # logic as `kept_by_me` above and for the same reason: this is the one screen that draws the
    # control, so a list endpoint must not pay for a query per row. `pass_on_state` returns None for
    # the owner — they use the ordinary send screen, which is a different verb — so the client never
    # has to work out which of two controls it is looking at.
    recipe.pass_on_state = pass_on_state(recipe, current_user, db)
    return recipe


@router.get("/{recipe_id}/scale", response_model=RecipeResponse)
def get_scaled_recipe(
    recipe_id: int,
    servings: int,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    # Gated like get_recipe: owner, public root, or accepted grantee only.
    recipe = (
        db.query(Recipe)
        .filter(Recipe.id == recipe_id, Recipe.deleted_at == None)
        .options(
            selectinload(Recipe.ingredient_sections).selectinload(IngredientSection.ingredients),
            selectinload(Recipe.ingredients),
            selectinload(Recipe.steps),
            selectinload(Recipe.user),
        )
        .first()
    )
    if not recipe:
        raise HTTPException(status_code=404, detail="Recipe not found")
    if not can_view(recipe, current_user, db):
        raise HTTPException(status_code=404, detail="Recipe not found")

    if recipe.servings is None:
        raise HTTPException(
            status_code=400, detail="Recipe does not have servings set - cannot scale"
        )

    multiplier = servings / recipe.servings

    # scale ingredients within sections
    scaled_sections = []
    for section in recipe.ingredient_sections:
        scaled_section_ings = [
            IngredientResponse.model_validate(scale_ingredient(ing, multiplier))
            for ing in section.ingredients
        ]
        scaled_sections.append(
            {
                "id": section.id,
                "name": section.name,
                "position": section.position,
                "ingredients": scaled_section_ings,
            }
        )

    scaled_ingredients = [
        IngredientResponse.model_validate(scale_ingredient(ing, multiplier))
        for ing in recipe.ingredients
    ]

    response_dict = {
        "id": recipe.id,
        "user_id": recipe.user_id,
        "name": recipe.name,
        "author_full_name": recipe.author_full_name,
        "cover_photo_url": recipe.cover_photo_url,
        "description": recipe.description,
        "story": recipe.story,
        "servings": servings,  # return TARGET servings, not original
        "prep_time_minutes": recipe.prep_time_minutes,
        "cuisine": recipe.cuisine,
        "diet": recipe.diet,
        "source": recipe.source,
        # No "notes": it is the owner's private scratchpad and is no longer on
        # RecipeResponse at all. This handler is gated on READ permission, not
        # ownership, so hand-copying it here shipped the scratchpad to every friend
        # and grantee who scaled a recipe. See the note on RecipeResponse.
        "language": recipe.language,
        "created_at": recipe.created_at,
        "deleted_at": recipe.deleted_at,
        "ingredient_sections": scaled_sections,
        "ingredients": scaled_ingredients,
        "steps": [StepResponse.model_validate(s) for s in recipe.steps],
    }

    return RecipeResponse.model_validate(response_dict)


@router.patch("/{recipe_id}", response_model=RecipeResponse)
def patch_recipe(
    recipe_in: RecipeUpdate,
    recipe_id: int,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    recipe = (
        db.query(Recipe)
        .filter(
            Recipe.id == recipe_id, Recipe.user_id == current_user.id, Recipe.deleted_at == None
        )
        .options(
            selectinload(Recipe.ingredient_sections).selectinload(IngredientSection.ingredients),
            selectinload(Recipe.ingredients),
            selectinload(Recipe.steps),
            selectinload(Recipe.user),
        )
        .first()
    )
    if not recipe:
        raise HTTPException(status_code=404, detail="Recipe not found")

    # Host-check the cover and every step photo BEFORE anything is written, so a bad URL anywhere in
    # the payload leaves the recipe exactly as it was rather than half-updated. This is the surface
    # #106's own "Change photo" control writes through, and it had no check until the ship gate said
    # so — the feature that introduced the rule was writing past it.
    _check_recipe_image_urls(recipe_in)

    # Which child collections did the client actually send? Use the dumped
    # set to detect presence, but read the values off the Pydantic model so
    # they stay as typed objects (IngredientCreate/StepCreate), not dicts.
    sent_fields = recipe_in.model_dump(exclude_unset=True)

    sections_sent = "ingredient_sections" in sent_fields
    ingredients_sent = "ingredients" in sent_fields
    steps_sent = "steps" in sent_fields

    new_sections = recipe_in.ingredient_sections if sections_sent else None
    new_ingredients = recipe_in.ingredients if ingredients_sent else None
    new_steps = recipe_in.steps if steps_sent else None

    # Attribution edit: `origin` is a structured OriginIn, not a column, so it maps
    # to origin_attribution the same way create does rather than being setattr'd
    # raw. A sent origin with a name (re)writes the byline; a sent origin whose name
    # is empty/None clears it. Omitting `origin` entirely leaves it untouched.
    if "origin" in sent_fields:
        o = recipe_in.origin
        if o is not None and o.name and o.name.strip():
            parts = [o.name.strip()] + [p for p in (o.place, o.year) if p]
            recipe.origin_attribution = " · ".join(parts)
        else:
            recipe.origin_attribution = None

    # Apply scalar fields only (skip the child collections + origin handled above).
    scalar_fields = {
        k: v
        for k, v in sent_fields.items()
        if k not in ("ingredient_sections", "ingredients", "steps", "origin")
    }
    # An explicit null on a NOT NULL column is a 422, not a 500. `RecipeUpdate` types every
    # field Optional so a client can omit it, which means an explicit `{"language": null}`
    # arrives as a sent field whose value is None — and `language` is NOT NULL with a
    # server_default, so setattr'ing None reached the database and came back as an
    # IntegrityError, i.e. an unhandled 500. Refusing it here rather than in the schema keeps
    # `Optional` honest (the field IS omittable) and puts the rule where the nullability
    # actually lives. Only `language` qualifies today; the rest of the scalars are nullable
    # columns where null is a legitimate "clear this".
    if "language" in scalar_fields and scalar_fields["language"] is None:
        raise HTTPException(
            status_code=422, detail="Language can't be empty — leave it out to keep it as it is."
        )
    for field, value in scalar_fields.items():
        setattr(recipe, field, value)

    # Replace children only when the client provided that collection. We bulk-
    # delete existing rows by recipe_id (synchronize_session=False bypasses ORM
    # instance tracking, avoiding stale-instance conflicts with the delete-orphan
    # cascade) and re-insert fresh. IDs aren't referenced externally, so
    # reassigning them is harmless. A fresh re-query happens after commit.
    recipe_id_val = recipe.id

    if sections_sent or ingredients_sent:
        db.query(Ingredient).filter(Ingredient.recipe_id == recipe_id_val).delete(
            synchronize_session=False
        )
        db.query(IngredientSection).filter(IngredientSection.recipe_id == recipe_id_val).delete(
            synchronize_session=False
        )
        db.flush()

        for section_in in new_sections or []:
            new_section = IngredientSection(
                recipe_id=recipe_id_val,
                name=section_in.name,
                position=section_in.position,
            )
            db.add(new_section)
            db.flush()
            for ing_in in section_in.ingredients:
                db.add(
                    Ingredient(
                        recipe_id=recipe_id_val,
                        section_id=new_section.id,
                        name=ing_in.name,
                        quantity_text=ing_in.quantity_text,
                        quantity_value=ing_in.quantity_value,
                        unit=ing_in.unit,
                        quantity_type=ing_in.quantity_type,
                        notes=ing_in.notes,
                        position=ing_in.position,
                    )
                )

        for ing_in in new_ingredients or []:
            db.add(
                Ingredient(
                    recipe_id=recipe_id_val,
                    section_id=None,
                    name=ing_in.name,
                    quantity_text=ing_in.quantity_text,
                    quantity_value=ing_in.quantity_value,
                    unit=ing_in.unit,
                    quantity_type=ing_in.quantity_type,
                    notes=ing_in.notes,
                    position=ing_in.position,
                )
            )

    if steps_sent:
        db.query(Step).filter(Step.recipe_id == recipe_id_val).delete(synchronize_session=False)
        db.flush()
        for step_in in new_steps:
            db.add(
                Step(
                    recipe_id=recipe_id_val,
                    position=step_in.position,
                    content=step_in.content,
                    section_header=step_in.section_header,
                    voice_note=step_in.voice_note,
                    photo_url=step_in.photo_url,
                )
            )

    db.commit()

    # Re-fetch a clean instance with children eagerly loaded (don't refresh the
    # working instance, whose relationship collections may hold deleted rows).
    db.expire_all()
    recipe = (
        db.query(Recipe)
        .filter(Recipe.id == recipe_id_val)
        .options(
            selectinload(Recipe.ingredient_sections).selectinload(IngredientSection.ingredients),
            selectinload(Recipe.ingredients),
            selectinload(Recipe.steps),
            selectinload(Recipe.user),
        )
        .first()
    )
    return recipe


@router.delete("/{recipe_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_recipe(
    recipe_id: int, current_user: User = Depends(get_current_user), db: Session = Depends(get_db)
):
    recipe = (
        db.query(Recipe)
        .filter(
            Recipe.id == recipe_id, Recipe.user_id == current_user.id, Recipe.deleted_at == None
        )
        .first()
    )
    if not recipe:
        raise HTTPException(status_code=404, detail="Recipe not found")

    recipe.deleted_at = datetime.now(timezone.utc)

    db.add(recipe)
    db.commit()
