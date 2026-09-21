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
`concurrency: daily-prompt` group is occupied ~1.3% of each window and cannot serialize anything. And
the delivered minute-of-hour spans 39 distinct values, only 4 of which the cron ever asked for.
Median gap 245 minutes, worst 459.

(On that concurrency group: with `cancel-in-progress: false` GitHub holds at most ONE pending run and
cancels a previously pending one when a newer trigger arrives, so queueing CAN discard runs in
principle — an earlier version of this note claimed it could not, which was too strong. It
demonstrably didn't here, and the zero-cancelled tally is what shows that, not the semantics.)

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
import time

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

# TWO SEAMS, so a test can drive the loop without patching the standard library. `asyncio.sleep` is
# the slow thing and `time.time` is the thing that must be fake to test alignment deterministically.
# The obvious move — `monkeypatch.setattr(asyncio, "sleep", ...)` — replaces it for the WHOLE PROCESS,
# including inside the test's own driver coroutine and inside `TestClient`. That deadlocks rather than
# failing, which cost a hung run to work out. Patching these names touches nothing but this module.
_sleep = asyncio.sleep
_now = time.time


def seconds_to_next_boundary(now: float, interval: int) -> float:
    """Seconds from `now` until the next wall-clock multiple of `interval`.

    WHY ALIGN AT ALL — a user-reported defect, and the numbers are the argument. The owner set 6pm and
    got nudges at 7:14, 7:28 and 7:16 pm on three consecutive nights: 74, 88 and 75 minutes late. Each
    one lands on a delivered GitHub Actions cron run — 23:14:05, 23:28:48 and 23:15:11 UTC — with the
    preceding run in every case BEFORE 22:00 UTC, which is their 6pm.

    NOT "to the minute", which an earlier version of this note claimed: the third reads 7:16 on the
    phone against a 23:15:11 run. A pass takes ~8s and then each push is its own HTTPS round trip, so
    ARRIVAL trails the run start by tens of seconds. That is a real match, just not an exact-minute
    one — and it is the same reason this change promises "within seconds of 6pm" rather than 18:00:00.

    `is_due` uses catch-up semantics ("has their hour passed today?"), which is what makes a late
    trigger safe, and the cost is that the nudge arrives on the FIRST trigger after the hour. So
    lateness is entirely the gap to the next trigger.

    The in-process ticker cut that to at most one interval. Sleeping a flat `interval` from process
    start, though, puts the ticks at an arbitrary phase: 6:03 one night, 6:09 the next, depending on
    when ECS last restarted the task. Aligning them to the clock makes the tick land ON the hour.

    WHY EPOCH SECONDS RATHER THAN A DATETIME. `time.time()` counts from 1970-01-01T00:00:00Z, so
    boundaries computed with `%` are aligned to UTC midnight with no timezone reasoning at all — and
    600 divides 3600, so a tick lands exactly on every whole hour AND every half hour. That covers
    every whole-hour offset and the :30 zones (India, Adelaide, Lord Howe).

    FIVE ZONE NAMES LAND EXACTLY 300s LATE, never more: `Asia/Kathmandu` (+5:45) and its
    `Asia/Katmandu` alias, `Pacific/Chatham` (+12:45) and its `NZ-CHAT` alias, and `Australia/Eucla`
    (+8:45). A :45 offset puts local :00 at UTC :15 or :45, both exactly five minutes short of a 600s
    boundary, so the lateness is a CONSTANT rather than a range. Measured across every name in the tz
    database at local 18:00 on three dates: 1779 zone-date pairs exact, 15 at 300s.

    An earlier version of this note said "up to one interval late" and listed only Nepal and Chatham —
    it overstated the bound by 2x and omitted Eucla. A ship gate measured it properly.

    NEVER RETURNS 0 — at an exact boundary it returns a full interval rather than firing immediately.
    Worth having, but it is NOT what preserves sleep-first, and an earlier version of this docstring
    claimed it was. The delay here is uniform in (0, interval]: 599.999s past a boundary yields
    0.001s, measured. And with float `time.time()` an exact boundary essentially never occurs, so this
    branch guards the case that cannot happen while missing the one that can. Sleep-first is preserved
    in `run_forever` instead, by making the FIRST sleep a full interval and aligning only after it —
    see the comment there. A ship gate caught me claiming otherwise.

    Wall-clock time can jump (NTP, a suspended host). A FORWARD jump just moves the next tick. A
    BACKWARD one is the direction an earlier version of this note missed, and it ADDS a tick rather
    than delaying one: the delay is computed on the wall clock but slept on the event loop's MONOTONIC
    clock, so if the wall clock slews back during the sleep, the sleep finishes before the target
    boundary is reached and the next computation returns the small residual. One extra short cycle,
    self-correcting, and bounded — ntpd slews at <=500 ppm, so <=0.3s over a 600s sleep.

    Neither direction can double-send, because `prompt_sends`' UNIQUE (user_id, local_date) is what
    makes that safe — the same reason two triggers can coexist at all.
    """
    remainder = now % interval
    return interval if remainder == 0 else interval - remainder


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

    SLEEPS A FULL INTERVAL FIRST, DELIBERATELY, AND ALIGNS ONLY AFTER THAT. The loop is started from
    the app's lifespan, so anything that brings the app up briefly — the test suite, a crash loop,
    someone running `uvicorn` to check one endpoint — would otherwise fire a real send pass on
    startup. A full first sleep means a short-lived process never sends, with no environment sniffing
    and no `if TESTING` branch, which is the kind of flag that ends up wrong in the one environment it
    mattered in. The word "full" is load-bearing: an ALIGNED first sleep can be milliseconds, which is
    how this guarantee briefly became probabilistic. See the loop body.

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
    logger.info(
        "daily-prompt scheduler started, every %ss, aligned to the wall clock", interval
    )
    # THE FIRST SLEEP IS A FULL INTERVAL, AND ONLY THE FIRST. This is not belt-and-braces; it restores
    # a guarantee that alignment alone quietly broke.
    #
    # Sleep-first is what stops a short-lived process from firing a real send pass — and
    # `tests/fixtures.py` uses `with TestClient(app)`, so nearly EVERY test in this repo starts this
    # loop. With a flat interval the guarantee was absolute: the first delay was always 600s, so
    # nothing living for milliseconds could tick. Align the first sleep and it becomes uniform in
    # (0, interval] — 0.001s for a process starting 599.999s past a boundary. Measured, not theorised.
    # A ship gate caught me claiming the `remainder == 0` branch covered this; it does not, because
    # with float time an exact boundary essentially never happens.
    #
    # The cost is ONE unaligned tick per task start, and up to two intervals after a deploy before
    # ticks settle onto boundaries. `is_due`'s catch-up semantics absorb that completely — a late tick
    # still nudges everyone whose hour has passed — so the trade is a guarantee the whole suite leans
    # on, bought with a few unaligned minutes after a restart.
    first_sleep = True
    while True:
        try:
            if first_sleep:
                delay = interval
                first_sleep = False
            else:
                # ALIGNED — see `seconds_to_next_boundary`. A flat sleep puts every tick at whatever
                # phase the last ECS restart happened to set, so a 6pm nudge arrives at 6:03 one
                # night and 6:09 the next. Aligned, it lands on the hour the person chose.
                delay = seconds_to_next_boundary(_now(), interval)
            await _sleep(delay)
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
