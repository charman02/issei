"""Turn whatever someone says about a recipe into the app's fields, via an LLM.

WHY THIS EXISTS. The line-based parser in `frontend/src/lib/parseRecipeText.js` was
measured against four realistic inputs and failed one outright: dictated run-on prose.
"you need tamarind, about a thumb of ginger, and some kangkong" is a single line holding
three ingredients, and no line-based rule can split it. That's exactly how a person
talks when they're telling you how they cook — which is the input this app most exists
to capture. A language model splits it trivially.

WHAT IT MUST NOT DO is the whole design problem. The app's one claim is that a person's
own imprecise amounts survive: "3 soup spoons", "a good splash", "until it smells
right". An LLM's default behaviour is to be helpful by normalising — it will happily
turn "a good splash" into "2 tablespooons (30 ml)". That would delete the only part of
the recipe that was actually theirs, and it would be worse than no feature at all,
because it would be a lie about the recipe presented as an improvement. The prompt
forbids it, and `_clean` enforces it afterwards rather than trusting the instruction:
any amount the model returns is re-typed by the app's own classifier, and any ingredient
whose name the model didn't ground in the source text is dropped.

The caller is expected to fall back to the local parser when this raises. See
`routers/recipes.py::parse_recipe_text`.
"""

from __future__ import annotations

import json
import logging
import re
from typing import Any

import httpx

from app.config import settings

logger = logging.getLogger(__name__)

OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions"

# A small, cheap, fast model is the right tool: this is extraction, not reasoning. The
# task is bounded and the schema is fixed, so paying for a frontier model would buy
# nothing a user could perceive. Overridable per-deploy without a code change (prod
# sets OPENROUTER_MODEL to this same value; keep the default in step with what runs).
DEFAULT_MODEL = "deepseek/deepseek-v4-flash-0731"

# The whole point of the app, stated as a rule rather than hoped for. Repeated in the
# schema description too, because a single instruction is easy for a model to drift from
# over a long input.
SYSTEM_PROMPT = """You extract recipes from how people actually talk about them.

Return ONLY a JSON object matching the schema. No prose, no markdown fences.

THE ONE RULE THAT MATTERS: preserve the cook's own words for amounts, exactly as
given. This app exists to keep imprecise measurements intact.
  · "3 soup spoons" stays "3 soup spoons" — never 45 ml, never 3 tablespoons
  · "a good splash" stays "a good splash" — never 2 tbsp
  · "a thumb of ginger" stays "a thumb" — never 15 g
  · "until it smells right" stays as written
NEVER convert, normalise, round, or add a unit that was not said. If no amount was
given for an ingredient, leave amount empty — do not invent one.

ONE EXCEPTION, and only this one: write a spoken count as a DIGIT. "three soup
spoons" becomes "3 soup spoons". Keep EVERY other word, including any hedge —
"about three cups" becomes "about 3 cups", never "3 cups", because dropping
"about" turns a guess into a measurement. "about a kilo" stays exactly as it is:
there is no count in it, "a" is an article. Only the numeral's spelling changes;
nothing is added, removed, or converted. It matters because a recipe with a real
count can be scaled up or down and a count spelled as a word cannot be.

Other rules:
  · Split run-on speech into separate ingredients. "you need tamarind, about a thumb
    of ginger, and some kangkong" is THREE ingredients.
  · Every ingredient name must appear in the input. Never add an ingredient the
    speaker didn't mention, even if the dish normally has it.
  · Steps in the order given, one action each, in the speaker's own voice. Don't
    add steps they didn't say.
  · A remark attached to a step ("don't crowd the pan", "this is the part people
    rush") goes in that step's note, not in its text.
  · servings only if a number was actually said. cuisine only if named or
    unmistakable from the dish name.
  · THE STORY IS NOT THE DESCRIPTION, and this is the distinction most worth getting
    right. A pasted recipe often opens with a paragraph or two ABOUT the dish before
    any ingredient appears — who made it, when it gets made, what it means, a warning
    about the one step everybody gets wrong. All of that goes in story, at whatever
    length it was written. description is ONE SHORT LINE, the kind of thing that fits
    under a dish name on a card; if the input has no such line, leave it empty rather
    than trimming the story down to fit. Never put the same sentence in both.
    story is the cook's own prose: keep their words and their order. Do not summarise
    it, do not tidy it, and do not write one if the input has none.
  · ready_in_minutes: total time as DIGITS ONLY, in minutes. "Ready in 30 minutes"
    is 30; "1 hr 15 min" is 75; "about an hour" is 60. Prefer a stated TOTAL over a
    prep or cook time on its own, and if only one is given, use it. Empty if no time
    was stated — never estimate one from the steps.
  · diet: ONLY one of Vegetarian, Vegan, Gluten-Free, Dairy-Free, Halal, Kosher,
    spelled exactly like that, and ONLY if the input SAYS SO. Empty otherwise. Do NOT
    infer it from the ingredient list — a recipe with no meat in it is not necessarily
    vegetarian, and being wrong here is worse than being silent: somebody may be
    avoiding a food for a reason that matters.
  · If the speaker says who the recipe came from, put that person in source_name,
    as the RECIPE'S OWNER would be named on a card. Strip the speaker's possessive:
    "my mom's sinigang" → "Mom", not "mom" and never "my mom". A relationship word
    IS a name when it's what they're called — "Mom", "Lola", "Auntie Ling" are all
    fine; capitalise it. Leave it empty rather than writing a phrase: not "my mom's
    friend", not "a recipe from work".
"""

# json_schema mode, not "please return JSON" — this is what makes the response shape
# reliable enough to skip defensive parsing of prose. OpenRouter passes it through to
# providers that support structured outputs.
RESPONSE_SCHEMA = {
    "type": "json_schema",
    "json_schema": {
        "name": "recipe",
        "strict": True,
        "schema": {
            "type": "object",
            "additionalProperties": False,
            # EVERY property must be listed here: OpenAI-style `strict` schemas require
            # `required` to name all of them, and a field left out is silently dropped rather
            # than defaulted. Optionality is expressed by "or empty" in the description, which
            # is why every one of these is a string even where the app wants an int.
            "required": [
                "name",
                "source_name",
                "description",
                "story",
                "servings",
                "ready_in_minutes",
                "cuisine",
                "diet",
                "ingredients",
                "steps",
            ],
            "properties": {
                "name": {"type": "string", "description": "The dish name."},
                "source_name": {
                    "type": "string",
                    "description": "Who the recipe came from, or empty.",
                },
                "description": {
                    "type": "string",
                    "description": (
                        "ONE SHORT LINE about the dish, of the kind that fits under a name "
                        "on a card, or empty. Not the story — see `story`. Never the same "
                        "sentence as the story."
                    ),
                },
                "story": {
                    "type": "string",
                    "description": (
                        "The cook's own prose ABOUT the dish, at whatever length they wrote "
                        "it: who it came from, when it gets made, what it means, what people "
                        "get wrong. Their words and their order, not a summary. Empty if the "
                        "input has none."
                    ),
                },
                "servings": {
                    "type": "string",
                    "description": "Digits only, or empty if not stated.",
                },
                "ready_in_minutes": {
                    "type": "string",
                    "description": (
                        "Total time in MINUTES, digits only ('75', not '1 hr 15 min'). "
                        "Empty if no time was stated. Never estimated from the steps."
                    ),
                },
                "cuisine": {"type": "string", "description": "Or empty."},
                "diet": {
                    "type": "string",
                    "description": (
                        "Exactly one of: Vegetarian, Vegan, Gluten-Free, Dairy-Free, Halal, "
                        "Kosher — and ONLY if the input says so. Empty otherwise. Never "
                        "inferred from the ingredients."
                    ),
                },
                "ingredients": {
                    "type": "array",
                    "items": {
                        "type": "object",
                        "additionalProperties": False,
                        "required": ["name", "amount"],
                        "properties": {
                            "name": {"type": "string"},
                            "amount": {
                                "type": "string",
                                "description": (
                                    "VERBATIM as spoken. Empty if no amount was "
                                    "given. Never converted to a standard unit."
                                ),
                            },
                        },
                    },
                },
                "steps": {
                    "type": "array",
                    "items": {
                        "type": "object",
                        "additionalProperties": False,
                        "required": ["content", "note"],
                        "properties": {
                            "content": {"type": "string"},
                            "note": {
                                "type": "string",
                                "description": (
                                    "A remark or warning about this step, or empty."
                                ),
                            },
                        },
                    },
                },
            },
        },
    },
}


class RecipeAIUnavailable(RuntimeError):
    """The model could not be used, or returned something unusable.

    One exception type for every failure — missing key, timeout, HTTP error, malformed
    JSON — because the caller's response is the same in all of them: fall back to the
    local parser. Distinguishing them would only tempt a caller into handling some and
    forgetting others.
    """


def is_configured() -> bool:
    return bool(settings.openrouter_api_key)


async def extract_recipe(text: str, *, timeout: float = 25.0) -> dict[str, Any]:
    """Ask the model to structure `text`. Raises RecipeAIUnavailable on any failure."""
    if not is_configured():
        raise RecipeAIUnavailable("OPENROUTER_API_KEY is not set")

    body = {
        "model": settings.openrouter_model or DEFAULT_MODEL,
        "messages": [
            {"role": "system", "content": SYSTEM_PROMPT},
            {"role": "user", "content": text},
        ],
        "response_format": RESPONSE_SCHEMA,
        # Deterministic extraction. Creativity here would mean inventing ingredients.
        "temperature": 0,
        # NO REASONING. Measured, not assumed: with thinking on, DeepSeek V4 Flash took
        # 72.9s for one recipe; off, the same call took 2.7s for the same output — roughly
        # 27x. (Single samples, and inference latency varies per call, so treat the ratio as
        # an order of magnitude rather than a constant.) Hybrid models think by default, and
        # there is nothing here to think ABOUT — the task is copying spans out of a sentence
        # into a fixed schema. It also costs money: reasoning tokens bill as output.
        #
        # Ignored by models without a reasoning mode, so this is safe for every model.
        "reasoning": {"enabled": False},
    }
    headers = {
        "Authorization": f"Bearer {settings.openrouter_api_key}",
        "Content-Type": "application/json",
    }
    # OpenRouter uses these for attribution on its dashboard; harmless if unset.
    if settings.openrouter_referer:
        headers["HTTP-Referer"] = settings.openrouter_referer
    headers["X-Title"] = "issei"

    try:
        async with httpx.AsyncClient(timeout=timeout) as client:
            resp = await client.post(OPENROUTER_URL, json=body, headers=headers)
        resp.raise_for_status()
        payload = resp.json()
        content = payload["choices"][0]["message"]["content"]
    except (httpx.HTTPError, KeyError, IndexError, ValueError) as exc:
        # Logged at warning, not error: a fallback path exists and the user is served.
        logger.warning("recipe_ai: request failed (%s)", exc.__class__.__name__)
        raise RecipeAIUnavailable(str(exc)) from exc

    try:
        data = json.loads(_strip_fences(content))
    except json.JSONDecodeError as exc:
        logger.warning("recipe_ai: response was not JSON")
        raise RecipeAIUnavailable("model did not return JSON") from exc

    if not isinstance(data, dict):
        raise RecipeAIUnavailable("model returned a non-object")

    return _clean(data, source_text=text)


def _strip_fences(content: str) -> str:
    """Remove a ```json fence if the model added one despite being told not to."""
    s = (content or "").strip()
    if not s.startswith("```"):
        return s
    s = s.split("\n", 1)[-1] if "\n" in s else s
    if s.endswith("```"):
        s = s[: -3]
    return s.strip()


def _clean(data: dict[str, Any], *, source_text: str) -> dict[str, Any]:
    """Coerce the model's answer into the app's shape, and hold it to the one rule.

    Enforcement, not decoration. A prompt is a request; this is the part that makes the
    guarantee true even when the model ignores it.

    **THE RETURN IS AN EXPLICIT WHITELIST, AND THAT IS A TRAP WORTH NAMING.** It is a dict literal,
    not a merge over `data`, which is right — a model must not be able to inject keys — but it means
    ADDING A FIELD TO `ParsedRecipe` AND TO THE PROMPT IS NOT ENOUGH. #65 did exactly that and
    shipped a feature that was completely inert on the real path: the model answered `story`,
    `ready_in_minutes` and `diet` correctly, this function dropped all three, and Pydantic's `""`
    defaults took their place. THE ENTIRE SUITE stayed green because every test in
    `tests/test_parse_endpoint.py` stubs `extract_recipe`, which sits ABOVE this function — so the
    test whose docstring claimed "end to end, five hands" actually started at hand three. The chain
    has SIX links, and this is the one with no HTTP surface of its own.
    `test_clean_returns_every_field_ParsedRecipe_declares` now pins it.
    """
    # Imported here to keep the module importable without the heavier deps at collect
    # time, and because this is the only place it's needed.
    from app.services.quantity import classify_amount

    def s(key: str) -> str:
        v = data.get(key)
        return v.strip() if isinstance(v, str) else ""

    lowered = source_text.lower()

    ingredients = []
    for raw in data.get("ingredients") or []:
        if not isinstance(raw, dict):
            continue
        name = (raw.get("name") or "").strip()
        amount = (raw.get("amount") or "").strip()
        if not name:
            continue
        # GROUNDING CHECK. A model asked about "adobo" will helpfully add soy sauce and
        # bay leaves whether or not they were mentioned, and a recipe with ingredients
        # the cook never said is not their recipe any more. Requiring the head word to
        # appear in the source is a cheap, high-recall filter: real ingredient names are
        # quoted from the input, invented ones usually aren't.
        head = name.split()[-1].lower().rstrip("s")
        if head and head not in lowered:
            logger.info("recipe_ai: dropped ungrounded ingredient %r", name)
            continue
        # CLAMPED like every other string — see the note at the return. `ParsedIngredient.name`
        # is Text120 and `amount` is Text60 (not 120, which is what I wrote first — `amount` is
        # deliberately the tighter of the two, because it holds "3 soup spoons", not a sentence).
        # A model that runs a whole paragraph into one ingredient would otherwise 500 the route.
        #
        # `classify_amount` is given the CLAMPED string, so the typed fields it returns can never
        # describe a value longer than the one stored beside them.
        clipped_amount = amount[:60]
        ingredients.append(
            {
                "name": name[:120],
                "amount": clipped_amount,
                **classify_amount(clipped_amount),
            }
        )

    steps = []
    for raw in data.get("steps") or []:
        if not isinstance(raw, dict):
            continue
        content = (raw.get("content") or "").strip()
        if not content:
            continue
        # Text2000 apiece. THE LIKELIEST OF THE CHILD-ROW OVERFLOWS, which is why it is worth
        # naming: an 8000-character paste whose method is one run-on paragraph produces exactly
        # one step over the ceiling, and before this that was an uncaught 500 — byte for byte the
        # defect fixed for `story` one field over. Found by a ship gate reading the fix.
        steps.append(
            {"content": content[:2000], "note": (raw.get("note") or "").strip()[:2000]}
        )

    servings = s("servings")
    digits = "".join(ch for ch in servings if ch.isdigit())

    # READY-IN: DIGITS ONLY, WHOLE STRING, OR NOTHING. Three candidate rules were wrong and the
    # third is why this one is strict:
    #
    #   · pass the prose through (the first version). `RecipeForm`'s Ready-in field is
    #     `<input type="number">`, and the HTML value-sanitisation algorithm blanks a number input
    #     whose value is not a valid float — so "about 40" renders as an EMPTY BOX while component
    #     state keeps the prose. Invisible and uncorrectable, i.e. the exact opposite of this
    #     parser's "show it for correction first" contract. Found by a ship gate.
    #   · `"".join(isdigit)`, the trick used for servings just above. That turns "1 hr 15 min" into
    #     115. (It is also why servings turns "4-6" into "46" today — pre-existing, not copied.)
    #   · a LEADING integer, which was the ship gate's suggestion and which I measured before
    #     taking. "1 hr 15 min" becomes **1**, and a reader can dismiss that as "so handle the
    #     multi-group case" — so here is the example that actually ends the argument: **"1 hour"
    #     becomes 1.** One digit group, unambiguous to a human, and reducing it files a 60-minute
    #     recipe as one minute. The prose cases that are SAFE to reduce ("40 minutes", "90 min")
    #     cannot be told apart from the catastrophic ones without implementing unit arithmetic — a
    #     mini time parser inside a function whose contract is "don't invent numbers". And the cost
    #     is asymmetric: a blank box is visibly blank and one tap from correct, while `1` looks like
    #     data. Losing "40 minutes" is a real but cheap loss.
    #
    # So: comply or be dropped. The model is asked for digits twice (prompt and property
    # description) and answers at temperature 0, so non-compliance is the rare case, and when it
    # happens an empty field is honest — the person fills in a number they can actually see.
    # Still a STRING at the API boundary (see `ParsedRecipe`): reduced, never coerced, because a
    # parser must not 422 a whole recipe over one field.
    ready = s("ready_in_minutes")
    # `isascii()` AS WELL AS `isdigit()`, because `str.isdigit()` is True for Arabic-Indic "٤٢",
    # Devanagari "२०" and even superscript "²⁵" — so a recipe written in a script with its own
    # digits could pass this gate, and then `<input type="number">` blanks the value (not a valid
    # float) and `parseInt` gives NaN. No wrong number is stored, but the value is invisible and
    # uncorrectable, which is the exact defect the digits-only rule exists to prevent. Found by a
    # ship gate. (Translation is #64 and out of scope; this just fails closed until then.)
    ready_minutes = ready if (ready.isascii() and ready.isdigit()) else ""

    # CLAMPED TO THE SCHEMA'S OWN CEILINGS, because `ParsedRecipe(**data)` is constructed OUTSIDE
    # the `except RecipeAIUnavailable` in the router, so a Pydantic `ValidationError` there is an
    # uncaught 500 on a route whose docstring promises it "NEVER 500s on the model's account".
    # `story` is where that became likely rather than theoretical: the prompt says to keep the
    # cook's prose "at whatever length it was written", the input cap is 8000 characters, and a
    # pasted food-blog recipe — the canonical paste — routinely opens with more than 4000. Found by
    # a ship gate. Truncating a 4100-character story is strictly better than discarding the parse
    # and silently falling back to the line-based parser, which is what the 500 caused.
    def clamped(key: str, limit: int) -> str:
        return s(key)[:limit]

    return {
        "name": clamped("name", 120),
        "source_name": clamped("source_name", 80),
        "description": clamped("description", 500),
        "story": clamped("story", 4000),
        # Clamped too, so the sentence "every string is clamped to its ceiling" is actually TRUE.
        # These two skipped the helper in the first version of this fix — and `ready_in_minutes` was
        # brand-new code in the same commit that introduced the helper, which is the signature of a
        # fix written at the end of a long session. Both need a pathological input (61+ digits) to
        # matter, but the DOC claimed total coverage, and that sentence is what stops the next
        # person checking.
        "servings": digits[:60],
        "ready_in_minutes": ready_minutes[:60],
        "cuisine": clamped("cuisine", 60),
        "diet": clamped("diet", 60),
        "ingredients": ingredients,
        "steps": steps,
    }
