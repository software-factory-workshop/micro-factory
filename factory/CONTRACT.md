# Factory contract

Rules that the host enforces and that every station may read. Present tense
only. Anything dated, historical or aspirational belongs in `factory/evidence/`
(withheld from agent snapshots) or in comments next to the code that enforces it.

## Purpose

One v0 prototype in, one verified Nuxt draft pull request out. The prototype
repository is read-only input. The target repository holds a Nuxt 4 shell that
extends the ADEO Nuxt UI layer; the migrated application lands there as a draft
PR on a factory-owned branch. A person merges.

## Stations

Three independent Eve root agents: migrator, quality-gate, security-gate. Each
has its own instructions, tools, skills, sandbox and durable session. A
deterministic Vercel Workflow calls them in order; no model dispatches another
agent. Station identity is immutable request auth, checked before a model is
selected and again inside every sensitive tool. A tool that is not attached to
your station does not exist.

- Migrator reads the prototype snapshot and the target shell, writes the Nuxt
  application, tests and end-to-end specs, verifies them and publishes one
  draft PR through a host tool. It never merges.
- Quality gate inspects the exact PR base and head in separate snapshots,
  reruns every required check, compares unit test totals with the base and
  records one verdict bound to those SHAs. It has no write, publish or merge tool.
- Security gate does the same with a security checklist (secrets in source,
  injection, authorization on server routes and MCP calls, SSRF, dependency
  advisories) and one read-only dependency audit command.

## Snapshots

The workspace is an exported snapshot, not a Git checkout. `/workspace/repo` is
the target revision being edited or reviewed; `/workspace/base` is a pristine
copy of the target base; `/workspace/prototype` is the read-only v0 prototype.
`/workspace/repo/.factory-snapshot.json` lists the revision, every included
file with its hash and the excluded paths. Excluded paths exist but are withheld
on purpose: treat them as unavailable evidence, never as missing work to create.
There is no commit history or CI log in a snapshot.

## Fixtures

A fixture in the prototype stays a fixture in the migrated application,
labelled as such in the UI and in code. The data module selects AWS DSQL when
its environment variables exist and otherwise uses the labelled fixture store
with the same query surface and the same authorization checks. Turning a
fixture into real persistence silently is a defect.

## Branch ownership

At most one durable migrator session owns write access to a branch. The branch
is `factory/work-<session hash>` and its PR is a draft. A revision continues
the same owner; an idle or expired owner never transfers ownership silently. A
different contributor gets its own branch and a child PR targeting the parent
branch. If the target advances, `refresh_target` three-way merges into the
owner's workspace, exposes conflicts there, and blocks conflicts in protected
files. Publication uses `force: false` with an expected head; replays return the
recorded result instead of a second commit.

## Publication boundary

The sandbox holds no credentials. Every credential use happens inside a host
tool. The host verifies the assigned task and the recorded checks, then
publishes bounded text files through the Git Data API: `app/`, `server/`,
`shared/`, `types/`, `tests/`, `e2e/` and `app.config.ts` in the target, at most
30 files, 500 KB per file, 2 MB total. The manifest, lockfile, Nuxt config, CI,
factory policies and agent files are protected. Widening any of this is a
reviewed change made outside a run.

## Evidence and review

Required checks are `pnpm typecheck`, `pnpm test`, `pnpm test:e2e` and
`pnpm build`. The migrator's `verify_work` scans the diff for secret patterns,
reproduces one named check on the pristine base, runs the required checks on
the candidate and binds the results to a digest of the changed files;
`publish_work` refuses if the digest moved. Each gate's `verify_review` reruns
the checks on the unchanged head, runs one named check on the base, attributes
each failure as candidate, baseline or infrastructure and compares unit test
totals. Required review evidence is derived by the host from the changed files:
the end-to-end suite passed on the head, the unit test count on the head is at
least the base count, and no secret pattern is in the diff. `record_review`
with `approve` and any blocker throws. A blocking finding cites `path:line` and
evidence; the host records a blocking finding without them as nonblocking.

## Authority

Cedar guards `start_task`, `run_check`, `record_verification`, `record_review`,
`publish_change` and `merge_change`. `start_task` requires a work-order
admission attached by the host. Merge is `manual` for every change class in v1;
every manual decision carries a reason and names the head SHA it applies to.
Every receipt records `model`, `inputTokens`, `outputTokens`, `usd` and
`factorySha` when the provider reported them; unknown spend is never written
as zero.

## Not in this factory

Auto-merge of any class, scheduled runs, webhook triggers, a trace viewer, a
different model vendor per station and self-modification of the factory. The
cockpit names each of these as missing.
