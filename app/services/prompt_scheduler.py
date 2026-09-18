"""An in-process ticker for the daily nudge, because GitHub's scheduler does not run on request.

WHY THIS EXISTS, MEASURED RATHER THAN ASSUMED. `.github/workflows/daily-prompt.yml` asks for a run
every 10 minutes: 144 a day. Counted off the Actions API on 2026-09-18, `event == "schedule"` only,
split at the moment `ea85076` changed the cron (2026-09-16 14:44 UTC), keeping only UTC days that lie
WHOLLY inside one era:

    hourly (target 24/day)          every 10 min (target 144/day)
      Sep 11  6   Sep 14  5           Sep 17  6
      Sep 12  7   Sep 15  5
      Sep 13  7
      n=5, mean 6.0/day = 25%         n=1, mean 6.0/day = 4%

    Excluded: Sep 10 (data starts 00:23), Sep 16 (the cron changed mid-day), Sep 18 (data ends
    18:19). An earlier version showed all nine days as one table, which implied nine days of evidence
    for a comparison that has FIVE days on one side and ONE on the other — and its 5.7 mean counted a
    partial day as a full one, which was the entire basis for saying the 10-minute cron did slightly
    WORSE. Excluding it, the two means are identical.

Five to seven runs a day in both eras: RAISING THE DECLARED FREQUENCY FROM 24/DAY TO 144/DAY
DELIVERED NO MORE RUNS. Six times the request, an identical mean. So `ea85076` — which shipped the
10-minute cron specifically to "stop losing nights to a dropped cron" — bought nothing, and the
comment it left in the workflow asserting the frequency was doing real work was false the day it
landed.

WHAT THAT DOES AND DOES NOT ESTABLISH. "It is a CAP, not a per-run drop probability" is the mechanism
I infer, and n=1 on the 10-minute side cannot carry it alone: the two eras are consecutive windows,
not randomised, so a quiet week of Actions load is an alternative explanation I cannot rule out from
here. **The decision does not rest on it.** Both eras independently deliver 5-7 runs a day against a
four-hour send window, with a median gap of 245 minutes — that alone makes the cron unfit as the only
trigger, whichever mechanism produces it. Treat the cap as the best available reading, not as proven.

THREE THINGS CORROBORATE "cap" over "our own config discarded them", and unlike the day counts
these do not depend on sample size. All 53 scheduled runs concluded `success` — zero `cancelled`,
zero `skipped`, checked by tallying conclusions client-side over the unfiltered list rather than
trusting a `status=` filter. Runs take a MEDIAN 8 SECONDS against a 600s interval, so the
`concurrency: daily-prompt` group is occupied ~1.3% of each window and cannot serialize anything —
(With `cancel-in-progress: false` GitHub holds at most ONE pending run per group and cancels a
previously pending one when a newer trigger arrives, so queueing CAN discard runs in principle — an
earlier version of this note claimed it could not, which was too strong. It demonstrably didn't here,
and the zero-cancelled tally is what shows that, not the queueing semantics.) And the delivered minute-of-hour spans 39 distinct values, only 4 of which
the cron ever asked for. Median gap 245 minutes, worst 459.

(The counts above are `event == "schedule"` ONLY. An earlier version of this note reported 6-8/day
and showed Sep 16 as 8, because it folded in three `workflow_dispatch` runs — which were mine, from
testing. Counting your own manual triggers as evidence of the platform's behaviour is the exact
mistake this module exists to correct in the other direction.)

Against that, a person's send window is `notify_hour` -> `quiet_from`, four hours wide on the
defaults. A median gap of 4.1 hours against a 4-hour window makes the nudge roughly a coin flip per
person per night — which is the whole retention mechanism #89, #106, #108 and #109 were in service
of, unreliable in production while every single run reported green.

WHY AN IN-PROCESS TICK IS SAFE HERE, when TECHDEBT previously rejected exactly this. The objection
was that an in-process tick double-fires during a rolling deploy (minHealthyPercent 100 /
maxHealthyPercent 200 overlaps two tasks) and breaks above `desiredCount: 1`. True, and it does not
matter: `prompt_sends` has a UNIQUE on (user_id, local_date) and `run_daily_prompt` catches the
resulting `IntegrityError` and records `already_sent_today`. Correctness was deliberately put in the
DATABASE rather than the trigger, precisely so that the trigger could be anything — including two of
them at once. The constraint that made a re-runnable endpoint safe is the same one that makes this
safe. It is the reason this is a sixteen-line loop and not a distributed lock.

THE GITHUB CRON STAYS. This does not replace it; it joins it. Two independent triggers, both
idempotent, is strictly better than either alone — the cron covers the window where this task is
restarting or a deploy is mid-roll, and this covers the ~138 runs a day GitHub declines to give us.
Neither can double-send.

WHY NOT EventBridge, which is the properly-decoupled answer: a `cdk deploy` re-renders the ECS
task definition the deploy pipeline owns, so adding a schedule rule from an operator's machine would
replace the running production image with whatever that machine has checked out. That hazard is
documented on the endpoint in `routers/notifications.py`. This needs no infrastructure change.
"""

import asyncio
import logging

from app.config import settings
from app.database import SessionLocal
from app.services.prompt import run_daily_prompt

logger = logging.getLogger(__name__)

# THE FLOOR IS A COST BOUNDARY, not just protection against a hot loop — and it has to equal
# `main.READY_DB_CACHE_SECONDS`, which `tests/test_prompt_scheduler.py` asserts rather than trusting
# this comment. (Defined here rather than imported from `main`, which imports THIS module.)
#
# Since a successful tick refreshes the readiness cache, this loop is the ONLY thing querying the
# database periodically — so the interval IS the idle window Neon gets, and Neon suspends its compute
# only after roughly 300s idle. An operator tightening the send window to 120s, which is the obvious
# reason to touch a knob the docs advertise as operator-settable, would give Neon no idle gap at all:
# 100% duty cycle, and the free tier gone mid-month. That exact bill has been paid once already — see
# `main.health_ready`, ~730 compute-hours against a free tier of ~190, caused by a 30s probe.
#
# So a smaller value is clamped UP and logged at WARNING rather than honoured. The previous floor was
# 60s and justified purely as CPU protection, which was true before the readiness cache was shared
# and wrong afterwards. Found by the ship gate.
MIN_INTERVAL_SECONDS = 600

# A SEAM, so a test can drive the loop without patching the standard library. `asyncio.sleep` is the
# only slow thing in `run_forever`, and the obvious test move — `monkeypatch.setattr(asyncio,
# "sleep", ...)` — replaces it for the WHOLE PROCESS, including inside the test's own driver
# coroutine and inside `TestClient`. That deadlocks rather than failing, which cost a hung run to
# work out. Patching this name instead touches nothing but this module.
_sleep = asyncio.sleep


def tick() -> dict:
    """One pass, on its own session. Synchronous — the caller offloads it to a thread.

    Its OWN `SessionLocal` rather than a request-scoped one, for the same reason
    `notify_push.queue` uses one: there is no request here, and a session that outlives the thread
    would hold a pooled connection across the HTTP calls to Apple and Google.
    """
    db = SessionLocal()
    try:
        return run_daily_prompt(db)
    finally:
        db.close()


async def run_forever(on_db_ok=None) -> None:
    """Tick every `prompt_scheduler_interval_seconds` until cancelled.

    SLEEPS FIRST, DELIBERATELY. The loop is started from the app's lifespan, so anything that brings
    the app up briefly — the test suite, a crash loop, someone running `uvicorn` to check one
    endpoint — would otherwise fire a real send pass on startup. Sleeping first means a short-lived
    process never sends, with no environment sniffing and no `if TESTING` branch, which is the kind
    of flag that ends up wrong in the one environment it mattered in.

    NEVER LETS AN EXCEPTION ESCAPE. A loop that dies on a transient database blip is worse than no
    loop, because it fails silently and stays failed until the next deploy — and `/health` would
    keep answering 200 throughout, which is exactly the shape of the bug this whole module exists
    to fix. `CancelledError` is re-raised so shutdown is not swallowed along with it.
    """
    # NOTE the off switch is the CALLER's: `main.lifespan` declines to create this task at all when
    # the interval is <= 0. Called directly with 0, this loop would clamp to the floor and run — only
    # tests do that, but "0 disables" is a property of the caller, not of the loop.
    interval = settings.prompt_scheduler_interval_seconds
    if interval < MIN_INTERVAL_SECONDS:
        logger.warning(
            "daily-prompt interval %ss is below the %ss floor; using the floor. A shorter interval "
            "would keep Neon's compute awake continuously — see MIN_INTERVAL_SECONDS.",
            interval, MIN_INTERVAL_SECONDS,
        )
        interval = MIN_INTERVAL_SECONDS
    logger.info("daily-prompt scheduler started, every %ss", interval)
    while True:
        try:
            await _sleep(interval)
        except asyncio.CancelledError:
            logger.info("daily-prompt scheduler stopping")
            raise
        try:
            # `to_thread` because everything below is blocking: sync SQLAlchemy, then an HTTPS POST
            # per subscription with a 10s timeout. Running it on the event loop would stall every
            # request in flight for the duration of the whole pass.
            summary = await asyncio.to_thread(tick)
            # Logged at INFO with the reason breakdown, so "why didn't it arrive?" is answerable
            # from the task logs alone — the same thing the workflow's step summary gives us for
            # the cron half, and the reason `SKIP_REASONS` is a vocabulary rather than one counter.
            # `main.configure_app_logging` is what makes this line actually appear; without it the
            # `app.*` loggers have no handler in production and only FAILURES were visible.
            logger.info("daily-prompt tick: %s", summary)
            # The pass just SELECTed from `users`, so the readiness probe does not need its own
            # query for the next `READY_DB_CACHE_SECONDS`. Collapsing the two periodic database
            # timers into one is a COST fix — two at the wrong phase offset leave Neon's compute no
            # idle window at all. See `main.mark_db_reachable`.
            #
            # `configured` IS LOAD-BEARING, and leaving it out was a real defect for one gate round.
            # `run_daily_prompt` returns EARLY, without touching the database, when VAPID is
            # unconfigured — a supported state that `.env.example` documents ("leave every one of
            # these blank and notifications are simply OFF"). So on such a deploy every tick
            # "succeeded" without a query and still refreshed the readiness cache. If DB egress then
            # broke on a task already past its first probe, `/health/ready` would answer
            # `{"db": "cached"}` FOREVER: the ALB never fails the target, ECS never replaces the
            # task, every real request 500s, and the probe reports green — verbatim the failure
            # `health_ready`'s own docstring exists to prevent, and the same silent-absence shape
            # this module exists to remove. Latent rather than live (prod has the keys), but the
            # coupling was invisible: the readiness probe's honesty depended on a push key.
            #
            # Only a success marks, AND only a success that went to the database.
            if on_db_ok is not None and summary.get("configured") is True:
                on_db_ok()
        except asyncio.CancelledError:
            logger.info("daily-prompt scheduler stopping mid-tick")
            raise
        except Exception:
            logger.exception("daily-prompt tick failed; the loop continues")
