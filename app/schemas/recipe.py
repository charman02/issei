from typing import Optional, Literal
from datetime import datetime
from pydantic import BaseModel, ConfigDict, Field


class OriginIn(BaseModel):
    name: str
    place: Optional[str] = None
    year: Optional[str] = None
    memory: Optional[str] = None


# Step schemas


class StepCreate(BaseModel):
    position: int
    content: str
    section_header: Optional[str] = None
    voice_note: Optional[str] = None
    # An already-uploaded photo for this step (POST /upload/recipe-photo returns
    # the URL). Same contract as the recipe's cover_photo_url: the client uploads
    # first and sends back a URL, so recipe writes stay JSON.
    photo_url: Optional[str] = None


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
    name: str
    quantity_text: Optional[str] = None
    quantity_value: Optional[float] = None
    unit: Optional[str] = None
    quantity_type: str = "precise"
    notes: Optional[str] = None
    position: int


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


class ParsedIngredient(BaseModel):
    name: str
    # The amount EXACTLY as the person said it. The typed fields beside it are the
    # app's own classification of that string — the model never gets to decide them.
    amount: str = ""
    quantity_text: Optional[str] = None
    quantity_value: Optional[float] = None
    unit: Optional[str] = None
    quantity_type: str = "unmeasured"


class ParsedStep(BaseModel):
    content: str
    note: str = ""


class ParsedRecipe(BaseModel):
    """A structured recipe that has NOT been saved.

    The response of POST /recipes/parse. Deliberately not a Recipe: nothing exists in
    the database yet, and the client is expected to show this for correction first.
    """

    name: str = ""
    source_name: str = ""
    description: str = ""
    servings: str = ""
    cuisine: str = ""
    ingredients: list[ParsedIngredient] = []
    steps: list[ParsedStep] = []
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
    name: str
    position: int
    ingredients: list[IngredientCreate] = []


class IngredientSectionResponse(BaseModel):
    id: int
    name: str
    position: int
    ingredients: list[IngredientResponse] = []

    model_config = ConfigDict(from_attributes=True)


# Recipe schemas


class RecipeCreate(BaseModel):
    name: str
    cover_photo_url: Optional[str] = None
    description: Optional[str] = None
    story: Optional[str] = None
    servings: Optional[int] = None
    prep_time_minutes: Optional[int] = None
    cuisine: Optional[str] = None
    diet: Optional[str] = None
    source: Optional[str] = None
    notes: Optional[str] = None
    language: str = "en"
    # Concrete: "public" (anyone/Browse) | "friends" (accepted friends only) | "private"
    # (only me + grantees). The create form auto-selects the default from the author's
    # profile — "public" on a public profile, "friends" on a private one — but the value
    # is stored literally, so a label like "Friends only" never silently widens later.
    # Schema default "friends" is the safe fallback if the client omits it. (The DB
    # column server_default stays "private" for rows inserted outside the app.)
    visibility: Literal["public", "friends", "private"] = "friends"
    ingredient_sections: list[IngredientSectionCreate] = []
    ingredients: list[IngredientCreate] = []
    steps: list[StepCreate] = []
    origin: Optional[OriginIn] = None


class CookIn(BaseModel):
    photo_url: Optional[str] = None
    note: Optional[str] = None


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


class HandoffIn(BaseModel):
    # A recipient is OPTIONAL. With neither field the handoff is "link-only": it
    # mints a token the sender shares however they already talk to that person
    # (share sheet / iMessage / etc.) — the fastest way to pass a recipe on.
    # Supplying to_email additionally enables auto-accept when that address signs
    # up; to_user_id grants an existing user access instantly.
    to_email: Optional[str] = None
    to_user_id: Optional[int] = None
    note: Optional[str] = None


class HandoffResponse(BaseModel):
    id: int
    recipe_id: int
    state: str
    to_email: Optional[str] = None
    to_user_id: Optional[int] = None
    note: Optional[str] = None
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
    name: Optional[str] = None
    cover_photo_url: Optional[str] = None
    description: Optional[str] = None
    story: Optional[str] = None
    servings: Optional[int] = None
    prep_time_minutes: Optional[int] = None
    cuisine: Optional[str] = None
    diet: Optional[str] = None
    source: Optional[str] = None
    notes: Optional[str] = None
    language: Optional[str] = None
    visibility: Optional[Literal["public", "friends", "private"]] = None
    # When provided, these fully replace the recipe's existing children.
    # Omit them to leave the collections untouched (scalar-only update).
    ingredient_sections: Optional[list[IngredientSectionCreate]] = None
    ingredients: Optional[list[IngredientCreate]] = None
    steps: Optional[list[StepCreate]] = None
    # Editing the "passed down from" attribution. Sent as a structured OriginIn
    # (same as create) and flattened to origin_attribution in the router. A null
    # name clears the byline; omitting the field entirely leaves it untouched.
    origin: Optional[OriginIn] = None
