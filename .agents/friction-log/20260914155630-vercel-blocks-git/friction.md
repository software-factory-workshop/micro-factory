---
title: 'Vercel blocks git deployments whose commit author email is not linked to a team GitHub account'
severity: 'minor'
---

## Expected Behavior
A push to the git-connected cockpit project deploys.

## Current Behavior
The first two deployments ended BLOCKED with seatBlock COMMIT_AUTHOR_REQUIRED because the commits were authored as remi.connesson@vercel.com, which is not the email of the GitHub account in the team. Rewriting the history to the GitHub-linked address (remiconnesson2@gmail.com) and force-pushing produced a building deployment.

## Possible Solution
Set git user.email to the GitHub-linked address in every factory checkout (done via git config in the three repositories), and mention it in the milestones setup so participants do not hit the same block.

## Minimal Reproducible Example
Commit with an email unknown to the Vercel team, push to a git-connected project, read readyStateReason on GET /v13/deployments/<id>.

## Context
Hit while deploying the ADEO micro-factory cockpit on 14 September 2026.
