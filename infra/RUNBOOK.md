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
- Plus 4 OPTIONAL ones for push notifications (#89): VAPID_PRIVATE_KEY, VAPID_PUBLIC_KEY,
  VAPID_SUBJECT, CRON_SECRET. Every one defaults to `""`, and unset means OFF rather than
  broken — `services/push.is_configured()` is False, each send is a logged no-op, and
  `POST /notifications/run-daily-prompt` answers 404. So the stack deploys and runs fine
  without them; see "Step 1b" below when you want notifications to actually fire.

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

Skip this entirely to ship with notifications off. Nothing breaks: all four settings default to
`""`, `is_configured()` returns False, every send is a logged no-op, and the cron route 404s.

**THE ORDER MATTERS AND IT IS THE OPPOSITE OF WHAT YOU MIGHT DO.** Create the SSM parameters
FIRST. ECS resolves every `secrets[]` entry when a task starts, so a task definition that
references `/issei/VAPID_PRIVATE_KEY` before that parameter exists fails to start — and the
circuit breaker rolls the deploy back. Do not add the entries "ready for later".

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

4. **Then wire them, in both places, because only one of them ships:**
   - `ssmParams` in `infra/lib/issei-stack.ts` — used by `cdk deploy`.
   - `secrets[]` in `.aws/task-definition.json` — **this is the one the GitHub Actions pipeline
     actually renders on every push.** Miss it and the variables are simply absent in production
     while the stack file looks correct, which is a silent no-op rather than an error.

5. **Two GitHub repo secrets** for `.github/workflows/daily-prompt.yml`, which runs hourly:
   - `CRON_KEY` — the same value as `/issei/CRON_SECRET`.
   - `API_URL` — e.g. `https://api.issei.app` (no trailing slash).

   The workflow exits 0 with "nothing to do" while either is unset. Set `CRON_KEY` only AFTER the
   server has `CRON_SECRET`, or the route 404s, `curl --fail-with-body` exits non-zero, and the
   workflow goes red every hour.

6. **Verify:** `GET /notifications/vapid-key` should report `configured: true`, and a manual
   `workflow_dispatch` of "Daily prompt" should return a JSON summary rather than 404.

   **The PWA shell shipped 2026-09-10 (commit `91660ef`), so these four secrets are now the last
   thing standing between the app and a real notification** — this step used to end by saying the
   client half was still missing. After setting them, the end-to-end check needs a PHONE, because
   nothing on the dev machine can do it (headless Chromium refuses `pushManager.subscribe` outright:
   there is no push service behind it). On the phone: open `https://issei.app`, install it via
   Share → "Add to Home Screen" — **required on iOS**, where Safari grants Web Push only to a
   home-screen install and `window.PushManager` doesn't exist in a browser tab at all — then open
   the app *from the home screen*, go to You → Notifications, turn on "Notify me on this device",
   and allow the browser prompt. The daily nudge then fires at the hour set on that screen, on the
   days a friend has posted since you last opened Home; a manual `workflow_dispatch` of "Daily
   prompt" runs the identical code path without waiting.

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
aws ssm delete-parameters --names \
  /issei/DATABASE_URL /issei/JWT_SECRET /issei/CLOUDINARY_CLOUD_NAME \
  /issei/CLOUDINARY_API_KEY /issei/CLOUDINARY_API_SECRET /issei/OPENROUTER_API_KEY \
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
  a secret missing from SSM (Step 1) → the app crashes on `Settings()` at import; or
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
  `daily-prompt.yml`, runs hourly for #89 and needs `CRON_KEY` / `API_URL` — see Step 1b.
  It is self-disabling while either is unset, so it costs nothing until you want it.) Wire it up after the
  first successful manual `cdk deploy` if you want push-to-deploy; it's optional for
  the initial launch.
- The `/health/ready` route in `app/main.py` is load-bearing behind the ALB target
  group here.
