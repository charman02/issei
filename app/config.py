from pydantic_settings import BaseSettings
from pydantic import ConfigDict, Field, field_validator


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

    # RATE LIMITING (`services/rate_limit.py`). On by default — a security control that ships
    # disabled is the "setting nothing reads" defect this codebase keeps deleting.
    #
    # THE OFF SWITCH IS THE POINT. Every other failure in this app degrades quietly; a rate limiter
    # that misfires locks real people out of their own accounts, and the person finding that out is
    # the owner reading a message from a user who cannot sign in. So it is wired into BOTH
    # `.aws/task-definition.json` and `infra/lib/issei-stack.ts` (pinned by
    # `tests/test_deploy_config.py`) and can be turned off by hand on a task revision without a code
    # change — with the same caveat that applies to the scheduler interval: the SERVICE holds a
    # concrete revision, so it also needs `aws ecs update-service --task-definition <family>:<rev>
    # --force-new-deployment`, and the next merge to main restores whatever the committed JSON says.
    rate_limit_enabled: bool = True
    # HOW MANY APPENDING PROXIES SIT IN FRONT of the app. 1 = the ALB and nothing else, which is
    # today. This is not a tuning knob, it is a statement about the network, and getting it wrong
    # breaks the limiter in one of two directions — see `rate_limit.client_ip` for both. Put
    # CloudFront in front and this becomes 2; run with nothing in front and it must be 0, because
    # with no proxy to append the real address every byte of `X-Forwarded-For` is attacker-written.
    #
    # BOUNDED, because BOTH out-of-range values fail SILENTLY and in opposite directions — a ship gate
    # pointed out that `-1` was accepted and aliases 0 (ignore the header → every caller in the ALB's
    # single bucket → the first attacker locks out the whole app), while `99` was accepted and clamps
    # to index 0 (→ trusts the attacker-written end of the header → nothing is limited). Neither
    # raised. 4 is a generous ceiling: nobody stacks five appending proxies in front of this app, and
    # a value that high is a typo rather than an architecture.
    trusted_proxy_hops: int = Field(default=1, ge=0, le=4)

    @field_validator("rate_limit_enabled", "trusted_proxy_hops", mode="before")
    @classmethod
    def _blank_means_the_default(cls, v, info):
        """The same landmine as `prompt_scheduler_interval_seconds`, on the same kind of field.

        A blank value raised at `app.config` IMPORT, which takes down the API container and the
        `alembic upgrade head` task together. Clearing a field is the instinctive way to switch
        something off, and this pair is documented as exactly that — so blank meant total outage on
        the control an operator reaches for while something is already going wrong.

        Pydantic already parses a generous bool vocabulary (`true/false`, `yes/no`, `on/off`, `1/0`),
        so only the empty case needs handling here; `trusted_proxy_hops` gets the same treatment
        because it is an int and has the identical failure. Garbage still raises, deliberately — a
        typo is to fix, not to obey.
        """
        if v is None:
            return cls.model_fields[info.field_name].default
        if isinstance(v, str) and not v.strip():
            return cls.model_fields[info.field_name].default
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
