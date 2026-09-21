"""The in-process daily-prompt ticker (`app/services/prompt_scheduler.py`).

WHY IT EXISTS AT ALL, since the GitHub Actions cron already calls the same code: that scheduler
delivers 5-7 runs a day no matter what the workflow asks for. Raising the declared cron from hourly
(24/day) to every ten minutes (144/day) in `ea85076` changed the delivered count by nothing —
measured off the Actions API. Against a four-hour-wide send window, a median gap of
245 minutes made the nudge a coin flip per person per night, with every run reporting green.

NO `pytest-asyncio`. The loop is async, and the obvious move is a plugin; this repo has a standing
habit of not adding a dependency for something small (`push.py` hand-rolls RFC 8291 rather than take
`pywebpush`, `PhotoFramer` uses a canvas rather than a crop library). `asyncio.run` on a local
coroutine costs one extra line per test and nothing to install, so the tests stay runnable on a
fresh clone with the existing requirements.

AND THE TESTS PATCH `prompt_scheduler._sleep`, NOT `asyncio.sleep`. The first version patched the
stdlib, which replaces sleep for the entire process — including inside the driver coroutine these
tests use to advance the loop. The suite HUNG rather than failing, which is the worst way for a test
bug to present, so the module exposes a seam and the reason is recorded in both places.
"""

import asyncio
import time

import pytest

from app.services import prompt_scheduler


# A WALL-CLOCK-BOUNDED WAIT, not a turn count. The first version of these tests spun
# `for _ in range(500): await asyncio.sleep(0)` and was FLAKY — it failed roughly one run in three.
# `tick` runs on a thread via `asyncio.to_thread`, so completing it needs the worker thread to
# finish AND the loop to process the resulting future; yielding N times guarantees neither. A
# deadline with a real (tiny) sleep does, and it fails loudly instead of intermittently.
#
# A flaky test is worse than no test: it trains everyone to re-run rather than to read.
async def _wait_until(predicate, timeout=5.0):
    """Await `predicate()` becoming truthy, or return False after `timeout` seconds."""
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        if predicate():
            return True
        await asyncio.sleep(0.002)
    return False



def test_it_SLEEPS_BEFORE_it_ticks_so_a_short_lived_process_never_sends(monkeypatch):
    """The property that keeps the test suite, and `uvicorn` on a laptop, from sending real pushes.

    The loop starts from the app's lifespan, so every `TestClient(app)` in this repo starts it.
    Ticking on startup would mean a real send pass — and a claimed `prompt_sends` row for the local
    date, which would then SUPPRESS that person's genuine nudge that evening. Sleeping first gets
    that for free, with no `if TESTING` branch to be wrong in the one environment that mattered.
    """
    ticks = []

    def counting_tick():
        ticks.append(1)
        return {}

    monkeypatch.setattr(prompt_scheduler, "tick", counting_tick)
    monkeypatch.setattr(prompt_scheduler.settings, "prompt_scheduler_interval_seconds", 3600)
    # FROZEN just shy of a boundary — the most hostile phase for this property, and the one that made
    # this test both flaky and untrue for a while. Alignment made the FIRST delay uniform in
    # (0, interval], so starting 0.01s before a boundary meant a tick inside this test's 0.05s window;
    # a ship gate reproduced exactly that. The fix was in the code (the first sleep is a full interval
    # again), and freezing the clock here is what proves it rather than trusting the odds: 1-in-72,000
    # is still a test that lies occasionally.
    monkeypatch.setattr(prompt_scheduler, "_now", lambda: float(3600 * 500_000 - 0.01))

    async def drive():
        task = asyncio.create_task(prompt_scheduler.run_forever())
        await asyncio.sleep(0.05)  # many event-loop turns — a tick would have landed by now
        task.cancel()
        with pytest.raises(asyncio.CancelledError):
            await task

    asyncio.run(drive())
    assert ticks == [], "the loop ticked before its first sleep elapsed"


def test_a_failing_tick_is_logged_and_the_NEXT_tick_still_runs(monkeypatch):
    """A loop that dies on a transient database blip is worse than no loop.

    It fails SILENTLY and stays failed until the next deploy, while `/health` keeps answering 200 —
    precisely the shape of the bug this module was written to fix. So a failing tick is caught,
    logged with a traceback, and the loop continues to its next interval.

    Driven by replacing the module's `_sleep` SEAM with a no-op, so two intervals pass at once.
    Not `asyncio.sleep` itself: patching the stdlib replaces it for the whole process, including
    inside this test's own driver, which deadlocks instead of failing.
    """
    calls = []

    def exploding_tick():
        calls.append(len(calls) + 1)
        if len(calls) == 1:
            raise RuntimeError("transient database blip")
        return {"candidates": 0, "sent": 0}

    real_sleep = asyncio.sleep

    async def instant_sleep(_seconds):
        await real_sleep(0)

    monkeypatch.setattr(prompt_scheduler, "tick", exploding_tick)
    monkeypatch.setattr(prompt_scheduler, "_sleep", instant_sleep)

    async def drive():
        task = asyncio.create_task(prompt_scheduler.run_forever())
        assert await _wait_until(lambda: len(calls) >= 2), "never reached a second tick"

        task.cancel()
        with pytest.raises(asyncio.CancelledError):
            await task

    asyncio.run(drive())
    assert len(calls) >= 2, "the loop stopped after the first tick raised"


def test_the_interval_is_FLOORED_so_a_bad_config_cannot_become_a_hot_loop(monkeypatch):
    """`prompt_scheduler_interval_seconds = 1` must not mean one full send pass per second.

    A send pass walks every candidate user and makes an HTTPS call per subscription. The floor is
    the difference between a misconfiguration and a self-inflicted outage plus a bill.
    """
    slept = []
    real_sleep = asyncio.sleep

    async def record_sleep(seconds):
        slept.append(seconds)
        await real_sleep(0)

    monkeypatch.setattr(prompt_scheduler, "tick", lambda: {})
    monkeypatch.setattr(prompt_scheduler, "_sleep", record_sleep)
    monkeypatch.setattr(prompt_scheduler.settings, "prompt_scheduler_interval_seconds", 1)
    # `_now` FROZEN TO AN EXACT BOUNDARY, so the aligned delay equals a full interval and this
    # test can assert the CLAMP rather than accidentally asserting the alignment. Before
    # alignment the first sleep was always the flat interval; now it is the distance to the next
    # wall-clock multiple, so an unfrozen clock makes this a different number every run.
    monkeypatch.setattr(prompt_scheduler, "_now", lambda: float(600 * 2_700_000))

    async def drive():
        task = asyncio.create_task(prompt_scheduler.run_forever())
        assert await _wait_until(lambda: bool(slept)), "the loop never slept"

        task.cancel()
        with pytest.raises(asyncio.CancelledError):
            await task

    asyncio.run(drive())
    # `== MIN_INTERVAL_SECONDS`, not `>= 60`. The first version asserted the ABANDONED floor, so a
    # regression putting it back to 60 would have passed — and 60 is exactly the value whose
    # justification this branch repudiated (CPU protection, true before the readiness cache was
    # shared and wrong after).
    assert slept and slept[0] == prompt_scheduler.MIN_INTERVAL_SECONDS, (
        f"slept {slept[:1]}s for a configured 1s — expected the "
        f"{prompt_scheduler.MIN_INTERVAL_SECONDS}s floor"
    )


def test_cancellation_is_not_swallowed_by_the_catch_all(monkeypatch):
    """The bare `except Exception` must not eat shutdown.

    `CancelledError` derives from `BaseException`, so `except Exception` already misses it — but the
    loop also catches it explicitly around the sleep and the tick in order to log, and a `return`
    instead of a `raise` in either place would make shutdown hang until the container is killed.
    """

    async def never_completes(_seconds):
        await asyncio.Event().wait()

    monkeypatch.setattr(prompt_scheduler, "tick", lambda: {})
    monkeypatch.setattr(prompt_scheduler, "_sleep", never_completes)

    cancelled = []

    async def drive():
        task = asyncio.create_task(prompt_scheduler.run_forever())
        await asyncio.sleep(0)
        task.cancel()
        with pytest.raises(asyncio.CancelledError):
            await task
        cancelled.append(task.cancelled())

    asyncio.run(drive())
    assert cancelled == [True], "the task finished without cancelling — shutdown was swallowed"


def test_tick_CLOSES_its_session_even_when_the_run_raises(monkeypatch):
    """A leaked session holds a pooled connection, and `tick` runs on a task that lives forever.

    The pool is small; one leak per failed tick exhausts it and every request then blocks on
    checkout. `finally: db.close()` is the whole fix, and this is what pins it.
    """
    closed = []

    class FakeSession:
        def close(self):
            closed.append(1)

    def boom(_db):
        raise RuntimeError("boom")

    monkeypatch.setattr(prompt_scheduler, "SessionLocal", lambda: FakeSession())
    monkeypatch.setattr(prompt_scheduler, "run_daily_prompt", boom)

    with pytest.raises(RuntimeError):
        prompt_scheduler.tick()
    assert closed == [1], "the session was not closed when run_daily_prompt raised"


def test_tick_uses_its_OWN_session_and_returns_the_run_summary(monkeypatch):
    """Its own `SessionLocal`, for the reason `notify_push.queue` uses one: there is no request.

    A request-scoped session would outlive the request and hold a connection across the HTTPS calls
    to Apple and Google.
    """
    made, closed = [], []

    class FakeSession:
        def close(self):
            closed.append(1)

    def fake_session_local():
        session = FakeSession()
        made.append(session)
        return session

    summary = {"candidates": 3, "sent": 2, "skipped": 1, "failed": 0, "reasons": {}}
    monkeypatch.setattr(prompt_scheduler, "SessionLocal", fake_session_local)
    monkeypatch.setattr(prompt_scheduler, "run_daily_prompt", lambda _db: summary)

    assert prompt_scheduler.tick() is summary
    assert len(made) == 1 and closed == [1]


def test_the_lifespan_STARTS_and_STOPS_the_loop(monkeypatch):
    """The wiring in `app/main.py`, not just the loop itself.

    Two ways for this to be silently broken: the task is never created (the scheduler ships doing
    nothing, which is the "setting nothing reads" defect this codebase keeps deleting), or it is
    created and never cancelled — which makes Python log "Task was destroyed but it is pending!"
    and can kill a tick mid-session.
    """
    from fastapi.testclient import TestClient

    import app.main as main

    started, stopped = [], []

    async def fake_run_forever(on_db_ok=None):
        # Accepts `on_db_ok` because the lifespan passes `mark_db_reachable` — see that function
        # for why the tick refreshes the readiness cache instead of letting the probe re-query.
        started.append(on_db_ok)
        try:
            await asyncio.Event().wait()
        except asyncio.CancelledError:
            stopped.append(1)
            raise

    monkeypatch.setattr(main.prompt_scheduler, "run_forever", fake_run_forever)
    monkeypatch.setattr(main.settings, "prompt_scheduler_interval_seconds", 600)

    with TestClient(main.app) as client:
        assert client.get("/health").status_code == 200
        assert len(started) == 1, "the lifespan never started the scheduler"
        assert started[0] is main.mark_db_reachable, (
            "the lifespan started the loop WITHOUT the readiness-cache callback, so the two "
            "600s database timers stay independent — see main.mark_db_reachable"
        )

    assert stopped == [1], "the lifespan never cancelled the scheduler on shutdown"


def test_a_NON_POSITIVE_interval_disables_it_entirely(monkeypatch):
    """The off switch, and it has to live in config rather than code.

    A runaway loop in production must be stoppable by editing the task definition, not by shipping a
    revert through a pipeline that migrates the database on the way.
    """
    from fastapi.testclient import TestClient

    import app.main as main

    started = []

    async def fake_run_forever(on_db_ok=None):
        started.append(1)
        await asyncio.Event().wait()

    monkeypatch.setattr(main.prompt_scheduler, "run_forever", fake_run_forever)
    monkeypatch.setattr(main.settings, "prompt_scheduler_interval_seconds", 0)

    with TestClient(main.app) as client:
        assert client.get("/health").status_code == 200

    assert started == [], "interval 0 still started the loop"


def test_the_tick_runs_OFF_the_event_loop(monkeypatch):
    """`asyncio.to_thread`, which nothing pinned until the ship gate pointed that out.

    Replacing `await asyncio.to_thread(tick)` with a bare `tick()` passed all eight earlier tests,
    because every one of them patched `tick` with a plain sync callable that behaves identically
    either way. The single property keeping a full send pass off the event loop was the one with no
    test — and the pass is sync SQLAlchemy plus an HTTPS call per subscription at a 10s timeout, so
    running it inline stalls every request in flight for the length of the whole pass.

    Asserted by recording the thread identity: the tick must NOT run on the thread the loop is on.
    """
    import threading

    seen = {}
    real_sleep = asyncio.sleep

    def recording_tick():
        seen["tick_thread"] = threading.get_ident()
        return {}

    async def instant_sleep(_seconds):
        await real_sleep(0)

    monkeypatch.setattr(prompt_scheduler, "tick", recording_tick)
    monkeypatch.setattr(prompt_scheduler, "_sleep", instant_sleep)

    async def drive():
        seen["loop_thread"] = threading.get_ident()
        task = asyncio.create_task(prompt_scheduler.run_forever())
        assert await _wait_until(lambda: "tick_thread" in seen), "the tick never ran"

        task.cancel()
        with pytest.raises(asyncio.CancelledError):
            await task

    asyncio.run(drive())
    assert "tick_thread" in seen, "the tick never ran"
    assert seen["tick_thread"] != seen["loop_thread"], (
        "the tick ran on the event loop thread — a send pass would stall every live request"
    )


def test_cancelling_DURING_a_tick_still_stops_the_loop(monkeypatch):
    """The mid-tick `except asyncio.CancelledError: raise`, which also had no test.

    The earlier cancellation test replaces `_sleep` with a never-completing coroutine, so the tick
    is never entered and only the SLEEP-side handler is exercised. Swallowing cancellation on the
    tick side instead — `return` where the code says `raise` — would make the lifespan's
    `await task` hang forever on shutdown, which is the exact hang that a bad test patch already
    caused once in this file's history.
    """
    started = []
    real_sleep = asyncio.sleep

    def slow_tick():
        started.append(1)
        import time

        time.sleep(0.2)  # long enough that cancellation lands while it is running
        return {}

    async def instant_sleep(_seconds):
        await real_sleep(0)

    monkeypatch.setattr(prompt_scheduler, "tick", slow_tick)
    monkeypatch.setattr(prompt_scheduler, "_sleep", instant_sleep)

    outcome = {}

    async def drive():
        task = asyncio.create_task(prompt_scheduler.run_forever())
        assert await _wait_until(lambda: bool(started)), "the tick never started"

        task.cancel()
        with pytest.raises(asyncio.CancelledError):
            await asyncio.wait_for(task, timeout=5)
        outcome["cancelled"] = task.cancelled()

    asyncio.run(drive())
    assert started, "the tick never started, so this test proved nothing"
    assert outcome.get("cancelled") is True, "cancelling during a tick did not stop the loop"


def test_a_successful_tick_marks_the_DB_reachable_and_a_FAILING_one_does_not(monkeypatch):
    """`on_db_ok` — a cost control, not a nicety. See `main.mark_db_reachable`.

    Two independent 600s database timers (this loop and `/health/ready`'s memoized probe) at the
    wrong phase offset leave Neon's compute no idle window at all, so it never autosuspends and the
    free-tier compute hours go. The tick has just SELECTed from `users`, so it refreshes the
    readiness cache instead of letting the probe issue its own query — collapsing two timers into
    one.

    A FAILING tick must not mark: it can fail for reasons that have nothing to do with the database,
    and a false "DB is fine" would let the readiness probe coast while egress is actually broken.
    """
    marks = []
    calls = []
    real_sleep = asyncio.sleep

    def flaky_tick():
        calls.append(1)
        if len(calls) == 1:
            raise RuntimeError("not a database problem")
        # `configured: True` because the guard FAILS CLOSED: absence means "this pass may not have
        # touched the database". `run_daily_prompt` sets it explicitly on the normal path for exactly
        # that reason, so a stub standing in for a real pass has to carry it too. The first version of
        # this stub omitted it and the test then failed — correctly, which is the guard working.
        return {"candidates": 0, "configured": True}

    async def instant_sleep(_seconds):
        await real_sleep(0)

    monkeypatch.setattr(prompt_scheduler, "tick", flaky_tick)
    monkeypatch.setattr(prompt_scheduler, "_sleep", instant_sleep)

    async def drive():
        task = asyncio.create_task(
            prompt_scheduler.run_forever(on_db_ok=lambda: marks.append(1))
        )
        # Waits for the MARK rather than the call count. `calls` is appended inside the worker
        # thread, so it reaches 2 BEFORE the loop resumes and calls `on_db_ok` — the first version
        # of this test cancelled in that gap and reported "2 ticks, 0 marks" about working code.
        assert await _wait_until(lambda: bool(marks)), "no successful tick ever marked"

        task.cancel()
        with pytest.raises(asyncio.CancelledError):
            await task

    asyncio.run(drive())
    assert len(calls) >= 2, "the loop did not reach a second, successful tick"
    assert len(marks) >= 1, "a SUCCESSFUL tick did not mark the DB reachable"
    assert len(marks) < len(calls), (
        f"{len(calls)} ticks but {len(marks)} marks — the FAILED tick marked too"
    )


def test_the_lifespan_makes_the_app_loggers_actually_LOG(monkeypatch):
    """Without this the scheduler's own success line is invisible in production.

    Uvicorn's `LOGGING_CONFIG` configures only the `uvicorn*` loggers, leaving root with no handler
    at WARNING — so `logger.info("daily-prompt tick: ...")` emitted nothing in the ECS task logs
    while a FAILURE still reached stderr via `logging.lastResort`. Successes silent, failures loud,
    and the commit that added the loop named that very line as its only means of verification.

    Asserted on the LOGGER's effective state rather than on captured output, because pytest's own
    handlers would otherwise make it pass regardless.
    """
    import logging

    from fastapi.testclient import TestClient

    import app.main as main

    app_logger = logging.getLogger("app")
    for h in list(app_logger.handlers):
        app_logger.removeHandler(h)
    # Also DISABLE it, which is the state this test exists to prove is recoverable. It is not
    # hypothetical: `dictConfig` defaults to `disable_existing_loggers=True`, and something in the
    # full suite leaves this logger disabled — so this test passed alone and failed in the suite,
    # reporting level INFO and effective level INFO while `isEnabledFor(INFO)` was False.
    app_logger.disabled = True
    monkeypatch.setattr(main.settings, "prompt_scheduler_interval_seconds", 0)

    with TestClient(main.app) as client:
        assert client.get("/health").status_code == 200
        # `app` carries the HANDLER; the LEVEL lives on the named children. Asserting INFO on `app`
        # itself is what the first version did, and it was asserting the cosmetic version of this
        # fix — a level on `app` is inherited by every child without one, which is exactly the
        # privacy leak the narrowing exists to avoid. So: handler here, level there.
        assert app_logger.handlers, "app.* has no handler, so its INFO lines go nowhere"
        # NOT because propagation needs it: `callHandlers` walks ancestors and consults each
        # HANDLER's level, never the ancestor logger's `disabled` or `level` — verified. So a
        # disabled `app` would still pass a child's record to this handler. Clearing it is
        # belt-and-braces for anything that logs on `app` ITSELF, where `Logger.handle` does check
        # the originating logger's flag. An earlier version of this assertion gave the wrong reason.
        assert not app_logger.disabled, "app.* is disabled, so app.* logs of its own go nowhere"
        sched = logging.getLogger("app.services.prompt_scheduler")
        assert sched.isEnabledFor(logging.INFO), (
            f"the scheduler cannot emit INFO: own level {sched.level}, effective "
            f"{sched.getEffectiveLevel()}, disabled {sched.disabled}, "
            f"manager.disable {logging.Logger.manager.disable}, app handlers {app_logger.handlers}"
        )

    # Idempotent: the suite starts this lifespan many times and handlers must not stack.
    before = len(app_logger.handlers)
    with TestClient(main.app):
        pass
    assert len(app_logger.handlers) == before, "the lifespan stacked another handler"


def test_an_UNCONFIGURED_tick_does_NOT_mark_the_DB_reachable(monkeypatch):
    """The finding a whole gate round of hunting untested properties still missed.

    `run_daily_prompt` returns EARLY, without touching the database, when VAPID is unconfigured —
    a state `.env.example` explicitly supports ("leave every one of these blank and notifications are
    simply OFF"). Its summary carries `configured: False`; the normal path omits the key.

    Marking on such a tick is not a cosmetic slip. `/health/ready` trusts that mark for
    `READY_DB_CACHE_SECONDS`, so on an unconfigured deploy every tick would refresh the cache without
    a query — and if DB egress then broke on a task past its first probe, the probe would answer
    `{"db": "cached"}` forever. The ALB never fails the target, ECS never replaces the task, every
    real request 500s, and readiness reports green. That is verbatim the failure `health_ready`'s own
    docstring exists to prevent.
    """
    marks, ticks = [], []

    def unconfigured_tick():
        ticks.append(1)
        return {"candidates": 0, "sent": 0, "skipped": 0, "failed": 0,
                "reasons": {}, "configured": False}

    real_sleep = asyncio.sleep

    async def instant_sleep(_seconds):
        await real_sleep(0)

    monkeypatch.setattr(prompt_scheduler, "tick", unconfigured_tick)
    monkeypatch.setattr(prompt_scheduler, "_sleep", instant_sleep)

    async def drive():
        task = asyncio.create_task(
            prompt_scheduler.run_forever(on_db_ok=lambda: marks.append(1))
        )
        assert await _wait_until(lambda: len(ticks) >= 3), "the loop never ticked"
        task.cancel()
        with pytest.raises(asyncio.CancelledError):
            await task

    asyncio.run(drive())
    assert marks == [], (
        f"{len(ticks)} ticks that never queried the database still marked it reachable "
        f"{len(marks)} times — /health/ready would be masked for good"
    )


def test_the_interval_FLOOR_equals_the_readiness_cache_window():
    """A cross-file invariant, asserted rather than left to a comment to keep true.

    The floor is not CPU protection (it was, at 60s, and that was wrong once the readiness cache
    became shared). Because a successful tick refreshes that cache, this loop is the only thing
    querying the database periodically — so the interval IS the idle window Neon gets, and Neon
    suspends only after roughly 300s idle. If the floor ever drops below the cache window, an
    operator tightening the send window silently pins Neon's compute awake and spends the free tier.
    """
    from app.main import READY_DB_CACHE_SECONDS

    assert prompt_scheduler.MIN_INTERVAL_SECONDS == READY_DB_CACHE_SECONDS, (
        "the scheduler's floor and the readiness cache window must match: the tick is what refreshes "
        "that cache, so a shorter interval means Neon never gets an idle gap"
    )
    assert prompt_scheduler.MIN_INTERVAL_SECONDS >= 300, (
        "below Neon's ~300s autosuspend threshold the compute never sleeps at all"
    )


def test_a_TOO_SHORT_interval_is_clamped_UP_and_warned_about(monkeypatch, caplog):
    """Clamped, not honoured — and loudly, because silently ignoring an operator's value is its own
    defect. 120s is the realistic mistake: a tighter send window is the obvious reason to touch this
    knob, and it is the value that costs money.
    """
    slept = []
    real_sleep = asyncio.sleep

    async def record_sleep(seconds):
        slept.append(seconds)
        await real_sleep(0)

    monkeypatch.setattr(prompt_scheduler, "tick", lambda: {})
    monkeypatch.setattr(prompt_scheduler, "_sleep", record_sleep)
    monkeypatch.setattr(prompt_scheduler.settings, "prompt_scheduler_interval_seconds", 120)
    # `_now` FROZEN TO AN EXACT BOUNDARY, so the aligned delay equals a full interval and this
    # test can assert the CLAMP rather than accidentally asserting the alignment. Before
    # alignment the first sleep was always the flat interval; now it is the distance to the next
    # wall-clock multiple, so an unfrozen clock makes this a different number every run.
    monkeypatch.setattr(prompt_scheduler, "_now", lambda: float(600 * 2_700_000))

    async def drive():
        task = asyncio.create_task(prompt_scheduler.run_forever())
        assert await _wait_until(lambda: bool(slept)), "the loop never slept"
        task.cancel()
        with pytest.raises(asyncio.CancelledError):
            await task

    with caplog.at_level("WARNING", logger="app.services.prompt_scheduler"):
        asyncio.run(drive())

    assert slept[0] == prompt_scheduler.MIN_INTERVAL_SECONDS, (
        f"slept {slept[0]}s for a configured 120s — expected the floor"
    )
    assert any("below the" in r.message or "floor" in r.message for r in caplog.records), (
        "the clamp was silent; an operator would think 120s took effect"
    )


def test_only_the_NAMED_loggers_are_raised_to_INFO(monkeypatch):
    """The privacy narrowing — `app.*` as a whole must NOT be forced to INFO.

    `services/recipe_ai.py` logs `dropped ungrounded ingredient %r` at INFO, which is a fragment of
    whatever someone pasted into the parser, and `services/push.py` logs an endpoint prefix. Raising
    the whole tree shipped both to CloudWatch for the first time. The scheduler needs to be heard;
    those do not.
    """
    import logging

    from fastapi.testclient import TestClient

    import app.main as main

    ai = logging.getLogger("app.services.recipe_ai")
    ai.setLevel(logging.NOTSET)
    monkeypatch.setattr(main.settings, "prompt_scheduler_interval_seconds", 0)

    with TestClient(main.app):
        assert logging.getLogger("app.services.prompt_scheduler").isEnabledFor(logging.INFO)
        assert not ai.isEnabledFor(logging.INFO), (
            "app.services.recipe_ai is at INFO, so a pasted ingredient name now reaches CloudWatch"
        )


def test_dictConfig_disabling_a_CHILD_logger_is_recovered(monkeypatch):
    """`disable_existing_loggers=True` disables every existing logger BY NAME, children included.

    The first version cleared `disabled` on the `app` parent only, so a disabled
    `app.services.prompt_scheduler` stayed silent and the fix looked applied. `alembic/env.py`'s
    `fileConfig` is the repo's real caller of that machinery and also defaults to disabling.
    """
    import logging

    from fastapi.testclient import TestClient

    import app.main as main

    child = logging.getLogger("app.services.prompt_scheduler")
    child.disabled = True
    logging.getLogger("app").disabled = True
    monkeypatch.setattr(main.settings, "prompt_scheduler_interval_seconds", 0)

    with TestClient(main.app):
        assert not child.disabled, "the CHILD logger is still disabled, so the tick line vanishes"
        assert child.isEnabledFor(logging.INFO)


# ---------------------------------------------------------------------------------------------
# WALL-CLOCK ALIGNMENT. A user-reported defect: the owner set 6pm and got nudges at 7:14, 7:28 and
# 7:16 pm on three consecutive nights. Each landed on a delivered cron run, with the
# preceding run landing before their hour — so the lateness was entirely the gap to the next trigger.
# The in-process ticker bounds that at one interval; ALIGNING the ticks puts them on the hour.
# ---------------------------------------------------------------------------------------------
BOUNDARY = prompt_scheduler.seconds_to_next_boundary


def test_the_delay_lands_on_the_next_wall_clock_boundary():
    """Epoch seconds count from 1970-01-01T00:00:00Z, so `%` gives UTC-aligned boundaries with no
    timezone reasoning — and 600 divides 3600, so a tick lands on every whole AND half hour."""
    import datetime

    def next_tick(hh_mm_ss, interval=600):
        base = datetime.datetime(2026, 9, 22, tzinfo=datetime.timezone.utc)
        h, m, s = map(int, hh_mm_ss.split(":"))
        at = base.replace(hour=h, minute=m, second=s)
        return (at + datetime.timedelta(seconds=BOUNDARY(at.timestamp(), interval))).strftime(
            "%H:%M:%S"
        )

    # A 6pm nudge in any whole-hour zone is xx:00 UTC — the tick lands exactly on it.
    assert next_tick("21:50:01") == "22:00:00"
    assert next_tick("21:59:59") == "22:00:00"
    # A :30 zone (India at 6pm local is 12:30 UTC) also lands exactly, because 600 divides 1800.
    assert next_tick("12:29:30") == "12:30:00"
    # A :45 zone (Nepal, 12:15 UTC) is late by EXACTLY 300s — a constant, not a range, because a :45
    # offset sits five minutes short of a 600s boundary. Recorded so nobody reads "aligned" as
    # "exact for everyone", and measured rather than bounded: an earlier comment here said "up to
    # one interval", which overstated it 2x.
    assert next_tick("12:14:30") == "12:20:00"


def test_the_delay_is_NEVER_zero_which_is_what_keeps_sleep_first_true():
    """At an exact boundary it returns a FULL interval rather than firing immediately.

    A zero here would defeat the sleep-first property the WHOLE SUITE now leans on: `tests/fixtures.py`
    uses `with TestClient(app)`, so nearly every test in the repo starts this loop. A tick on startup
    would be a real send pass against the configured database — and would claim a `prompt_sends` row
    for today, SUPPRESSING that person's genuine nudge that evening.
    """
    # An exact multiple of 600 — 1_600_000_000 is NOT one (it is 400s past a boundary), which is the
    # sort of off-by-a-bit that made an earlier hand-check of this look wrong.
    exact = 600 * 2_700_000
    assert exact % 600 == 0, "the fixture itself must be on a boundary for this to prove anything"
    assert BOUNDARY(float(exact), 600) == 600

    for offset in range(0, 1200):
        delay = BOUNDARY(float(exact + offset), 600)
        assert 0 < delay <= 600, f"delay {delay} at offset {offset} breaks sleep-first"


def test_the_loop_sleeps_the_ALIGNED_delay_not_a_flat_interval(monkeypatch):
    """The wiring, not just the arithmetic.

    A flat `interval` from process start puts the ticks at whatever phase the last ECS restart set —
    6:03 one night, 6:09 the next. This asserts the loop asks the boundary function instead.
    """
    slept = []
    real_sleep = asyncio.sleep

    async def record_sleep(seconds):
        slept.append(seconds)
        await real_sleep(0)

    # 120s past a boundary, so an aligned first sleep is 480 and a flat one would be 600.
    frozen = 600 * 2_700_000 + 120
    monkeypatch.setattr(prompt_scheduler, "tick", lambda: {"configured": True})
    monkeypatch.setattr(prompt_scheduler, "_sleep", record_sleep)
    monkeypatch.setattr(prompt_scheduler, "_now", lambda: float(frozen))
    monkeypatch.setattr(prompt_scheduler.settings, "prompt_scheduler_interval_seconds", 600)

    async def drive():
        task = asyncio.create_task(prompt_scheduler.run_forever())
        # TWO sleeps: the first is deliberately a FULL interval, and only the second aligns.
        assert await _wait_until(lambda: len(slept) >= 2), "the loop never reached a second sleep"
        task.cancel()
        with pytest.raises(asyncio.CancelledError):
            await task

    asyncio.run(drive())
    # Both halves, because each alone is a bug. A full first sleep is what keeps sleep-first
    # DETERMINISTIC — an aligned first sleep is uniform in (0, interval] and can be milliseconds,
    # which would let a short-lived `TestClient` fire a real send pass. A ship gate caught me claiming
    # the `remainder == 0` branch prevented that; it does not.
    assert slept[0] == 600, (
        f"first sleep was {slept[0]}s, expected a full 600. An aligned FIRST sleep makes sleep-first "
        "probabilistic for the whole suite."
    )
    assert slept[1] == 480, (
        f"second sleep was {slept[1]}s from 120s past a boundary — expected 480 (aligned). 600 would "
        "mean the loop never aligns and every tick keeps the phase of the last restart."
    )


def test_alignment_holds_for_a_CLAMPED_interval_too(monkeypatch):
    """The two features must compose: a too-short configured value is clamped to the floor AND the
    resulting ticks are still aligned to that floor, not to the value the operator typed."""
    slept = []
    real_sleep = asyncio.sleep

    async def record_sleep(seconds):
        slept.append(seconds)
        await real_sleep(0)

    frozen = 600 * 2_700_000 + 120
    monkeypatch.setattr(prompt_scheduler, "tick", lambda: {"configured": True})
    monkeypatch.setattr(prompt_scheduler, "_sleep", record_sleep)
    monkeypatch.setattr(prompt_scheduler, "_now", lambda: float(frozen))
    monkeypatch.setattr(prompt_scheduler.settings, "prompt_scheduler_interval_seconds", 120)

    async def drive():
        task = asyncio.create_task(prompt_scheduler.run_forever())
        assert await _wait_until(lambda: len(slept) >= 2), "the loop never reached a second sleep"
        task.cancel()
        with pytest.raises(asyncio.CancelledError):
            await task

    asyncio.run(drive())
    assert slept[0] == 600, "the first sleep must be a full CLAMPED interval, not the configured 120"
    assert slept[1] == 480, (
        f"second sleep was {slept[1]}s — expected 480, i.e. aligned to the 600s FLOOR. Aligning to "
        "the configured 120 instead would give 0 and break sleep-first."
    )


def test_only_the_FIVE_45_minute_zones_are_late_and_by_EXACTLY_five_minutes():
    """The bound, measured across the tz database rather than asserted.

    The docstring for `seconds_to_next_boundary` used to say the :45 zones land "up to one interval
    late" and named two of them. Both halves were wrong: the lateness is a CONSTANT 300s (a :45 offset
    puts local :00 five minutes short of a 600s boundary, never further), and there are five names, not
    two — `Australia/Eucla` was missing. A ship gate measured it; this keeps it measured.

    Pinned because the claim is user-facing in effect: it is the difference between telling someone in
    Kathmandu "within seconds" and "within five minutes".
    """
    import datetime
    import zoneinfo

    interval = 600
    late = {}
    for name in zoneinfo.available_timezones():
        tz = zoneinfo.ZoneInfo(name)
        for day in (datetime.date(2026, 1, 15), datetime.date(2026, 7, 15), datetime.date(2026, 9, 21)):
            six_pm = datetime.datetime.combine(day, datetime.time(18, 0), tzinfo=tz)
            delay = BOUNDARY(six_pm.timestamp(), interval)
            # A tick coincides with their hour exactly when the boundary does, i.e. a FULL interval.
            if delay != interval:
                late.setdefault(name, set()).add(delay)

    assert set(late) == {
        "Asia/Kathmandu", "Asia/Katmandu", "Pacific/Chatham", "NZ-CHAT", "Australia/Eucla",
    }, f"the set of late zones changed: {sorted(late)}"
    for name, delays in late.items():
        assert delays == {300.0}, f"{name} is late by {delays}, expected exactly 300s"
