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


def root_of(recipe, db):
    """Walk parent_recipe_id to the lineage root; return the root Recipe."""
    from app.models.recipe import Recipe

    seen = set()
    current = recipe
    while current.parent_recipe_id is not None and current.id not in seen:
        seen.add(current.id)
        parent = db.query(Recipe).filter(Recipe.id == current.parent_recipe_id).first()
        if parent is None:
            break
        current = parent
    return current


def effective_visibility(recipe, db):
    """A recipe's visibility is its ROOT's visibility (root binds descendants)."""
    return root_of(recipe, db).visibility


def can_view(recipe, user, db):
    """public root OR owner OR an accepted grant on the root (see sharing spec)."""
    from app.models.handoff import Handoff

    if recipe.user_id == user.id:
        return True
    root = root_of(recipe, db)
    if root.visibility == "public":
        return True
    return (
        db.query(Handoff)
        .filter(
            Handoff.recipe_id == root.id,
            Handoff.to_user_id == user.id,
            Handoff.state == "accepted",
        )
        .first()
        is not None
    )


def _node_summary(recipe, db):
    from app.models.cook_event import CookEvent

    cook_count = db.query(CookEvent).filter(CookEvent.recipe_id == recipe.id).count()
    return {
        "id": recipe.id,
        "name": recipe.name,
        "author_full_name": recipe.author_full_name,
        "lineage_relation": recipe.lineage_relation,
        "origin_attribution": recipe.origin_attribution,
        "cook_count": cook_count,
    }


def _subtree_ids(root, db):
    from app.models.recipe import Recipe

    ids, frontier = [], [root.id]
    while frontier:
        node_id = frontier.pop()
        ids.append(node_id)
        child_ids = [
            r.id
            for r in db.query(Recipe.id)
            .filter(Recipe.parent_recipe_id == node_id, Recipe.deleted_at == None)
            .all()
        ]
        frontier.extend(child_ids)
    return ids


def build_lineage_view(recipe, db):
    """The walkable spine (root -> focus), the focus node's direct children, and
    whole-tree counts. Powers GET /recipes/{id}/lineage."""
    from app.models.recipe import Recipe
    from app.models.cook_event import CookEvent

    # spine: ancestors from root down to focus
    chain, seen, current = [], set(), recipe
    while current is not None and current.id not in seen:
        seen.add(current.id)
        chain.append(current)
        if current.parent_recipe_id is None:
            break
        current = db.query(Recipe).filter(Recipe.id == current.parent_recipe_id).first()
    chain.reverse()

    children = (
        db.query(Recipe)
        .filter(Recipe.parent_recipe_id == recipe.id, Recipe.deleted_at == None)
        .all()
    )

    root = chain[0] if chain else recipe
    subtree = _subtree_ids(root, db)
    cooks = db.query(CookEvent).filter(CookEvent.recipe_id.in_(subtree)).count()

    return {
        "focus": _node_summary(recipe, db),
        "spine": [_node_summary(n, db) for n in chain],
        "children": [_node_summary(c, db) for c in children],
        "counts": {"cooks": cooks, "versions": len(subtree)},
    }
