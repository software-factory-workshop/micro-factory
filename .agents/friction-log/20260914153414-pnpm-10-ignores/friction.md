---
title: 'pnpm 10 ignores agent-browser postinstall until approve-builds, so e2e has no browser'
severity: 'minor'
---

## Expected Behavior
pnpm install gives agent-browser its Chromium so pnpm test:e2e runs headless in the sandbox.

## Current Behavior
pnpm 10.33 skipped the postinstall (Ignored build scripts), so the e2e run would fail as infrastructure.

## Possible Solution
List agent-browser, esbuild and vue-demi under onlyBuiltDependencies in pnpm-workspace.yaml (done).

## Minimal Reproducible Example
Remove pnpm-workspace.yaml from adeo-todo-nuxt and run pnpm install then pnpm test:e2e.

## Context
Hit while building the ADEO micro-factory on 14 September 2026 for the 15 September workshop.
