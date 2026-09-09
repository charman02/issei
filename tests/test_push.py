"""The push sender (#89) — the one place in this app that sends rather than stores.

The point of this file is the round trip. `services/push.py` hand-rolls RFC 8291 encryption
rather than pulling in `pywebpush` (which drags `requests`, a second HTTP stack, into a codebase
standardised on httpx), and the failure mode of hand-rolled crypto is SILENT: a body a browser
quietly discards looks identical from the sender's side to one it accepts. "It returned 201"
proves nothing, because the push service relays bytes it cannot read either.

So we decrypt. `_decrypt_as_client` implements the RECEIVER half of the spec independently — the
derivation a browser performs — and asserts the plaintext comes back. If the sender's info
strings, key order, salt handling or padding delimiter were wrong, that round trip fails.
"""

import base64
import json
import struct

import pytest
from cryptography.hazmat.primitives import hashes, serialization
from cryptography.hazmat.primitives.asymmetric import ec
from cryptography.hazmat.primitives.ciphers.aead import AESGCM
from cryptography.hazmat.primitives.kdf.hkdf import HKDF

from app.services import push


def _b64(raw: bytes) -> str:
    return base64.urlsafe_b64encode(raw).rstrip(b"=").decode()


def _make_client_keys():
    """A browser's subscription keys: a P-256 keypair plus a 16-byte auth secret."""
    private = ec.generate_private_key(ec.SECP256R1())
    public_bytes = private.public_key().public_bytes(
        encoding=serialization.Encoding.X962,
        format=serialization.PublicFormat.UncompressedPoint,
    )
    auth_secret = b"0123456789abcdef"
    return private, _b64(public_bytes), _b64(auth_secret), public_bytes, auth_secret


def _decrypt_as_client(body: bytes, client_private, client_public_bytes, auth_secret) -> bytes:
    """The receiver half of RFC 8291, written independently of the sender.

    Deliberately not sharing helpers with `services/push.py`: if both sides called the same
    derivation function, a wrong info string would cancel out and the test would pass against a
    body no browser can read. The only thing shared is the RFC.
    """
    salt = body[:16]
    (record_size,) = struct.unpack("!L", body[16:20])
    key_id_len = body[20]
    sender_public_bytes = body[21 : 21 + key_id_len]
    ciphertext = body[21 + key_id_len :]

    sender_public = ec.EllipticCurvePublicKey.from_encoded_point(
        ec.SECP256R1(), sender_public_bytes
    )
    shared = client_private.exchange(ec.ECDH(), sender_public)

    # (receiver, sender) order — the asymmetry that a naive implementation gets backwards.
    prk_info = b"WebPush: info\x00" + client_public_bytes + sender_public_bytes
    ikm = HKDF(algorithm=hashes.SHA256(), length=32, salt=auth_secret, info=prk_info).derive(
        shared
    )
    cek = HKDF(
        algorithm=hashes.SHA256(),
        length=16,
        salt=salt,
        info=b"Content-Encoding: aes128gcm\x00",
    ).derive(ikm)
    nonce = HKDF(
        algorithm=hashes.SHA256(),
        length=12,
        salt=salt,
        info=b"Content-Encoding: nonce\x00",
    ).derive(ikm)

    padded = AESGCM(cek).decrypt(nonce, ciphertext, None)
    assert record_size == push.RECORD_SIZE
    # 0x02 marks the final record; strip it to recover the payload.
    assert padded.endswith(b"\x02"), "missing the last-record padding delimiter"
    return padded[:-1]


# --- the round trip: the only real proof the encryption is right ---


def test_a_browser_can_decrypt_what_we_encrypt():
    client_private, p256dh, auth, client_public_bytes, auth_secret = _make_client_keys()
    plaintext = json.dumps({"title": "issei", "body": "3 friends posted"}).encode()

    body = push.encrypt_payload(plaintext, p256dh, auth)
    assert _decrypt_as_client(body, client_private, client_public_bytes, auth_secret) == plaintext


def test_the_body_has_the_header_shape_the_rfc_specifies():
    """salt(16) | record_size(4) | key_id_len(1) | sender_public(65) | ciphertext."""
    _, p256dh, auth, _, _ = _make_client_keys()
    body = push.encrypt_payload(b"hi", p256dh, auth)

    assert len(body[:16]) == 16
    assert struct.unpack("!L", body[16:20])[0] == push.RECORD_SIZE
    assert body[20] == 65, "an uncompressed P-256 point is 65 bytes"
    # 16 + 4 + 1 + 65 header, then the ciphertext: 2 bytes of plaintext + 1 delimiter + 16 tag.
    assert len(body) == 86 + 3 + 16


def test_every_send_uses_a_FRESH_salt_and_ephemeral_key():
    """Reusing either would let a push service correlate messages, and reusing a (key, nonce)
    pair with AES-GCM is a catastrophic break rather than a weakness."""
    _, p256dh, auth, _, _ = _make_client_keys()
    a = push.encrypt_payload(b"same plaintext", p256dh, auth)
    b = push.encrypt_payload(b"same plaintext", p256dh, auth)
    assert a[:16] != b[:16], "salt was reused"
    assert a[21:86] != b[21:86], "ephemeral public key was reused"
    assert a != b


def test_a_different_subscription_cannot_read_it():
    """The keys are what scope a message to one device — not the endpoint URL."""
    _, p256dh, auth, _, _ = _make_client_keys()
    other_private, _, _, other_public_bytes, other_auth = _make_client_keys()
    body = push.encrypt_payload(b"private", p256dh, auth)
    with pytest.raises(Exception):
        _decrypt_as_client(body, other_private, other_public_bytes, other_auth)


def test_an_injected_salt_and_key_make_it_deterministic():
    """Only so a test can pin bytes; production always takes the random path. Keyword-only, so
    an accidental positional argument can't disable the randomness."""
    client_private, p256dh, auth, client_public_bytes, auth_secret = _make_client_keys()
    fixed_salt = b"\x01" * 16
    fixed_key = ec.generate_private_key(ec.SECP256R1())
    a = push.encrypt_payload(b"x", p256dh, auth, salt=fixed_salt, ephemeral=fixed_key)
    b = push.encrypt_payload(b"x", p256dh, auth, salt=fixed_salt, ephemeral=fixed_key)
    assert a == b
    assert a[:16] == fixed_salt
    assert _decrypt_as_client(a, client_private, client_public_bytes, auth_secret) == b"x"


# --- quiet hours: the wrap-around is the COMMON case, not the edge one ---


def test_quiet_hours_wrap_midnight():
    """22 -> 8 is the default, and `quiet_from <= hour <= quiet_to` gets it exactly backwards —
    it would suppress the whole day EXCEPT the quiet window."""
    for hour in (22, 23, 0, 3, 7):
        assert push.in_quiet_hours(hour, 22, 8) is True, hour
    for hour in (8, 9, 12, 18, 21):
        assert push.in_quiet_hours(hour, 22, 8) is False, hour


def test_quiet_hours_that_dont_wrap():
    """A daytime window, e.g. someone who works nights and wants 1am-6am left alone."""
    for hour in (1, 3, 5):
        assert push.in_quiet_hours(hour, 1, 6) is True, hour
    for hour in (0, 6, 7, 23):
        assert push.in_quiet_hours(hour, 1, 6) is False, hour


def test_the_boundaries_are_half_open():
    """`from` is quiet, `to` is not — so 22->8 leaves 8am sendable, which is what "quiet until 8"
    means to a person."""
    assert push.in_quiet_hours(22, 22, 8) is True
    assert push.in_quiet_hours(8, 22, 8) is False


def test_equal_bounds_mean_NO_quiet_hours_not_a_blackout():
    """Someone setting both to the same number is saying "don't bother", not "never contact me".
    Reading an ambiguous input the destructive way would silently mute an account forever."""
    for hour in range(24):
        assert push.in_quiet_hours(hour, 9, 9) is False, hour


# --- the unconfigured path: a deploy without the secret must behave like before push existed ---


def test_an_unconfigured_deploy_sends_nothing_and_raises_nothing():
    """Both keys default to "" so CI and the container's `import app.main` smoke test pass. If
    this raised instead, adding push would have broken the deploy before reaching prod."""
    assert push.is_configured() is False
    assert push.send("https://push.example/x", "irrelevant", "irrelevant", {"a": 1}) == 0


def test_is_configured_needs_BOTH_halves(monkeypatch):
    """A subscription is minted against the PUBLIC key, so a private key alone cannot deliver to
    it — half a keypair is not a usable configuration."""
    monkeypatch.setattr(push.settings, "vapid_private_key", "priv", raising=False)
    monkeypatch.setattr(push.settings, "vapid_public_key", "", raising=False)
    assert push.is_configured() is False
    monkeypatch.setattr(push.settings, "vapid_public_key", "pub", raising=False)
    assert push.is_configured() is True


# --- the VAPID header ---


def test_the_vapid_jwt_is_signed_and_scoped_to_the_ORIGIN(monkeypatch):
    """`aud` is the push service's origin, not the full endpoint: a JWT scoped to the whole URL
    would be a bearer token for that one subscription."""
    key = ec.generate_private_key(ec.SECP256R1())
    raw_private = key.private_numbers().private_value.to_bytes(32, "big")
    public_bytes = key.public_key().public_bytes(
        encoding=serialization.Encoding.X962,
        format=serialization.PublicFormat.UncompressedPoint,
    )
    monkeypatch.setattr(push.settings, "vapid_private_key", _b64(raw_private), raising=False)
    monkeypatch.setattr(push.settings, "vapid_public_key", _b64(public_bytes), raising=False)

    headers = push._vapid_headers("https://fcm.googleapis.com/fcm/send/abc123?x=1")
    assert headers["Content-Encoding"] == "aes128gcm"
    assert headers["TTL"] == str(push.TTL_SECONDS)

    token = headers["Authorization"].split("t=", 1)[1].split(",", 1)[0]
    header_b64, claims_b64, sig_b64 = token.split(".")

    def unb64(v):
        return base64.urlsafe_b64decode(v + "=" * (-len(v) % 4))

    assert json.loads(unb64(header_b64))["alg"] == "ES256"
    claims = json.loads(unb64(claims_b64))
    assert claims["aud"] == "https://fcm.googleapis.com", "must be the origin, not the path"
    assert claims["sub"] == push.settings.vapid_subject
    assert claims["exp"] > 0

    # The signature must be the raw 64-byte r||s pair, not DER — a DER signature verifies nowhere
    # and is the single easiest thing to get wrong here.
    signature = unb64(sig_b64)
    assert len(signature) == 64
    from cryptography.hazmat.primitives.asymmetric.utils import encode_dss_signature

    r = int.from_bytes(signature[:32], "big")
    s = int.from_bytes(signature[32:], "big")
    key.public_key().verify(
        encode_dss_signature(r, s),
        f"{header_b64}.{claims_b64}".encode(),
        ec.ECDSA(hashes.SHA256()),
    )


def test_only_404_and_410_mean_a_dead_subscription():
    """The list a pruner must consult. 401/403 mean OUR key is wrong, not that the subscriptions
    are dead — a prune-on-any-4xx sender would empty the whole table on the first botched key
    rotation, and a subscription can only be recreated by the user re-granting permission on that
    device. There is no recovery path, which is why this is pinned rather than assumed."""
    assert push.DEAD_SUBSCRIPTION_CODES == (404, 410)
    for code in (400, 401, 403, 413, 429, 500, 503):
        assert code not in push.DEAD_SUBSCRIPTION_CODES, code


def test_a_transport_failure_is_logged_and_swallowed(monkeypatch):
    """A push is never worth taking a request or a scheduled run down for. The main caller is a
    scheduled job with nobody waiting on a response, so an uncaught exception there is a silent
    outage rather than a visible error."""
    key = ec.generate_private_key(ec.SECP256R1())
    monkeypatch.setattr(
        push.settings,
        "vapid_private_key",
        _b64(key.private_numbers().private_value.to_bytes(32, "big")),
        raising=False,
    )
    monkeypatch.setattr(push.settings, "vapid_public_key", "pub", raising=False)

    def boom(*a, **k):
        raise RuntimeError("network is down")

    monkeypatch.setattr(push.httpx, "post", boom)
    _, p256dh, auth, _, _ = _make_client_keys()
    assert push.send("https://push.example/x", p256dh, auth, {"a": 1}) == 0
