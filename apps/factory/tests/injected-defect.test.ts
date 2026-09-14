import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import test from "node:test";
import assert from "node:assert/strict";
import { applyReview, deliveryRequest, newDelivery } from "../runtime/lib/delivery-state.ts";
import { mergeEligibility as mergeDecision } from "../runtime/lib/merge-policy.ts";

const fixtureRoot = fileURLToPath(new URL("./fixtures/defects/non-persisting-save/", import.meta.url));
const fixtureTitle = readFileSync(`${fixtureRoot}/README.md`, "utf8");
const candidatePatch = readFileSync(`${fixtureRoot}/candidate.patch`, "utf8");
const sha = "a".repeat(40);
const baseSha = "b".repeat(40);
const task = deliveryRequest.parse({
  operationId: "11111111-1111-4111-8111-111111111111",
  title: "Review the injected save fixture",
  brief: "Check the injected issue edit against persistence and reload behavior.",
});

test("injected fixture describes a client-only save that cannot survive reload", () => {
  assert.match(fixtureTitle, /^# \[injected\]/m);
  assert.match(candidatePatch, /const todo = items\.value\.find/);
  assert.doesNotMatch(candidatePatch, /^\+.*method: "PATCH"/m);
  assert.match(candidatePatch, /^-\s+await \$fetch\(`\/api\/todos\/\$\{id\}`, \{ method: "PATCH" \}\);/m);
});

test("lazy approval of the injected fixture stays human_review and manual", () => {
  const state = newDelivery("worker-owner", task);
  state.publication = {
    number: 999,
    url: "https://github.com/software-factory-workshop/adeo-todo-nuxt/pull/999",
    headSha: sha,
    targetHeadSha: baseSha,
    targetBranch: "main",
    ownerSessionId: "wrun_owner",
    branch: "factory/owner",
  };
  const lazyReview = {
    verdict: "approve",
    summary: "The injected UI path appears to save the edit.",
    headSha: sha,
    baseSha,
    targetBranch: "main",
    findings: [],
    limitations: ["The reviewer did not run the save and reload check."],
  };

  applyReview(state, lazyReview);
  assert.equal(state.phase, "human_review");

  const decision = mergeDecision({
    files: [{ filename: "app/app.vue", status: "modified", patch: candidatePatch }],
    review: {
      ...lazyReview,
      verification: { prepared: true, repositoryChecksPassed: true, candidateUnchanged: true },
    },
    headSha: sha,
    baseSha,
    targetBranch: "main",
    workerSessionId: "wrun_owner",
    reviewerSessionId: "wrun_reviewer",
  });
  assert.equal(decision?.status, "manual");
  assert.match(decision?.reason ?? "", /limitations|did not approve/i);
});
