# Reference run record · 14 September 2026

Status: **complete on attempt 4** (18:12–18:44 CEST, 14 September 2026): the loop went from admission to `ready` with both gates approving one head and no merge performed. Attempts 1 to 3 are kept below because each produced a factory change. This file records what exists, what was executed, and exactly what stopped the loop, so the next person can finish it without re-deriving anything. Nothing below claims a PR, a receipt or a cost that did not happen.

## What exists

| Item | Value |
| --- | --- |
| Factory repository | https://github.com/software-factory-workshop/micro-factory (`main`, see git log for the revision when you read this) |
| Prototype repository (input) | https://github.com/software-factory-workshop/adeo-todo-proto at `00e1891`. Hand-authored v0-shaped Next.js app (Neon, Passport, Connect to the Jira MCP, labelled fixtures). Not the deployment source of the `adeo-todo-proto` Vercel project: that source could not be downloaded from the agent session (friction log). |
| Target repository | https://github.com/software-factory-workshop/adeo-todo-nuxt at `ed34fe6`. Nuxt 4 shell on the vendored ADEO layer. Checks verified locally on 14 Sep: `pnpm typecheck`, `pnpm test` (2 tests), `pnpm test:e2e` (1 headless agent-browser spec against the built Nitro server), `pnpm build`. |
| Cockpit Vercel project | `demo-software-factory/adeo-micro-factory` (`prj_khvTAUUbqRnUKbMNaYanurEroc5v`), git-connected to the factory repository. Private Blob store `micro-factory-cockpit` (`store_TLmZEfwXWtcEmXjB`). Connectors attached: `pocket-id-passport` (Passport front door) and `github/jira-clone` (GitHub App). |
| Local verification of the factory | `pnpm typecheck` (Nuxt + agent tsconfig) clean; `pnpm test` 122/122; `pnpm build` builds the cockpit and the three Eve roots (`migrator`, `quality-gate`, `security-gate`). |

## What was executed

1. Unit tests: 122 passing, including the transition table, the gate sequence (quality gate → security gate → ready), the publication allowlist, digest binding in `verify_work`/`publish_work`, approve-with-blocker refusal, the fifteen Cedar policies including `start_task`, the test-count delta on the `deleted-test` fixture, the secret scan, and the agent-facing text check.
2. Build: `node scripts/build-eve.mjs` for the three roots and `nuxt build` for the cockpit, locally.
3. A preview deployment of `apps/factory` from the CLI (result appended below when known).

## What stopped the full loop

- **Root directory.** Set to `apps/factory` at 15:52 through `vercel api PATCH /v9/projects/<id>` (the MCP token lacked team scope; the CLI's own session worked). A CLI deployment from `apps/factory` (`dpl_EJ1pUqnsHc2WjR8eLwnKAFdUT4Nv`) ended `BLOCKED`; the first git deployment is recorded below when it exists.
- **Connector coverage.** Verified indirectly at 15:55 on 14 Sep: `gh api /orgs/software-factory-workshop/installations` lists the connector's GitHub App `jira-clone-adeo` (installation 161088937) with `repository_selection: all`, so `github/jira-clone` can read `adeo-todo-proto` and publish to `adeo-todo-nuxt`. The token itself was never read by the agent.
- **Fixture PRs.** The three `[injected]` fixtures are patches in the factory repository; the paid gate evals need a person to open them as PRs in `adeo-todo-nuxt`.

## Attempt 1 · delivery `7b0988cfa4a8838f4d6281e1cff03915eb0ad95a0effad5783edb825ee77b747`

Started 16:01 CEST from cockpit deployment `adeo-micro-factory-l3mp028lf` (factory SHA `00a164e`), brief `project-reference-20260914` admitted as a work order through the cockpit records API and `POST /factory/delivery` (HTTP 202, Cedar `start_task` allowed). The Blob store had to be connected to the project first (`POST /v1/storage/stores/<id>/connections`) and the cockpit redeployed: the first POST failed with "No blob credentials found".

| Time | Observation |
| --- | --- |
| 16:02 | `worker_starting → working`; migrator session `wrun_41M2G3JPFS0GSSJX7460E54TFY`; `prepare_work` prepared target `7c810af` (7 files), prototype `a62ab70` (18 files) and the pristine base; receipts carry `model: meta/muse-spark-1.3-contributor` and `factorySha`. |
| 16:02–16:06 | The migrator read the prototype file by file (14 `read_file` calls), the shell, the skills, then wrote `server/utils/identity.ts`, `server/utils/jira.ts`, `server/utils/todos.ts`, `server/api/jira.get.ts`, `server/api/todos/*` and the page. |
| 16:06 | Eve `input.requested` kind `session-limit`: 500,437 input tokens used of 500,000. `turn.completed`, `session.waiting`. The loop classified this as "Agent stopped without a trusted result" → `human_review`. Usage recorded so far: 37,818 in / 701 out / 0.00028571 USD for the last window only (the per-window overwrite, fixed in `5df6891`). |
| 16:11 | Continuation approved by hand (`POST /migrator/eve/v1/session/<id>` with the `continue` option). The migrator then passed `pnpm typecheck`, `pnpm test`, `pnpm build` and smoke-tested `/api/todos` and the SSR page in the sandbox. |
| 16:14 | `pnpm test:e2e` failed: "Chrome exited early (exit code: 127)"; Chromium's shared libraries are missing in the sandbox. The migrator started diagnosing and hit the limit again at 1,025,377 tokens. Left waiting. No PR was published; no gate ran. |

Factory changes made from this attempt, all in `5df6891` and target `b07e2ad`: usage accumulates across observation windows (`accumulateModelUsage`), the migrator gets a 2M input-token budget with the same 25 USD cap, and the target shell installs Chromium's libraries with `sudo dnf` before `agent-browser install`. Friction entries: `20260914161552-headless-chromium-cannot`, `20260914161553-eve-s-per`.

## Attempt 2 · delivery `b68d408eee89a83fc259604c6ccd7e34f274ba8871d32b635fac6d4c4cc08220`

Started 16:17 CEST from cockpit deployment `adeo-micro-factory-52f25wa96` (factory SHA `5df6891`), same brief, new operation id; target base `b07e2ad` (shell with Chromium libraries in postinstall).

| Time | Observation |
| --- | --- |
| 16:18–16:35 | Migrator session `wrun_41M2G4GCP90GG5MVP7CSNT9T3G`. Read the prototype and the shell, wrote the typed DSQL/fixture data module, identity and Jira modules, six routes, the page, four Vitest files (20 tests) and two e2e specs, ran typecheck, unit, e2e (5 specs, three stable runs after isolating browser sessions per spec) and build in the sandbox, then `verify_work` (digest `d46773c6…`) and `publish_work`. **Draft PR #1** https://github.com/software-factory-workshop/adeo-todo-nuxt/pull/1, branch `factory/work-361f4654ef1a12df23ecdee2`, head `2b6360b6`, 16 files. Accumulated usage at publication: 1,698,476 input tokens, 69,354 output tokens, 0.0487 USD (`meta/muse-spark-1.3-contributor`). |
| 16:35 | `review_starting → reviewing` (quality gate) with session `wrun_41M2G5GXGB0GSXTF14PWN5XXD0`. |
| 16:36–17:20 | The gate read the policy copy, every changed file and the tests, ran `verify_review`: typecheck, unit, e2e and build passed on head `2b6360b6`, all attributed `passed`. `record_review(approve)` was **refused by the host**: the pristine-base unit total was unparseable (Vitest colour codes), so the head-vs-base comparison was missing. The gate retried verification, hit its 500K input-token guardrail and recorded `incomplete` with the missing-evidence limitation. Correct behaviour of the host rule; wrong reason (a parsing gap, not a candidate defect). |
| 17:20–17:45 | The delivery never left `reviewing`: the observation cursor (351, from the migrator stream) was reused for the gate stream (187 events), so every advance observed nothing while the driver kept claiming (version reached 1099). Cancelled by hand at 17:45. No gate verdict reached the ledger; no merge was performed. |

Factory changes from this attempt: `3eee09e` (strip ANSI from test totals, run checks with `CI=1 NO_COLOR=1 FORCE_COLOR=0`) and the cursor fix (`resetObservation` on station change plus self-heal of a foreign cursor). Friction entries: `20260914174152-vitest-colours-its`, plus the two earlier ones.

## Attempt 3 · delivery `4d1294bb5a6fc1158252cc27cca55e3e1d2c2571040e126fed94ea857ccc86d1`

Started 17:47 CEST from cockpit deployment `adeo-micro-factory-7ggdb6al5` (factory SHA `3681b12`, cursor fix and NO_COLOR checks in place). Migrator session `wrun_41M2G9MP8M0GKPZW7PB9STZJZB`.

| Time | Observation |
| --- | --- |
| 17:48–18:05 | Wrote `shared/types.ts`, identity, Jira and DSQL/fixture modules, six routes, the page, four test files and the e2e specs; found that Nuxt auto-imports are absent in plain Vitest and fixed it inside the allowlist (explicit `h3` type imports, a config resolver); typecheck, 12 unit tests (base 2) and build passed; started proving the browser flow by hand before the e2e run. |
| 18:06 | Eve `input.requested` kind `session-limit` at 2,011,137 of 2,000,000 input tokens. Spend so far: 0.0316 USD. The loop moved to `human_review` ("stopped without a trusted result"). No PR published. |

Factory change from this attempt: a session-limit pause is now an owner question in the cockpit (`Waiting → Approve a fresh token budget / Stop here`), answered through Eve's input response on the same session so the station continues in `working`, `revising` or `reviewing`; guardrails raised to 6M input tokens for the migrator and 2M for the gates under the unchanged 25 USD cap. The cost cap is the hard limit; the token guardrail is an interruption a person decides on.

## Attempt 4 · delivery `798479e80bfcc054d5dcf9a2acc432f6c2ce15369fdbcf56aa80a19af056685b` · complete

Cockpit deployment `adeo-micro-factory-gqg95vqf7`, factory SHA `1fb3a4fe97d4624fa730f7517a0c3b9b5e90dbee`, prototype `a62ab70`, target base `b07e2ad`. Same admitted brief `project-reference-20260914`.

| Field | Value |
| --- | --- |
| Date | 14 September 2026, 18:12–18:44 CEST |
| Factory SHA | `1fb3a4f` (tagged `m0-run`) |
| Prototype revision | `a62ab70864cd24398144b1f2fdb4f663df3d8459` |
| Delivery id | `798479e80bfcc054d5dcf9a2acc432f6c2ce15369fdbcf56aa80a19af056685b` |
| Draft PR | https://github.com/software-factory-workshop/adeo-todo-nuxt/pull/2, branch `factory/work-c0de1bcba6cea48add5b55e3`, head `7bf1e99fb3a37ca9984b31ba031f25968abb12da`, 22 files, migrator session `wrun_41M2GB2T190GV97CAHATMKQQMW` |
| Gate verdicts (head `7bf1e99f`) | quality-gate `approve`, 2 nonblocking findings (`tests/routes.test.ts:6`, `app/components/TodoList.vue:17`), no limitations, verification prepared/checks passed/head unchanged, unit tests 19 on head vs 2 on base. security-gate `approve`, no findings, no limitations: parameterised DSQL statements, identity from the verified Passport header, server-only Connect token, no input-derived fetch target, dependency audit clean. |
| Merge decision | `manual`: "Verdict applies to head 7bf1e99f…; no merge was performed. Merge is manual in v1 for every change class." |
| Receipts | 7 (`worker_starting`, `working`, `review_starting`, `reviewing`, `review_starting`, `reviewing`, `ready`). Accumulated usage on the `ready` receipt: `meta/muse-spark-1.3-contributor`, 2,793,735 input tokens, 120,779 output tokens, 0.0825 USD, `factorySha 1fb3a4f`. The first two receipts carry no usage because no model call had completed yet; nothing was written as zero. |
| Timeline | 18:12 working · 18:36 publication recorded, quality gate starts · 18:40 quality gate approves, security gate starts · 18:44 ready |
| Human interventions | None inside the run. Between attempts: approved one Eve continuation by hand (attempt 1), connected the Blob store, set the root directory, rewrote commit authorship, cancelled attempt 2. |
| What a human still judges | Whether PR #2 is a faithful migration of the prototype (the gates judged code quality and security, not product fidelity), whether the DSQL path works against a real cluster (no credentials in the sandbox), and whether the Jira MCP path works once the connector exists. Merge remains a person's decision. |

## Command sheet to repeat the reference run

```sh
# Cockpit: https://adeo-micro-factory.vercel.app (Passport). Projects -> Admit as work order -> Start migration.
# Or from the CLI with the project's development OIDC token (vercel env pull in apps/factory first):
cd apps/factory && set -a && source .env.local && set +a
vercel curl /factory/cockpit/records/drafts/<draft-id> --deployment <url> -X PUT -H "authorization: Bearer $VERCEL_OIDC_TOKEN" -H "content-type: application/json" --data @draft.json
vercel curl /factory/delivery --deployment <url> -X POST -H "authorization: Bearer $VERCEL_OIDC_TOKEN" -H "content-type: application/json" --data '{"operationId":"<uuid>","draftId":"<draft-id>","title":"...","brief":"..."}'
vercel curl /factory/delivery/<id> --deployment <url> -H "authorization: Bearer $VERCEL_OIDC_TOKEN"
vercel curl /factory/delivery/<id>/receipts --deployment <url> -H "authorization: Bearer $VERCEL_OIDC_TOKEN"
```
