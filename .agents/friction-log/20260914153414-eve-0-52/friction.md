---
title: 'Eve 0.52.5 rejects the Vercel plugin skills nested metadata.priority frontmatter'
severity: 'minor'
---

## Expected Behavior
Skills copied verbatim from software-factory-workshop/skills build in an Eve root.

## Current Behavior
eve build fails discovery: Expected metadata.priority frontmatter to be a string, for vercel-connect, nuxt, vue, typescript-best-practices and thermo-nuclear-code-quality-review.

## Possible Solution
Ship an Eve-compatible flat metadata map in the shared skills repository, or document the flatten step. The micro-factory reuses the Jira factory's flattened copies.

## Minimal Reproducible Example
Copy skills/vercel-connect from software-factory-workshop/skills into agents/migrator/agent/skills and run node scripts/build-eve.mjs migrator.

## Context
Hit while building the ADEO micro-factory on 14 September 2026 for the 15 September workshop.
