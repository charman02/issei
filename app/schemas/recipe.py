from typing import Annotated, Optional, Literal
from datetime import datetime
from pydantic import BaseModel, ConfigDict, EmailStr, Field, StringConstraints


# ---------------------------------------------------------------------------
# CEILINGS. Every recipe field was unbounded until now — no `max_length` in the
# schema and no length on the column either (`Mapped[str] = mapped_column()`
# infers an unlimited VARCHAR), so a single request could store a megabyte in a
# dish name and every card in Browse would try to render it.
#
# These are deliberately GENEROUS: they exist to refuse abuse and protect the
# layout, not to edit anyone. No cook writing a real recipe will meet one, and
# there are no character counters in the UI — hitting a wall produces an honest
# error through `toUserMessage`, not a nagging countdown while you type.
#
# Two rules held to:
#   - Maxima only. Nothing here makes a field newly REQUIRED; `OriginIn.name`
#     accepts "" today and a test depends on that. Tightening a minimum is a
#     separate decision with a different blast radius.
#   - Match what already exists rather than inventing a parallel scale. A dish
#     name is 120 because a post's `dish_name` is 120 and they name the same
#     thing; `source` is 80 because it holds a person's name and `first_name`
#     is 80.
# ---------------------------------------------------------------------------
Text40 = Annotated[str, StringConstraints(max_length=40)]
Text60 = Annotated[str, StringConstraints(max_length=60)]
Text80 = Annotated[str, StringConstraints(max_length=80)]
Text120 = Annotated[str, StringConstraints(max_length=120)]
Text300 = Annotated[str, StringConstraints(max_length=300)]
Text500 = Annotated[str, StringConstraints(max_length=500)]
Text2000 = Annotated[str, StringConstraints(max_length=2000)]
Text4000 = Annotated[str, StringConstraints(max_length=4000)]
# A URL the client has already uploaded to Cloudinary. Real ones run ~120 chars;
# 500 is slack, and the point is that an unbounded string field rendered into an
# `<img src>` is a place to hide a payload.
Url500 = Annotated[str, StringConstraints(max_length=500)]

# How MANY child rows one recipe may carry. Length caps alone don't stop the
# other shape of abuse: 100,000 ingredients of one character each. A recipe with
# more than a hundred of either is not a recipe.
MAX_INGREDIENTS = 100
MAX_STEPS = 100
MAX_SECTIONS = 30

# The three-type quantity model. This was a bare `str` — so it accepted 100,000 characters
# (verified in review, stored), AND it accepted any value at all, while `services/scaling.py`
# branches on exactly these three. A `Literal` fixes both at once, which is why it isn't just
# another Text alias: the fix for "too long" and the fix for "not a real type" are the same fix.
QuantityType = Literal["precise", "imprecise", "unmeasured"]


class OriginIn(BaseModel):
    # No min_length: "" is accepted here today and the router treats a blank name
    # as "no origin given" (see `_origin_attribution`). Deliberately unchanged.
    name: Text120
    place: Optional[Text120] = None
    year: Optional[Text40] = None
    memory: Optional[Text2000] = None


# Step schemas


class StepCreate(BaseModel):
    # See IngredientCreate.position — unbounded, this is a Postgres-only 500.
    position: int = Field(ge=0, le=10000)
    # 2000 for a step and its note. A step is one instruction — the form's own copy
    # says "one step per box" — but people do write a paragraph, and a note carrying
    # the knowledge an ingredient list can't hold is exactly where someone should be
    # allowed to run on.
    content: Text2000
    section_header: Optional[Text120] = None
    voice_note: Optional[Text2000] = None
    # An already-uploaded photo for this step (POST /upload/recipe-photo returns
    # the URL). Same contract as the recipe's cover_photo_url: the client uploads
    # first and sends back a URL, so recipe writes stay JSON.
    photo_url: Optional[Url500] = None


class StepResponse(BaseModel):
    id: int
    position: int
    content: str
    section_header: Optional[str] = None
    voice_note: Optional[str] = None
    photo_url: Optional[str] = None

    model_config = ConfigDict(from_attributes=True)


# Ingredient schemas


class IngredientCreate(BaseModel):
    name: Text120
    # The amount as the person wrote it — "3 soup spoons", "a good splash", "about a
    # kilo". 60 is roomy for any of those and this field is never normalized, so it
    # has to survive verbatim whatever it holds.
    quantity_text: Optional[Text60] = None
    quantity_value: Optional[float] = None
    unit: Optional[Text40] = None
    quantity_type: QuantityType = "precise"
    notes: Optional[Text300] = None
    # Bounded: `position: int` accepts 10**19, which overflows int4 on Postgres and 500s there
    # while passing on SQLite — the same shape of prod-only bug as #97's unvalidated
    # `through_post_id`. A position beyond the collection cap can't mean anything anyway.
    position: int = Field(ge=0, le=10000)


class IngredientResponse(BaseModel):
    id: int
    name: str
    quantity_text: Optional[str] = None
    quantity_value: Optional[float] = None
    unit: Optional[str] = None
    quantity_type: str
    notes: Optional[str] = None
    position: int
    # Only set by the scale endpoint, and only when an amount was deliberately
    # NOT scaled (a folk unit that would land on a fraction, or a non-linear
    # measure like "3 fingers of water"). Carries the multiplier — e.g. "×2.5" —
    # so the UI can show the cook's own words plus what to adjust by feel.
    scale_note: Optional[str] = None

    model_config = ConfigDict(from_attributes=True)


class ParseTextIn(BaseModel):
    # Bounded so a paste can't become an unbounded prompt: 8000 characters is far more
    # than any real recipe and keeps a single request's token cost predictable.
    text: str = Field(min_length=1, max_length=8000)


# The PARSE response carries the same ceilings as the create schema, and it has to: this is
# what `POST /recipes/parse` hands back for the client to correct and then SUBMIT. Uncapped, the
# parser could produce a step or an ingredient name the create endpoint then refuses — a dead end
# in the app's primary capture route, and the route most likely to produce one long field, since
# run-on dictated prose is exactly what the local parser can't split.
class ParsedIngredient(BaseModel):
    name: Text120
    # The amount EXACTLY as the person said it. The typed fields beside it are the
    # app's own classification of that string — the model never gets to decide them.
    amount: Text60 = ""
    quantity_text: Optional[Text60] = None
    quantity_value: Optional[float] = None
    unit: Optional[Text40] = None
    quantity_type: QuantityType = "unmeasured"


class ParsedStep(BaseModel):
    content: Text2000
    note: Text2000 = ""


class ParsedRecipe(BaseModel):
    """A structured recipe that has NOT been saved.

    The response of POST /recipes/parse. Deliberately not a Recipe: nothing exists in
    the database yet, and the client is expected to show this for correction first.
    """

    name: Text120 = ""
    source_name: Text80 = ""
    description: Text500 = ""
    # A STRING here, not an int: the model reports what the recipe said ("4-6", "a family").
    servings: Text60 = ""
    cuisine: Text60 = ""
    ingredients: list[ParsedIngredient] = Field(default=[], max_length=MAX_INGREDIENTS)
    steps: list[ParsedStep] = Field(default=[], max_length=MAX_STEPS)
    # False when the model was unavailable, so the client knows to fall back to its own
    # local parser rather than trusting an empty result. Reported as a field rather than
    # an error status because "the model is off" is a normal state, not a failure.
    ai: bool = True


class IngredientSuggestions(BaseModel):
    # The signed-in user's OWN ingredient vocabulary, most-used first, for the
    # add-recipe autosuggest. An object rather than a bare array so this can grow
    # a field (counts, a remembered unit) without a breaking response shape.
    names: list[str] = []


class FieldSuggestions(BaseModel):
    # The signed-in user's OWN past values for two recipe-form fields, most-used
    # first: who they've credited before ("Passed down from") and the cuisines
    # they've tagged. Same scoping/security as IngredientSuggestions — only words
    # this user typed themselves. The frontend merges the static CUISINES list in
    # front of the cuisines here; sources have no static list (they're people).
    sources: list[str] = []
    cuisines: list[str] = []


# IngredientSection schemas


class IngredientSectionCreate(BaseModel):
    name: Text120
    position: int = Field(ge=0, le=10000)
    ingredients: list[IngredientCreate] = Field(default=[], max_length=MAX_INGREDIENTS)


class IngredientSectionResponse(BaseModel):
    id: int
    name: str
    position: int
    ingredients: list[IngredientResponse] = []

    model_config = ConfigDict(from_attributes=True)


# Recipe schemas


class RecipeCreate(BaseModel):
    # The dish. 120 to match a post's `dish_name` — the two name the same thing, and a
    # recipe written from the meal composer (#81) carries that value straight across, so
    # a tighter cap here would reject something the composer just accepted.
    name: Text120
    cover_photo_url: Optional[Url500] = None
    description: Optional[Text500] = None
    # The person's story about the dish, and the owner's private notes. The two longest
    # fields in the app on purpose: this is the knowledge an ingredient list can't hold.
    story: Optional[Text4000] = None
    servings: Optional[int] = Field(default=None, ge=0, le=1000)
    prep_time_minutes: Optional[int] = Field(default=None, ge=0, le=100000)
    cuisine: Optional[Text60] = None
    diet: Optional[Text60] = None
    # A PERSON — "from Lola". 80, the same ceiling as `User.first_name`.
    source: Optional[Text80] = None
    notes: Optional[Text2000] = None
    language: Optional[Text40] = "en"
    # Concrete: "public" (anyone/Browse) | "friends" (accepted friends only) | "private"
    # (only me + grantees). The create form auto-selects the default from the author's
    # profile — "public" on a public profile, "friends" on a private one — but the value
    # is stored literally, so a label like "Friends only" never silently widens later.
    # Schema default "friends" is the safe fallback if the client omits it. (The DB
    # column server_default stays "private" for rows inserted outside the app.)
    visibility: Literal["public", "friends", "private"] = "friends"
    # Collection ceilings. Without these, per-field caps are trivially defeated by
    # sending a hundred thousand one-character ingredients — the request body is the
    # only thing that would have stopped it.
    ingredient_sections: list[IngredientSectionCreate] = Field(
        default=[], max_length=MAX_SECTIONS
    )
    ingredients: list[IngredientCreate] = Field(default=[], max_length=MAX_INGREDIENTS)
    steps: list[StepCreate] = Field(default=[], max_length=MAX_STEPS)
    origin: Optional[OriginIn] = None


class CookIn(BaseModel):
    photo_url: Optional[Url500] = None
    note: Optional[Text2000] = None


class RecipeResponse(BaseModel):
    id: int
    user_id: int
    name: str
    author_full_name: Optional[str] = None
    cover_photo_url: Optional[str] = None
    description: Optional[str] = None
    story: Optional[str] = None
    servings: Optional[int] = None
    prep_time_minutes: Optional[int] = None
    cuisine: Optional[str] = None
    diet: Optional[str] = None
    source: Optional[str] = None
    # `notes` is DELIBERATELY ABSENT. It is the owner's private scratchpad, and
    # InvitePreview already documents that the recipient gets the dish, not the
    # account. But RecipeResponse is what EVERY reader receives — a friend on a
    # friends-visibility recipe, an accepted handoff grantee, the unauthenticated
    # GET /recipes/browse feed, and GET /recipes/{id}/scale (gated on read
    # permission, not ownership) — so leaving it here leaked the scratchpad to all
    # of them while the invite path carefully withheld it. Removed from the read
    # surface entirely rather than nulled per-handler: five handlers each
    # remembering to blank a field is how the inconsistency arose. The column and
    # its write path (RecipeCreate/RecipeUpdate, owner-only) are unchanged — it is
    # owner-written data, still stored, just no longer returned on a read. (It is NOT read
    # by services/growth.py, which deliberately excludes the generic recipe-level notes
    # from soul_count — do not conclude from that the column is dead and drop it.)
    # If an owner-facing notes UI is ever built, give it its OWN owner-gated response
    # rather than restoring this field here.
    language: str
    cook_count: int = 0
    owner_cook_count: int = 0
    shared_with_count: int = 0
    growth_stage: str = "seed"
    growth_vitality: str = "bare"
    soul_count: int = 0
    last_cooked_at: Optional[datetime] = None
    visibility: str = "private"
    origin_attribution: Optional[str] = None
    prompt_key: Optional[str] = None
    prompt_answer: Optional[str] = None
    created_at: datetime
    deleted_at: Optional[datetime] = None
    # Whether the CALLER has kept this recipe (#57) — a fact about the viewer's own
    # shelf, not about the recipe or anyone else, so it discloses nothing across users
    # and defaults False. Populated only by the single-recipe read, which is the one
    # place a "Keep"/"Kept" control is drawn; every list endpoint leaves it False
    # rather than firing a query per row.
    kept_by_me: bool = False
    # How many people have kept this recipe — **only ever populated for its owner**, None for
    # everyone else (#96). Never 0-for-others: a client can't print a number it wasn't given.
    # The cook's private signal that a recipe landed, which matters most for a recipe written
    # WITHOUT a post — the ask/fulfil loop only exists on posts, so keeps are the only signal
    # that surface generates. There is deliberately NO list of keepers, anywhere: keeping is a
    # bookmark addressed to nobody, and naming the keeper would change what keeping means.
    keeper_count: Optional[int] = None
    ingredient_sections: list[IngredientSectionResponse] = []
    ingredients: list[IngredientResponse] = []
    steps: list[StepResponse] = []

    model_config = ConfigDict(from_attributes=True)


class KeptShelf(BaseModel):
    """The "Kept" tab: recipes that are in your kitchen but are not yours (#57).

    ONE shelf merging two independent things — recipes someone handed you (an accepted
    handoff grant) and recipes you kept yourself (a bookmark) — merged on the SERVER so
    un-keeping a bookmark can never hide a recipe somebody actually sent you.

    `unreachable_count` is how many shelf entries the caller can no longer open, because
    the cook made the recipe private, unfriended them, or deleted it. Deliberately a bare
    NUMBER: naming the dish would mean storing its name on the save row (content
    duplication — the first inch of the copy design) and would tell the keeper that a
    specific recipe still exists but was closed to them, which is more than the app
    discloses anywhere else. The count says "something you kept is gone" without saying
    which choice the cook made.
    """

    recipes: list[RecipeResponse] = []
    unreachable_count: int = 0


class RecipeExport(BaseModel):
    """Everything the caller WROTE, in one JSON document (#105).

    An envelope rather than a bare list, and each field earns its place: `exported_at` so a file
    sitting in someone's downloads folder says when it was true, and `recipe_count` so a truncated
    or half-written file is detectable without counting the array by hand.

    It reuses `RecipeResponse` deliberately instead of defining a leaner export shape. A second
    schema would be a second thing to remember when a field is added — and the failure mode is
    silent, because an export missing a field still parses. The cost is that a few computed fields
    (`soul_count`, `growth_stage`, `growth_vitality`, which no UI has displayed since the garden was
    removed) ride along; that is a smaller problem than an export that quietly loses the story
    someone typed.

    What is NOT here: recipes on the caller's KEPT shelf. Those are someone else's record of their
    dish, held by a grant that permits reading — read is not write, and "keep" has never meant a
    copy.
    """

    exported_at: datetime
    recipe_count: int
    recipes: list[RecipeResponse] = []


class HandoffIn(BaseModel):
    # A recipient is OPTIONAL. With neither field the handoff is "link-only": it
    # mints a token the sender shares however they already talk to that person
    # (share sheet / iMessage / etc.) — the fastest way to pass a recipe on.
    # Supplying to_email additionally enables auto-accept when that address signs
    # up; to_user_id grants an existing user access instantly.
    # EmailStr, not a bare string: this value is later compared against a signing-up user's
    # email to auto-accept the grant, so a 500KB unvalidated string was both unbounded storage
    # and a comparison against something that could never be an address. Length is bounded too
    # — EmailStr alone doesn't cap it.
    to_email: Optional[Annotated[EmailStr, StringConstraints(max_length=254)]] = None
    to_user_id: Optional[int] = None
    # No `note`. It was accepted, stored, and displayed nowhere (#102) — see the model. Pydantic
    # IGNORES unknown fields by default, so an older frontend build still sending one gets a 201
    # rather than a 422; that matters because Vercel and ECS deploy independently.


class HandoffResponse(BaseModel):
    id: int
    recipe_id: int
    state: str
    to_email: Optional[str] = None
    to_user_id: Optional[int] = None
    token: Optional[str] = None

    model_config = ConfigDict(from_attributes=True)


class InvitePreview(BaseModel):
    # The recipient's view of a handed-off recipe, readable WITHOUT an account.
    #
    # This used to be a soft wall (name/story/photo only) that made the recipient
    # sign up before reading the ingredients. That inverted the whole point: the
    # person on the other end of a handoff has never tasted the dish and wants to
    # COOK it, so gating the body is friction at the moment of highest intent.
    # The token is the capability; holding the link IS the permission to read.
    #
    # Still deliberately NOT exposed — the recipient gets the dish, not the
    # account: the owner's private `notes` scratchpad, user_id/author ids, and
    # anything else that isn't the recipe as cooked. Signing up is what unlocks
    # KEEPING and COOKING it — never editing or adding to it. A recipient cannot
    # change someone else's record of the dish (patch_recipe/delete_recipe filter on
    # user_id); "add to it" was a false claim and POSITIONING.md forbids it.
    recipe_id: int
    name: str
    from_name: Optional[str] = None
    origin_attribution: Optional[str] = None
    story: Optional[str] = None
    growth_stage: str = "seed"
    growth_vitality: str = "bare"
    cover_photo_url: Optional[str] = None
    description: Optional[str] = None
    servings: Optional[int] = None
    prep_time_minutes: Optional[int] = None
    cuisine: Optional[str] = None
    diet: Optional[str] = None
    ingredient_sections: list[IngredientSectionResponse] = []
    ingredients: list[IngredientResponse] = []
    steps: list[StepResponse] = []


class RecipeUpdate(BaseModel):
    # Same ceilings as RecipeCreate, field for field. They have to match: an edit that
    # accepted more than a create would be a way in, and one that accepted LESS would
    # make an already-saved recipe unsavable — you'd open the edit form on your own
    # recipe and be unable to submit it.
    name: Optional[Text120] = None
    cover_photo_url: Optional[Url500] = None
    description: Optional[Text500] = None
    story: Optional[Text4000] = None
    servings: Optional[int] = Field(default=None, ge=0, le=1000)
    prep_time_minutes: Optional[int] = Field(default=None, ge=0, le=100000)
    cuisine: Optional[Text60] = None
    diet: Optional[Text60] = None
    source: Optional[Text80] = None
    notes: Optional[Text2000] = None
    # min_length=1 here and NOT on create, deliberately: the column is NOT NULL with a
    # server_default, so create can omit it and get "en" — but an EXPLICIT null on update
    # reaches setattr and 500s on the IntegrityError. A 422 is the honest answer.
    language: Optional[Annotated[str, StringConstraints(min_length=1, max_length=40)]] = None
    visibility: Optional[Literal["public", "friends", "private"]] = None
    # When provided, these fully replace the recipe's existing children.
    # Omit them to leave the collections untouched (scalar-only update).
    ingredient_sections: Optional[list[IngredientSectionCreate]] = Field(
        default=None, max_length=MAX_SECTIONS
    )
    ingredients: Optional[list[IngredientCreate]] = Field(
        default=None, max_length=MAX_INGREDIENTS
    )
    steps: Optional[list[StepCreate]] = Field(default=None, max_length=MAX_STEPS)
    # Editing the "passed down from" attribution. Sent as a structured OriginIn
    # (same as create) and flattened to origin_attribution in the router. A null
    # name clears the byline; omitting the field entirely leaves it untouched.
    origin: Optional[OriginIn] = None
