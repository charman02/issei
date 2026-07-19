"""Growth model: stage (breadth of dimensions + use) and vitality (repeated use).
See the living-recipe spec §2 + its 2026-07-10 refinement.

Two axes:
  STAGE   seed → sprout → sapling → tree.  USE advances up to SAPLING; only SOUL
          reaches TREE (a beloved-but-untold recipe caps at sapling).
  VITALITY bare → blooming → fruiting (Sapling & Tree only; caps at fruiting).
"""

# tunable thresholds
_SAPLING_SOUL = 3  # soul dimensions to reach sapling by breadth
_TREE_SOUL = 3  # soul dimensions required for tree (use can't substitute)
_HEAVY_USE = 5  # cooks that count as "genuinely used" → grows up to sapling
_BLOOM_COOKS = 2  # activity to start blooming
_FRUIT_COOKS = 12  # activity to fruit (then caps)


def soul_count(recipe) -> int:
    """How many soul dimensions are present (0-4).

    Soul = what carries the PERSON, not generic recipe metadata:
      • story               — the framing narrative / their words
      • cover_photo_url      — a photo (presence)
      • origin_attribution   — who it came from
      • their words on steps — ≥1 step with a voice_note (the person's voice)

    Deliberately NOT counted: the generic recipe-level `notes` field (practical
    detail, not necessarily soul — 2026-07-18 growth decision), and cooking
    (use advances only to sapling, in growth_stage).
    """
    dims = (
        bool(getattr(recipe, "story", None)),
        bool(getattr(recipe, "cover_photo_url", None)),
        bool(getattr(recipe, "origin_attribution", None)),
        _has_step_words(recipe),
    )
    return sum(dims)


def _has_step_words(recipe) -> bool:
    """True if any step carries the person's words (a non-empty voice_note)."""
    steps = getattr(recipe, "steps", None) or []
    return any((getattr(s, "voice_note", None) or "").strip() for s in steps)


def growth_stage(soul: int, cook_count: int) -> str:
    # Tree requires soul; use alone can never get here.
    if soul >= _TREE_SOUL and (cook_count >= 1 or soul >= 4):
        return "tree"
    # Sapling: enough soul breadth, OR genuinely used (grows up on use).
    if soul >= _SAPLING_SOUL or cook_count >= _HEAVY_USE:
        return "sapling"
    # Sprout: any single sign of life.
    if soul >= 1 or cook_count >= 1:
        return "sprout"
    return "seed"


def growth_vitality(cook_count: int, share_count: int) -> str:
    activity = cook_count + share_count
    if activity >= _FRUIT_COOKS:
        return "fruiting"
    if activity >= _BLOOM_COOKS:
        return "blooming"
    return "bare"
