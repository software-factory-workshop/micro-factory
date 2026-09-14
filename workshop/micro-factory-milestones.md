# Micro-factory participant milestones

Four checkpoints named by capability. Each names the factory revision to check out, the prepared prototype repository, the exact commands, the expected effect, the test or eval that proves it, and how to recover when the step fails. The injected defects are labelled `[injected]` everywhere; none of them is a discovered product task.

Rehearsal passes when a clean participant setup completes M0 to M2 in 90 minutes and recovers from one failed step. Record the rehearsal in `factory/evidence/` with the date, the factory revision and the failed step that was recovered.

Repositories: factory `software-factory-workshop/micro-factory`, prototype `software-factory-workshop/adeo-todo-proto`, target `software-factory-workshop/adeo-todo-nuxt`. Every participant needs Node 24.11+, pnpm 10.33.4, GitHub access to the three repositories, and a Vercel account on `demo-software-factory` for the deployed cockpit.

## M0-run · the loop runs end to end

Factory revision: tag `m0-run` (the reference run revision recorded in `factory/evidence/`). Prototype: `adeo-todo-proto` at `main`.

```sh
git clone git@github.com:software-factory-workshop/micro-factory.git && cd micro-factory
git checkout m0-run
pnpm install --frozen-lockfile
pnpm typecheck && pnpm test && pnpm build
```

Then in the deployed cockpit: Projects → keep the prefilled brief → **Admit as work order** → **Start migration**. Follow the project page.

Expected effect: the phase timeline shows `worker_starting → working → review_starting → reviewing (quality-gate) → review_starting → reviewing (security-gate) → ready` or `human_review`; a draft PR exists on `factory/work-<hash>` in `adeo-todo-nuxt`; the Attempts list links to three station runs; the action bar reads **Open PR**; every result says "verdict applies to head `<sha>`; no merge was performed".

Proof: `apps/factory/tests/delivery-ledger.test.ts` and `delivery.test.ts` (transition table and gate sequence, run locally); `FACTORY_RUN_MIGRATOR_EVAL=1 pnpm --filter @micro-factory/factory exec eve eval migrator-tool-order --url <cockpit-url> --strict` for the tool order on a real run.

Recovery: a delivery in `blocked` shows **Resume**; click it once, the same station continues (no worker is replaced). If the migrator asks a question the action bar reads **Answer**. If `Start migration` returns 503, retry the same brief: the delivery id is `sha256(principal:operationId)` and admission is retried, never duplicated. If the sandbox cannot install dependencies, the command evidence names the failing install; that is infrastructure, not a candidate defect.

## M1-break-the-gate · the gate refuses what a lazy reviewer approves

Factory revision: `m0-run`. Prototype: unchanged. Prepared PRs in `adeo-todo-nuxt`, opened by the facilitator from `apps/factory/tests/fixtures/defects/*/candidate.patch`:

| Fixture | Defect | Which gate catches it | Deterministic? |
| --- | --- | --- | --- |
| `non-persisting-save` | UI reports a save that never reaches persistence | quality gate (model finding, e2e evidence) | no |
| `deleted-test` | a failing test is deleted to go green | quality gate, host test-count delta in `verify_review` | yes |
| `trusted-author-id` | a server route trusts a body-supplied author id | security gate (model finding with `path:line`) | no |

```sh
cd apps/factory
FACTORY_RUN_INJECTED_DEFECT_EVAL=1 FACTORY_INJECTED_DEFECT_FIXTURE=deleted-test FACTORY_INJECTED_DEFECT_PR=<pr> pnpm exec eve eval injected-defect-review --url <cockpit-url> --strict
FACTORY_RUN_INJECTED_DEFECT_EVAL=1 FACTORY_INJECTED_DEFECT_FIXTURE=trusted-author-id FACTORY_GATE=security-gate FACTORY_INJECTED_DEFECT_PR=<pr> pnpm exec eve eval injected-defect-review --url <cockpit-url> --strict
```

Expected effect: both evals assert `changes_requested`. For `deleted-test` the blocking finding is host-written ("Candidate unit test count (n) is lower than the pristine base count (m)") before any model text. Try to approve anyway from the cockpit: there is no approve control; the host `record_review` throws on `approve` with any blocker.

Proof: `apps/factory/tests/gate-host-rules.test.ts` (test-count delta, secret scan, evidence downgrade, approve-with-blocker refusal, failure attribution) and the two evals above.

Recovery: if the eval reports `incomplete` instead of `changes_requested`, open the gate run from the project page and read the limitations; a missing base test total means the base check did not emit a summary line, which is an infrastructure gap to record in the friction log, not a factory bug to patch during the session.

## M2-add-a-standard · a host rule the model cannot argue with

Factory revision: `m1-break-the-gate` (same code as `m0-run`; the tag marks where participants start editing). Prototype: unchanged.

Task: add one required-evidence rule to `apps/factory/runtime/lib/review-policy.ts`, for example "every server route under `server/api/` has a unit test whose file name shares its base name", derived by the host from the changed-file inventory. Add its unit test in `apps/factory/tests/station-boundaries.test.ts`, then run:

```sh
pnpm test
pnpm typecheck
git commit -am "Add the route-has-test standard" && git push
```

Expected effect: `hostReviewLimitations` returns the new limitation for a PR that adds a route without a test; `record_review` refuses `approve` for it; the cockpit shows the limitation under the gate verdict. The rule is not in any prompt, so no wording change by the model can remove it.

Proof: the new unit test, plus `FACTORY_RUN_GATE_EVAL=1 FACTORY_GATE=quality-gate FACTORY_GATE_PR=<pr-without-test> pnpm exec eve eval gate-structured-output --url <cockpit-url> --strict` whose log line shows the limitation.

Recovery: if `pnpm test` fails on `agent-facing-text.test.ts`, a prompt was edited instead of the host rule; revert the prompt change. If the deployed cockpit does not show the new limitation, the deployment is still building or the participant is looking at the previous factory SHA shown in the sidebar.

## M3-bound-it · budgets and revisions stop the loop, not a person

Factory revision: `m2-add-a-standard`. Prototype: unchanged. A prepared brief that the migrator cannot satisfy in one pass (the facilitator's `[injected]` brief asking for a feature the prototype does not have).

```sh
# in the cockpit: admit the brief, start, and let the gates loop
# afterwards, read the receipts:
curl -s <cockpit-url>/factory/delivery/<id>/receipts | jq '.[] | {to, actor, reason, usd, inputTokens, outputTokens}'
```

Expected effect: after `maxRevisions` (3) blocking rounds the delivery stops in `human_review` with the reason "Maximum delivery revisions reached"; every receipt carries `model`, `inputTokens`, `outputTokens`, `usd` and `factorySha` when the provider reported them, and none writes zero for unknown spend; the per-session model limits in `factory-config.ts` (500k input tokens, 100k output tokens, 25 USD) cap any single station.

Proof: `apps/factory/tests/delivery-ledger.test.ts` (revision counting, receipt fields) and `model-usage.test.ts` (no zero for unknown usage); the receipts endpoint on the real run.

Recovery: if the loop keeps revising past three rounds, compare `request.maxRevisions` in the delivery JSON with the default; a brief admitted with a larger value is the cause. If receipts show no usage, the provider stream had no `model.call.completed` events: record it as a provider gap, do not invent the numbers.

## Out of scope in every milestone

Auto-merge of any class, scheduled runs, webhook triggers, a trace viewer, a different model vendor per station, self-modification of the factory. The cockpit lists them under "Not in this factory (v1)".
