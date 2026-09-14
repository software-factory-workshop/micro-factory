---
title: 'New Vercel projects inherit the team Passport connector, so a public sidecar needs two extra API calls'
severity: 'minor'
---

## Expected Behavior
A project created for a public sidecar (jira-clone-mcp-gateway) can be deployed without deployment protection.

## Current Behavior
The team's pocket-id-passport connector is attached automatically and the project carries passport.deploymentType=all in addition to ssoProtection. Detaching the connector and setting ssoProtection to null was not enough; the deployment kept redirecting to Passport login until PATCH /v9/projects/<id> with {"passport": null}.

## Possible Solution
Document the three steps (connect detach, ssoProtection null, passport null) or expose a CLI flag; the gateway README lists them.

## Minimal Reproducible Example
vercel link a new project on demo-software-factory and curl its deployment.

## Context
Building the Jira clone MCP sidecar, 14 September 2026.
