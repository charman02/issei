"""Profile pictures (issei #33): setting user.photo_url via PATCH /auth/me, the
avatar-upload endpoint's guards, and photo_url carrying through to the surfaces that
show a face (login, friends list, profile, posts feed).
"""

from io import BytesIO
from unittest.mock import patch


def test_photo_url_defaults_none(client, make_user):
    _, h = make_user()
    assert client.get("/auth/me", headers=h).json()["photo_url"] is None


def test_set_photo_url_no_password_needed(client, make_user):
    # Low-risk like a name edit — setting a photo needs no current_password.
    _, h = make_user()
    r = client.patch("/auth/me", json={"photo_url": "https://res.cloudinary.com/issei/avatars/me.jpg"}, headers=h)
    assert r.status_code == 200
    assert r.json()["photo_url"] == "https://res.cloudinary.com/issei/avatars/me.jpg"


def test_clear_photo_url_with_empty_string(client, make_user):
    _, h = make_user()
    client.patch("/auth/me", json={"photo_url": "https://res.cloudinary.com/issei/avatars/me.jpg"}, headers=h)
    # An empty string clears back to the monogram (stored as NULL).
    r = client.patch("/auth/me", json={"photo_url": ""}, headers=h)
    assert r.status_code == 200
    assert r.json()["photo_url"] is None


def test_photo_url_rejects_non_cloudinary_url(client, make_user):
    # photo_url is rendered as <img src> to anyone who sees the user's name, so an
    # arbitrary external URL would be a viewer-IP tracking pixel. Only a Cloudinary
    # HTTPS URL (what our own upload returns) is accepted.
    _, h = make_user()
    r = client.patch("/auth/me", json={"photo_url": "https://evil.com/px.gif"}, headers=h)
    assert r.status_code == 422
    # And the row stays clean.
    assert client.get("/auth/me", headers=h).json()["photo_url"] is None


def test_photo_url_whitespace_clears_to_null(client, make_user):
    _, h = make_user()
    client.patch("/auth/me", json={"photo_url": "https://res.cloudinary.com/issei/avatars/me.jpg"}, headers=h)
    r = client.patch("/auth/me", json={"photo_url": "   "}, headers=h)
    assert r.status_code == 200
    assert r.json()["photo_url"] is None


def test_login_response_carries_photo_url(client, make_user):
    # The cached issei_user drives the You-box avatar; a re-login must not drop it.
    user, h = make_user()
    client.patch("/auth/me", json={"photo_url": "https://res.cloudinary.com/issei/avatars/me.jpg"}, headers=h)
    resp = client.post(
        "/auth/login", data={"username": user.email, "password": "password123"}
    )
    assert resp.status_code == 200
    assert resp.json()["user"]["photo_url"] == "https://res.cloudinary.com/issei/avatars/me.jpg"


def test_photo_url_shows_on_friends_list_and_profile(client, make_user):
    # A face rides along wherever the name shows — friends list + profile header.
    a, ah = make_user()
    b, bh = make_user()
    client.patch("/auth/me", json={"photo_url": "https://res.cloudinary.com/issei/avatars/b.jpg"}, headers=bh)
    fid = client.post("/friends/request", json={"to_user_id": b.id}, headers=ah).json()["id"]
    client.post(f"/friends/{fid}/accept", headers=bh)

    friends = client.get("/friends", headers=ah).json()
    assert friends[0]["user_id"] == b.id
    assert friends[0]["photo_url"] == "https://res.cloudinary.com/issei/avatars/b.jpg"

    prof = client.get(f"/friends/profile/{b.id}", headers=ah).json()
    assert prof["photo_url"] == "https://res.cloudinary.com/issei/avatars/b.jpg"


def test_photo_url_shows_on_posts_feed(client, make_user):
    me, mh = make_user()
    client.patch("/auth/me", json={"photo_url": "https://res.cloudinary.com/issei/avatars/me.jpg"}, headers=mh)
    client.post(
        "/posts",
        json={"photo_url": "https://res.cloudinary.com/demo/image/upload/x.jpg", "dish_name": "Adobo"},
        headers=mh,
    )
    feed = client.get("/posts/feed", headers=mh).json()
    assert feed[0]["author_photo_url"] == "https://res.cloudinary.com/issei/avatars/me.jpg"


# --- the avatar upload endpoint (Cloudinary mocked) ---


def _img(content_type="image/jpeg"):
    return {"file": ("me.jpg", BytesIO(b"fakeimagebytes"), content_type)}


def test_avatar_upload_returns_url(client, make_user):
    _, h = make_user()
    with patch("app.routers.upload.cloudinary.uploader.upload") as up:
        up.return_value = {"secure_url": "https://res.cloudinary.com/issei/avatars/x.jpg"}
        r = client.post("/upload/avatar", files=_img(), headers=h)
    assert r.status_code == 200
    assert r.json()["url"] == "https://res.cloudinary.com/issei/avatars/x.jpg"
    # Uploaded into the avatars folder with a square face-gravity crop.
    _, kwargs = up.call_args
    assert kwargs["folder"] == "issei/avatars"
    crop = kwargs["transformation"][0]
    assert crop["width"] == crop["height"] and crop["gravity"] == "face"


def test_avatar_upload_rejects_non_image(client, make_user):
    _, h = make_user()
    r = client.post("/upload/avatar", files=_img(content_type="application/pdf"), headers=h)
    assert r.status_code == 400


def test_avatar_upload_requires_auth(client, make_user):
    make_user()
    r = client.post("/upload/avatar", files=_img())
    assert r.status_code == 401
