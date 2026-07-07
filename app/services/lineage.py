"""Lineage services: diff detection (pre-fills the remix prompt), effective
visibility (root binds descendants), and the walkable lineage view.

See docs/superpowers/specs/2026-07-06-lineage-tree-signature-feature-design.md.
"""


def _ing_names(items):
    return [i.name.strip().lower() for i in items if getattr(i, "name", None)]


def _step_texts(items):
    return [s.content.strip().lower() for s in items if getattr(s, "content", None)]


def diff_recipes(parent_ingredients, parent_steps, child_ingredients, child_steps):
    """Compare a child version to its parent and describe what changed, so the
    remix prompt can be pre-filled ('You swapped butter -> lard. Why?')."""
    p_ings, c_ings = _ing_names(parent_ingredients), _ing_names(child_ingredients)
    removed = [n for n in p_ings if n not in c_ings]
    added = [n for n in c_ings if n not in p_ings]

    ingredient_changed = bool(removed or added)
    steps_changed = _step_texts(parent_steps) != _step_texts(child_steps)

    if ingredient_changed:
        if removed and added:
            summary = f"{removed[0]} → {added[0]}"
        elif added:
            summary = f"added {added[0]}"
        else:
            summary = f"dropped {removed[0]}"
        return {"changed": True, "summary": summary, "prompt_key": "ingredient_swap"}

    if steps_changed:
        return {"changed": True, "summary": "changed the method", "prompt_key": "step_change"}

    return {"changed": False, "summary": "", "prompt_key": "general_change"}


def effective_visibility(recipe, db):
    """A recipe's visibility is its ROOT's visibility — the root author binds all
    descendants (a keeper cannot out-share past the origin). Walks parents to root."""
    from app.models.recipe import Recipe

    seen = set()
    current = recipe
    while current.parent_recipe_id is not None and current.id not in seen:
        seen.add(current.id)
        parent = db.query(Recipe).filter(Recipe.id == current.parent_recipe_id).first()
        if parent is None:
            break
        current = parent
    return current.visibility
