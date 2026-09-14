---
name: security-review
description: Review a pull request for security defects in a Nuxt application that uses AWS DSQL, Vercel Passport and Vercel Connect. Use inside the security gate to check secrets in source, injection, authorization on server routes and MCP tools, SSRF and dependency advisories, and to write findings with path:line and evidence.
---

# Security review

Work through every section against the changed files. A finding is worth recording only when you can point at a line and say what an attacker would do with it. Write `path:line`, the observed code, and the consequence. A concern you could not trace to a line is a limitation, not a finding.

## Secrets in source

The host already scanned added lines for key, token, private-key and connection-string patterns. Confirm nothing slipped past: base64 blobs, `.env` contents pasted into tests, fixture users with real-looking credentials, URLs with embedded passwords. Any credential in the diff is blocking. Configuration belongs in runtime config read on the server.

## Injection

- SQL: every statement in the data module (`server/utils/*`) must use parameters (`$1`, tagged template, or the client's parameter array). String concatenation or template interpolation of request input into SQL is blocking, even for "internal" fields such as sort columns. Check identifiers built from input (table or column names) against an allowlist.
- Shell: any `exec`, `spawn` or `child_process` with input-derived arguments is blocking unless arguments are passed as an array and the command is fixed.
- HTML: `v-html` with server or user content, or `innerHTML` writes, are blocking unless the content is sanitized and the reason is documented.

## Authorization on server routes and MCP tools

- Identity comes only from the verified Vercel Passport header on the server (`x-vercel-oidc-passport-token`, parsed and validated). A route that reads a user id, email or role from the request body, query string or a client-supplied header is blocking.
- Every mutating route (`POST`, `PATCH`, `PUT`, `DELETE`) must check that the authenticated user may act on the resource; a row keyed by a body-supplied `userId` or `authorId` is the classic defect. Ownership must be derived server-side.
- Anything that calls the Jira MCP through Vercel Connect must call `getToken` inside a server route and never return or log the token. Tool arguments derived from user input must be validated with a schema before the call.
- Fixture mode must not weaken checks: a labelled fixture store still enforces the same authorization as the DSQL store.

## SSRF

Any server-side `fetch`, `$fetch` or `ofetch` whose URL, host or path derives from request input is blocking unless the destination is an allowlisted origin. Redirects should be disabled (`redirect: "error"`) for machine-to-machine calls.

## Dependency advisories

Call `audit_dependencies`. Report an advisory as a candidate finding only when this PR changed the lockfile; otherwise record it as a baseline limitation with the advisory id. Never modify the lockfile.

## Verdict

`changes_requested` when any blocking finding stands. `incomplete` when required evidence is missing and you could not obtain it. `approve` only when the checks passed independently, no blocking finding remains and every required host evidence item is present. The verdict applies to one head SHA and is not merge permission.
