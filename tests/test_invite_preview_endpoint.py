"""The crawler-facing link-preview endpoint: GET /recipes/invite/{token}/preview.

Serves recipe-specific OpenGraph HTML so a shared invite link unfurls showing the
actual dish. Must return 200 HTML in every case (a crawler that gets a 5xx shows no
preview at all), and must never leak the owner's private fields.
"""


def _payload(name="Adobo", **extra):
    return {
        "name": name,
        "ingredients": [
            {"name": "chicken", "quantity_text": "2 lbs", "quantity_type": "precise", "position": 1}
        ],
        "steps": [{"content": "Cook", "position": 1}],
        **extra,
    }


def _handoff_token(client, headers, recipe_id):
    return client.post(f"/recipes/{recipe_id}/handoff", json={}, headers=headers).json()["token"]


def test_preview_renders_the_recipe_card(client, make_user):
    owner, headers = make_user(first_name="Charlie", last_name="C")
    root = client.post(
        "/recipes",
        json=_payload(name="Chicken Adobo", origin={"name": "Lola"}),
        headers=headers,
    ).json()
    token = _handoff_token(client, headers, root["id"])

    r = client.get(f"/recipes/invite/{token}/preview")
    assert r.status_code == 200
    assert "text/html" in r.headers["content-type"]
    body = r.text
    # The dish and its byline in the title; the sender in the description.
    assert '<meta property="og:title" content="Chicken Adobo — from Lola" />' in body
    assert "Charlie C passed you the recipe for Chicken Adobo" in body
    # Bounces a human who lands here to the real invite page.
    assert "/invite/" in body and token in body


def test_preview_is_unauthenticated(client, make_user):
    owner, headers = make_user()
    root = client.post("/recipes", json=_payload(), headers=headers).json()
    token = _handoff_token(client, headers, root["id"])
    # No auth header at all — a crawler holding the link.
    assert client.get(f"/recipes/invite/{token}/preview").status_code == 200


def test_preview_uses_cover_photo_when_present(client, make_user):
    owner, headers = make_user()
    root = client.post(
        "/recipes",
        json=_payload(cover_photo_url="https://res.cloudinary.com/demo/image/upload/adobo.jpg"),
        headers=headers,
    ).json()
    token = _handoff_token(client, headers, root["id"])
    body = client.get(f"/recipes/invite/{token}/preview").text
    assert '<meta property="og:image" content="https://res.cloudinary.com/demo/image/upload/adobo.jpg" />' in body


def test_unknown_token_returns_200_with_an_honest_card_not_500(client, make_user):
    # A crawler must never get an error page — a bad token degrades to an honest card.
    #
    # "Honest" is load-bearing and this test used to get it wrong: it asserted the card said
    # "expired or moved", which a handoff token cannot do (no `expires_at`, nothing sweeps them).
    make_user()
    r = client.get("/recipes/invite/not-a-real-token/preview")
    assert r.status_code == 200
    # The apostrophe is HTML-escaped in the rendered card, so match a clause without one.
    assert "issei is how someone sends you a dish" in r.text
    assert "expired" not in r.text.lower()
    assert "og:image" in r.text  # still a valid card


def test_preview_does_not_leak_private_notes(client, make_user):
    owner, headers = make_user()
    root = client.post(
        "/recipes",
        json=_payload(notes="PRIVATE-SCRATCHPAD: ask mom about the vinegar"),
        headers=headers,
    ).json()
    token = _handoff_token(client, headers, root["id"])
    body = client.get(f"/recipes/invite/{token}/preview").text
    assert "PRIVATE-SCRATCHPAD" not in body


def test_preview_claims_no_audio(client, make_user):
    import re

    owner, headers = make_user()
    root = client.post("/recipes", json=_payload(), headers=headers).json()
    token = _handoff_token(client, headers, root["id"])
    body = client.get(f"/recipes/invite/{token}/preview").text
    assert not re.search(r"record|recording|\bvoice\b|audio|listen", body, re.I)
