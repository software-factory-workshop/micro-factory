---
title: 'Headless Chromium cannot launch in the Vercel sandbox without its shared libraries'
severity: 'major'
---

## Expected Behavior
pnpm test:e2e (agent-browser, Playwright Chromium) runs headless inside the factory sandbox after pnpm install.

## Current Behavior
In reference run 7b0988cf the migrator's e2e step failed with 'Chrome exited early (exit code: 127) without writing DevToolsActivePort': the Amazon Linux sandbox lacks glib2, nss, atk, gtk3, mesa-libgbm and the rest of Chromium's shared libraries. Typecheck, unit tests, build and an API smoke test had passed.

## Possible Solution
The target shell's postinstall now runs the same sudo dnf install list as the @agent-browser/eve extension when passwordless sudo is present, then agent-browser install. A sandbox image with the libraries preinstalled would remove the per-run install time.

## Minimal Reproducible Example
In a Vercel sandbox: pnpm install adeo-todo-nuxt at ed34fe6, then pnpm test:e2e.

## Context
Reference run of the ADEO micro-factory, 14 September 2026.
