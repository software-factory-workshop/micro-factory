# [injected] Issue edit appears saved but is lost on reload

This is an intentionally defective candidate fixture for reviewer evaluation.
It changes the Jira detail-edit flow so the UI fabricates a successful saved
issue locally and skips the canonical detail reload. The user sees a success
notice, but no PATCH reaches the issue persistence boundary; a later reload
therefore restores the old issue.

The candidate patch is in `candidate.patch`. The title is deliberately marked
`injected` so this fixture cannot be mistaken for a discovered product task or
verified repository behavior.
