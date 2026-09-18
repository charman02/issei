import asyncio
import contextlib
import logging
import sys
from contextlib import asynccontextmanager
from time import monotonic

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy import text

from app.config import settings
from app.database import SessionLocal
from app.routers import auth, feedback, friends, posts, recipes, upload, notifications
from app.services import prompt_scheduler

logger = logging.getLogger(__name__)


def configure_app_logging() -> None:
    """Give the `app.*` loggers a handler, because otherwise they have none in production.

    WITHOUT THIS THE SCHEDULER IS INVISIBLE, which would make its own success unobservable — the
    exact failure it was written to fix, one level up. Uvicorn calls `dictConfig` on its
    `LOGGING_CONFIG`, which configures only the `uvicorn*` loggers; the ROOT logger is left with no
    handlers and at WARNING. Measured against exactly what the container runs:

        root handlers: []      root level: 30 (WARNING)
        app.services.prompt_scheduler.isEnabledFor(INFO) -> False

    So `daily-prompt tick: {...}` produced nothing at all in the ECS logs, while a FAILURE still
    reached stderr through `logging.lastResort`. Successes silent, failures loud — which means "the
    loop died" and "nobody was due" looked identical, and the commit that added the loop nominated
    that very log line as the only way to verify it works. Found by the ship gate.

    Called from the lifespan rather than at import, so it runs AFTER uvicorn has configured logging
    and cannot be undone by it. Idempotent: the handler check matters because the test suite starts
    and stops this lifespan many times, and stacking handlers would multiply every line.
    """
    app_logger = logging.getLogger("app")
    if not app_logger.handlers:
        handler = logging.StreamHandler(sys.stdout)
        handler.setFormatter(logging.Formatter("%(levelname)s %(name)s: %(message)s"))
        app_logger.addHandler(handler)

    # NAMED LOGGERS, NOT THE WHOLE `app.*` TREE, and that narrowing is a privacy decision. Raising
    # the entire tree to INFO newly shipped user-typed content to CloudWatch:
    # `services/recipe_ai.py` logs `dropped ungrounded ingredient %r` at INFO — an ingredient name
    # lifted from whatever someone pasted into the parser — and `services/push.py` logs an endpoint
    # prefix. Before this function existed those went nowhere. The quiet was doing a little privacy
    # work, so only the loggers that have to speak are raised. Found by the ship gate. `app` ITSELF
    # IS NOT IN THIS LIST, and that is the whole narrowing. A level on `app` is INHERITED by every
    # child that has none of its own — `getEffectiveLevel` walks up until it finds a non-zero level
    # — so setting `app` to INFO raises `app.services.recipe_ai` with it and the narrowing is
    # cosmetic. The first version of this function did exactly that, and its own test caught it.
    # `app` keeps the HANDLER (records propagate up to it, and `callHandlers` does not consult an
    # ancestor's level) while its level stays NOTSET, inheriting root's WARNING.
    logging.getLogger("app").disabled = False
    for name in ("app.main", "app.services.prompt", "app.services.prompt_scheduler"):
        target = logging.getLogger(name)
        # `disabled` BEFORE the level, because it overrides everything and is set BEHIND YOUR BACK.
        # `logging.config.dictConfig` defaults to `disable_existing_loggers=True`, which sets
        # `disabled = True` on every existing logger BY NAME — children included, which is why this
        # loops rather than clearing the parent alone. `Logger.isEnabledFor` checks that flag first,
        # so a logger can report level INFO, effective level INFO and `manager.disable = 0` while
        # emitting nothing. Exactly that combination failed a test here, and the state it printed
        # looked impossible until this flag explained it. The repo's real caller of that machinery
        # is `alembic/env.py`'s `fileConfig`, which also defaults to disabling; uvicorn passes
        # False, so production is not hit TODAY — which is why it is set explicitly rather than
        # trusted.
        target.disabled = False
        target.setLevel(logging.INFO)


@asynccontextmanager
async def lifespan(_app: FastAPI):
    """Owns the in-process daily-prompt ticker (see `services/prompt_scheduler.py` for WHY).

    GATED ON A POSITIVE INTERVAL. Zero or negative disables the loop — and note it must be a
    NUMBER: a blank value used to crash `Settings` at import and take the container down with it,
    which is fixed in `config.py` and pinned by a test, because clearing a field is the instinctive
    way to switch something off in the ECS console.

    `on_db_ok=mark_db_reachable` is the fix for a cost defect, not a nicety — see that function.
    Two independent 600s database timers can leave Neon's compute no idle window at all.

    The task is CANCELLED AND AWAITED on shutdown, and a strong reference is kept in a local:
    the event loop holds only a weak one, so a task passed straight to `create_task` and
    forgotten can be collected mid-flight, which is a documented way to lose background work
    silently. `suppress(CancelledError)` because awaiting a cancelled task re-raises and a clean
    shutdown is not an error.

    WHAT THIS DOES **NOT** DO, since an earlier version of this docstring claimed it did: it does
    not protect a tick that is already running. The blocking work is on a thread via
    `asyncio.to_thread`, and `CancelledError` cannot be delivered into a thread — `await task`
    returns immediately while the worker thread runs on. What actually joins that thread is the
    interpreter's executor shutdown at process exit, bounded by ECS `stopTimeout` — unset in BOTH
    `.aws/task-definition.json` (the file the pipeline actually renders) and
    `infra/lib/issei-stack.ts`, so the 30s default applies. A deploy landing mid-pass therefore truncates
    it, and because `run_daily_prompt` writes each `prompt_sends` row BEFORE sending, the users
    already claimed but not yet pushed lose that evening's nudge rather than getting two. That
    ordering is deliberate and this is its accepted cost.
    """
    configure_app_logging()
    task = None
    if settings.prompt_scheduler_interval_seconds > 0:
        task = asyncio.create_task(
            prompt_scheduler.run_forever(on_db_ok=mark_db_reachable)
        )
    else:
        logger.info("daily-prompt scheduler disabled (interval <= 0)")
    try:
        yield
    finally:
        if task is not None:
            task.cancel()
            with contextlib.suppress(asyncio.CancelledError):
                await task


app = FastAPI(lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origin_list,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(auth.router)
app.include_router(recipes.router)
app.include_router(upload.router)
app.include_router(feedback.router)
app.include_router(friends.router)
app.include_router(posts.router)
app.include_router(notifications.router)


@app.get("/health")
def health():
    return {"status": "ok"}


# How long a SUCCESSFUL database check is trusted before /health/ready queries again.
# 600s is chosen against Neon's autosuspend (~5 min idle): longer than the suspend
# threshold, so the compute is allowed to sleep between checks.
READY_DB_CACHE_SECONDS = 600
# Timestamp of the last successful DB check (monotonic seconds), or None if the last
# check FAILED or none has run. Process-local by design — each task proves its own
# egress, which is the whole point of the probe.
_last_ready_ok: float | None = None


@app.get("/health/ready")
def health_ready():
    """Readiness probe — proves this task can reach the database.

    The ALB target group points here so a task with broken DB egress fails its health
    check and ECS rolls back via the circuit breaker, instead of reporting 'green' over
    a silently-dead prod.

    THE CHECK IS MEMOIZED, and that is a cost fix, not a shortcut. The ALB polls this
    every 30s (infra/lib/issei-stack.ts) against a single always-on task, so querying on
    every call meant a database round-trip every 30 seconds forever. Neon's entire cost
    model is autosuspend-when-idle; a 30s heartbeat means it never gets an idle window,
    so the compute billed 24/7 (~730 compute-hours/month against a free tier of roughly
    190) on an app with almost no real traffic. That overage was health checks, not users.

    What the memoization deliberately preserves:
      - a NEW task always does a real query (nothing cached yet), so a deploy with broken
        DB egress still fails its first health check and still triggers the rollback —
        which is when this endpoint actually earns its keep;
      - a FAILED check is never cached, so once the DB is genuinely unreachable every
        subsequent poll re-probes at the full 30s cadence and the task goes unhealthy
        promptly;
      - only a SUCCESS is trusted, and only for READY_DB_CACHE_SECONDS.

    The cost: a DB that breaks while a task is already running is detected up to ~10
    minutes late rather than within 30 seconds. Accepted — the app 500s on real requests
    immediately either way, and paying for 24/7 compute to shorten that window is the
    wrong trade at this scale.
    """
    global _last_ready_ok
    now = monotonic()
    if _last_ready_ok is not None and (now - _last_ready_ok) < READY_DB_CACHE_SECONDS:
        return {"status": "ready", "db": "cached"}
    try:
        with SessionLocal() as session:
            session.execute(text("SELECT 1"))
    except Exception:
        # Clear the cache so the next poll re-probes instead of coasting on a stale OK.
        _last_ready_ok = None
        raise
    _last_ready_ok = now
    return {"status": "ready", "db": "checked"}


def mark_db_reachable() -> None:
    """Record that something OTHER than the readiness probe just proved the DB reachable.

    THIS EXISTS TO STOP TWO TIMERS FROM COSTING MORE THAN ONE, and the cost is real money that
    has already been spent once. `READY_DB_CACHE_SECONDS` is 600 specifically so the ALB's 30s
    polling leaves Neon an idle window longer than its ~5-minute autosuspend threshold — the
    docstring above records the month the compute billed ~730 hours against a free tier of ~190
    because a 30s heartbeat never let it sleep.

    `prompt_scheduler` adds a SECOND periodic database query. Two independent 600s timers at phase
    offset φ leave idle gaps of φ and 600−φ, and the compute only suspends on a gap over ~300s:
    aligned timers keep today's 50% duty cycle, but φ=300 means NEITHER gap is long enough and the
    compute never suspends at all — 100% duty, free tier exhausted mid-month, and Neon then
    suspends prod while `/health/ready` serves a cached green for up to ten minutes.

    So the tick calls this instead of letting the probe re-query: the tick has just SELECTed from
    `users`, which proves reachability at least as well as `SELECT 1` does. The two timers collapse
    into one and the duty cycle stays where it was. Found by the ship gate, which did the phase
    arithmetic; I had not thought about Neon at all.

    Only SUCCESS marks. A failed tick leaves the cache alone so the probe does its own real query,
    because a tick can fail for reasons that have nothing to do with the database.
    """
    global _last_ready_ok
    _last_ready_ok = monotonic()
