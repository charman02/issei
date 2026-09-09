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
    # Profile picture URL (from POST /upload/avatar), or "" / null to clear back to the
    # monogram. Low-risk like a name edit — no current_password. Empty string is allowed
    # here (unlike the name rules) precisely so a user can remove their photo.
    #
    # The router pins the HOST (it must be a Cloudinary HTTPS URL); this pins the LENGTH,
    # which nothing did — a megabyte of string beginning "https://x.cloudinary.com/" passed
    # every check that existed. No min_length, because "" is how you remove the photo.
    photo_url: Optional[Annotated[str, StringConstraints(max_length=500)]] = None
