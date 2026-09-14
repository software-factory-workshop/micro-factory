import test from "node:test";
import assert from "node:assert/strict";
import { reconcileManuallyMergedDelivery, type GithubMergeEvidence } from "../runtime/lib/delivery-reconcile.ts";
import { factoryRepository } from "../runtime/lib/factory-config.ts";

const repository = factoryRepository;
const headSha = "a".repeat(40);
const targetHeadSha = "b".repeat(40);
const mergeCommitSha = "c".repeat(40);

const publication = {
  number: 35,
  url: `https://github.com/${repository}/pull/35`,
  headSha,
  targetHeadSha,
  targetBranch: "main",
  ownerSessionId: "wrun_owner",
  branch: "factory/work-owner",
};

const review = {
  headSha,
  baseSha: targetHeadSha,
  targetBranch: "main",
  verdict: "incomplete",
  findings: [],
  limitations: ["Required host evidence remains for a human decision."],
  verification: { prepared: true, repositoryChecksPassed: true, candidateUnchanged: true },
};

function saved(overrides: Record<string, unknown> = {}) {
  return {
    phase: "human_review",
    publication,
    review,
    mergeReview: { ...review },
    reviewerSessionId: "wrun_reviewer",
    ...overrides,
  };
}

function evidence(overrides: Partial<GithubMergeEvidence> = {}): GithubMergeEvidence {
  return { repository, number: 35, merged: true, state: "closed", headSha, targetHeadSha, targetBranch: "main", mergeCommitSha, ...overrides };
}

test("reconciles exact GitHub evidence without changing the saved delivery", () => {
  const input = saved();
  const before = structuredClone(input);
  const result = reconcileManuallyMergedDelivery(input, evidence(), repository);
  assert.equal(result.eligible, true);
  assert.equal(result.commitSha, mergeCommitSha);
  assert.match(result.reason, /Read-only/);
  assert.deepEqual(input, before);
});

test("binds the saved URL, repository, PR number, head, base and target exactly", () => {
  assert.equal(reconcileManuallyMergedDelivery(saved(), evidence({ repository: "other/repo" }), repository).eligible, false);
  assert.equal(reconcileManuallyMergedDelivery(saved(), evidence({ number: 36 }), repository).eligible, false);
  assert.equal(reconcileManuallyMergedDelivery(saved(), evidence({ headSha: "d".repeat(40) }), repository).eligible, false);
  assert.equal(reconcileManuallyMergedDelivery(saved(), evidence({ targetHeadSha: "d".repeat(40) }), repository).eligible, false);
  assert.equal(reconcileManuallyMergedDelivery(saved(), evidence({ targetBranch: "release" }), repository).eligible, false);
  assert.equal(reconcileManuallyMergedDelivery(saved({ publication: { ...publication, url: "https://github.com/other/repo/pull/35" } }), evidence(), repository).eligible, false);
  assert.equal(reconcileManuallyMergedDelivery(saved({ publication: { ...publication, url: `${publication.url}?view=files` } }), evidence(), repository).eligible, false);
});

test("requires trusted independent review and merge evidence", () => {
  assert.equal(reconcileManuallyMergedDelivery(saved({ review: undefined }), evidence(), repository).eligible, false);
  assert.equal(reconcileManuallyMergedDelivery(saved({ mergeReview: undefined }), evidence(), repository).eligible, false);
  assert.equal(reconcileManuallyMergedDelivery(saved({ reviewerSessionId: "wrun_owner" }), evidence(), repository).eligible, false);
  assert.equal(reconcileManuallyMergedDelivery(saved({ review: { ...review, verification: undefined } }), evidence(), repository).eligible, false);
  assert.equal(reconcileManuallyMergedDelivery(saved({ mergeReview: { ...review, verification: { prepared: true, repositoryChecksPassed: false, candidateUnchanged: true } } }), evidence(), repository).eligible, false);
  assert.equal(reconcileManuallyMergedDelivery(saved({ review: { ...review, findings: [{ severity: "blocking" }] } }), evidence(), repository).eligible, false);
  assert.equal(reconcileManuallyMergedDelivery(saved({ review: { ...review, verdict: "changes_requested" } }), evidence(), repository).eligible, false);
  assert.equal(reconcileManuallyMergedDelivery(saved({ review: { ...review, headSha: "d".repeat(40) } }), evidence(), repository).eligible, false);
});

test("fails closed for non-merged or malformed provider evidence", () => {
  assert.equal(reconcileManuallyMergedDelivery(saved(), evidence({ merged: false }), repository).eligible, false);
  assert.equal(reconcileManuallyMergedDelivery(saved(), evidence({ state: "open" }), repository).eligible, false);
  assert.equal(reconcileManuallyMergedDelivery(saved(), undefined, repository).eligible, false);
  assert.equal(reconcileManuallyMergedDelivery(saved(), evidence({ mergeCommitSha: "short" }), repository).eligible, false);
  assert.equal(reconcileManuallyMergedDelivery(saved({ phase: "working" }), evidence(), repository).eligible, false);
  assert.equal(reconcileManuallyMergedDelivery(saved({ phase: "cancelled" }), evidence(), repository).eligible, false);
  assert.equal(reconcileManuallyMergedDelivery(saved({ phase: "needs_revision" }), evidence(), repository).eligible, false);
});

test("already merged is idempotent and does not require another provider read", () => {
  const input = saved({ phase: "merged" });
  const before = structuredClone(input);
  const result = reconcileManuallyMergedDelivery(input, undefined, repository);
  assert.equal(result.eligible, true);
  assert.deepEqual(input, before);
});
