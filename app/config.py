from pydantic_settings import BaseSettings
from pydantic import ConfigDict


class Settings(BaseSettings):
    database_url: str
    jwt_secret: str
    algorithm: str = "HS256"
    access_token_expire_minutes: int = 60 * 24 * 7  # 7 days
    cloudinary_cloud_name: str = ""
    cloudinary_api_key: str = ""
    cloudinary_api_secret: str = ""
    # Comma-separated allowed frontend origins for CORS. Set in the deploy env
    # (e.g. the Vercel URL) so adding a frontend host needs no code change.
    # Local dev is always allowed.
    cors_origins: str = ""
    # OpenRouter, for structuring a spoken/pasted recipe into fields. Optional by
    # design: with no key the parse endpoint reports that the model is unavailable and
    # the client falls back to its local parser, so /add keeps working exactly as it did
    # before this existed. Server-side only — a key in the frontend bundle would be
    # readable by anyone who opens /assets/index-*.js and could be used to spend credits.
    openrouter_api_key: str = ""
    # Cheap and fast beats clever here: this is bounded extraction against a fixed
    # schema, not reasoning. Overridable per-deploy without a code change.
    openrouter_model: str = ""
    # Sent as HTTP-Referer for attribution on OpenRouter's dashboard. Cosmetic.
    openrouter_referer: str = ""
    # SES — password-reset emails. sender_email must be a verified SES identity.
    sender_email: str = ""
    # Where a new feedback note is emailed (#101). Empty → falls back to `sender_email`, which
    # needs NO new secret: SES requires the sender to be verified and, inside the sandbox, the
    # recipient too, so the one address guaranteed to be verified is the one already configured.
    # Point this at a real inbox once that address is verified in SES. Both empty → no email at
    # all, logged once per note, and feedback still saves — see services/email.py.
    feedback_notify_email: str = ""
    # Frontend URL used to build the reset link in the email.
    app_url: str = "https://issei.app"
    # Web Push / VAPID (#89). Both DEFAULT TO "" and that is load-bearing, not laziness: CI
    # sets only DATABASE_URL and JWT_SECRET, and the container build runs
    # `python -c "import app.main"` with just those two — a required field here would raise at
    # import and break the deploy before anything reached prod. With them empty,
    # `services/push.is_configured()` is False and every send is a logged no-op, so the app
    # behaves exactly as it did before push existed.
    #
    # The keypair is a P-256 ECDSA key, generated once (see infra/RUNBOOK.md) and stored as
    # base64url of the raw 32-byte private scalar. The PUBLIC key is not secret — the browser
    # needs it to subscribe, so it is served to the client — but it lives here rather than in
    # the frontend bundle so a rotation is a deploy and not a rebuild.
    #
    # ADDING THESE TO PROD MEANS FOUR EDITS AND ONLY ONE OF THEM SHIPS: the SSM parameter,
    # `ssmParams` in infra/lib/issei-stack.ts, `secrets[]` in .aws/task-definition.json (this is
    # the one the pipeline actually renders), and this class. Miss the task-definition entry and
    # the variable is simply absent in prod while the stack file looks correct.
    vapid_private_key: str = ""
    vapid_public_key: str = ""
    # The "sub" claim in the VAPID JWT — a mailto: or https: URL a push service can contact if
    # our sends misbehave. Required by RFC 8292 whenever a key is configured.
    vapid_subject: str = "mailto:hello@issei.app"
    # The shared secret the daily-prompt cron presents (#89). Defaults to "" and, when empty, the
    # route is DISABLED rather than open — an unset secret must never mean "no authentication
    # required", which is the failure mode of every `if secret and secret != given` check ever
    # written. Set it in SSM + the task definition alongside the VAPID keys.
    cron_secret: str = ""

    model_config = ConfigDict(env_file=".env", extra="ignore")

    @property
    def cors_origin_list(self) -> list[str]:
        defaults = [
            "http://localhost:5173",
        ]
        extra = [o.strip() for o in self.cors_origins.split(",") if o.strip()]
        seen, out = set(), []
        for o in defaults + extra:
            if o not in seen:
                seen.add(o)
                out.append(o)
        return out


settings = Settings()
