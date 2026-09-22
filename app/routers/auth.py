import logging
import uuid
from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, Depends, HTTPException, Request, status
from fastapi.security import OAuth2PasswordRequestForm
from pydantic import BaseModel, EmailStr
from sqlalchemy.orm import Session

from app.database import get_db
from app.models.user import User
from app.models.handoff import Handoff
from app.models.password_reset import PasswordResetToken
from app.schemas.user import UserCreate, UserResponse, AccountUpdate
from app.auth import hash_password, verify_password, create_access_token, get_current_user
from app.services import rate_limit
from app.services.email import send_password_reset_email
from app.services.media import require_our_image_url

logger = logging.getLogger(__name__)


class ForgotPasswordRequest(BaseModel):
    email: EmailStr


class ResetPasswordRequest(BaseModel):
    token: str
    new_password: str

router = APIRouter(prefix="/auth", tags=["auth"])


@router.post("/signup", response_model=UserResponse, status_code=status.HTTP_201_CREATED)
def signup(request: Request, user_in: UserCreate, db: Session = Depends(get_db)):
    # Bounded per address because this route CREATES PUBLIC STATE: since #80 every account is listed
    # by name in `GET /friends/discover`, so mass signup does not just fill a table, it fills every
    # real user's directory. Counted per attempt rather than per success — a script probing which
    # addresses are already registered (this route answers "Email already registered", deliberately)
    # is the same load and the same abuse.
    rate_limit.enforce(rate_limit.ip_key(request, "signup"), *rate_limit.SIGNUP_PER_IP)
    existing_user = db.query(User).filter(User.email == user_in.email).first()
    if existing_user:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST, detail="Email already registered"
        )
    hashed = hash_password(user_in.password)
    new_user = User(
        email=user_in.email,
        hashed_password=hashed,
        first_name=user_in.first_name,
        last_name=user_in.last_name,
    )
    db.add(new_user)
    db.commit()
    # re-read from db to populate server-generated fields (id, created_at)
    db.refresh(new_user)
    # Auto-accept any pending recipe invites addressed to this email (sharing spec §4.2).
    pending = (
        db.query(Handoff)
        .filter(Handoff.to_email == new_user.email, Handoff.state == "pending")
        .all()
    )
    for h in pending:
        h.to_user_id = new_user.id
        h.state = "accepted"
    if pending:
        db.commit()
        db.refresh(new_user)
    return new_user


@router.post("/login")
def login(
    request: Request,
    form_data: OAuth2PasswordRequestForm = Depends(),
    db: Session = Depends(get_db),
):
    """Exchange credentials for a token.

    THE TWO LIMITS HERE ARE ASYMMETRIC, AND THAT ASYMMETRY IS THE WHOLE DESIGN. Getting it wrong in
    the obvious direction — one pre-check covering both dimensions — hands every account on the app a
    remote lockout switch: the addresses are public (#80), so ten deliberate wrong guesses against
    someone's email would lock that person out of their own account for fifteen minutes, repeatable
    forever by a script. A safety feature that lets a stranger deny you your account is worse than
    the brute-force exposure it closes.
      - PER IP is a PRE-CHECK, refused before the bcrypt comparison runs. bcrypt is deliberately slow
        (~100ms), so an unbounded attempt rate is a CPU exhaustion vector on a 0.5-vCPU task quite
        apart from the guessing; refusing early is what actually protects it. An address is the
        caller's own resource, so cutting it off costs nobody else.
      - PER ACCOUNT is a POST-CHECK, and only failures count. The password is verified FIRST, so a
        CORRECT password is never refused no matter how many wrong ones preceded it. The attacker
        gains nothing (their guesses are all wrong, and they are still cut off), while the account's
        real owner cannot be locked out by anyone but themselves.

    A distributed attacker rotating addresses against one account still spends a bcrypt per guess —
    the per-account limit bounds their progress, not their load. Bounding that needs a WAF in front,
    which is a different purchase; this is recorded as a known edge rather than implied away.
    """
    ip_bucket = rate_limit.ip_key(request, "login")
    account_bucket = rate_limit.account_key("login", form_data.username)
    rate_limit.refuse_if_over(ip_bucket, *rate_limit.LOGIN_PER_IP)

    user = db.query(User).filter(User.email == form_data.username).first()
    if not user or not verify_password(form_data.password, user.hashed_password):
        rate_limit.note_failure(ip_bucket, *rate_limit.LOGIN_PER_IP)
        rate_limit.note_failure(account_bucket, *rate_limit.LOGIN_PER_ACCOUNT)
        # Asked AFTER recording, so the attempt that fills the bucket is itself answered with the
        # wait rather than a 401 that invites one more try. Nothing is lost by that: the password was
        # wrong either way, and the 429 is the more useful of the two answers.
        rate_limit.refuse_if_over(account_bucket, *rate_limit.LOGIN_PER_ACCOUNT)
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid email or password",
            headers={"WWW-Authenticate": "Bearer"},
        )
    # A SUCCESS CLEARS THE ACCOUNT BUCKET AND DELIBERATELY NOT THE IP ONE. Clearing the account's
    # failures is right: signing in is positive evidence of ownership, which is what the failure
    # count was standing in for, so someone who fumbled nine passwords and then remembered is not
    # left one mistake from a wait. Clearing the IP bucket would be a hole — an attacker holding ONE
    # valid credential could log into their own account every twenty-nine guesses and reset the
    # per-address limit forever, which is exactly the limit that protects the CPU.
    rate_limit.clear(account_bucket)
    token = create_access_token({"sub": str(user.id)})
    return {
        "access_token": token,
        "token_type": "bearer",
        "user": {
            "id": user.id,
            "email": user.email,
            "first_name": user.first_name,
            "last_name": user.last_name,
            # Include profile_visibility so the cached issei_user (the ONLY client
            # hydration point — there's no /auth/me refetch) stays honest. Without it,
            # a re-login would drop the field and the UI would default to "private",
            # telling a public-profile user their kitchen is friends-only when it isn't.
            "profile_visibility": user.profile_visibility,
            # #105 — the create form reads this to pre-select a new recipe's visibility, and it
            # has to be in the cached user for the same reason profile_visibility is: the form
            # renders before any /auth/me round trip would answer.
            "default_recipe_visibility": user.default_recipe_visibility,
            "invite_permission": user.invite_permission,
            # Same reason — the cached user drives the You-box avatar; a re-login that
            # dropped it would blank the photo back to the monogram until the next edit.
            "photo_url": user.photo_url,
            # Notification settings (#89). THIS DICT IS HAND-BUILT AND HAS TO BE KEPT IN STEP
            # WITH `UserResponse` — the identical omission has shipped twice, and it fails only
            # in the window between login and the first `reconcile()`, so it passes every backend
            # test and every component test with a seeded cache. A settings screen would render a
            # switch as `undefined` (reading as off) for exactly one page load.
            "timezone": user.timezone,
            "notify_hour": user.notify_hour,
            "notify_prompt_me": user.notify_prompt_me,
            "notify_prompt_every_days": user.notify_prompt_every_days,
            "notify_friend_posts": user.notify_friend_posts,
            "notify_people": user.notify_people,
            "quiet_from": user.quiet_from,
            "quiet_to": user.quiet_to,
        },
    }


@router.get("/me", response_model=UserResponse)
def get_me(current_user: User = Depends(get_current_user)):
    return current_user


@router.patch("/me", response_model=UserResponse)
def update_me(
    update: AccountUpdate,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Edit the signed-in account: name, email, and/or password.

    Only fields present in the body change. Email and password changes require the
    correct current_password (they alter the login identity); a name change does
    not. Email must be unique. On success the whole (updated) user is returned so
    the client can refresh its cached copy.
    """
    changing_email = update.email is not None and update.email != current_user.email
    changing_password = update.new_password is not None

    # Sensitive changes are gated on the current password. Checked once, up front,
    # so an email+password change in one request can't half-apply.
    if changing_email or changing_password:
        if not update.current_password or not verify_password(
            update.current_password, current_user.hashed_password
        ):
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Your current password isn't right.",
            )

    if changing_email:
        taken = (
            db.query(User)
            .filter(User.email == update.email, User.id != current_user.id)
            .first()
        )
        if taken:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="That email is already in use.",
            )
        current_user.email = update.email

    if changing_password:
        current_user.hashed_password = hash_password(update.new_password)

    if update.first_name is not None:
        current_user.first_name = update.first_name
    if update.last_name is not None:
        current_user.last_name = update.last_name
    if update.profile_visibility is not None:
        # Low-risk like a name edit (exposes only the user's own content), so no
        # current_password gate. Item visibility is concrete, so this flip alone changes
        # NOTHING already stored — it only sets the default the create form auto-selects
        # next time. To rescope existing items, the caller sends apply_visibility_to_all.
        current_user.profile_visibility = update.profile_visibility

    # The two #105 settings. No current_password: one only narrows what reaches the caller, the
    # other only changes what a form pre-selects, and both are instantly reversible.
    if update.invite_permission is not None:
        current_user.invite_permission = update.invite_permission
    if update.default_recipe_visibility is not None:
        current_user.default_recipe_visibility = update.default_recipe_visibility

    if update.photo_url is not None:
        # Low-risk like a name edit — no password. An empty/blank string clears the photo
        # back to the monogram (stored as NULL). A non-blank value must be a Cloudinary
        # HTTPS URL — i.e. one our own POST /upload/avatar produced. This is the guard the
        # ship review asked for: photo_url is rendered as <img src> to anyone who sees the
        # user's name, so accepting an arbitrary URL would let someone point it at an
        # external tracking pixel that leaks every viewer's IP. Not XSS (an <img src> won't
        # run javascript:/data: script), but a real privacy leak, so we pin the host.
        #
        # The host rule itself now lives in `services/media.py`, shared with
        # `PATCH /posts/{id}` (#106). It was inline here, and the next write to accept a photo
        # URL shipped with no check at all — which is what a rule living in one router does.
        # The BLANK-CLEARS behaviour stays here rather than moving into the service, because it
        # is specific to this field: a profile photo is optional (NULL → monogram) while a
        # post's is `nullable=False`, so the same blank value must mean opposite things.
        photo = (update.photo_url or "").strip()
        if not photo:
            current_user.photo_url = None
        else:
            current_user.photo_url = require_our_image_url(photo, what="profile photo")

    if update.apply_visibility_to_all is not None:
        # Bulk sweep, chosen in the confirm dialog: set EVERY recipe and post to one
        # concrete value ("public" when opening the profile, "friends" when closing it).
        # Because item visibility is concrete (no live-follow), a profile flip alone
        # changes nothing existing — this sweep is the only way to bulk-rescope what's
        # already there, and it's always an explicit, confirmed choice. Applied after
        # profile_visibility so it's one request. Bulk UPDATEs (not per-row), O(1)
        # queries regardless of item count.
        from app.models.recipe import Recipe
        from app.models.post import Post

        target = update.apply_visibility_to_all
        db.query(Recipe).filter(Recipe.user_id == current_user.id).update(
            {Recipe.visibility: target}, synchronize_session=False
        )
        db.query(Post).filter(Post.user_id == current_user.id).update(
            {Post.visibility: target}, synchronize_session=False
        )

    # Notification settings (#89). Applied last and plainly: each is independent, none needs a
    # password (they change nothing anyone else can see and nothing that can't be undone), and
    # `None` means unchanged like everywhere else here.
    #
    # `timezone` arrives on LOGIN and SIGNUP too, not just from a settings screen — a user who
    # never opens settings still has to be reachable at a sane hour, and it is the client that
    # knows the answer (Intl.DateTimeFormat().resolvedOptions().timeZone). It is also the one
    # field here a user does not consciously set, which is why it is not rendered as a control.
    #
    # No cross-field validation: `quiet_from == quiet_to` means "no quiet hours" rather than a
    # 24-hour blackout (see `services/push.in_quiet_hours`), and a `notify_hour` that lands inside
    # someone's own quiet window is a coherent configuration meaning "not for now" — refusing
    # either would be the app second-guessing a choice it can't actually read the intent of.
    for field in (
        "timezone",
        "notify_hour",
        "notify_prompt_me",
        "notify_prompt_every_days",
        "notify_friend_posts",
        "notify_people",
        "quiet_from",
        "quiet_to",
    ):
        value = getattr(update, field)
        if value is not None:
            setattr(current_user, field, value)

    # THE TWO DEPRECATED ALIASES, each honoured only where its explicit field is absent — see
    # AccountUpdate. An older client build sending one means "stop interrupting me", and discarding
    # it because a column was renamed would tell someone their opt-out worked when it didn't. This
    # file now carries two generations of alias, which is itself the argument for getting the model
    # right the first time.
    #
    # `notify_posts` maps to BOTH switches, exactly as the migration backfills, which is the only
    # honest reading: 'instant' and 'daily' both meant "reachable" and 'off' meant "leave me alone",
    # while nobody using that field ever expressed an opinion about being PROMPTED to post, because
    # the app didn't do that yet.
    if update.notify_posts is not None:
        reachable = update.notify_posts != "off"
        if update.notify_prompt_me is None:
            current_user.notify_prompt_me = reachable
        if update.notify_friend_posts is None:
            current_user.notify_friend_posts = reachable
    # `notify_prompt` was #89's daily-nudge switch, and `notify_prompt_me` is the meaning its NAME
    # always claimed — that task's own comment called it "the app nudging YOU" while filling it with
    # other people's activity. So this one maps straight across, and it wins over `notify_posts`
    # because it is the more specific statement of the same intent.
    if update.notify_prompt_me is None and update.notify_prompt is not None:
        current_user.notify_prompt_me = update.notify_prompt

    db.commit()
    db.refresh(current_user)
    return current_user


class DeleteAccountRequest(BaseModel):
    password: str


@router.delete("/me", status_code=status.HTTP_204_NO_CONTENT)
def delete_account(
    body: DeleteAccountRequest,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Permanently delete the signed-in account and all associated data."""
    if not verify_password(body.password, current_user.hashed_password):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Your password isn't right.",
        )
    db.delete(current_user)
    db.commit()


@router.post("/forgot-password", status_code=status.HTTP_204_NO_CONTENT)
def forgot_password(
    request: Request, body: ForgotPasswordRequest, db: Session = Depends(get_db)
):
    """Request a password-reset email.

    Always returns 204 — even when the email is not registered — so the
    response gives no information about which accounts exist.

    THE TIGHTEST PER-ACCOUNT LIMIT IN THE APP, because this is the only route where a stranger can
    make a THIRD PARTY's phone buzz: the caller names the address and we send mail to it. Unthrottled,
    that is a harassment channel with someone else's inbox as the target and our SES quota as the
    fuel. Three an hour is enough for a first email that landed in spam, and useless for flooding.

    BOTH LIMITS ARE CHECKED BEFORE THE ADDRESS IS RESOLVED, which is what keeps the unconditional 204
    honest. Counting only addresses that exist, or refusing only those, would make the limiter answer
    the question the 204 exists to refuse — and a 429 that arrives only for real accounts is a
    cleaner existence oracle than an error message, because it is machine-readable.
    """
    # THE COPY IS WRITTEN FOR THE PERSON WHO ACTUALLY HITS THIS, which a ship gate pointed out is
    # almost never an attacker: it is someone whose reset mail went to spam, who clicked "send" three
    # times in two minutes, and who cannot sign in. "Too many attempts" tells them nothing; naming the
    # spam folder tells them where the email they already have is. It is UNCONDITIONAL — a real and an
    # invented address get this identical sentence — so it stays no account-existence oracle, which is
    # the property the unconditional 204 exists for and the limiter must not undo.
    #
    # Worth recording, because it is what makes 3/hr defensible rather than a denial-of-recovery
    # weapon: an attacker burning a victim's three ALSO DELIVERS a working reset link to that victim,
    # since this route deletes prior unused tokens and mails a fresh one valid for an hour. So the
    # tight limit cannot be used to keep someone locked out of their own account.
    _MAILED = "A reset link is already on its way — check your spam folder."
    rate_limit.enforce(
        rate_limit.ip_key(request, "forgot"), *rate_limit.FORGOT_PER_IP, message=_MAILED
    )
    rate_limit.enforce(
        rate_limit.account_key("forgot", body.email),
        *rate_limit.FORGOT_PER_ACCOUNT,
        message=_MAILED,
    )
    user = db.query(User).filter(User.email == body.email).first()
    if not user:
        return

    # Invalidate any still-pending tokens for this user so there is at most
    # one live link at a time (avoids confusion if someone clicks an old one).
    db.query(PasswordResetToken).filter(
        PasswordResetToken.user_id == user.id,
        PasswordResetToken.used.is_(False),
    ).delete()

    token = str(uuid.uuid4())
    record = PasswordResetToken(
        user_id=user.id,
        token=token,
        expires_at=datetime.now(timezone.utc) + timedelta(hours=1),
        used=False,
    )
    db.add(record)
    db.commit()

    try:
        send_password_reset_email(user.email, token)
    except Exception:
        logger.exception("SES send failed for %s", user.email)
        # Don't surface the SES error to the client — the response must stay
        # silent whether or not the email account exists.


@router.post("/reset-password", status_code=status.HTTP_204_NO_CONTENT)
def reset_password(
    request: Request, body: ResetPasswordRequest, db: Session = Depends(get_db)
):
    """Consume a reset token and update the password.

    Per address only — there is no account to key on until the token resolves, and keying on the
    token would give every guess its own fresh bucket, which is the shape of limiter that does
    nothing. The token is a uuid4 (122 random bits), so guessing was never the realistic threat; this
    is here so the route cannot be hammered for free, and so the limit exists before someone shortens
    the token.
    """
    rate_limit.enforce(rate_limit.ip_key(request, "reset"), *rate_limit.RESET_PER_IP)
    if len(body.new_password) < 8:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Password must be at least 8 characters.",
        )

    record = (
        db.query(PasswordResetToken)
        .filter(
            PasswordResetToken.token == body.token,
            PasswordResetToken.used.is_(False),
            PasswordResetToken.expires_at > datetime.now(timezone.utc),
        )
        .first()
    )
    if not record:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="This reset link is invalid or has expired.",
        )

    user = db.query(User).filter(User.id == record.user_id).first()
    user.hashed_password = hash_password(body.new_password)
    record.used = True
    db.commit()
