"""Web Push: the one place a notification actually leaves the building (#89).

Everything else in this app writes a row and waits to be read. This sends.

NO NEW DEPENDENCIES, deliberately. The obvious choice is `pywebpush`, but it hard-depends on
`requests`, and this codebase standardised on `httpx` (already a pinned direct dep, already used
for the OpenRouter call) — adding `requests` means a second TLS/HTTP stack nobody audits, in a
prod requirements file that is hand-derived and documents ~30MB of deliberate removals. What
pywebpush actually does is two well-specified things, and `cryptography==48.0.0` is already
pinned (as python-jose's backend) and does both:

  - RFC 8292 (VAPID): an ES256 JWT proving we're the sender, in an Authorization header.
  - RFC 8291 (Message Encryption): ECDH P-256 + HKDF-SHA256 + AES-128-GCM over the payload, so
    the push service relays bytes it cannot read.

The risk in hand-rolling that is silent wrongness — an encrypted body a browser rejects looks the
same from here as a delivered one. So `tests/test_push.py` DECRYPTS what this produces, from the
receiver's side, using the derivation the RFC specifies for the client. A round trip that lands
back on the plaintext is a real proof; "it returned 201" would not be.

DEGRADES, NEVER RAISES. With no VAPID key configured, `is_configured()` is False and every send
is a logged no-op — so a deploy without the secret behaves exactly as the app did before push
existed, rather than 500ing. This is the opposite of `services/email.py`, which raises and relies
on its one HTTP caller to catch; that pattern is wrong here, because the main caller is a
scheduled job with no user waiting on a response, where an uncaught exception is a silent outage.
"""

import base64
import json
import logging
import os
import struct
import time
from typing import Optional

import httpx
from cryptography.hazmat.primitives import hashes, serialization
from cryptography.hazmat.primitives.asymmetric import ec
from cryptography.hazmat.primitives.asymmetric.utils import decode_dss_signature
from cryptography.hazmat.primitives.ciphers.aead import AESGCM
from cryptography.hazmat.primitives.kdf.hkdf import HKDF

from app.config import settings

log = logging.getLogger(__name__)

# One record, so the whole payload goes in a single AES-GCM block. 4096 is the floor every push
# service is required to accept; our payloads are a sentence and a URL, well under it.
RECORD_SIZE = 4096
# How long a push service should hold an undeliverable message. 12 hours: the daily prompt is
# pointless tomorrow, and a person-to-person notification that arrives a day late is worse than
# one that doesn't (it reads as the app being broken).
TTL_SECONDS = 12 * 60 * 60
# The JWT's lifetime. RFC 8292 caps it at 24h; short is better, and every send mints a fresh one.
JWT_TTL_SECONDS = 12 * 60 * 60


def is_configured() -> bool:
    """Whether a real send can even be attempted.

    Both halves of the keypair are required: the private key signs the JWT and the public key is
    what the browser subscribed against, so a subscription minted for one public key cannot be
    delivered to with another.
    """
    return bool(settings.vapid_private_key and settings.vapid_public_key)


def _b64url_decode(value: str) -> bytes:
    """Base64url without padding, which is what every Push API field uses.

    The browser's `p256dh` and `auth` arrive unpadded; Python's decoder requires padding. Adding
    it back is the whole job, and getting it wrong produces a key that is silently the wrong
    length rather than an error.
    """
    pad = "=" * (-len(value) % 4)
    return base64.urlsafe_b64decode(value + pad)


def _b64url_encode(raw: bytes) -> str:
    return base64.urlsafe_b64encode(raw).rstrip(b"=").decode("ascii")


def in_quiet_hours(hour: int, quiet_from: int, quiet_to: int) -> bool:
    """Is `hour` inside the user's quiet window?

    THE WINDOW WRAPS MIDNIGHT IN THE DEFAULT CONFIGURATION (22 -> 8), which makes the obvious
    implementation exactly backwards: `quiet_from <= hour <= quiet_to` is False for every hour of
    a 22-to-8 window and True for none of them, so it would suppress the whole day EXCEPT the
    quiet hours. There is no other range control in this app to crib the semantics from, which is
    why this is a named function with its own tests rather than an inline comparison.

    Equal values mean no quiet hours at all rather than a 24-hour blackout: someone setting both
    to the same number is expressing "don't bother", not "never contact me", and the destructive
    reading of an ambiguous input is the wrong one.
    """
    if quiet_from == quiet_to:
        return False
    if quiet_from < quiet_to:
        # An ordinary daytime window, e.g. 1 -> 6.
        return quiet_from <= hour < quiet_to
    # Wraps midnight: 22 -> 8 means 22, 23, 0..7.
    return hour >= quiet_from or hour < quiet_to


def _vapid_headers(endpoint: str) -> dict:
    """The RFC 8292 Authorization header for one endpoint.

    `aud` is the push service's ORIGIN, not the full endpoint — a JWT scoped to the whole URL
    would be a bearer token for that one subscription, which is not what the spec asks for and
    leaks more than it needs to.
    """
    from urllib.parse import urlparse

    parsed = urlparse(endpoint)
    audience = f"{parsed.scheme}://{parsed.netloc}"

    header = _b64url_encode(json.dumps({"typ": "JWT", "alg": "ES256"}).encode())
    claims = _b64url_encode(
        json.dumps(
            {
                "aud": audience,
                "exp": int(time.time()) + JWT_TTL_SECONDS,
                "sub": settings.vapid_subject,
            }
        ).encode()
    )
    signing_input = f"{header}.{claims}".encode()

    private_int = int.from_bytes(_b64url_decode(settings.vapid_private_key), "big")
    key = ec.derive_private_key(private_int, ec.SECP256R1())
    der = key.sign(signing_input, ec.ECDSA(hashes.SHA256()))
    # JWS wants the raw r||s pair, fixed at 32 bytes each. `cryptography` emits DER, whose
    # integers are variable-length and may carry a leading zero — a naive concatenation of the
    # DER bytes produces a signature that verifies nowhere.
    r, s = decode_dss_signature(der)
    signature = _b64url_encode(r.to_bytes(32, "big") + s.to_bytes(32, "big"))

    return {
        "Authorization": f"vapid t={header}.{claims}.{signature}, k={settings.vapid_public_key}",
        "TTL": str(TTL_SECONDS),
        "Content-Encoding": "aes128gcm",
        "Content-Type": "application/octet-stream",
    }


def encrypt_payload(plaintext: bytes, p256dh: str, auth: str, *, salt: Optional[bytes] = None,
                    ephemeral: Optional[ec.EllipticCurvePrivateKey] = None) -> bytes:
    """RFC 8291 aes128gcm encryption of one push payload.

    `salt` and `ephemeral` are injectable ONLY so a test can pin a deterministic value against a
    known vector; production always takes the random path. They are keyword-only to make an
    accidental positional pass impossible.

    The shape of the output is fixed by the RFC and the order matters:
        salt(16) | record_size(4, big-endian) | key_id_len(1) | our_public_key(65) | ciphertext

    The receiver reads the header to learn our ephemeral public key, does the same ECDH from its
    side, and derives the identical CEK — which is what the round-trip test exercises.
    """
    client_public_bytes = _b64url_decode(p256dh)
    auth_secret = _b64url_decode(auth)
    record_salt = salt if salt is not None else os.urandom(16)
    our_key = ephemeral if ephemeral is not None else ec.generate_private_key(ec.SECP256R1())

    client_public = ec.EllipticCurvePublicKey.from_encoded_point(
        ec.SECP256R1(), client_public_bytes
    )
    our_public_bytes = our_key.public_key().public_bytes(
        encoding=serialization.Encoding.X962,
        format=serialization.PublicFormat.UncompressedPoint,
    )
    shared = our_key.exchange(ec.ECDH(), client_public)

    # Step one: mix the ECDH secret with the subscription's auth secret. The info string binds the
    # result to BOTH public keys, in the order (receiver, sender) — swapping them yields a key the
    # browser will not derive, and nothing here would notice.
    prk_info = b"WebPush: info\x00" + client_public_bytes + our_public_bytes
    ikm = HKDF(
        algorithm=hashes.SHA256(), length=32, salt=auth_secret, info=prk_info
    ).derive(shared)

    cek = HKDF(
        algorithm=hashes.SHA256(),
        length=16,
        salt=record_salt,
        info=b"Content-Encoding: aes128gcm\x00",
    ).derive(ikm)
    nonce = HKDF(
        algorithm=hashes.SHA256(),
        length=12,
        salt=record_salt,
        info=b"Content-Encoding: nonce\x00",
    ).derive(ikm)

    # 0x02 is the padding delimiter marking the LAST record. A single-record message still needs
    # it; omitting it produces a body the browser discards without telling anyone.
    ciphertext = AESGCM(cek).encrypt(nonce, plaintext + b"\x02", None)

    return (
        record_salt
        + struct.pack("!L", RECORD_SIZE)
        + bytes([len(our_public_bytes)])
        + our_public_bytes
        + ciphertext
    )


def send(endpoint: str, p256dh: str, auth: str, payload: dict) -> int:
    """Deliver one notification to one device. Returns the push service's status code.

    Return codes worth knowing, because acting on the wrong one is destructive:
      201 / 200  delivered to the service (NOT to the person — nothing here can know that)
      404 / 410  the subscription is DEAD. Prune the row; the browser has moved on.
      401 / 403  OUR KEY IS WRONG. Do NOT prune — a prune-on-any-4xx sender would empty the whole
                 table on the first botched key rotation, and a subscription can only be recreated
                 by the user re-granting permission on that device. There is no recovery path.
      413        payload too large.
      429        slow down.

    0 is returned when nothing was attempted (not configured), so a caller can distinguish "we
    didn't try" from "the service said no" without catching anything.
    """
    if not is_configured():
        log.info("push: VAPID not configured, skipping send to %s", endpoint[:60])
        return 0
    try:
        body = encrypt_payload(json.dumps(payload).encode(), p256dh, auth)
        headers = _vapid_headers(endpoint)
        response = httpx.post(endpoint, content=body, headers=headers, timeout=10.0)
        if response.status_code not in (200, 201):
            log.warning(
                "push: %s returned %s for %s",
                response.status_code,
                response.text[:200],
                endpoint[:60],
            )
        return response.status_code
    except Exception:
        # A push is never worth taking a request or a scheduled run down for. Logged with a
        # traceback so a systematically broken key is visible in CloudWatch rather than being a
        # mystery about why nobody gets notifications.
        log.exception("push: send failed for %s", endpoint[:60])
        return 0


# The two status codes — and ONLY these two — that mean a stored row should be deleted.
DEAD_SUBSCRIPTION_CODES = (404, 410)
