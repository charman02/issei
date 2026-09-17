from typing import Annotated, Literal, Optional
from pydantic import BaseModel, EmailStr, Field, ConfigDict, StringConstraints
from datetime import datetime


# A person's name is load-bearing here: every recipe carries a byline, so a name
# that renders as nothing leaves a dish with no one attached to it. Stripping
# first and then requiring one character is what rejects "" and "   " with the
# same rule. 80 is generous enough for long multi-part names while keeping a
# byline something the layout can hold.
PersonName = Annotated[
    str, StringConstraints(strip_whitespace=True, min_length=1, max_length=80)
]


class UserBase(BaseModel):
    email: EmailStr
    first_name: str
    last_name: str


# The name rules live on the INPUT model only, deliberately. UserResponse also
# inherits UserBase, and tightening it there would turn any already-stored blank
# name into a 500 on read — punishing the existing account for a rule it was
# created before. New accounts can't get in without a real name; old ones stay
# readable.
class UserCreate(UserBase):
    first_name: PersonName
    last_name: PersonName
    # 72 bytes is bcrypt's own ceiling — anything longer is silently truncated,
    # so accepting it would mean accepting a password we don't fully check.
    password: str = Field(min_length=8, max_length=72)


class UserResponse(UserBase):
    id: int
    # "public" | "private" — whose recipes/posts a stranger can see. Read-safe to
    # expose (unlike the name rules, no stored row can violate it: the column is NOT
    # NULL with a server_default, so every user has a concrete value).
    profile_visibility: str = "private"
    # Cloudinary URL of the profile picture, or None → the UI shows the monogram.
    photo_url: Optional[str] = None
    # Notification settings (#89). SERVER-OWNED, unlike every other settings toggle in this app,
    # which lives in the client's `issei_prefs` localStorage bag. That difference is the whole
    # point: a push is delivered with the browser closed, by a server that cannot read
    # localStorage — so a preference stored there would look correct in every test and in local
    # use, while a user who switched notifications OFF kept receiving them.
    #
    # Safe to expose on read: all five are NOT NULL with server_defaults, so no stored row can
    # violate the type (the same reasoning that puts `profile_visibility` here). `timezone` is
    # nullable because every account predating #89 has none.
    timezone: Optional[str] = None
    notify_hour: int = 18
    notify_prompt_me: bool = True
    notify_prompt_every_days: int = 1
    notify_friend_posts: bool = True
    notify_people: bool = True
    quiet_from: int = 22
    quiet_to: int = 8
    # The two #105 settings. Safe to expose for the same reason as the others: both are NOT NULL
    # with a server_default, so no stored row can violate the type.
    #
    # `invite_permission` is the caller's OWN setting only — it is on UserResponse, which is
    # returned by /auth/me and /auth/login, never by a route that describes someone else. Leaking
    # another person's value would tell a sender in advance whether an address will accept an
    # unsolicited recipe, which is exactly the thing `handoff_recipe`'s uniform 404 exists to hide.
    invite_permission: str = "anyone"
    default_recipe_visibility: str = "friends"
    created_at: datetime

    model_config = ConfigDict(from_attributes=True)


# Editing an existing account (PATCH /auth/me). Every field is optional so a caller
# sends only what's changing. The name rules match UserCreate (a byline can't become
# blank); email is validated + checked unique in the router. Changing email or
# password requires current_password — those alter the login identity, so a stolen,
# unlocked session shouldn't be able to lock the real owner out. A name edit is
# low-risk and needs no password.
class AccountUpdate(BaseModel):
    first_name: Optional[PersonName] = None
    last_name: Optional[PersonName] = None
    email: Optional[EmailStr] = None
    # bcrypt's 72-byte ceiling, same as signup — longer is silently truncated.
    new_password: Optional[str] = Field(default=None, min_length=8, max_length=72)
    # Verified in the router before an email or password change is allowed.
    current_password: Optional[str] = None
    # Who can see this user's recipes/posts. Low-risk like a name edit — it exposes
    # only the user's own content, so it needs no current_password (unlike email /
    # password, which are login identity).
    profile_visibility: Optional[Literal["public", "private"]] = None
    # Optional bulk sweep, sent alongside a profile_visibility change: set EVERY one of
    # the user's recipes and posts to this concrete value in one action. Used by the
    # confirm dialog — "make everything public" sends "public" when opening the profile;
    # "make everything friends-only" sends "friends" when closing it. Applied AFTER
    # profile_visibility in the router. Because values are concrete (no live-follow), a
    # profile flip alone changes NOTHING existing — this sweep is the only way to
    # bulk-rescope what's already there, and it's always an explicit, confirmed choice.
    apply_visibility_to_all: Optional[Literal["public", "friends", "private"]] = None
    # Who may pre-address a handoff to you (#105). Low-risk like the others — it only narrows what
    # reaches YOU and is instantly reversible, so no current_password. A Literal rather than a free
    # string so an unknown value is a 422 rather than a silently permissive setting: "anythin" must
    # not fail open into "anyone".
    invite_permission: Optional[Literal["anyone", "friends"]] = None
    # What the create form pre-selects for a new recipe (#105). THREE values, matching an item's
    # concrete visibility — and note this is NOT the same field as `profile_visibility` above,
    # which is two-valued and still drives the bulk sweep. Changing this moves nothing already
    # saved; per #68 an item's visibility is stored literally at create time.
    default_recipe_visibility: Optional[Literal["public", "friends", "private"]] = None
    # Profile picture URL (from POST /upload/avatar), or "" / null to clear back to the
    # monogram. Low-risk like a name edit — no current_password. Empty string is allowed
    # here (unlike the name rules) precisely so a user can remove their photo.
    #
    # The router pins the HOST (it must be a Cloudinary HTTPS URL); this pins the LENGTH,
    # which nothing did — a megabyte of string beginning "https://x.cloudinary.com/" passed
    # every check that existed. No min_length, because "" is how you remove the photo.
    photo_url: Optional[Annotated[str, StringConstraints(max_length=500)]] = None
    # Notification settings (#89). All optional, `None` = unchanged, like everything else here.
    #
    # `timezone` is sent by the CLIENT from Intl.DateTimeFormat().resolvedOptions().timeZone —
    # on login and on signup, not just from a settings screen, because a user who never opens
    # settings still needs to be reachable at a sane hour. Bounded but NOT checked against the tz
    # database: an unknown zone degrades to "never due" with a log in
    # `services/prompt.local_now()`, which is better than 422ing someone whose browser reports a
    # zone this Python build hasn't heard of.
    #
    # The hours are bounded 0-23, and that is not a validation nicety: the scheduler compares
    # `notify_hour` against a real clock hour, so an out-of-range value means a user who is never
    # due again — a silent opt-out they didn't ask for.
    timezone: Optional[Annotated[str, StringConstraints(max_length=64)]] = None
    notify_hour: Optional[int] = Field(default=None, ge=0, le=23)
    # THREE SWITCHES, split by SUBJECT: the app asking YOU to share a meal, a friend having
    # shared one, and a person reaching you. See `User.notify_prompt_me` for why this is not the
    # three-value cadence it replaced.
    notify_prompt_me: Optional[bool] = None
    # HOW OFTEN the prompt may arrive, as a minimum gap in local days. Bounded rather than a
    # `Literal` because every value >= 1 is meaningful (see the column's comment): 1 is the existing
    # daily behaviour, and the client offers 1 / 3 / 7. The ceiling is a month — past that, the
    # honest way to say it is `notify_prompt_me: false`.
    notify_prompt_every_days: Optional[int] = Field(default=None, ge=1, le=30)
    notify_friend_posts: Optional[bool] = None
    notify_people: Optional[bool] = None
    quiet_from: Optional[int] = Field(default=None, ge=0, le=23)
    quiet_to: Optional[int] = Field(default=None, ge=0, le=23)
    # TWO DEPRECATED ALIASES, kept only for the deploy window — and this file now has two
    # generations of them, which is itself the argument for getting the model right the first time.
    #
    # Pydantic ignores unknown fields, so dropping one outright gives an older frontend build a
    # cheerful 200 for a request that changed nothing — and Vercel and ECS deploy independently, so
    # the window is real. For a note on a handoff that trade was fine (#102); for "stop
    # interrupting me" it is not, because the person is told it worked.
    #
    # `notify_prompt` maps to `notify_prompt_me`, which is the meaning its NAME always claimed —
    # #89's own comment called it "the app nudging YOU" while filling it with other people's
    # activity. `notify_posts` maps to BOTH new switches, the same way the migration backfills.
    # An explicit new field always wins over an alias; a test pins that.
    notify_prompt: Optional[bool] = None
    notify_posts: Optional[Literal["instant", "daily", "off"]] = None
