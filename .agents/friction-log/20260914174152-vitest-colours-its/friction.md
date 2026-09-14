---
title: 'Vitest colours its summary in the sandbox so the host test-count parser saw no total'
severity: 'major'
---

## Expected Behavior
verify_review parses the unit test totals on base and head and compares them.

## Current Behavior
In reference run b68d408e the quality gate could not approve: 'Pristine base unit tests did not emit a parseable total'. Vitest 5 wrote ANSI colour codes around ' Tests 2 passed (2)' even though stdout was not a TTY, and the regex matched nothing. The gate recorded incomplete for a candidate whose checks all passed.

## Possible Solution
Done in 3eee09e: strip ANSI before matching and export CI=1 NO_COLOR=1 FORCE_COLOR=0 in every check command. A machine-readable reporter (vitest --reporter=json) would be more robust than parsing the human summary.

## Minimal Reproducible Example
Run vitest 5 inside a Vercel sandbox via sandbox.run and inspect stdout for escape codes.

## Context
Reference run of the ADEO micro-factory, 14 September 2026.
