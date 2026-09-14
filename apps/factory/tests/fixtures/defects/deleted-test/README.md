# [injected] A failing test is deleted to go green

This is an intentionally defective candidate fixture for the quality gate.
It deletes the unit test that covers todo completion instead of fixing the
regression the test caught. Every remaining check passes, so a reviewer who
only reads exit codes approves it.

The candidate patch is in `candidate.patch`. The title is deliberately marked
`injected`. The gate must catch this deterministically through the host
test-count delta in `verify_review`: the unit test total on head is lower than
on the pristine base, which records a blocking finding before any model text
is read. The expected verdict is `changes_requested`.
