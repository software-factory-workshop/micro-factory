---
title: 'Eve''s per-session input-token guardrail stops a long migration mid-turn and the loop records it as a stop without result'
severity: 'major'
---

## Expected Behavior
A migration that legitimately needs more than 500K input tokens either has the budget or the cockpit shows a budget-approval decision.

## Current Behavior
The migrator hit the 500K input-token limit at step 18 (reading the prototype file by file re-sends the whole transcript each step). Eve emitted input.requested (session-limit) and session.waiting; the delivery loop read turn.completed as 'Agent stopped without a trusted result' and moved to human_review. Approving the continuation by hand let the session continue to typecheck, unit, build and API smoke; it then hit the limit again at 1,025,377 tokens.

## Possible Solution
Done: migratorModelLimits raises the migrator input budget to 2M tokens with the same 25 USD cost cap. Open: the loop should classify a session-limit input request as an attention kind (Waiting -> Approve budget) instead of a stop without result, and the migrator instructions should prefer one bash listing over per-file reads for the prototype.

## Minimal Reproducible Example
Start the reference brief on factory revision 00a164e and watch the migrator session events for input.requested with kind session-limit.

## Context
Reference run of the ADEO micro-factory, 14 September 2026.
