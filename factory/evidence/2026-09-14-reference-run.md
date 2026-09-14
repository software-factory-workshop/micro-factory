# Reference run record · 14 September 2026

Status: **not run end to end**. This file records what exists, what was executed, and exactly what stopped the full loop, so the next person can finish it without re-deriving anything. Nothing below claims a PR, a receipt or a cost that did not happen.

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
