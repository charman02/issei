# issei on AWS — live deploy runbook (api.issei.app)

Deploys the issei API to AWS ECS Fargate behind an ALB, served over **HTTPS at
`https://api.issei.app`**, and cuts the live Vercel frontend over to it. This is a
**keep-it-running** deploy (not the teardown artifact) — cost is ~$36/mo, mostly
the ALB + public IPs, which bill even at zero traffic. Tear down later with
`cdk destroy` (Step 6) if the cost isn't worth it.

The stack is domain-ON (`infra/bin/issei.ts` has `domainName: 'issei.app'`,
`apiSubdomain: 'api'`). To go back to raw-ALB HTTP, comment those two lines out.

**Prerequisite that gates everything: the `issei.app` Route53 hosted zone must
exist** (auto-created when you register the domain through Route53). The ACM cert
DNS-validates against it during `cdk deploy`, so the deploy will hang on cert
validation if the zone isn't there yet. Confirm it first (Step 0).

Everything below runs with **your** AWS credentials, in **us-west-2**. Each step is
yours to execute and watch.

---

## Prerequisites (one-time on your machine)

- **AWS CLI v2** configured: `aws sts get-caller-identity` should return your account.
  Use least-privilege creds you're comfortable creating infra with (this stack makes
  a VPC, ALB, ECS, IAM roles, an OIDC provider).
- **Node 18+** and **Docker** (the CDK builds the container image locally to push).
  Docker Desktop must be running.
- From `infra/`: `npm install` (already done in this worktree if `node_modules/` exists).
- The 6 REQUIRED app secrets, available in the repo-root `.env` (DATABASE_URL, JWT_SECRET,
  CLOUDINARY_CLOUD_NAME, CLOUDINARY_API_KEY, CLOUDINARY_API_SECRET, OPENROUTER_API_KEY).
- Plus 4 for push notifications (#89): VAPID_PRIVATE_KEY, VAPID_PUBLIC_KEY, VAPID_SUBJECT,
  CRON_SECRET. **These are REQUIRED TOO now — all ten parameters must exist before any deploy.**
  They were optional until the four `secrets[]` entries were committed to
  `.aws/task-definition.json`; ECS now resolves all ten when a task starts, so a missing one is
  `ResourceInitializationError: unable to pull secrets` and a circuit-breaker rollback.

  Keep the distinction straight, because "optional" is still half true: the VALUES are optional to
  the app's BEHAVIOUR — with them empty `services/push.is_configured()` is False, each send is a
  logged no-op and `POST /notifications/run-daily-prompt` answers 404. The PARAMETERS are not
  optional to the DEPLOY. And SSM cannot store an empty SecureString, so in practice a successful
  deploy means all four hold real values and push is live. See "Step 1b".

Set these once per shell session:
```bash
export AWS_REGION=us-west-2
export AWS_DEFAULT_REGION=us-west-2
ACCOUNT=$(aws sts get-caller-identity --query Account --output text)
echo "account: $ACCOUNT  region: $AWS_REGION"
```

---

## Step 0 — Confirm the issei.app hosted zone exists (the gate)

The deploy DNS-validates the ACM cert against this zone, so it MUST exist first.
Route53 creates it automatically when the domain registration completes:
```bash
aws route53 list-hosted-zones-by-name --dns-name issei.app \
  --query "HostedZones[?Name=='issei.app.'].[Id,Name]" --output text
```
- **Prints a zone id + `issei.app.`** → good, proceed.
- **Prints nothing** → registration hasn't finished creating the zone yet. Check
  registration status and wait:
  ```bash
  aws route53domains get-domain-detail --domain-name issei.app --region us-east-1 \
    --query 'StatusList' --output text 2>/dev/null || echo "not yet visible"
  ```
  (route53domains is only in us-east-1 — the `--region us-east-1` is intentional and
  doesn't change where the app deploys.) Re-run Step 0 until the zone appears.

---

## Step 1 — Put the 6 required secrets in SSM Parameter Store (SecureString, free tier)

The task definition reads these at `/issei/<NAME>`. Source them from the
repo-root `.env` so no secret is ever typed or committed. Run from the **repo root**:

```bash
set -a; source .env; set +a   # loads DATABASE_URL, JWT_SECRET, CLOUDINARY_*, OPENROUTER_API_KEY

for NAME in DATABASE_URL JWT_SECRET CLOUDINARY_CLOUD_NAME CLOUDINARY_API_KEY CLOUDINARY_API_SECRET OPENROUTER_API_KEY; do
  aws ssm put-parameter \
    --name "/issei/$NAME" \
    --type SecureString \
    --value "${!NAME}" \
    --overwrite \
    --region "$AWS_REGION" >/dev/null && echo "  ✓ /issei/$NAME"
done
```

Verify they exist (names only, values stay encrypted):
```bash
aws ssm get-parameters-by-path --path /issei --region "$AWS_REGION" \
  --query 'Parameters[].Name' --output text
```

> DATABASE_URL should be the Neon **pooler** endpoint with `?sslmode=require`.
> The GitHub Actions migration step uses the non-pooler (direct) endpoint via
> the `MIGRATION_DATABASE_URL` repo secret.

---

## Step 1b — Push notifications (#89), when you want them ON

**THIS IS NO LONGER SKIPPABLE.** It was, until the four `secrets[]` entries were committed to
`.aws/task-definition.json`. A first deploy into a fresh account — or this one after a
`cdk destroy` and rebuild — now needs all four parameters to exist before the task will start. The
CODE still degrades gracefully with empty values (`is_configured()` False, sends are logged no-ops,
the cron route 404s), but you can no longer REACH that state through a deploy, because SSM will not
store an empty SecureString.

**THE ORDER MATTERS AND IT IS THE OPPOSITE OF WHAT YOU MIGHT DO.** Parameters first, then the IAM
grant, and only then let a deploy run. ECS resolves every `secrets[]` entry when a task starts, so
a reference to a parameter that does not exist yet fails to start and the circuit breaker rolls the
deploy back — with an EMPTY log group, because the container never ran. The entries are already
committed, which is what turns this from advice into a precondition: the trade for never having to
remember step 5 is that steps 3 and 4 are now mandatory.

1. **Generate the keypair.** A P-256 ECDSA key, stored as base64url of the raw 32-byte private
   scalar and the raw 65-byte uncompressed public point:
   ```bash
   python - <<'PY'
   import base64
   from cryptography.hazmat.primitives.asymmetric import ec
   from cryptography.hazmat.primitives import serialization
   k = ec.generate_private_key(ec.SECP256R1())
   b64 = lambda b: base64.urlsafe_b64encode(b).rstrip(b"=").decode()
   print("VAPID_PRIVATE_KEY=" + b64(k.private_numbers().private_value.to_bytes(32, "big")))
   print("VAPID_PUBLIC_KEY=" + b64(k.public_key().public_bytes(
       encoding=serialization.Encoding.X962,
       format=serialization.PublicFormat.UncompressedPoint)))
   PY
   ```
   The PUBLIC key is not a secret — it is served to every browser by `GET /notifications/vapid-key`,
   because a client needs it to subscribe. It lives in SSM anyway so rotating the pair is a deploy
   rather than a frontend rebuild.

   **Rotating invalidates every existing subscription.** A subscription is minted against one
   public key; after a rotation the push service answers 401/403, which the sender deliberately
   does NOT treat as "dead" (only 404/410 prune a row), so nothing is deleted — but nobody
   receives anything until each device re-subscribes. Rotate only if the private key leaks.

2. **A cron secret**, any long random string: `openssl rand -hex 32`.

3. **Put all four in SSM:**
   ```bash
   for NAME in VAPID_PRIVATE_KEY VAPID_PUBLIC_KEY VAPID_SUBJECT CRON_SECRET; do
     aws ssm put-parameter --name "/issei/$NAME" --type SecureString \
       --value "${!NAME}" --overwrite --region "$AWS_REGION"
   done

   # Confirm all four landed, without printing their values:
   aws ssm get-parameters-by-path --path /issei --region "$AWS_REGION" \
     --query 'Parameters[].Name' --output text | tr '\t' '\n' | sort
   ```
   `VAPID_SUBJECT` is a `mailto:` or `https:` URL a push service can contact about our sends —
   required by RFC 8292 whenever a key is configured.

   Note `$AWS_REGION`, **not** `$REGION` — this loop said `$REGION` until 2026-09-10, and that
   variable is set nowhere in this file, so a copy-paste passed `--region ""`. Step 1's identical
   loop always had it right.

4. **GRANT THE EXECUTION ROLE READ ON THE FOUR NEW PARAMETERS. This step is easy to miss and it
   is the one that fails the deploy.**

   The six existing secrets are readable because `ecs.Secret.fromSsmParameter` in the CDK stack
   auto-granted the execution role read on *exactly those six ARNs*. The pipeline renders
   `.aws/task-definition.json`, **not** CDK — so adding four `secrets[]` entries there does not
   extend that grant. Without this the task dies at startup with
   `ResourceInitializationError: unable to pull secrets`, the circuit breaker rolls the deploy back,
   and the cause looks like a mystery because the task definition is correct.

   An inline policy rather than `cdk deploy`, for the reason named at the top of
   `.github/workflows/daily-prompt.yml`: a `cdk deploy` from a laptop registers a new revision of
   the SAME task-definition family, built from the operator's working tree, and points the live
   service at it — replacing the running production image.

   ```bash
   ROLE=$(aws ecs describe-task-definition      --task-definition IsseiStackTaskDefC777D49A --region "$AWS_REGION"      --query 'taskDefinition.executionRoleArn' --output text | sed 's|.*/||')
   echo "$ROLE"   # IsseiStack-TaskDefExecutionRole...

   aws iam put-role-policy --role-name "$ROLE" --policy-name issei-push-secrets      --region "$AWS_REGION" --policy-document "$(python - <<'JSON'
   import json
   base = "arn:aws:ssm:us-west-2:069091212126:parameter/issei/"
   names = ["VAPID_PRIVATE_KEY", "VAPID_PUBLIC_KEY", "VAPID_SUBJECT", "CRON_SECRET"]
   print(json.dumps({"Version": "2012-10-17", "Statement": [
       {"Effect": "Allow", "Action": "ssm:GetParameters",
        "Resource": [base + n for n in names]}]}))
   JSON
   )"
   ```

   Console equivalent: **IAM → Roles →** search the role name → **Add permissions → Create inline
   policy → JSON**, same document, name it `issei-push-secrets`.

5. **Then wire them, in both places, because only one of them ships:**
   - `ssmParams` in `infra/lib/issei-stack.ts` — used by `cdk deploy`.
   - `secrets[]` in `.aws/task-definition.json` — **this is the one the GitHub Actions pipeline
     actually renders on every push.** Miss it and the variables are simply absent in production
     while the stack file looks correct, which is a silent no-op rather than an error.

5b. **One plain env var, in BOTH files, by the same rule as step 5:**
   `PROMPT_SCHEDULER_INTERVAL_SECONDS` (600) — how often the in-process ticker runs
   (`app/services/prompt_scheduler.py`, the PRIMARY nudge trigger since 2026-09-18). Not a
   secret, so no SSM parameter and no IAM grant: just `environment[]` in
   `.aws/task-definition.json` (the one that ships) and `environment` in
   `infra/lib/issei-stack.ts` (kept in step so it can't drift).
   `tests/test_deploy_config.py` pins both — it gained that REVERSE direction (a Settings field
   the deployment never supplies) only after this variable shipped absent from both files while
   three documents called it an operator-settable off switch.
   **0 disables the loop — 0, not blank.** And a hand-registered revision needs
   `aws ecs update-service --task-definition <family>:<rev> --force-new-deployment` before new
   tasks use it; the next merge to main reverts it regardless.

5c. **Two more plain env vars, same rule, for rate limiting** (`app/services/rate_limit.py`,
   2026-09-21). Both in `environment[]` of the JSON that ships AND in the stack file; both pinned
   by `tests/test_deploy_config.py`, name and VALUE.
   - `RATE_LIMIT_ENABLED` (`true`) — **the off switch you may actually need.** Every other failure
     in this app degrades quietly; a misfiring rate limiter locks real people out of their own
     accounts, and you learn about it from a user who cannot sign in. Same emergency-stop mechanics
     as 5b: register a revision with `false`, then `update-service --force-new-deployment`, and know
     that the next merge to main restores `true`. Blank means "unset" and yields the default rather
     than crashing the container.
     **The case it is actually for, named so nobody has to work it out live:** an in-person user
     testing session. `SIGNUP_PER_IP` is 20 an hour and everyone in one room shares one address, so a
     session bigger than that will refuse the twenty-first person with "Too many attempts. Try again
     in 54 minutes." and nothing in the copy hints it is a per-network signup cap. Flip this to
     `false` for the session, flip it back after. (A ship gate raised this against this project's own
     history of testing in batches; 10 was the original number and would have bitten a dozen people.)
   - `TRUSTED_PROXY_HOPS` (`1`) — how many appending proxies sit in front. **Not a preference: a
     statement about this network**, and both wrong values break the limiter silently and in
     opposite directions. Too low and every caller is bucketed under the ALB's own private address,
     so one attacker hitting the login limit locks out every real user. Too high and it trusts an
     element of `X-Forwarded-For` that the CLIENT wrote, so a script rotating that header gets a
     fresh bucket per request and nothing is limited at all. An ALB APPENDS the address it saw,
     which is why the rightmost entries are the trustworthy ones. **If you ever put CloudFront in
     front of this ALB, this becomes 2 in the same change** — it is the one number in the
     deployment that a new hop invalidates, and nothing will fail to tell you.

6. **Two GitHub repo secrets** for `.github/workflows/daily-prompt.yml` — the SECOND of two
   triggers since 2026-09-18 (the primary one is `app/services/prompt_scheduler.py`, in-process,
   which needs no secret because it makes no HTTP call). Still worth wiring: it covers the window
   where the task is restarting or a deploy is mid-roll, and both are idempotent per
   (user, local_date). It ASKS for **every 10 minutes** (`5,15,25,35,45,55` past the hour) and
   GitHub delivers 5-7 runs a day whatever it asks — five complete days of hourly against one of
   every-ten-minutes, both a mean of 6.0/day, so read "cap rather than loss rate" as the best
   available reading rather than proof (`app/services/prompt_scheduler.py` carries the caveat and the
   exclusions). Either way it is far too few against a person's send window of only four hours, which
   is why the primary trigger moved in-process:
   - `CRON_KEY` — the same value as `/issei/CRON_SECRET`.
   - `API_URL` — e.g. `https://api.issei.app` (no trailing slash).

   The workflow exits 0 with "nothing to do" while **either** is unset, which is what makes the
   order flexible: `API_URL` alone is harmless and can go in at any time. Set `CRON_KEY` only AFTER
   the server has `CRON_SECRET` — with both present the workflow starts POSTing, and an unset
   server secret DISABLES the route (404 rather than open, deliberately), so
   `curl --fail-with-body` exits non-zero and the run goes red **six times an hour, with six
   emails an hour** — the schedule is every 10 minutes, so a wrong key is loud rather than
   occasional. Budget for that before you start, or fix the key first: the volume has surprised
   someone once already. Each red run also emails the repo owner, so the signal arrives whether or
   not anyone is looking at Actions.

7. **Verify — AND MIND THE ORDER, because the obvious one burns the thing it checks.** Install on
   the phone and subscribe BEFORE pressing "Daily prompt" by hand. A dispatch with zero
   subscriptions still claims a `PromptSend` row (user, local_date) for every due user and counts
   them `failed` — deliberate, and pinned by
   `tests/test_prompt.py::test_a_due_user_with_NO_devices_is_not_an_error`, because they were
   genuinely due and nothing server-side can install an app for them. So testing the wiring first
   consumes YOUR OWN local date and no nudge can arrive that evening. On a run with no devices
   expect `{"candidates": N, "sent": 0, "failed": N}` — that is correct, not broken.

   `curl -s https://api.issei.app/notifications/vapid-key` should report
   `configured: true` with a public key — it answers `configured: false` rather than 404ing when
   unset, so that one call distinguishes "not wired" from "broken". Then a manual
   `workflow_dispatch` of "Daily prompt" should return a JSON summary rather than 404 (safe to press
   twice: `prompt_sends`' UNIQUE (user, local_date) refuses a double-send).

   **DONE — this step is history now, and is kept for the sequence.** The PWA shell shipped
   2026-09-10 (commit `91660ef`), the four parameters were created 2026-09-15, and on **2026-09-17 a
   production daily prompt arrived on an installed iOS home-screen app and its tap opened the
   composer.** So the end-to-end leg described below has been walked once; redo it after any change
   to the VAPID keys, the service worker or the payload shape. It needs a PHONE, because
   nothing on the dev machine can do it (headless Chromium refuses `pushManager.subscribe` outright:
   there is no push service behind it). On the phone: open `https://issei.app`, install it via
   Share → "Add to Home Screen" — **required on iOS**, where Safari grants Web Push only to a
   home-screen install and `window.PushManager` doesn't exist in a browser tab at all — then open
   the app *from the home screen*, go to You → Notifications, turn on "Notify me on this device",
   and allow the browser prompt. The daily nudge then fires at the hour set on that screen, on any
   day you have **not already shared a meal**, and no more often than the "How often" setting allows
   (#109 — every 1 / 3 / 7 days, defaulting to 1). **NOT "on the days a friend has posted"**, which
   is what this line used to say and what #89 actually built: gating the prompt on friends' activity
   made it circular — the mechanism for getting people to post required people to have already
   posted. #108 repointed it at the recipient's own silence. A manual `workflow_dispatch` of "Daily
   prompt" runs the identical code path without waiting, and its JSON summary carries a per-reason
   breakdown (`already_posted_today`, `nudged_recently`, `hour_not_reached`, …) so a night with no
   nudge can be explained from the run page rather than from the database.

## Step 2 — Bootstrap CDK (one-time per account/region)

```bash
cd infra
npx cdk bootstrap "aws://$ACCOUNT/$AWS_REGION"
```
Creates the CDK toolkit stack (an S3 bucket + roles CDK uses to push assets). Safe to
re-run; no-op if already bootstrapped.

---

## Step 3 — Deploy

```bash
cd infra
npx cdk deploy
```
Review the IAM/security-group changes it prints, type `y`. First deploy takes
~15–20 min: it builds the ARM64 image, pushes to ECR, requests the ACM cert and
**DNS-validates it against the issei.app zone** (a few min), then stands up
VPC → ALB → ECS service and waits for the task to pass health checks.

> If it stalls a long time on the certificate: the hosted zone isn't resolving
> (re-check Step 0), or the domain registration is still finalizing. The cert
> can't validate until Route53 is answering for issei.app.

On success it prints outputs, including:
```
IsseiStack.ApiUrl = https://api.issei.app
IsseiStack.AlbDns = IsseiStack-Alb...elb.amazonaws.com
IsseiStack.DeployRoleArn = arn:aws:iam::...:role/issei-github-deploy
```
Export the API URL for the checks:
```bash
API=$(aws cloudformation describe-stacks --stack-name IsseiStack --region "$AWS_REGION" \
  --query "Stacks[0].Outputs[?OutputKey=='ApiUrl'].OutputValue" --output text)
echo "$API"   # → https://api.issei.app
```
The Route53 A-alias for `api.issei.app` is created by the stack, but public DNS
can take a few minutes to answer. If `curl` can't resolve it yet, wait and retry,
or test against the raw `AlbDns` over HTTP in the meantime.

---

## Step 4 — Verify it actually works (the evidence)

```bash
# liveness + readiness (readiness proves the task reached Neon)
curl -s "$API/health"            # → {"status":"ok"}
curl -s "$API/health/ready"      # → {"status":"ready"}   ← DB reachable from Fargate

# a real authenticated round-trip
curl -s -X POST "$API/auth/signup" -H 'Content-Type: application/json' \
  -d '{"first_name":"Aws","last_name":"Demo","email":"aws-demo@example.com","password":"pw123456"}'
TOKEN=$(curl -s -X POST "$API/auth/login" \
  -H 'Content-Type: application/x-www-form-urlencoded' \
  -d 'username=aws-demo@example.com&password=pw123456' \
  | python -c "import sys,json;print(json.load(sys.stdin)['access_token'])")
curl -s "$API/auth/me" -H "Authorization: Bearer $TOKEN"   # → the user

# a recipe create (exercises the DB write path end to end)
curl -s -X POST "$API/recipes" -H "Authorization: Bearer $TOKEN" \
  -H 'Content-Type: application/json' \
  -d '{"name":"AWS Adobo","servings":4,"steps":[{"content":"Simmer","position":1}]}'
```
> This writes a test user + recipe to your **real Neon prod DB**. Either use a throwaway
> Neon branch for the demo, or delete the `aws-demo@example.com` rows afterward.

### Capture (this is the interview artifact)
- Terminal: the `cdk deploy` outputs + the curl results above.
- AWS Console screenshots: **ECS** (cluster → service → task RUNNING, health passing),
  **EC2 → Load Balancers** (the ALB), **CloudWatch → Log groups → /ecs/issei-api**
  (real application logs from the running container), **IAM** (the `issei-github-deploy`
  OIDC role).
- A cost note: **Cost Explorer** or the Billing dashboard after a few hours.

---

## Step 5 — Cut the live app over to the AWS API

Point the Vercel frontend at `https://api.issei.app` so the real app uses AWS.

1. **Vercel dashboard → issei project → Settings → Environment Variables**: set
   `VITE_API_URL = https://api.issei.app` (Production). Then **redeploy** the
   frontend (Deployments → ⋯ → Redeploy, or push a trivial commit) — Vite inlines
   the var at build time, so it only takes effect on a fresh build.
2. Verify end to end in a browser at `https://issei.app` (the canonical site; `issei-delta.vercel.app` is Vercel's alias for the same deployment): sign in,
   open a recipe, add one. Watch the **Network tab** — calls should go to
   `api.issei.app` and succeed (no CORS error; the stack already allows the Vercel
   origin). If you see CORS failures, confirm `CORS_ORIGINS` on the task includes
   the exact Vercel origin.

**Résumé/GitHub is now truthful in the present tense** — the app is live on AWS.

---

## Step 6 — Destroy (only when you want to stop the ~$36/mo)

**If the live app is pointed here, revert it first** (Step 5, in reverse):
update `VITE_API_URL` and redeploy, THEN destroy — so users never hit a dead API.

```bash
cd infra
npx cdk destroy
```
Removes the VPC, ALB, ECS service, log group, IAM roles, OIDC provider. Then:

```bash
# the ECR repo holding the pushed image is a CDK asset repo; images may linger.
# Optional cleanup if you want zero footprint:
# ALL TEN. The four push parameters are as required as the six now that the task definition
# references them, so a teardown that leaves them behind and a rebuild elsewhere fails to start.
aws ssm delete-parameters --names \
  /issei/DATABASE_URL /issei/JWT_SECRET /issei/CLOUDINARY_CLOUD_NAME \
  /issei/CLOUDINARY_API_KEY /issei/CLOUDINARY_API_SECRET /issei/OPENROUTER_API_KEY \
  /issei/VAPID_PRIVATE_KEY /issei/VAPID_PUBLIC_KEY /issei/VAPID_SUBJECT /issei/CRON_SECRET \
  --region "$AWS_REGION"
```
The CDK **bootstrap** stack (`CDKToolkit`) is fine to leave — it costs ~nothing and
saves re-bootstrapping next time. Confirm nothing expensive remains:
```bash
aws elbv2 describe-load-balancers --region "$AWS_REGION" --query 'LoadBalancers[].LoadBalancerName'
aws ecs list-clusters --region "$AWS_REGION"
```
Both should be empty (or not list `issei`).

---

## Known snags (a first ECS/CDK deploy usually hits one or two)

Each of these is itself a "Dive Deep" story worth writing down.

- **Task fails health checks / stuck "PENDING → STOPPED" loop.** Read the stopped
  task's *Stopped reason* in the ECS console and the CloudWatch logs. Usual causes:
  a secret missing from SSM (Step 1 or 1b) → **the container never starts at all**: the Stopped
  reason reads `ResourceInitializationError: unable to pull secrets` and the log group is EMPTY.
  This line used to say "the app crashes on `Settings()` at import" — it does not; `Settings()` is
  never reached, which is precisely why an empty log reads as a mystery. The same failure appears if
  the parameter exists but the EXECUTION ROLE lacks read on it (Step 1b, step 4), and the two are
  indistinguishable from outside, so check both. Or
  the container can't reach Neon (check the task's security-group egress + that the
  DATABASE_URL is the correct pooler host with `sslmode=require`).
- **Health check flapping though the app is up.** The ALB target group hits
  `/health/ready`, which does a real DB `SELECT 1`. If Neon is unreachable it returns
  500 and the target never goes healthy — which is *by design* (better than "green"
  over a dead DB), but means fix the DB reachability, not the health path.
- **`cdk deploy` can't build the image.** Docker Desktop not running, or not able to
  build `linux/arm64` (needs buildx / QEMU on an x86 machine — Docker Desktop has it
  by default). The base image is digest-pinned and verified multi-arch, so the FROM
  line itself is fine.
- **Deploy hangs on the ACM certificate.** The cert DNS-validates against the
  issei.app hosted zone; if the zone doesn't exist or isn't resolving yet (domain
  registration still finalizing), validation never completes. Re-check Step 0; the
  cert can't validate until Route53 answers for issei.app. CDK will wait a long
  time, then fail — safe to re-run `cdk deploy` once the zone is live.
- **`api.issei.app` doesn't resolve right after deploy.** The A-alias exists but
  public DNS caches take a few minutes. Wait/retry, or hit the raw `AlbDns` over
  HTTP meanwhile. (Not a stack problem.)
- **`Need to perform AWS calls for account …, but no credentials`** during synth/deploy
  → your shell lost its AWS creds; re-run the `export` block at the top. (Note: with
  the domain ON, `cdk synth`/`deploy` needs live creds to look up the hosted zone —
  it can't synth fully offline anymore.)
- **`cdk deploy` can't build the image.** Docker Desktop not running, or can't build
  `linux/arm64` (Docker Desktop has buildx/QEMU by default). The base image is
  digest-pinned and verified multi-arch, so the FROM line itself is fine.
- **Bootstrap complains about an existing CDKToolkit** → harmless, it's already there.

---

## What deploys what

- **`cdk deploy`** (this runbook) is what stands up the AWS infra. It's manual —
  nothing here fires automatically.
- **Merging to `main`** still auto-deploys the frontend to Vercel and the backend
  to ECS Fargate via GitHub Actions. The `infra/` code on `main`
  does **not** deploy anything on a push — CloudFormation only changes when you run
  `cdk deploy`.
- The **GitHub Actions workflow** (`.github/workflows/deploy.yml`) is the *ongoing*
  image-update path — build → push → update the ECS service on pushes to main. It
  only works once the stack (and its OIDC deploy role) exists, and needs the
  `AWS_ACCOUNT_ID` / `MIGRATION_DATABASE_URL` repo secrets set. (A second workflow,
  `daily-prompt.yml`, runs every 10 minutes for #89 and needs `CRON_KEY` / `API_URL` — see Step 1b.
  It is self-disabling while either is unset, so it costs nothing until you want it.) Wire it up after the
  first successful manual `cdk deploy` if you want push-to-deploy; it's optional for
  the initial launch.
- The `/health/ready` route in `app/main.py` is load-bearing behind the ALB target
  group here.
