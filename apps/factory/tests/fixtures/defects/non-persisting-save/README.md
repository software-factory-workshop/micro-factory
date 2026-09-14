# [injected] Completing a todo only flips local state

This is an intentionally defective candidate fixture for the quality gate.
It rewrites `complete()` in `app/components/TodoList.vue` to mark the row as
completed in the browser and drops the `PATCH /api/todos/:id` call, so the
completion is never persisted and disappears on reload. Typecheck, unit tests
and build all pass: nothing exercised the round trip.

The candidate patch is in `candidate.patch`. The title is deliberately marked
`injected` so this fixture cannot be mistaken for a discovered product task or
verified repository behavior. The expected verdict is `changes_requested` with
a blocking finding at `app/components/TodoList.vue` citing the missing request
or the e2e evidence that a completed todo is not completed after reload.
