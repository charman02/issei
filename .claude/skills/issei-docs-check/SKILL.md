---
name: issei-docs-check
description: Use before pushing or deploying issei, or whenever asked to check/update the docs. Verifies README and every other doc against the actual code — test counts, endpoint/model/service inventory, shipped-but-undocumented features, and POSITIONING violations — then applies the mechanical fixes and surfaces the judgment calls. Keeping public docs true after a deploy is a hard project requirement.
---

# issei docs check

Keeps issei's documentation from lying to the people who can clone the repo. The project
rule is non-negotiable: **whenever code is pushed and deployed, the docs are brought back
into agreement with it — the README above all.**

**Core principle:** this is a *measurement* problem before it is a *writing* problem. The
failure mode is not clumsy prose; it is a confident number the codebase contradicts, in a
document handed to recruiters and users. So nothing is "adjusted by arithmetic" — every
count is re-run, and the command that produced it travels with the change.

## When this runs

- Before any `git push`, and before/right after any deploy to prod. This is the trigger the
  project rule names.
- On demand ("check the docs", "is the README still true?", "update the docs").
- After a batch of feature work, before it's summarized to the user.

If a push is imminent and this hasn't run, run it first — do not push stale docs.

## How to run it

1. **Dispatch the `issei-docs-auditor` subagent** (`.claude/agents/issei-docs-auditor.md`).
   It is read-only and does the measuring: it runs the exact checks, compares each doc claim
   to the measured value, scans for POSITIONING violations, and returns a structured report
   of stale claims with the proof for each. Let it do the counting — do not eyeball counts
   yourself, and do not trust a number already written in a doc.

2. **Read its report and split the findings in two:**
   - **Mechanical** — a wrong count, a renamed file, a stale services list, an endpoint
     number. Apply these directly. The measured value in the report is the correct value;
     write exactly that, not an arithmetic guess.
   - **Judgment** — a reworded claim, a feature to describe from scratch, a positioning call,
     anything in POSITIONING.md's territory. Do NOT silently rewrite these. Draft the change
     and surface it to the user with the reasoning, because a wrong call here ships a false
     claim under the app's own name.

3. **Never edit `POSITIONING.md` to make a violation "pass."** If a doc claims something
   POSITIONING forbids, the doc is wrong, not the constitution. The one exception is a doc
   that explicitly explains a feature's *absence* (FUTURE.md's "Not Built: Audio", the
   shopping-list removal note) — that is correct and stays.

4. **Re-measure after editing.** Apply the fixes, then re-run the same checks and confirm the
   docs now agree. A docs change that leaves a different count wrong is not done.

## What "the docs" means here

`README.md` (public, highest priority) · `ARCHITECTURE.md` · `FUTURE.md` · `POSITIONING.md`
(the ruleset — read, rarely edit) · `TECHDEBT.md` if present · both `CLAUDE.md` copies (repo
root and `C:\Users\chissman\issei\CLAUDE.md` — they can diverge because the file is
git-ignored) · `.env.example`, `frontend/.env.example` · `docs/**`.

**And one document that is not in this repo at all: the owner's GitHub PROFILE README**
(`github.com/charman02/charman02`). It is the most recruiter-facing text the project has, it
quotes issei's numbers and links, and because it lives elsewhere nothing in a normal docs pass
touches it — so it drifts silently. It went months linking "live app" at a stale `*.vercel.app`
preview and "API docs" at a decommissioned Render host returning **503**.

Treat it as part of every docs pass:

1. The auditor clones it read-only and reports its stale claims like any other file (see its own
   instructions for the two extra checks: **curl every URL**, and measure the commit count and
   elapsed span, which no in-repo doc states).
2. Applying the fixes is a commit and push to that OTHER repo — clone, edit, commit, push. The
   same credential helper that pushes issei works there.
3. **Only the issei-derived claims are yours to change.** That file is written in the first person
   about someone's career; their job, their degrees and their other projects are not docs drift.
   Keep their voice, and put the diff in front of them in your report.
4. A **dead link outranks a wrong number** when you order the findings. A recruiter who clicks
   through to a 503 forms a worse impression than one who reads a stale test count.

## Known drift to expect (as of this skill's writing — verify, don't trust)

These have shipped and were often undocumented; the auditor will flag whichever are still
missing:
- the LLM layer: `POST /recipes/parse`, `app/services/recipe_ai.py`, `app/services/quantity.py`, the `OPENROUTER_*` env vars
- the three add-recipe doors (paste / guided / form) and dictation
- test counts (they have been wrong in both directions; a stray untracked `*.test.*` file has inflated the frontend count before — stash scratch files before counting)

## What good looks like

A push where the README's numbers match `--collect-only`, its route table matches the
`@router` grep, every shipped surface is either documented or deliberately omitted, and the
POSITIONING scan is clean. End by telling the user, in one line, what was stale and what you
changed — and which judgment calls you're leaving to them.
