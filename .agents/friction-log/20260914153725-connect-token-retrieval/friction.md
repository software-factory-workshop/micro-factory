---
title: 'Connect token retrieval for the coding agent is blocked, so connector coverage is unverified'
severity: 'major'
---

## Expected Behavior
An agent building the factory can read which repositories the github/jira-clone GitHub App installation covers and can download the adeo-todo-proto deployment source.

## Current Behavior
vercel connect token github/jira-clone --subject app and the Vercel MCP endpoint search were denied as credential materialization. The v0 reference prototype is therefore a hand-authored v0-shaped Next.js repository (software-factory-workshop/adeo-todo-proto), and a GitHub connector covering the new repositories must be confirmed by a person.

## Possible Solution
Provide a read-only allowlisted check of the installation repository list that does not hand the token to the agent, or let a person run the two commands before the session.

## Minimal Reproducible Example
Run vercel connect token github/jira-clone --subject app --scope demo-software-factory from an agent session running in auto mode.

## Context
Hit while building the ADEO micro-factory on 14 September 2026.
