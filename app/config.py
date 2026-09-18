from pydantic_settings import BaseSettings
from pydantic import ConfigDict, field_validator


# Words that mean "switch it off" / "leave it on" for `PROMPT_SCHEDULER_INTERVAL_SECONDS`. The
# documented values are 0 and a number of seconds; these are what someone reaches for INSTEAD, under
# pressure, on the field every doc calls the emergency stop. Before this they raised at `app.config`
# import and took the API container down with the migration task — see the validator.
#
# BOTH DIRECTIONS, and the second one is the point. The first version accepted only the off words,
# which closed two fatal inputs and left the class open: an operator who has just learned that `off`
# works reaches for `on` when the incident ends, and `on` still crashed the container — identical
# blast radius, same field, same emergency, reached by the person most likely to have learned the
# vocabulary. A ship gate found that. ON means "enabled at the default interval", which is what
# someone typing it wants.
OFF_VALUES = frozenset({"off", "false", "no", "none", "disabled", "disable"})
ON_VALUES = frozenset({"on", "true", "yes", "enable", "enabled", "default"})


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
    # ADDING THESE TO PROD MEANS FIVE STEPS AND ONLY ONE OF THEM SHIPS:
    #   1. the SSM parameter itself
    #   2. an IAM grant of `ssm:GetParameters` on that ARN to the ECS EXECUTION ROLE — the step
    #      that fails the deploy, and the one this comment used to omit. The existing secrets are
    #      readable because `ecs.Secret.fromSsmParameter` auto-granted read on exactly those; the
    #      pipeline never runs `cdk`, so a new `secrets[]` entry extends nothing.
    #   3. `ssmParams` in infra/lib/issei-stack.ts (does NOT ship — kept in step so it can't drift)
    #   4. `secrets[]` in .aws/task-definition.json — THIS is the one the pipeline renders
    #   5. this class
    # Miss 4 and the variable is simply absent in prod while the stack file looks correct. Miss 2
    # and the container never starts, with an empty log group. `tests/test_deploy_config.py` now
    # pins 3, 4 and 5 against each other; 1 and 2 live in AWS and only a deploy can prove them.
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
    # How often the IN-PROCESS daily-prompt ticker runs (`services/prompt_scheduler.py`). Ten
    # minutes, matching what the GitHub cron ASKS for and does not get — that scheduler delivers
    # 5-7 runs a day whether you request 24 or 144, measured, which is why an in-process loop
    # exists at all. FLOORED AT 600s in the loop (`prompt_scheduler.MIN_INTERVAL_SECONDS`), and
    # that floor is a COST boundary rather than protection against a hot loop: because a
    # successful tick refreshes the `/health/ready` cache, this loop is the only thing querying
    # the database periodically, so the interval IS the idle window Neon gets. A smaller value is
    # clamped UP and logged at WARNING. Setting 120s here does NOT give you a 120s send window.
    #
    # SET 0 TO DISABLE — 0, not blank (blank means "unset" and yields this default; see the
    # validator below for why that mattered). The variable is wired into BOTH
    # `.aws/task-definition.json` and `infra/lib/issei-stack.ts`, and `tests/test_deploy_config.py`
    # pins it there — it was absent from both when this setting first shipped, while three places
    # documented it as an off switch that needed no deploy.
    #
    # What it honestly buys, in full, because the first version of this note stopped halfway: a
    # hand-registered revision with 0 does nothing on its own — the SERVICE holds a concrete revision
    # ARN, so it also needs `aws ecs update-service --task-definition <family>:<rev>
    # --force-new-deployment` before new tasks pick it up. Even then the pipeline renders every
    # revision from the committed JSON, so the next merge to main restores 600. Emergency stop, not
    # a durable setting; for durable, edit `.aws/task-definition.json` and ship it.
    #
    # Enabled by default, because a scheduler that ships disabled is the "setting nothing reads"
    # defect this codebase keeps deleting — and the loop is harmless where it isn't wanted, since
    # `run_daily_prompt` claims nobody's day on a deploy with no VAPID keys configured.
    prompt_scheduler_interval_seconds: int = 600

    @field_validator("prompt_scheduler_interval_seconds", mode="before")
    @classmethod
    def _blank_interval_means_the_default(cls, v):
        """A BLANK value must not take the container down, and it used to.

        `PROMPT_SCHEDULER_INTERVAL_SECONDS=""` raised
        `ValidationError: Input should be a valid integer, unable to parse string as an integer`
        at `app.config` IMPORT time — so the API container failed to boot, and so did the
        `alembic upgrade head` task that imports the same settings. A failed migration step plus a
        failed service, from clearing one field.

        That matters because CLEARING A FIELD IS THE INSTINCTIVE WAY TO TURN SOMETHING OFF in the
        ECS console, and all the documentation for this setting says it is the off switch. Someone
        reaching for it in a hurry, to stop a loop misbehaving in production, would have taken the
        whole API down instead — the worst possible moment for the emergency control to be a
        landmine. Found by the ship gate.

        Blank now means "unset", which is what a blank environment variable means everywhere else.
        To DISABLE the loop, set 0 — and every place that documents the switch now says so
        explicitly rather than leaving it to be inferred.
        """
        if v is None:
            return cls.model_fields["prompt_scheduler_interval_seconds"].default
        if not isinstance(v, str):
            return v
        text = v.strip().lower()
        if not text:
            # Blank means UNSET, which is what a blank environment variable means everywhere else.
            # Reads the field's declared default rather than repeating the literal, so changing the
            # default cannot silently make blank mean something other than "unset".
            return cls.model_fields["prompt_scheduler_interval_seconds"].default
        if text in ON_VALUES:
            return cls.model_fields["prompt_scheduler_interval_seconds"].default
        if text in OFF_VALUES:
            # The adjacent keystroke to a blank. Someone reaching for the documented off switch in a
            # hurry types `off` or `false` at least as readily as `0`, and before this those raised
            # at `app.config` import — taking the API container AND the `alembic upgrade head` task
            # down, which is the same total outage the blank case caused. Anything else unparseable
            # still raises, deliberately: `600s` or `ten` is a typo to fix, not an intention to
            # obey.
            return 0
        return v

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
