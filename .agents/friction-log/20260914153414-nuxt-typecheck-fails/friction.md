---
title: 'Nuxt typecheck fails when tsconfig.json adds an include list on top of the generated config'
severity: 'minor'
---

## Expected Behavior
Extending ./.nuxt/tsconfig.json and adding include for tests/ and e2e/ typechecks.

## Current Behavior
vue-tsc 3.3.11 fails with Cannot find module vue-router/volar/sfc-route-blocks.

## Possible Solution
Keep tsconfig.json as { extends: ./.nuxt/tsconfig.json } (done); Vitest type-checks its own specs and e2e specs are plain .mjs.

## Minimal Reproducible Example
In adeo-todo-nuxt set tsconfig.json to extend the generated config plus an include array, then run pnpm typecheck.

## Context
Hit while building the ADEO micro-factory on 14 September 2026 for the 15 September workshop.
