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
