---
title: 'Private GitHub Packages layer cannot install inside the credential-free sandbox'
severity: 'major'
---

## Expected Behavior
pnpm install --frozen-lockfile in /workspace/repo installs @software-factory-workshop/nuxt-adeo-ds without a token.

## Current Behavior
The layer lives on GitHub Packages and needs NODE_AUTH_TOKEN; the sandbox holds no credentials by design, so the install would fail.

## Possible Solution
Vendor the tarball (done in adeo-todo-nuxt/vendor with a file: dependency, copied from the Jira factory), or publish the layer where the sandbox egress allowlist can read it anonymously.

## Minimal Reproducible Example
In a fresh checkout of adeo-todo-nuxt with the registry dependency instead of the file: dependency, run pnpm install --frozen-lockfile with no NODE_AUTH_TOKEN.

## Context
Hit while building the ADEO micro-factory on 14 September 2026 for the 15 September workshop.
