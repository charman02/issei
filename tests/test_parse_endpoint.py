"""POST /recipes/parse — the HTTP surface of the LLM extraction layer.

The behaviour that matters most here is what happens when the model ISN'T available.
This endpoint costs money per call and depends on a third party, so the app has to keep
working without it: /add worked before this existed and must keep working when
OpenRouter is down, out of credit, or simply unconfigured. Every failure returns
ai=False with empty fields, and the client falls back to the line-based parser it
already ships.

Nothing here reaches the network — recipe_ai.extract_recipe is stubbed.
"""

import pytest

from app.services import recipe_ai
from app.services.recipe_ai import RecipeAIUnavailable


SAID = (
    "sinigang from my lola. you need tamarind, about a thumb of ginger, and some "
    "kangkong. boil the pork until tender, then add the tamarind. don't overcook "
    "the greens."
)


@pytest.fixture
def ai_returns(monkeypatch):
    """Stub the model with a fixed answer."""

    def _install(data):
        async def fake(text, **kwargs):
            return data

        monkeypatch.setattr(recipe_ai, "extract_recipe", fake)
        # The router imported the symbol directly, so patch it there too.
        import app.routers.recipes as recipes_router

        monkeypatch.setattr(recipes_router, "extract_recipe", fake)

    return _install


@pytest.fixture
def ai_fails(monkeypatch):
    def _install(exc=RecipeAIUnavailable("no key")):
        async def fake(text, **kwargs):
            raise exc

        monkeypatch.setattr(recipe_ai, "extract_recipe", fake)
        import app.routers.recipes as recipes_router

        monkeypatch.setattr(recipes_router, "extract_recipe", fake)

    return _install


FULL = {
    "name": "Sinigang",
    "source_name": "Lola",
    "description": "Sour pork soup.",
    # #65 — the three fields the parser used to leave blank while the form had slots for them.
    # Added to the EXISTING fixture rather than a second one, so every test in this file exercises
    # the wider shape and nothing can pass by describing a narrower recipe than the app returns.
    "story": (
        "My grandmother made this every Sunday for about forty years. She never wrote it down, "
        "and the one thing she always said was not to rush the souring — you wait, and then you "
        "taste it."
    ),
    "ready_in_minutes": "75",
    "diet": "Gluten-Free",
    "servings": "4",
    "cuisine": "Filipino",
    "ingredients": [
        {
            "name": "tamarind",
            "amount": "",
            "quantity_text": None,
            "quantity_value": None,
            "unit": None,
            "quantity_type": "unmeasured",
        },
        {
            "name": "ginger",
            "amount": "about a thumb",
            "quantity_text": "about a thumb",
            "quantity_value": None,
            "unit": None,
            "quantity_type": "unmeasured",
        },
    ],
    "steps": [
        {"content": "Boil the pork until tender", "note": ""},
        {"content": "Add the tamarind", "note": "don't overcook the greens"},
    ],
}


def test_structures_what_was_said(client, make_user, ai_returns):
    _, headers = make_user()
    ai_returns(FULL)

    r = client.post("/recipes/parse", json={"text": SAID}, headers=headers)
    assert r.status_code == 200
    body = r.json()
    assert body["ai"] is True
    assert body["name"] == "Sinigang"
    assert body["source_name"] == "Lola"
    assert [i["name"] for i in body["ingredients"]] == ["tamarind", "ginger"]
    # The step remark stays attached to its step rather than being folded into the text.
    assert body["steps"][1]["note"] == "don't overcook the greens"


def test_saves_nothing(client, make_user, ai_returns):
    # The model is allowed to be wrong, so it must not be allowed to write. The client
    # shows the result for correction and the user submits the form as usual.
    _, headers = make_user()
    ai_returns(FULL)

    client.post("/recipes/parse", json={"text": SAID}, headers=headers)
    assert client.get("/recipes", headers=headers).json() == []


def test_reports_ai_false_rather_than_failing_when_unavailable(
    client, make_user, ai_fails
):
    # THE test. No key, a timeout, a 429, malformed JSON — all the same to the caller,
    # and none of them may break /add. A 500 here would turn a missing API key into a
    # broken feature.
    _, headers = make_user()
    ai_fails()

    r = client.post("/recipes/parse", json={"text": SAID}, headers=headers)
    assert r.status_code == 200
    body = r.json()
    assert body["ai"] is False
    assert body["ingredients"] == []
    assert body["steps"] == []
    assert body["name"] == ""


def test_requires_a_signed_in_user(client):
    # It spends money per call, so it must not be reachable by anyone who finds the URL,
    # even though it touches no rows.
    r = client.post("/recipes/parse", json={"text": SAID})
    assert r.status_code in (401, 403)


def test_rejects_empty_text(client, make_user):
    _, headers = make_user()
    r = client.post("/recipes/parse", json={"text": ""}, headers=headers)
    assert r.status_code == 422


def test_rejects_text_far_longer_than_any_recipe(client, make_user):
    # Bounded so a paste can't become an unbounded prompt, and so one request's token
    # cost stays predictable.
    _, headers = make_user()
    r = client.post("/recipes/parse", json={"text": "x" * 9000}, headers=headers)
    assert r.status_code == 422


def test_is_not_shadowed_by_the_recipe_id_route(client, make_user, ai_returns):
    # /recipes/{recipe_id} is declared in the same router. If "/parse" were registered
    # after it, this would try to look up a recipe named "parse".
    _, headers = make_user()
    ai_returns(FULL)
    r = client.post("/recipes/parse", json={"text": SAID}, headers=headers)
    assert r.status_code == 200


def test_result_can_be_saved_through_the_normal_create_path(
    client, make_user, ai_returns
):
    # The parse output has to be usable as-is: its ingredient rows carry the same
    # quantity_* fields RecipeCreate expects, so a client can post them straight back
    # without a translation layer that could drop the typing.
    _, headers = make_user()
    ai_returns(FULL)
    parsed = client.post("/recipes/parse", json={"text": SAID}, headers=headers).json()

    payload = {
        "name": parsed["name"],
        "visibility": "private",
        "ingredients": [
            {
                "name": i["name"],
                "quantity_text": i["quantity_text"],
                "quantity_value": i["quantity_value"],
                "unit": i["unit"],
                "quantity_type": i["quantity_type"],
                "position": n + 1,
            }
            for n, i in enumerate(parsed["ingredients"])
        ],
        "steps": [
            {"content": s["content"], "voice_note": s["note"] or None, "position": n + 1}
            for n, s in enumerate(parsed["steps"])
        ],
    }
    created = client.post("/recipes", json=payload, headers=headers)
    assert created.status_code == 201
    saved = created.json()
    assert saved["name"] == "Sinigang"
    assert len(saved["ingredients"]) == 2
    # And the imprecision survived the round trip.
    assert saved["ingredients"][1]["quantity_text"] == "about a thumb"


# --- EVERY FORM FIELD THE PARSER CAN FILL (#65) --------------------------------------------------
#
# The parser used to fill five fields while the form had eleven, so a pasted recipe arrived with
# blanks in slots whose content was sitting in the text that had just been pasted. The three added
# here are the ones a written recipe actually carries: its opening prose, its total time, and a
# stated diet. The test that matters most is the LAST one — that each field survives the whole
# chain, because every link in it (prompt → schema → response model → client mapping → form seed)
# can drop a field silently.


def test_the_story_and_the_description_are_separate_fields(client, make_user, ai_returns):
    """THE SPLIT THAT MATTERS MOST. A pasted recipe usually opens with prose about the dish, and
    the parser had nowhere to put it: the model either dropped it or squeezed it into
    `description`, which is capped at 500 and is meant to be ONE LINE under a dish name, while
    `story` — the field POSITIONING calls the one that carries the person, at 4000 characters —
    sat empty.
    """
    _, h = make_user()
    ai_returns(FULL)
    body = client.post("/recipes/parse", json={"text": SAID}, headers=h).json()

    assert body["description"] == "Sour pork soup."
    assert body["story"] == FULL["story"]
    # Not the same sentence in both — the thing the prompt is most at risk of doing.
    assert body["story"] != body["description"]
    assert len(body["story"]) > len(body["description"])


def test_the_ready_in_time_and_the_diet_come_through(client, make_user, ai_returns):
    _, h = make_user()
    ai_returns(FULL)
    body = client.post("/recipes/parse", json={"text": SAID}, headers=h).json()
    assert body["ready_in_minutes"] == "75"
    assert body["diet"] == "Gluten-Free"


def test_the_new_fields_are_all_OPTIONAL(client, make_user, ai_returns):
    """A model that answers with none of them must not 500 or drop the rest of the recipe. Every
    one defaults to empty, exactly like `cuisine` and `servings` before them.
    """
    _, h = make_user()
    ai_returns(
        {
            "name": "Toast",
            "ingredients": [{"name": "bread", "amount": ""}],
            "steps": [{"content": "Toast it.", "note": ""}],
        }
    )
    body = client.post("/recipes/parse", json={"text": "toast: bread. toast it."}, headers=h).json()
    assert body["story"] == "" and body["ready_in_minutes"] == "" and body["diet"] == ""
    assert body["name"] == "Toast"


def test_ready_in_minutes_is_NOT_coerced_to_an_int(client, make_user, ai_returns):
    """It travels as TEXT. The form's field is an int, but the model is asked for digits and can
    still answer "about 40" — and a parser whose whole contract is "show this for correction
    first" is the wrong place to decide what a bad value becomes. Coercing here would either 422
    the whole recipe over one field or silently invent a number.
    """
    _, h = make_user()
    ai_returns({**FULL, "ready_in_minutes": "about 40"})
    body = client.post("/recipes/parse", json={"text": SAID}, headers=h).json()
    assert body["ready_in_minutes"] == "about 40"
    # ...and the rest of the recipe is unharmed by it.
    assert body["name"] == "Sinigang"


def test_a_diet_outside_the_vocabulary_is_passed_through_not_rejected(
    client, make_user, ai_returns
):
    """THE SERVER passes it through; the CLIENT is what drops it. Both halves are deliberate.

    Constrained by PROMPT rather than a `Literal` so the server never 500s a whole recipe over one
    field. Two earlier claims in this docstring were wrong and are worth recording:

      · "the vocabulary lives in ONE place" — it does not. There are THREE copies: the canonical
        list in `frontend/src/lib/diets.js` (shared with Browse's filter) plus two in
        `app/services/recipe_ai.py`, in SYSTEM_PROMPT and in the `diet` property description. A test
        in `tests/test_recipe_ai.py` now pins both prompt copies against `diets.js`. "One place" was
        the intent, not the state.
      · "an unmatched value is the same outcome as empty" — a ship gate showed it is not. The
        form's field is a `<select value={diet}>` over `DIETS`, so a value with no matching option
        leaves the select showing NOTHING SELECTED while component state keeps the string, and
        submit sends it: the recipe filed with a diet the cook never saw. `PasteRecipe.fromAI` now
        matches case-insensitively and drops anything else, which is what makes prompt-only
        constraint safe — that argument rests on the person SEEING the value, and this was the one
        path where they couldn't.
    """
    _, h = make_user()
    ai_returns({**FULL, "diet": "pescatarian-ish"})
    r = client.post("/recipes/parse", json={"text": SAID}, headers=h)
    assert r.status_code == 200
    assert r.json()["diet"] == "pescatarian-ish"


def test_the_MODEL_IS_ASKED_for_every_field_the_response_can_carry(client, make_user):
    """The link a test can actually hold onto: the request schema and the response model agree.

    `strict` JSON-schema mode requires `required` to name every property, and a field left out of
    it is silently dropped rather than defaulted — so "the model was never asked" and "the model
    declined to answer" look identical downstream. This is what makes adding a field to
    `ParsedRecipe` and forgetting the prompt a caught mistake rather than a quiet blank.
    """
    from app.services.recipe_ai import RESPONSE_SCHEMA
    from app.schemas.recipe import ParsedRecipe

    schema = RESPONSE_SCHEMA["json_schema"]["schema"]
    asked = set(schema["properties"])
    # Every property is required (strict mode), which is the rule that makes the above true.
    assert asked == set(schema["required"])

    returned = set(ParsedRecipe.model_fields)
    # `ai` is the transport flag, not an extracted field; the parser sets it itself.
    returned.discard("ai")
    assert returned == asked, (
        "ParsedRecipe and the model's schema disagree. Anything in ParsedRecipe that is not in "
        "the schema arrives permanently empty; anything in the schema that is not in ParsedRecipe "
        "is paid for and discarded."
    )


def test_every_new_field_survives_to_a_SAVED_recipe(client, make_user, ai_returns):
    """The SERVER half, end to end — and read the next paragraph before trusting the phrase.

    THE CHAIN HAS SIX LINKS, NOT FIVE: prompt → `RESPONSE_SCHEMA` → **`_clean()`** → `ParsedRecipe`
    → the client's snake→camel mapping → the form's `initialValues`. This docstring said "five
    hands" and omitted `_clean`, which is exactly the link #65 first shipped broken: `_clean`'s
    return is a whitelist dict literal, it dropped all three new fields, and THIS TEST could not
    see it because `ai_returns` stubs `extract_recipe`, which sits ABOVE `_clean`. So a test
    claiming "end to end" actually began at hand three, and the suite stayed green.

    `tests/test_recipe_ai.py::test_clean_returns_every_field_ParsedRecipe_declares` is the test that
    covers that link. The CLIENT half is pinned in `frontend/src/pages/PlantRecipe.test.jsx` (not
    `PasteRecipe.test.jsx`, which this docstring also named wrongly). What remains here is the
    server half plus proof that what the parser returns is actually SAVABLE in those fields.
    """
    _, h = make_user()
    ai_returns(FULL)
    parsed = client.post("/recipes/parse", json={"text": SAID}, headers=h).json()

    r = client.post(
        "/recipes",
        json={
            "name": parsed["name"],
            "source": parsed["source_name"],
            "description": parsed["description"],
            "story": parsed["story"],
            "cuisine": parsed["cuisine"],
            "diet": parsed["diet"],
            "prep_time_minutes": int(parsed["ready_in_minutes"]),
            "servings": int(parsed["servings"]),
            "ingredients": [
                {"name": i["name"], "quantity_text": i["amount"], "position": n}
                for n, i in enumerate(parsed["ingredients"])
            ],
            "steps": [
                {"content": s["content"], "voice_note": s["note"], "position": n}
                for n, s in enumerate(parsed["steps"])
            ],
        },
        headers=h,
    )
    assert r.status_code == 201, r.text
    saved = r.json()
    assert saved["story"] == FULL["story"]
    assert saved["diet"] == "Gluten-Free"
    assert saved["prep_time_minutes"] == 75
    # And the fidelity promise is still intact through the whole round trip — the hedge word
    # survives, which is the thing this app exists for.
    assert saved["ingredients"][1]["quantity_text"] == "about a thumb"
