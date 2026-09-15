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

import pytest

from app.config import Settings

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
