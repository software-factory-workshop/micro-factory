# ADEO micro-factory

One v0 prototype in, one verified Nuxt 4 draft pull request out. Built with Eve on the host mechanisms of the [Jira factory](https://github.com/software-factory-workshop/jira-clone) (`apps/factory`): the same durable delivery loop, receipt-first Blob ledger, station identity, Cedar authority and GitHub publication path, copied rather than redesigned.

| Repository | Role |
| --- | --- |
| `software-factory-workshop/adeo-todo-proto` | Input. A v0-shaped Next.js app: Neon via `@neondatabase/serverless`, Vercel Passport identity, Vercel Connect to the Jira clone MCP, labelled fixtures. Read-only for the factory. |
| `software-factory-workshop/adeo-todo-nuxt` | Target. A Nuxt 4 shell on the ADEO layer with Vitest, headless e2e through `agent-browser`, and AWS DSQL dependencies. The migrator publishes draft PRs on `factory/work-<hash>` branches. |
| this repository | The factory: cockpit, three Eve roots, workflow, policies, tests, evals and evidence. |

## Stations

Three independent Eve root agents, called by one deterministic Vercel Workflow (`apps/factory/server/workflows/delivery.ts`). No model dispatches another agent.

| Station | Tools | Skills | Output |
| --- | --- | --- | --- |
| `migrator` | `prepare_work`, `bash`, `read_file`, `glob`, `grep`, `verify_work`, `publish_work`, `ask_owner`, `refresh_target` | `adeo-nuxt-ui`, `nuxt`, `vue`, `typescript-best-practices`, `vercel-connect`, `vercel-passport` | One draft PR. `publish_work` refuses if the changed-file digest moved since `verify_work` or verification did not pass. |
| `quality-gate` | `prepare_review`, `bash`, `read_file`, `glob`, `grep`, `verify_review`, `record_review` | `thermo-nuclear-code-quality-review` | One verdict bound to the exact head: `verdict`, `summary`, `findings[{severity,path,line?,message,evidence}]`, `limitations`. `approve` with any blocker throws. |
| `security-gate` | same plus `audit_dependencies` (read-only) | `security-review` | Same schema, same host rule. A blocking finding without `path:line` and evidence is recorded nonblocking. |

Station identity is request auth (`runtime/lib/station-access.ts`); every station tool is mounted on its own root and `audit_dependencies` exists only for the security gate through `defineDynamic`.

## Host rules that do not depend on a model

- `verify_work` and `verify_review` run `pnpm typecheck`, `pnpm test`, `pnpm test:e2e`, `pnpm build` plus one named check on the pristine base; failures are attributed as candidate, baseline or infrastructure from the two runs.
- Required review evidence is derived from the changed files: e2e passed on head, unit test count on head at least the base count, no secret pattern in the diff (`runtime/lib/review-policy.ts`).
- Cedar guards `start_task` (needs a `work_order` admission), `run_check`, `record_verification`, `record_review`, `publish_change`, `merge_change` (`factory/policies/cedar`).
- Merge is `manual` for every change class in v1 and every decision carries a reason naming the head SHA (`runtime/lib/merge-policy.ts`).
- Publication goes through the allowlist in `runtime/lib/work-github.ts`: `app/`, `server/`, `shared/`, `types/`, `tests/`, `e2e/`, `app.config.ts`; 30 files, 500 KB per file, 2 MB total.
- Every receipt carries `model`, `inputTokens`, `outputTokens`, `usd`, `factorySha` when the provider reported them; unknown spend is never written as zero.

## Run locally

Requires Node 24.11+ and pnpm 10.33.4.

```sh
pnpm install --frozen-lockfile
pnpm typecheck
pnpm test
pnpm build
```

Cockpit: `pnpm dev` then `pnpm --filter @micro-factory/factory dev:migrator`, `dev:quality-gate`, `dev:security-gate` in three terminals. The cockpit proxies `/migrator/**`, `/quality-gate/**`, `/security-gate/**`, `/factory/**` and `/eve/v1/**` to those ports in development; `apps/factory/vercel.json` declares the same routing for production.

Evals: see `apps/factory/evals/README.md`. All three are paid and opt-in.

## Deployment prerequisites

The cockpit needs a Vercel project with a private Blob store attached, project OIDC for the AI Gateway, Vercel Sandbox, and the GitHub App connector named in `runtime/lib/factory-config.ts` (`github/jira-clone`, the existing workshop installation) with repository access to both `adeo-todo-proto` and `adeo-todo-nuxt`. The sandbox holds no credentials; every `getToken()` call sits inside a host tool.

## Workshop

- `workshop/micro-factory-milestones.md`: M0 to M3 checkpoints with command sheets and recovery steps.
- `factory/evidence/`: dated run records, experiment records and the friction log summary. Excluded from agent snapshots.
- `factory/CONTRACT.md`: the rules every station may read.

## Not in v1

Auto-merge of any class, scheduled runs, webhook triggers, a trace viewer, a different model vendor per station, self-modification of the factory. The cockpit names each as missing.
