"""Lineage services: effective visibility (root binds descendants), read
authorization (can_view), and the walkable lineage view.

A recipe's effective visibility is bound to its lineage root; can_view is the
single read-authorization rule (public root OR owner OR an accepted grant on
the root) that every recipe read funnels through.
"""


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
