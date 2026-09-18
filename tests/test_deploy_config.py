"""The four-edits problem, turned into a red CI run instead of a silent prod no-op.

`app/config.py` has carried this warning since #89:

    ADDING THESE TO PROD MEANS FIVE STEPS AND ONLY ONE OF THEM SHIPS: the SSM parameter, the
    execution-role IAM grant, `ssmParams` in infra/lib/issei-stack.ts, `secrets[]` in
    .aws/task-definition.json (this is the one the pipeline actually renders), and this class.

Push notifications then spent five days deployed and inert, because a value the container never
received is indistinguishable from a value the code chose to ignore. Nothing failed. No test went
red. `is_configured()` simply returned False and every send was a logged no-op, exactly as designed.

These tests close the two seams a repo CAN check. They cannot reach AWS, so they say nothing about
whether the parameters or the IAM policy exist — that is what the deploy and
`GET /notifications/vapid-key` are for. What they do catch is the class of mistake that is invisible
in a diff and silent in production:

  - a name in `secrets[]` that no `Settings` field reads (the variable arrives and nothing uses it)
  - a `Settings` field wired in one file and forgotten in the other
  - a malformed or wrong-account/region ARN
  - the two config files drifting apart, which is how the stack file comes to look correct while
    the file that actually ships does not
"""

import json
import pathlib
import re

from pydantic import ValidationError

import pytest

from app.config import OFF_VALUES, ON_VALUES, Settings

REPO = pathlib.Path(__file__).resolve().parent.parent
TASK_DEF = REPO / ".aws" / "task-definition.json"
STACK = REPO / "infra" / "lib" / "issei-stack.ts"

# The account and region the task definition targets. Pinned as literals on purpose: a secret
# pointing at the right parameter NAME in the wrong account fails at container start with
# `ResourceInitializationError`, which is invisible in review and produces an empty log group.
ACCOUNT = "069091212126"
REGION = "us-west-2"
ARN_PREFIX = f"arn:aws:ssm:{REGION}:{ACCOUNT}:parameter/issei/"


def _container():
    data = json.loads(TASK_DEF.read_text(encoding="utf-8"))
    containers = data["containerDefinitions"]
    assert len(containers) == 1, "one container; this test's assumptions change if that changes"
    return containers[0]


def _task_def_secret_names():
    return [s["name"] for s in _container().get("secrets", [])]


def _stack_ssm_params():
    """The string literals inside `const ssmParams = [...]` in the CDK stack."""
    text = STACK.read_text(encoding="utf-8")
    match = re.search(r"const ssmParams = \[(.*?)\];", text, re.S)
    assert match, "could not find `const ssmParams = [...]` — was it renamed?"
    return re.findall(r"'([A-Z0-9_]+)'", match.group(1))


def test_the_task_definition_is_valid_json():
    """It is rendered by the pipeline, not parsed by any test, so nothing else would notice."""
    json.loads(TASK_DEF.read_text(encoding="utf-8"))


def test_every_secret_in_the_task_definition_is_a_setting_the_app_reads():
    """A name here that no `Settings` field matches is a variable delivered to nobody.

    This is the silent half of the four-edits problem: the deploy succeeds, the container has the
    environment variable, and the code keeps behaving as if it were unset — which is precisely how
    push notifications shipped inert.
    """
    fields = set(Settings.model_fields)
    unread = [n for n in _task_def_secret_names() if n.lower() not in fields]
    assert not unread, (
        f"in .aws/task-definition.json secrets[] but read by no Settings field: {unread}. "
        "Either add the field to app/config.py or remove the entry — a variable nothing reads is "
        "a deploy that looks configured and behaves unconfigured."
    )


def test_the_two_config_files_agree():
    """`ssmParams` (CDK) and `secrets[]` (the pipeline's file) must name the same parameters.

    Only the task definition ships — the pipeline never runs `cdk`. So a name present in the stack
    and missing from the JSON is absent in production while the stack file looks correct, and the
    reverse leaves the CDK-managed IAM grant behind, which fails the task at startup.
    """
    assert sorted(_task_def_secret_names()) == sorted(_stack_ssm_params()), (
        "`.aws/task-definition.json` secrets[] and `ssmParams` in infra/lib/issei-stack.ts have "
        "drifted. Only the first one ships; the second is what grants the execution role read."
    )


@pytest.mark.parametrize("name", _task_def_secret_names())
def test_each_secret_arn_is_well_formed_and_matches_its_name(name):
    """The ARN must end in exactly its own parameter name, on the right account and region.

    A transposed character here is not a test failure anywhere else — it is a container that never
    starts, a circuit-breaker rollback, and an empty CloudWatch log group.
    """
    arn = next(s["valueFrom"] for s in _container()["secrets"] if s["name"] == name)
    assert arn == ARN_PREFIX + name, f"{name}: expected {ARN_PREFIX + name}, got {arn}"


def test_secrets_and_environment_do_not_collide():
    """The same variable set twice, from two sources, has no defined winner worth relying on."""
    container = _container()
    secrets = {s["name"] for s in container.get("secrets", [])}
    env = {e["name"] for e in container.get("environment", [])}
    assert not (secrets & env), f"declared as both a secret and a plain env var: {secrets & env}"


def test_the_push_settings_are_all_wired():
    """The four #89 settings specifically, because this is the feature the seam was found on.

    Named rather than derived: `Settings` has fields that deliberately do NOT belong in the task
    definition (`algorithm`, `access_token_expire_minutes` — crypto internals with defaults), so
    "every field is a secret" would be the wrong assertion. These four are the ones that were
    missing, and a regression here would put the feature straight back to silently inert.
    """
    names = set(_task_def_secret_names())
    for setting in ("VAPID_PRIVATE_KEY", "VAPID_PUBLIC_KEY", "VAPID_SUBJECT", "CRON_SECRET"):
        assert setting in names, f"{setting} is not in .aws/task-definition.json secrets[]"


def test_no_secret_VALUE_is_committed():
    """Only ARNs belong in this file. A literal value here would be a leak in a public repo."""
    for secret in _container().get("secrets", []):
        assert secret["valueFrom"].startswith("arn:aws:ssm:"), (
            f"{secret['name']} has a literal value rather than an SSM ARN"
        )


# ---------------------------------------------------------------------------------------------
# THE REVERSE DIRECTION. Everything above walks task-definition -> Settings: it catches a
# variable that ARRIVES and is never read. It cannot catch the opposite, which is a `Settings`
# field the app READS and the task definition never supplies — and that is the failure that
# actually reaches production, because the default silently stands in for the real value.
#
# `prompt_scheduler_interval_seconds` shipped exactly that way: documented in three places as
# "the off switch lives in the task definition, so a runaway needs no deploy", while being absent
# from `.aws/task-definition.json` altogether. Using the switch would have meant adding the
# variable and pushing — the round trip the docs said it avoided — and a value set by hand in the
# ECS console is wiped by the next merge, because the pipeline renders every revision from that
# committed file. The docs gate found it; this test is so the next one doesn't have to.
#
# Deliberately an ALLOWLIST rather than "every non-default field", because most settings are
# genuinely fine on their defaults in every environment. The list names the fields whose value in
# PRODUCTION must be a deliberate choice rather than whatever the code happens to default to.
# ---------------------------------------------------------------------------------------------
def _settings_with(raw):
    """A `Settings` built with one raw STRING value, the way an environment variable arrives.

    Through a dict rather than a keyword so a type checker doesn't object to the very coercion under
    test: every value in `environment[]` reaches pydantic as a string.
    """
    from app.config import Settings

    return Settings(**{"database_url": "sqlite://", "jwt_secret": "x",
                       "prompt_scheduler_interval_seconds": raw})


SETTINGS_THAT_MUST_BE_WIRED_AS_PLAIN_ENV = (
    "PROMPT_SCHEDULER_INTERVAL_SECONDS",
)


def _task_def_environment_names():
    return [e["name"] for e in _container().get("environment", [])]


@pytest.mark.parametrize("name", SETTINGS_THAT_MUST_BE_WIRED_AS_PLAIN_ENV)
def test_each_operationally_important_setting_is_in_the_task_definition(name):
    """In `environment[]` of the file the PIPELINE renders — not just in the CDK stack.

    `test_the_two_config_files_agree` covers secrets in both files; this covers the plain env vars
    that carry an operational lever. The CDK stack is documentation here (the pipeline never runs
    `cdk`), so the JSON is the one that has to be right.
    """
    assert name in _task_def_environment_names(), (
        f"{name} is read by app.config but absent from .aws/task-definition.json environment[] — "
        "so production runs on the code default and the value cannot be changed without a code "
        "change, however the docs describe it."
    )


@pytest.mark.parametrize("name", SETTINGS_THAT_MUST_BE_WIRED_AS_PLAIN_ENV)
def test_each_wired_env_var_is_a_setting_the_app_actually_READS(name):
    """The mirror of the check above: a plain env var nobody reads is a lie in the other direction.

    Same reasoning as `test_every_secret_in_the_task_definition_is_a_setting_the_app_reads`, which
    only covers `secrets[]`.
    """
    from app.config import Settings

    assert name.lower() in Settings.model_fields, (
        f"{name} is in .aws/task-definition.json environment[] but no Settings field reads it"
    )


@pytest.mark.parametrize("name", SETTINGS_THAT_MUST_BE_WIRED_AS_PLAIN_ENV)
def test_the_two_config_files_agree_on_plain_env_vars_too(name):
    """The stack file must name it as well, so it cannot quietly describe a different prod.

    `infra/RUNBOOK.md` states the rule: wire it in BOTH places, because only one of them ships and
    a stack file that looks correct while prod lacks the variable is a silent no-op.
    """
    stack = STACK.read_text(encoding="utf-8")
    assert name in stack, (
        f"{name} is in .aws/task-definition.json but not in infra/lib/issei-stack.ts — the stack "
        "file now describes a production that does not exist"
    )

    # AND THE SAME VALUE, not merely the same name. A substring check passes while the JSON says
    # "600" and the stack says '0' — which is verbatim "the stack file describes a production that
    # does not exist", the failure this test's own message claims to close. `_stack_ssm_params`
    # already set the precedent of parsing rather than grepping.
    shipped = next(e["value"] for e in _container()["environment"] if e["name"] == name)
    match = re.search(rf"{re.escape(name)}:\s*'([^']*)'", stack)
    assert match, f"{name} appears in the stack file but not as a quoted env value"
    assert match.group(1) == shipped, (
        f"{name} is '{match.group(1)}' in infra/lib/issei-stack.ts but '{shipped}' in "
        ".aws/task-definition.json — only the JSON ships, so the stack file is describing a "
        "production that does not exist"
    )


def test_a_BLANK_interval_does_not_crash_settings():
    """Clearing the field in the ECS console must not take the container down.

    It used to: an empty string failed int parsing at `app.config` import, so the API container and
    the `alembic upgrade head` task both died. Clearing a value is the instinctive way to disable
    something, and this field is documented as the off switch — so the off switch was a landmine.
    0 is the way to disable it; blank means "unset".
    """
    # Built through a dict on purpose: passing a STRING to an int field is exactly what an
    # environment variable does, and what this test is about — but spelling it as a keyword makes a
    # type checker object to the very thing under test.
    make = _settings_with

    assert make("").prompt_scheduler_interval_seconds == 600, "blank must mean unset, not a crash"
    assert make("   ").prompt_scheduler_interval_seconds == 600, "whitespace is blank"
    assert make("0").prompt_scheduler_interval_seconds == 0, "0 is how you disable the loop"
    assert make("900").prompt_scheduler_interval_seconds == 900


@pytest.mark.parametrize("word", sorted(OFF_VALUES))
def test_an_OFF_word_disables_instead_of_crashing_the_container(word):
    """The words an operator reaches for INSTEAD of 0, on the field every doc calls the emergency stop.

    Before this vocabulary existed they raised at `app.config` import — which takes down the API
    container AND the pre-deploy `alembic upgrade head` task, in the middle of the incident the
    operator was trying to stop. Same total outage as the blank-value bug, same field.

    This test exists because a ship gate pointed out the whole frozenset shipped with NO test: the
    next person to read it would see six speculative-looking strings, simplify the validator, and
    re-arm the crash for anyone whose task definition already carries `off` from a past incident.
    """
    assert _settings_with(word).prompt_scheduler_interval_seconds == 0
    assert _settings_with(word.upper()).prompt_scheduler_interval_seconds == 0, "case must not matter"
    assert _settings_with(f"  {word} ").prompt_scheduler_interval_seconds == 0, "nor whitespace"


@pytest.mark.parametrize("word", sorted(ON_VALUES))
def test_an_ON_word_means_the_DEFAULT_interval_rather_than_crashing(word):
    """The inverse of the off vocabulary, and the reason it has to exist.

    Accepting only the off words closed two fatal inputs and left the class open: an operator who has
    just learned that `off` works reaches for `on` when the incident ends — and `on` still crashed the
    container, identical blast radius, reached by the person most likely to have learned the
    vocabulary. ON means "enabled at the default interval", which is what someone typing it wants.
    """
    expected = Settings.model_fields["prompt_scheduler_interval_seconds"].default
    assert _settings_with(word).prompt_scheduler_interval_seconds == expected
    assert _settings_with(word.upper()).prompt_scheduler_interval_seconds == expected


@pytest.mark.parametrize("junk", ["600s", "ten", "1e3", "null", "6 0 0", "-"])
def test_GARBAGE_still_raises_because_a_typo_is_to_fix_not_to_obey(junk):
    """The deliberate other half of the decision, which is just as unpinned without a test.

    `600s` or `ten` is a mistake to correct, not an intention to infer — silently substituting a
    default there would hide a misconfiguration behind working software. Only the two vocabularies
    and a blank are forgiven.
    """
    with pytest.raises(ValidationError):
        _settings_with(junk)
