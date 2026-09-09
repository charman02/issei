"""Unit tests for the invite link-preview (OG) builders.

These mirror the frontend inviteOg.test.js that this logic replaced — the preview
moved from a Vercel serverless function (which Vercel wasn't deploying) to a FastAPI
route, so the string/escaping logic lives here now and is tested here.
"""

from types import SimpleNamespace

from app.services.invite_og import (
    escape_html,
    build_invite_meta,
    render_invite_og_document,
)

CTX = {"site_origin": "https://issei.app", "token": "tok123"}


def _recipe(**over):
    base = dict(
        name="Adobo",
        from_name="Charlie",
        origin_attribution="Lola",
        description="A braise that tastes like her kitchen.",
        cover_photo_url="https://img.test/adobo.jpg",
    )
    base.update(over)
    return SimpleNamespace(**base)


class TestEscapeHtml:
    def test_escapes_html_and_attribute_breaking_chars(self):
        assert escape_html('<b>"Mom\'s" & <adobo></b>') == (
            "&lt;b&gt;&quot;Mom&#x27;s&quot; &amp; &lt;adobo&gt;&lt;/b&gt;"
        )

    def test_none_becomes_empty_not_the_word_none(self):
        assert escape_html(None) == ""


class TestBuildInviteMetaRealRecipe:
    def test_title_carries_dish_and_byline(self):
        m = build_invite_meta(_recipe(), **CTX)
        assert m["title"] == "Adobo — from Lola"
        assert m["found"] is True

    def test_description_names_the_sender(self):
        m = build_invite_meta(_recipe(), **CTX)
        assert "Charlie passed you the recipe for Adobo" in m["description"]

    def test_cover_photo_is_the_preview_image(self):
        assert build_invite_meta(_recipe(), **CTX)["image"] == "https://img.test/adobo.jpg"

    def test_url_is_origin_plus_token(self):
        assert build_invite_meta(_recipe(), **CTX)["url"] == "https://issei.app/invite/tok123"

    def test_falls_back_to_site_image_without_a_cover(self):
        m = build_invite_meta(_recipe(cover_photo_url=None), **CTX)
        assert m["image"] == "https://issei.app/og.png"

    def test_drops_byline_from_title_without_attribution(self):
        assert build_invite_meta(_recipe(origin_attribution=None), **CTX)["title"] == "Adobo"

    def test_missing_sender_leaves_no_blank(self):
        m = build_invite_meta(_recipe(from_name=None), **CTX)
        assert "Someone passed you the recipe for Adobo" in m["description"]


class TestBuildInviteMetaNotFound:
    def test_never_says_EXPIRED_because_a_token_cannot_expire(self):
        # This test used to assert the copy said "expired or moved", and its own name claimed that
        # was the honest answer. It wasn't: `Handoff` has no `expires_at` and nothing sweeps
        # handoffs, so a token cannot expire — the true states are "deleted" or "never existed".
        # The docstring in invite_og.py said so six lines above the string that said otherwise.
        # POSITIONING: nothing in issei expires.
        m = build_invite_meta(None, reached=True, **CTX)
        assert m["found"] is False
        assert "isn't here" in m["description"]
        for word in ("expired", "expire", "moved", "no longer available"):
            assert word not in m["description"].lower(), word
        assert m["image"] == "https://issei.app/og.png"
        assert m["url"] == "https://issei.app/invite/tok123"

    def test_does_not_call_a_link_expired_when_unreachable(self):
        # DB blip — the link may be valid, so "expired" would be a lie.
        m = build_invite_meta(None, reached=False, **CTX)
        assert m["found"] is False
        assert "expired" not in m["description"].lower()
        assert "open this recipe on issei" in m["description"].lower()


class TestRenderDocument:
    def test_injects_recipe_specific_og_tags(self):
        html = render_invite_og_document(build_invite_meta(_recipe(cover_photo_url="https://img.test/a.jpg"), **CTX))
        assert '<meta property="og:title" content="Adobo — from Lola" />' in html
        assert '<meta property="og:image" content="https://img.test/a.jpg" />' in html
        assert '<meta name="twitter:card" content="summary_large_image" />' in html
        # Bounces a human who somehow lands here to the real URL.
        assert "url=https://issei.app/invite/tok123" in html

    def test_escapes_a_hostile_recipe_name(self):
        html = render_invite_og_document(
            build_invite_meta(_recipe(name='"><script>alert(1)</script>', origin_attribution=None), **CTX)
        )
        assert "<script>alert(1)</script>" not in html
        assert "&lt;script&gt;" in html

    def test_claims_no_audio_anywhere(self):
        import re

        banned = re.compile(r"record|recording|\bvoice\b|audio|listen", re.I)
        for meta in (
            build_invite_meta(_recipe(), **CTX),
            build_invite_meta(None, reached=True, **CTX),
            build_invite_meta(None, reached=False, **CTX),
        ):
            assert not banned.search(render_invite_og_document(meta))
