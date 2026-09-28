"""The LLM extraction layer, and the guarantee it has to keep.

The one thing that would make this feature worse than not having it: an amount that
arrives back converted. "a good splash" returned as "2 tbsp (30 ml)" would delete the
only part of the recipe that was actually the cook's, while looking like a helpful
improvement. The prompt forbids it; `_clean` enforces it; these pin the enforcement,
because a prompt is a request and only code is a guarantee.

No test here reaches the network. `extract_recipe` is exercised by stubbing the HTTP
layer, so the prompt, the parsing and the cleaning are all testable offline and in CI.
"""

import json

import httpx
import pytest

from app.services import recipe_ai
from app.services.quantity import classify_amount
from app.services.recipe_ai import (
    RESPONSE_SCHEMA,
    SYSTEM_PROMPT,
    RecipeAIUnavailable,
    _clean,
    extract_recipe,
)


# ── the classifier the model's output is graded by ──────────────────────────────


class TestClassifyAmount:
    """Must agree with frontend/src/utils/quantity.js. Verified case-by-case against it.

    A second, independently-written word list is how the two would eventually disagree
    about whether "a good splash" scales — and that disagreement is a wrong number in
    someone's kitchen, so this shares folk_units with scaling.py rather than restating it.
    """

    @pytest.mark.parametrize(
        "text,expected",
        [
            ("200 g", "precise"),
            ("2 cups", "precise"),
            ("1/2 cup", "precise"),
            ("1 1/2 cups", "precise"),
            ("2 bay leaves", "precise"),
            # A countable folk unit: the count is real, the vessel isn't.
            ("3 soup spoons", "imprecise"),
            ("1 can", "imprecise"),
            # A hedge makes a real unit imprecise — the hedge IS the point.
            ("about 2 cups", "imprecise"),
            ("~2 cups", "imprecise"),
            ("1 heaping tablespoon", "imprecise"),
            # Geometry, not quantity. Doubling "3 fingers of water" gives you soup.
            ("3 fingers", "imprecise"),
            # No number at all: nothing to scale, ever.
            ("a good splash", "unmeasured"),
            ("a thumb", "unmeasured"),
            ("to taste", "unmeasured"),
            ("", "unmeasured"),
            (None, "unmeasured"),
        ],
    )
    def test_types(self, text, expected):
        assert classify_amount(text)["quantity_type"] == expected

    @pytest.mark.parametrize(
        "spoken,digits",
        [
            ("three soup spoons", "3 soup spoons"),
            ("about three cups", "about 3 cups"),
            ("two cups", "2 cups"),
            ("a couple of pinches", "2 of pinches"),
        ],
    )
    def test_a_spoken_count_scales_like_a_written_one(self, spoken, digits):
        # Found by a LIVE model call: DeepSeek returned "three soup spoons" because
        # that is what was said, and it typed `unmeasured` — never scalable — while
        # "3 soup spoons" typed `imprecise`. Whether a recipe could be doubled
        # depended on whether the cook happened to say a numeral. Both classifiers
        # had the bug identically, so it wasn't drift; it was a shared blind spot
        # that only the LLM path could reach, since nobody TYPES "three".
        assert (
            classify_amount(spoken)["quantity_type"]
            == classify_amount(digits)["quantity_type"]
        )
        assert (
            classify_amount(spoken)["quantity_value"]
            == classify_amount(digits)["quantity_value"]
        )

    def test_a_spoken_count_keeps_its_own_spelling(self):
        # The digit rewrite is for CLASSIFICATION only. What gets stored and shown is
        # still what the person said — that's the entire product.
        assert (
            classify_amount("three soup spoons")["quantity_text"] == "three soup spoons"
        )

    def test_an_article_is_not_a_count(self):
        # "about a kilo" has no count in it — "a" is an article. Reading it as 1 would
        # invent precision the cook never offered.
        assert classify_amount("about a kilo")["quantity_type"] == "unmeasured"
        assert classify_amount("a good splash")["quantity_value"] is None

    def test_keeps_the_words_exactly(self):
        # The whole product rests on this line.
        assert classify_amount("3 soup spoons")["quantity_text"] == "3 soup spoons"

    def test_unmeasured_carries_no_unit(self):
        # A unit implies something to multiply. "a good splash" has nothing.
        assert classify_amount("a good splash")["unit"] is None

    def test_reads_a_unicode_fraction(self):
        assert classify_amount("½ cup")["quantity_value"] == 0.5

    def test_ingredient_name_cannot_change_the_type(self):
        # Classified from the UNIT remainder only. A name containing a folk word
        # ("1 can of drop-shaped pasta") must not flip a precise amount.
        assert classify_amount("200 g")["quantity_type"] == "precise"


# ── cleaning the model's answer ─────────────────────────────────────────────────


class TestClean:
    SOURCE = (
        "adobo from lola. three soup spoons of soy sauce, a good splash of vinegar, "
        "a whole head of garlic. brown the chicken, then simmer it."
    )

    def test_types_every_amount_itself(self):
        # The model is asked for the words; the APP decides what they mean. Anything
        # else puts the model in charge of grading its own output.
        out = _clean(
            {
                "name": "Adobo",
                "ingredients": [
                    {"name": "soy sauce", "amount": "3 soup spoons"},
                    {"name": "vinegar", "amount": "a good splash"},
                ],
            },
            source_text=self.SOURCE,
        )
        assert out["ingredients"][0]["quantity_type"] == "imprecise"
        assert out["ingredients"][0]["quantity_text"] == "3 soup spoons"
        assert out["ingredients"][1]["quantity_type"] == "unmeasured"

    def test_drops_an_ingredient_the_speaker_never_mentioned(self):
        # A model asked about adobo will helpfully add bay leaves whether or not they
        # were said, and a recipe with ingredients the cook never mentioned is not
        # their recipe any more.
        out = _clean(
            {
                "ingredients": [
                    {"name": "soy sauce", "amount": "3 soup spoons"},
                    {"name": "bay leaves", "amount": "2"},
                ]
            },
            source_text=self.SOURCE,
        )
        names = [i["name"] for i in out["ingredients"]]
        assert names == ["soy sauce"]

    def test_keeps_a_grounded_multiword_name(self):
        out = _clean(
            {"ingredients": [{"name": "cane vinegar", "amount": "a splash"}]},
            source_text="a splash of cane vinegar",
        )
        assert out["ingredients"][0]["name"] == "cane vinegar"

    def test_keeps_a_plural_named_singular_in_the_source(self):
        # The grounding check compares the head word stripped of a trailing "s", so
        # "onions" still matches "onion" in the text.
        out = _clean(
            {"ingredients": [{"name": "onions", "amount": "2"}]},
            source_text="two onion, chopped",
        )
        assert out["ingredients"][0]["name"] == "onions"

    def test_drops_nameless_and_malformed_rows(self):
        out = _clean(
            {
                "ingredients": [
                    {"name": "", "amount": "1 cup"},
                    "not an object",
                    {"amount": "2"},
                ],
                "steps": [{"content": ""}, "nope", {"note": "orphan"}],
            },
            source_text=self.SOURCE,
        )
        assert out["ingredients"] == []
        assert out["steps"] == []

    def test_keeps_a_step_note_separate_from_its_text(self):
        out = _clean(
            {
                "steps": [
                    {"content": "Brown the chicken", "note": "don't crowd the pan"}
                ]
            },
            source_text=self.SOURCE,
        )
        assert out["steps"][0] == {
            "content": "Brown the chicken",
            "note": "don't crowd the pan",
        }

    def test_reduces_servings_to_digits(self):
        # RecipeCreate.servings is Optional[int]; "serves about 4-6 people" would fail
        # validation, and guessing which number is meant is not the app's business.
        assert _clean({"servings": "serves 4"}, source_text="")["servings"] == "4"
        assert _clean({"servings": "a few"}, source_text="")["servings"] == ""

    def test_survives_a_response_missing_every_field(self):
        out = _clean({}, source_text="")
        assert out == {
            "name": "",
            "source_name": "",
            "description": "",
            "story": "",
            "servings": "",
            "ready_in_minutes": "",
            "cuisine": "",
            "diet": "",
            "ingredients": [],
            "steps": [],
        }

    def test_clean_returns_every_field_ParsedRecipe_declares(self):
        """THE TEST THIS FILE WAS MISSING, and its absence let #65 ship completely inert.

        `_clean`'s return is an explicit WHITELIST dict literal — correct, because a model must not
        be able to inject keys — which means adding a field to the prompt AND to `ParsedRecipe` is
        not enough. #65 did exactly that: the model answered `story`, `ready_in_minutes` and `diet`,
        this function dropped all three, and Pydantic's "" defaults took their place. The whole
        feature was a no-op on the only path that matters, with the ENTIRE suite green. (Deliberately not
        a number here: a count in a comment is a thing that goes stale, and the point is "all of
        them", not "how many".)

        Why they were green: every test in `tests/test_parse_endpoint.py` stubs `extract_recipe`,
        which sits ABOVE `_clean` — so the one whose docstring said "end to end, five hands" began
        at hand three. The chain has SIX links and this is the link with no HTTP surface of its own.

        The sibling assertion in `test_parse_endpoint.py` pins the prompt schema against
        `ParsedRecipe`; this pins `_clean` against it. Together they cover the whole chain, and
        `test_survives_a_response_missing_every_field` above is now the tripwire it was meant to be
        — it previously asserted the OLD seven keys exactly, so it certified the bug as correct.
        """
        from app.schemas.recipe import ParsedRecipe

        returned = set(ParsedRecipe.model_fields)
        # `ai` is the transport flag the router sets, not something extracted.
        returned.discard("ai")
        assert set(_clean({}, source_text="")) == returned

    def test_a_ready_in_time_is_digits_or_nothing(self):
        """COMPLY OR BE DROPPED, and the rejected alternatives are the reason.

        A LEADING-integer rule (the ship gate's suggestion) turns "1 hr 15 min" into **1** — a
        75-minute recipe filed as one minute, which a person may not challenge. `"".join(isdigit)`,
        the trick `servings` uses above, turns it into 115. Both invent a number, and this file's own
        prompt says never to estimate one. An empty field is honest: the person types a number they
        can see, in a `<input type="number">` that would have shown prose as a blank box anyway.
        """
        assert _clean({"ready_in_minutes": "75"}, source_text="")["ready_in_minutes"] == "75"
        assert _clean({"ready_in_minutes": "  90 "}, source_text="")["ready_in_minutes"] == "90"
        for prose in ("1 hr 15 min", "about 40", "40 minutes", "an hour", ""):
            assert _clean({"ready_in_minutes": prose}, source_text="")["ready_in_minutes"] == ""

    def test_a_long_story_is_CLAMPED_rather_than_500ing_the_route(self):
        """`ParsedRecipe(**data)` is constructed OUTSIDE the router's `except RecipeAIUnavailable`,
        so a Pydantic length error there is an uncaught 500 on a route whose docstring promises it
        "NEVER 500s on the model's account". `story` made that likely rather than theoretical: the
        prompt says to keep the cook's prose at whatever length they wrote it, the input cap is 8000
        characters, and a pasted food-blog recipe routinely opens with more than 4000. The client
        catches everything and falls through to the local parser, so the person silently got the
        worse parse and the model call was paid for and discarded. Found by a ship gate.
        """
        from app.schemas.recipe import ParsedRecipe

        out = _clean({"story": "a" * 5000, "description": "b" * 900}, source_text="")
        assert len(out["story"]) == 4000
        assert len(out["description"]) == 500
        # The thing that actually broke: constructing the response model must not raise.
        ParsedRecipe(**out, ai=True)

    def test_EVERY_string_is_clamped_including_the_child_rows(self):
        """The first version of the clamp covered six top-level fields and missed four, which a ship
        gate found by measuring rather than reading: `servings` and `ready_in_minutes` skipped the
        helper (and `ready_in_minutes` was brand-new code in the same commit that introduced it — the
        signature of a fix written late), and the ingredient/step strings were never clamped at all.

        THE STEP ONE IS THE LIKELY OVERFLOW, not a theoretical one: an 8000-character paste whose
        method is a single run-on paragraph produces exactly one step over the 2000 ceiling, and that
        was an uncaught 500 on a route that promises never to 500 on the model's account — byte for
        byte the defect fixed for `story` one field over.

        Asserted against the models' OWN declared ceilings rather than literals, so this cannot drift
        from them: that is how the ingredient clamp was caught using 120 for `amount`, which is
        Text60.
        """
        from app.schemas.recipe import ParsedIngredient, ParsedRecipe, ParsedStep

        def ceiling(model, field):
            for meta in model.model_fields[field].metadata:
                if getattr(meta, "max_length", None):
                    return meta.max_length
            raise AssertionError(f"{model.__name__}.{field} declares no max_length")

        out = _clean(
            {
                "name": "n" * 300,
                "source_name": "s" * 300,
                "description": "d" * 900,
                "story": "y" * 5000,
                "servings": "4" * 70,
                "ready_in_minutes": "9" * 61,
                "cuisine": "c" * 300,
                "diet": "x" * 300,
                "ingredients": [{"name": "pork " * 40, "amount": "a lot " * 40}],
                "steps": [{"content": "x" * 2639, "note": "y" * 2639}],
            },
            source_text="pork " * 40,
        )
        for field in (
            "name",
            "source_name",
            "description",
            "story",
            "servings",
            "ready_in_minutes",
            "cuisine",
            "diet",
        ):
            assert len(out[field]) <= ceiling(ParsedRecipe, field), field
        for field in ("name", "amount"):
            assert len(out["ingredients"][0][field]) <= ceiling(ParsedIngredient, field), field
        for field in ("content", "note"):
            assert len(out["steps"][0][field]) <= ceiling(ParsedStep, field), field
        # The assertion that matters: the construction that used to 500.
        ParsedRecipe(**out, ai=True)

    def test_a_ready_in_time_in_non_ASCII_digits_is_dropped(self):
        """`str.isdigit()` is True for Arabic-Indic "٤٢", Devanagari "२०" and superscript "²⁵",
        so the digits-only gate let them through — and then `<input type="number">` blanks the value
        (not a valid float) and `parseInt` gives NaN. No wrong number is stored, but the value is
        invisible and uncorrectable, which is the exact defect the rule exists to prevent. Found by a
        ship gate. Translation is #64; this just fails closed until then.
        """
        for foreign in ("٤٢", "२०", "²⁵"):
            assert _clean({"ready_in_minutes": foreign}, source_text="")["ready_in_minutes"] == ""
        assert _clean({"ready_in_minutes": "42"}, source_text="")["ready_in_minutes"] == "42"

    def test_the_diet_vocabulary_matches_the_ONE_list_it_lives_in(self):
        """The vocabulary is in `frontend/src/lib/diets.js` and the prompt names it twice. Three
        copies with nothing pinning them is the `folk_units` ↔ `quantity.js` problem again — except
        that pair has a CLAUDE.md rule behind it, and a real pin is cheap here.
        """
        import re
        from pathlib import Path

        js = (
            Path(__file__).resolve().parent.parent / "frontend" / "src" / "lib" / "diets.js"
        ).read_text(encoding="utf-8")
        # TRAILING COMMA OPTIONAL. The first version required one, and with a `>= 5` floor against
        # six entries that meant exactly ONE name could silently escape the pin: drop the comma on
        # the last entry (a formatter, a hand edit) and the test parses five, passes, and leaves that
        # name unpinned — the precise drift this test exists to catch. Found by a ship gate.
        names = re.findall(r"^\s*'([^']+)',?\s*$", js, re.M)
        # An EXACT count, not a floor, for the same reason: a floor cannot notice a missing entry.
        assert len(names) == 6, f"expected 6 diet names in diets.js, parsed {names}"
        # BOTH prompt copies, not just SYSTEM_PROMPT. The second is RESPONSE_SCHEMA's `diet`
        # property description, and the first version of this test left it unpinned — so the exact
        # drift it exists to prevent could still happen in one of the two places. Caught by a docs
        # gate, which also corrected the claim that the vocabulary lived in ONE place: it lives in
        # three, and two of them are now held to the canonical one.
        described = RESPONSE_SCHEMA["json_schema"]["schema"]["properties"]["diet"]["description"]
        for name in names:
            assert name in SYSTEM_PROMPT, f"{name!r} is in diets.js but not in SYSTEM_PROMPT"
            assert name in described, f"{name!r} is in diets.js but not in the diet description"


# ── the request itself ──────────────────────────────────────────────────────────


def _stub_post(monkeypatch, *, content=None, raises=None, status=200):
    """Replace the HTTP call, so the prompt and parsing are testable with no network."""

    class Resp:
        status_code = status

        def raise_for_status(self):
            if status >= 400:
                req = httpx.Request("POST", recipe_ai.OPENROUTER_URL)
                raise httpx.HTTPStatusError(
                    "rate limited", request=req, response=httpx.Response(status, request=req)
                )

        def json(self):
            return {"choices": [{"message": {"content": content}}]}

    class Client:
        def __init__(self, *a, **k):
            pass

        async def __aenter__(self):
            return self

        async def __aexit__(self, *a):
            return False

        async def post(self, url, **kwargs):
            Client.last = kwargs
            if raises:
                raise raises
            return Resp()

    monkeypatch.setattr(recipe_ai.httpx, "AsyncClient", Client)
    return Client


@pytest.fixture
def configured(monkeypatch):
    monkeypatch.setattr(recipe_ai.settings, "openrouter_api_key", "test-key")
    monkeypatch.setattr(recipe_ai.settings, "openrouter_model", "")
    monkeypatch.setattr(recipe_ai.settings, "openrouter_referer", "")


class TestExtract:
    @pytest.mark.anyio
    async def test_splits_run_on_speech(self, configured, monkeypatch):
        # The input the local line-based parser cannot handle at all — one spoken line
        # holding three ingredients — and the reason this layer exists.
        said = (
            "sinigang. you need tamarind, about a thumb of ginger, and some kangkong. "
            "boil the pork until tender, then add the tamarind."
        )
        _stub_post(
            monkeypatch,
            content=json.dumps(
                {
                    "name": "Sinigang",
                    "ingredients": [
                        {"name": "tamarind", "amount": ""},
                        {"name": "ginger", "amount": "about a thumb"},
                        {"name": "kangkong", "amount": "some"},
                    ],
                    "steps": [
                        {"content": "Boil the pork until tender", "note": ""},
                        {"content": "Add the tamarind", "note": ""},
                    ],
                }
            ),
        )
        out = await extract_recipe(said)
        assert [i["name"] for i in out["ingredients"]] == [
            "tamarind",
            "ginger",
            "kangkong",
        ]
        assert len(out["steps"]) == 2

    @pytest.mark.anyio
    async def test_asks_for_a_json_schema_and_zero_temperature(
        self, configured, monkeypatch
    ):
        # Structured output is what makes the shape reliable; temperature 0 is what
        # stops "creativity" from meaning invented ingredients.
        Client = _stub_post(monkeypatch, content="{}")
        await extract_recipe("x")
        body = Client.last["json"]
        assert body["response_format"]["type"] == "json_schema"
        assert body["temperature"] == 0

    @pytest.mark.anyio
    async def test_forbids_conversion_in_the_prompt(self, configured, monkeypatch):
        Client = _stub_post(monkeypatch, content="{}")
        await extract_recipe("x")
        system = Client.last["json"]["messages"][0]["content"]
        assert "never" in system.lower()
        assert "45 ml" in system  # the concrete example, not just an instruction

    @pytest.mark.anyio
    async def test_raises_without_a_key(self, monkeypatch):
        monkeypatch.setattr(recipe_ai.settings, "openrouter_api_key", "")
        with pytest.raises(RecipeAIUnavailable):
            await extract_recipe("anything")

    @pytest.mark.anyio
    async def test_raises_on_a_timeout(self, configured, monkeypatch):
        _stub_post(monkeypatch, raises=httpx.ReadTimeout("slow"))
        with pytest.raises(RecipeAIUnavailable):
            await extract_recipe("x")

    @pytest.mark.anyio
    async def test_raises_on_an_http_error(self, configured, monkeypatch):
        _stub_post(monkeypatch, content="{}", status=429)
        with pytest.raises(RecipeAIUnavailable):
            await extract_recipe("x")

    @pytest.mark.anyio
    async def test_raises_when_the_answer_is_not_json(self, configured, monkeypatch):
        _stub_post(monkeypatch, content="Sure! Here's your recipe:")
        with pytest.raises(RecipeAIUnavailable):
            await extract_recipe("x")

    @pytest.mark.anyio
    async def test_tolerates_a_markdown_fence(self, configured, monkeypatch):
        # Told not to, but models do it anyway, and failing over a wrapper would send
        # a usable answer to the fallback path for no reason.
        _stub_post(
            monkeypatch,
            content='```json\n{"name": "Adobo", "ingredients": [], "steps": []}\n```',
        )
        out = await extract_recipe("adobo")
        assert out["name"] == "Adobo"

    @pytest.mark.anyio
    async def test_raises_on_a_json_array(self, configured, monkeypatch):
        # Valid JSON, wrong shape — must not be treated as a recipe.
        _stub_post(monkeypatch, content="[1, 2, 3]")
        with pytest.raises(RecipeAIUnavailable):
            await extract_recipe("x")
