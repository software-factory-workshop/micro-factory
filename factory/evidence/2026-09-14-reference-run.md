# Reference run record · 14 September 2026

Status: **first attempt executed, stopped before publication; second attempt recorded below.** This file records what exists, what was executed, and exactly what stopped the loop, so the next person can finish it without re-deriving anything. Nothing below claims a PR, a receipt or a cost that did not happen.

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

## Command sheet to finish the reference run

```sh
# 1. Set Root Directory = apps/factory on adeo-micro-factory in the Vercel dashboard, then:
cd micro-factory && git push origin main            # triggers a git deployment
# 2. Confirm GitHub App access to adeo-todo-proto and adeo-todo-nuxt (or create a new connector from apps/factory and update githubConnectorName)
# 3. In the cockpit: Projects -> Admit as work order -> Start migration
# 4. Record: delivery id, PR URL, receipts (GET /factory/delivery/<id>/receipts), usd/inputTokens/outputTokens, factorySha
# 5. Tag the revision: git tag m0-run && git push --tags
```

Fill the table below when the run completes.

| Field | Value |
| --- | --- |
| Date | |
| Factory SHA | |
| Prototype revision | |
| Delivery id | |
| Draft PR | |
| Gate verdicts (head SHA) | |
| Receipts (count, usd, tokens) | |
| Human interventions | |
