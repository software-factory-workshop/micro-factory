---
title: 'The Jira clone MCP endpoint is unauthenticated behind Passport and its reads ignore bearer tokens'
severity: 'major'
---

## Expected Behavior
A public sidecar can validate a clone-issued OAuth access token before forwarding an MCP request.

## Current Behavior
/mcp has no bearer gate (deployment protection was the only barrier) and the REST read routes such as GET /api/rest/api/3/myself ignore a present Authorization header; only the four write routes call restBearerIdentity. The sidecar therefore cannot tell a valid token from a random string on reads.

## Possible Solution
Make myself (or a dedicated introspection route) validate a present bearer with restBearerIdentity and answer 401 for unknown tokens; optionally gate /mcp itself. Small server route change publishable through the Jira factory worker.

## Minimal Reproducible Example
curl -H 'Authorization: Bearer nonsense' https://adeo-jira-clone.vercel.app/api/rest/api/3/myself through a trusted source and observe 200.

## Context
Building the Jira clone MCP sidecar, 14 September 2026.
