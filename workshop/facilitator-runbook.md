# Facilitator runbook · 15 September 2026

Everything a facilitator needs on the day, in the order it is needed. Dates and identifiers are the real ones as of the night before.

## URLs

| What | URL | Auth |
| --- | --- | --- |
| Micro-factory cockpit | https://adeo-micro-factory.vercel.app | Vercel Passport (Pocket ID) |
| Jira factory cockpit | https://adeo-factory-cockpit.vercel.app | Vercel Passport |
| Jira clone | https://adeo-jira-clone.vercel.app | Vercel Passport; MCP via the gateway below |
| Jira MCP gateway (public sidecar) | https://jira-clone-mcp-gateway.vercel.app/mcp | OAuth bearer from the clone |
| Connect + MCP CRUD demo | https://jira-connect-demo.vercel.app | Vercel Passport |
| Pocket ID (identity provider) | https://pocket-id-software-factory.vercel.app | passkey; instructor console at `/workshop` |
| Input for the room: v0 kanban prototype | https://github.com/software-factory-workshop/adeo-kanban-proto | GitHub |
| Shell template (targets are generated from it) | https://github.com/software-factory-workshop/adeo-nuxt-shell | GitHub |
| Generated target for the kanban | https://github.com/software-factory-workshop/adeo-kanban-nuxt · production https://adeo-kanban-nuxt.vercel.app | GitHub / Vercel Passport |
| Reference target (14 Sep runs, PR #11 etc.) | https://github.com/software-factory-workshop/adeo-todo-nuxt · https://adeo-todo-nuxt.vercel.app | GitHub / Vercel Passport |

## Models (AI Gateway ids, chosen 15 Sep for speed)

| Station | Model |
| --- | --- |
| micro-factory migrator, quality gate | `openai/gpt-5.6-sol-fast` |
| micro-factory security gate | `zai/glm-5.3-flash` (different vendor on purpose) |
| Jira factory task miner / worker / reviewer | `openai/gpt-5.6-sol-fast` / `openai/gpt-5.6-sol-fast` / `zai/glm-5.3-flash` (Luna Fast skipped tool arguments in the mining evals) |

Measured the night before: full M0 migration about 5 minutes (was 32 with Muse); each gate 2 to 3 minutes. Opus 5 is not enabled on this team's gateway; do not switch to it live.

## Before the room fills (15 minutes)

1. Laptop: `cd micro-factory/apps/factory && vercel env pull .env.local --environment production` (refreshes `VERCEL_OIDC_TOKEN`, it expires). Make sure `.env.local` still has `VERCEL_PROTECTION_BYPASS` (project protection bypass secret; find it under Deployment Protection if missing).
2. `set -a && source .env.local && set +a && node scripts/eval-proxy.mjs &` then `curl -s http://127.0.0.1:4299/eve/v1/info | jq .agent.name` must print `@micro-factory/factory`.
3. Open the cockpit in a browser you are signed into; confirm the Recent page lists the reference deliveries.
4. `gh pr list -R software-factory-workshop/adeo-todo-nuxt` must show the three `[injected]` drafts (#3, #4, #5) based on `reference-migration`. `main` must be the bare shell (`git log -1 origin/main` → "Install Chromium shared libraries…", `b07e2ad`). If a participant merged something into `main`, reset: `git push --force-with-lease origin b07e2ad:main`.
5. Pocket ID: put the signup QR on the slide (`/workshop` console → QR). Attendees are placed in group `workshop`; Passport sends no groups, so the Jira clone gives every attendee the deployment default role `member` (`JIRA_PASSPORT_DEFAULT_ROLE`). Named roles come from `JIRA_PASSPORT_ROLE_MAP` (persona emails and the instructor as admin).

## Personas (for the role demo)

Users `persona-admin`, `persona-member`, `persona-viewer` exist in Pocket ID with emails `persona-<role>@workshop.invalid` and a `role` custom claim (`admin`/`member`/`viewer`). The Passport connector `pocket-id-passport` forwards the `cost_center` and `role` id-token claims (same mechanism as `cost_center`); the Jira clone honours an explicit `role` claim first, then the email map, then the default `member`. Do not forward `groups`: attendees only carry the `workshop` group, which the clone treats as unrecognised and rejects. To sign in as one on a clean browser profile, mint a one-time code and open the code URL from the Passport interaction page:

```sh
# POCKET_ID_KEY = Pocket ID API key
curl -s -X POST -H "X-API-KEY: $POCKET_ID_KEY" -H 'content-type: application/json' \
  -d '{"ttl":"12h"}' https://pocket-id-software-factory.vercel.app/api/users/<user-id>/one-time-access-token
# then: https://pocket-id-software-factory.vercel.app/login/alternative/code?code=<token>&redirect=<the /interaction?... path Passport sent you to>
```

Codes minted with `expiresAt` are 6 characters and cannot be typed on the code page; always use `ttl`. User ids: `GET /api/users?search=persona`.

## What the factory does now (changed the morning of 15 Sep)

1. **Input**: a v0 project's GitHub URL, pasted on the cockpit's Projects page (default: the kanban prototype). The cockpit derives the target name: `adeo-kanban-proto` → `adeo-kanban-nuxt`.
2. **Bootstrap** (host, before any station): generates the target repository from the `adeo-nuxt-shell` template if it does not exist, creates the git-linked Vercel project behind the same Passport connector as the cockpit, and pushes an empty commit so `main` (the bare shell) is deployed to production. Idempotent: reruns reuse everything. An open `dev` PR on the target blocks a second delivery for the same prototype (merge or close it first).
3. **One PR on `dev` → `main`**, not a draft. Its Vercel preview is the review surface; the cockpit shows **Open preview** once Vercel reports it. Gates review the exact head; blocking findings go back to the same owner on the same branch.
4. **Approve and merge**: when both gates approve, the cockpit shows **Approve and merge** (a reason is required, recorded on the receipt). The host squash-merges into `main` under Cedar `merge_change` and Vercel deploys production. Nothing merges without a person.

Bootstrap credentials (`GITHUB_BOOTSTRAP_TOKEN`, `FACTORY_VERCEL_TOKEN`) live only on the cockpit project; stations never see them. They are Rémi's personal tokens for now: rotate after the workshop.

## The migrated app is DEPLOYED

Every generated target is a git-linked Vercel project: `main` is production (the shell until the merge), the `dev` PR gets a preview deployment behind Passport, and after **Approve and merge** production is the migrated app. The loop records the preview on the publication (read from the GitHub deployment status Vercel posts for the exact head) and the cockpit shows **Open preview** next to **Open PR** once it is live. For the reference target `adeo-todo-nuxt` the same holds for the 14 Sep PRs.

What is live in the preview and what is not:

- Identity: live (Vercel Passport, verified subject).
- Jira issues: live through the Jira clone MCP with a per-user Connect consent (the "Authorise with the Jira clone" button), after the revision requested on PR #11 the night before. Before that revision the section showed labelled fixture issues because the candidate asked Connect for an app-subject token.
- Persistence: `fixture` (labelled) until Aurora DSQL is installed on the project. The AWS Marketplace integration offers it: accept the Marketplace terms once at https://vercel.com/demo-software-factory/~/integrations/accept-terms/aws then run `vercel integration add aws/aws-dsql -n adeo-todo-dsql` from `adeo-todo-nuxt`; the app selects DSQL when `DSQL_CLUSTER_ENDPOINT` (plus region/database/user) is present, so map the integration's variable names to those four if they differ, and redeploy.

## M0 in the room

Cockpit → Projects → the kanban prototype URL is prefilled, the brief follows → Admit as work order → Start migration. The start takes a few seconds longer than before (bootstrap of the target) the first time a prototype is used. About 5 minutes to the `dev` PR, then 2 to 3 minutes per gate, then **Open preview** and **Approve and merge**. Kanban reference: delivery `ad682574…` in Recent work (started 13:54, merged 14:59 the day of the workshop; PR #3 on `adeo-kanban-nuxt`, production is the merged app). Expect the security gate to request changes on the Passport header trust: that is the human decision point, use **Approve and merge anyway** with a reason. The reference artefacts if a run misbehaves: PR #11 (full cockpit loop on the workshop models, both gates approve, delivery `284abcac…` in the cockpit's Recent list), plus PR #6 and #8 from the eval-only runs; all drafts on `main`.

Run the eval version in a terminal while people watch:

```sh
FACTORY_RUN_MIGRATOR_EVAL=1 pnpm exec eve eval migrator-tool-order --url http://127.0.0.1:4299 --strict --verbose
```

## M1 in the room

```sh
FACTORY_RUN_GATE_EVAL=1 FACTORY_GATE=quality-gate FACTORY_GATE_PR=4 pnpm exec eve eval gate-structured-output --url http://127.0.0.1:4299 --strict --verbose
FACTORY_RUN_GATE_EVAL=1 FACTORY_GATE=security-gate FACTORY_GATE_PR=3 pnpm exec eve eval gate-structured-output --url http://127.0.0.1:4299 --strict --verbose
FACTORY_RUN_INJECTED_DEFECT_EVAL=1 FACTORY_INJECTED_DEFECT_PR=5 FACTORY_INJECTED_DEFECT_FIXTURE=non-persisting-save pnpm exec eve eval injected-defect-review --url http://127.0.0.1:4299 --strict --verbose
```

Expected: `changes_requested` each time; #4 blocked by the host test-count delta (18 < 19) before any model text. Findings recorded in the night-before runs: `tests/todos.test.ts:14`, `server/api/todos/index.post.ts:13`, `app/components/TodoList.vue:39`.

## The shared GitHub budget

Both factories, and any other agent using the `github/jira-clone` connector, share one GitHub App installation with a 5000 requests/hour budget. It ran out during the night before the workshop (error text: `API rate limit exceeded for installation ID 161088937 … resets <time>`), which surfaced as `prepare_work`/`prepare_review` HTTP 403 and deliveries stopping in `human_review`. Two fixes shipped: snapshots now cost one archive request per revision instead of one call per file (a run went from ~300 calls to ~20), and a gate that stops before recording a review is restarted automatically. If the error reappears, the message names the reset time; nothing else is wrong. Rémi's overnight Codex session (goal: 50 Jira PRs merged through the Jira factory cockpit) shares this budget and admits a work order every 10 to 30 seconds. Stop it before the micro-factory practical starts, or the room competes with it for GitHub calls.

## Known wobbles and what to say

- `prepare_review` can fail on a GitHub hiccup (`fetch failed`, or `HTTP 403` seen once on the night). The gate records no verdict. In the cockpit loop the gate is restarted automatically, up to twice ("Restarting quality-gate (retry 1 of 2)" in the timeline); in a standalone eval, rerun it. This is the "infrastructure, not candidate" attribution in action.
- Vercel closes idle function streams after about 20 seconds; the eval proxy reconnects with `startIndex`. If an eval says `terminated`, the proxy died: restart it.
- The Vercel toolbar on the Connect demo intercepts clicks during automation; humans are unaffected.
- The deleted or unknown issue key on the Connect demo shows as 502, not 404. Cosmetic.
