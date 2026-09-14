# Micro-factory evals

Run from `apps/factory` against the deployed factory root URL:

```sh
pnpm exec eve eval --url <factory-root-url> --list --json
```

All three evals are opt-in because they spend model calls and perform real station work:

```sh
FACTORY_RUN_MIGRATOR_EVAL=1 pnpm exec eve eval migrator-tool-order --url <factory-root-url> --strict

FACTORY_RUN_GATE_EVAL=1 FACTORY_GATE=quality-gate FACTORY_GATE_PR=<open-pr> \
  pnpm exec eve eval gate-structured-output --url <factory-root-url> --strict

FACTORY_RUN_INJECTED_DEFECT_EVAL=1 FACTORY_INJECTED_DEFECT_PR=<open-pr-with-fixture> \
  FACTORY_INJECTED_DEFECT_FIXTURE=non-persisting-save \
  pnpm exec eve eval injected-defect-review --url <factory-root-url> --strict
```

Fixtures under `tests/fixtures/defects/` are labelled `[injected]` and are real diffs against the `reference-migration` branch of `adeo-todo-nuxt` (the reference migration; `main` stays the bare shell for M0): `trusted-author-id` (security gate, PR #3), `deleted-test` (caught deterministically by the test-count delta in `verify_review`, PR #4, see `tests/gate-host-rules.test.ts`) and `non-persisting-save` (quality gate, PR #5). The PRs stay open as drafts on branches `injected/*`; recreate one with `git checkout -b injected/<name> reference-migration && git apply tests/fixtures/defects/<name>/candidate.patch` and `gh pr create --draft --base reference-migration` if it was closed. Results of the 14 Sep runs: `factory/evidence/2026-09-14-evals.md`.

## Reaching the deployed factory from a laptop

The cockpit project is Passport-protected and the station routes require a Vercel OIDC bearer, and `eve eval` has no header option. Run a local proxy that injects both and point `--url` at it:

```sh
vercel env pull .env.local --environment production          # VERCEL_OIDC_TOKEN (expires, re-pull)
# add VERCEL_PROTECTION_BYPASS=<project protection bypass secret> to .env.local
set -a && source .env.local && set +a
node scripts/eval-proxy.mjs &                                 # 127.0.0.1:4299 -> adeo-micro-factory.vercel.app
FACTORY_RUN_GATE_EVAL=1 FACTORY_GATE=quality-gate FACTORY_GATE_PR=4 pnpm exec eve eval gate-structured-output --url http://127.0.0.1:4299 --strict --verbose
```

The proxy also rewrites `/eve/v1/info` so the root answers with this package's name; `eve eval` refuses a remote whose agent name differs.

Every eval logs what a human still judges. Passing the shape or order check is not evidence that the migration is faithful.
