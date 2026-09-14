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

Fixtures under `tests/fixtures/defects/` are labelled `[injected]`: `non-persisting-save` (copied from the Jira factory), `trusted-author-id` (security gate) and `deleted-test` (caught deterministically by the test-count delta in `verify_review`, see `tests/gate-host-rules.test.ts`). To run the injected-defect eval, a person opens a PR in the target repository from `candidate.patch` and passes its number.

Every eval logs what a human still judges. Passing the shape or order check is not evidence that the migration is faithful.
