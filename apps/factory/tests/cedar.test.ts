import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import assert from "node:assert/strict";
import { test } from "node:test";
import { FACTORY_POLICY_REVISION, FACTORY_POLICY_TEXT } from "../runtime/lib/cedar/generated-policies.ts";
import { evaluateFactory, factoryPolicyManifest, validateFactoryPolicies } from "../runtime/lib/cedar/engine.ts";
import { changeResource, repositoryResource } from "../runtime/lib/cedar/model.ts";
import { runFactoryOperation, FactoryAuthorizationError, type FactoryDecisionAudit } from "../runtime/lib/cedar/operation-runner.ts";
import { FACTORY_POLICY_METADATA } from "../runtime/lib/cedar/policy-metadata.ts";
import { FACTORY_SCHEMA_REVISION, getFactoryCedarSchema } from "../runtime/lib/cedar/schema.ts";

const appRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const policyRoot = resolve(appRoot, "../../factory/policies/cedar");
const candidateSha = "a".repeat(64);
const baseSha = "b".repeat(40);
const branch = "factory/work-test";

const worker = { kind: "service" as const, id: "oidc:worker", tags: { role: "worker", station: "worker", lane: "worker" } };
const reviewer = { kind: "service" as const, id: "oidc:reviewer", tags: { role: "reviewer", station: "reviewer", lane: "reviewer" } };
const mergeDriver = { kind: "service" as const, id: "factory-delivery-driver", tags: { role: "merge-coordinator", station: "delivery-driver", lane: "merge" } };

function change(overrides: Partial<Parameters<typeof changeResource>[0]> = {}) {
  return changeResource({
    id: "operation-1",
    taskId: "task-1",
    candidateSha,
    baseSha,
    branch,
    expectedRevision: baseSha,
    ...overrides,
  });
}

function context(overrides: Record<string, unknown> = {}) {
  return {
    expectedRevision: baseSha,
    candidateSha,
    baseSha,
    verifiedSha: candidateSha,
    branch,
    lane: "worker" as const,
    budget: 0,
    riskClass: "low" as const,
    evidence: { id: "verification-1", source: "factory.verify_work", complete: true, candidateSha },
    ...overrides,
  };
}

test("canonical Cedar files are generated, strictly validated, and revisioned", async () => {
  const report = validateFactoryPolicies();
  assert.equal(report.ok, true, report.issues.map((issue) => issue.message).join("\n"));
  assert.equal(report.policyCount, FACTORY_POLICY_METADATA.length);
  assert.match(FACTORY_POLICY_REVISION, /^sha256:[a-f0-9]{64}$/);
  assert.match(FACTORY_SCHEMA_REVISION, /^sha256:[a-f0-9]{64}$/);
  const records = [] as Array<{ id: string; text: string }>;
  for (const metadata of [...FACTORY_POLICY_METADATA].sort((left, right) => left.id.localeCompare(right.id))) {
    const text = await readFile(resolve(policyRoot, `${metadata.id}.cedar`), "utf8");
    records.push({ id: metadata.id, text });
    assert.equal(FACTORY_POLICY_TEXT[metadata.id], text, metadata.id);
  }
  assert.equal(
    FACTORY_POLICY_REVISION,
    `sha256:${createHash("sha256").update(records.map(({ id, text }) => `${id}\n${text}`).join("\n")).digest("hex")}`,
  );
  const manifest = factoryPolicyManifest();
  assert.equal(manifest.schema, getFactoryCedarSchema());
  assert.equal(manifest.policies.length, 15);
  assert.ok(manifest.actions.every((action) => "inputSchema" in action));
});

test("worker publication on the dev branch is allowed without the draft flag (15 Sep pipeline)", () => {
  const result = evaluateFactory({
    principal: worker,
    action: "publish_change",
    input: { branch: "dev", candidateSha, baseSha, draft: false },
    resource: change({ branch: "dev" }),
    context: context({ branch: "dev" }),
  });
  assert.equal(result.valid, true, result.errors.join("\n"));
  assert.equal(result.decision, "ALLOW", result.determiningPolicies.join(","));
});

test("worker publication is allowed only for its verified candidate and factory branch", () => {
  const result = evaluateFactory({
    principal: worker,
    action: "publish_change",
    input: { branch, candidateSha, baseSha, draft: true },
    resource: change(),
    context: context(),
  });
  assert.equal(result.valid, true, result.errors.join("\n"));
  assert.equal(result.decision, "ALLOW");
  assert.deepEqual(result.determiningPolicies, ["factory-worker-publishes-verified-change"]);

  const stale = evaluateFactory({
    principal: worker,
    action: "publish_change",
    input: { branch, candidateSha, baseSha, draft: true },
    resource: change({ expectedRevision: "c".repeat(40) }),
    context: context(),
  });
  assert.equal(stale.decision, "DENY");
  assert.ok(stale.determiningPolicies.includes("factory-forbid-stale-change-state"));

  const defaultBranch = evaluateFactory({
    principal: worker,
    action: "publish_change",
    input: { branch: "main", candidateSha, baseSha, draft: true },
    resource: change({ branch: "main" }),
    context: context({ branch: "main" }),
  });
  assert.equal(defaultBranch.decision, "DENY");
  assert.ok(defaultBranch.determiningPolicies.includes("factory-forbid-default-branch-publication"));
});

test("review, verification, checks, and low-risk merge bind their host roles", () => {
  const review = evaluateFactory({
    principal: reviewer,
    action: "record_review",
    input: { reviewId: "review-1", verdict: "approved", reviewedSha: candidateSha },
    resource: change(),
    context: context({ lane: "reviewer", reviewedSha: candidateSha, evidence: { id: "review-1", source: "factory.review_gate", complete: true, candidateSha } }),
  });
  assert.equal(review.decision, "ALLOW", review.errors.join("\n"));
  assert.ok(review.determiningPolicies.includes("factory-reviewer-records-review"));

  const check = evaluateFactory({
    principal: reviewer,
    action: "run_check",
    input: { checkId: "typecheck", command: "pnpm typecheck" },
    resource: repositoryResource(),
    context: context({ lane: "reviewer", expectedRevision: candidateSha, baseSha, evidence: { id: "prepare-1", source: "factory.prepare_review", complete: true, candidateSha } }),
  });
  assert.equal(check.decision, "ALLOW", check.errors.join("\n"));

  const mergeSha = "d".repeat(40);
  const merge = evaluateFactory({
    principal: mergeDriver,
    action: "merge_change",
    input: { pullRequest: "42", targetBranch: "main" },
    resource: change({ id: "42", candidateSha: mergeSha, baseSha, branch: "main", expectedRevision: baseSha }),
    context: { expectedRevision: baseSha, candidateSha: mergeSha, baseSha, verifiedSha: mergeSha, reviewedSha: mergeSha, branch: "main", lane: "merge", budget: 0, riskClass: "low", evidence: { id: "merge-1", source: "factory.merge-policy", complete: true, candidateSha: mergeSha } },
  });
  assert.equal(merge.decision, "ALLOW", merge.errors.join("\n"));
  assert.ok(merge.determiningPolicies.includes("factory-delivery-driver-merges-low-risk-change"));

  const elevated = evaluateFactory({
    principal: mergeDriver,
    action: "merge_change",
    input: { pullRequest: "42", targetBranch: "main" },
    resource: change({ id: "42", candidateSha: mergeSha, baseSha, branch: "main", expectedRevision: baseSha }),
    context: { expectedRevision: baseSha, candidateSha: mergeSha, baseSha, verifiedSha: mergeSha, reviewedSha: mergeSha, branch: "main", lane: "merge", budget: 0, riskClass: "elevated", evidence: { id: "merge-1", source: "factory.merge-policy", complete: true, candidateSha: mergeSha } },
  });
  assert.equal(elevated.decision, "DENY");
  assert.ok(elevated.determiningPolicies.includes("factory-forbid-elevated-auto-merge"));
});

test("missing evidence and unbound services fail closed", () => {
  const missing = evaluateFactory({
    principal: worker,
    action: "publish_change",
    input: { branch, candidateSha, baseSha, draft: true },
    resource: change(),
    context: context({ evidence: undefined }),
  });
  assert.equal(missing.decision, "DENY");
  assert.ok(missing.determiningPolicies.includes("factory-forbid-missing-evidence"));

  const unknownService = evaluateFactory({
    principal: { kind: "service", id: "oidc:unknown", tags: { role: "unknown" } },
    action: "publish_change",
    input: { branch, candidateSha, baseSha, draft: true },
    resource: change(),
    context: context(),
  });
  assert.equal(unknownService.decision, "DENY");
  assert.ok(unknownService.determiningPolicies.includes("factory-forbid-unbound-service-mutation"));
});

function assertAuditMetadata(audit: FactoryDecisionAudit, operationId: string) {
  assert.equal(audit.operationId, operationId);
  assert.equal(audit.action, "publish_change");
  assert.deepEqual(audit.principal, { kind: "service", id: worker.id });
  assert.deepEqual(audit.resource, { kind: "change", id: "operation-1" });
  assert.equal(audit.decision, "ALLOW");
  assert.equal(audit.valid, true);
  assert.equal(audit.policyRevision, FACTORY_POLICY_REVISION);
  assert.equal(audit.schemaRevision, FACTORY_SCHEMA_REVISION);
  assert.deepEqual(audit.determiningPolicies, ["factory-worker-publishes-verified-change"]);
  assert.deepEqual(audit.inputFields, ["baseSha", "branch", "candidateSha", "draft"]);
  assert.deepEqual(audit.contextFields, Object.keys(context()).sort());
  assert.equal(JSON.stringify(audit).includes(candidateSha), false);
}

test("trusted operation runner never executes denied or invalid operations and emits redacted decision audits", async () => {
  const audits: FactoryDecisionAudit[] = [];
  let executed = false;
  await assert.rejects(
    runFactoryOperation({
      operationId: "operation-denied",
      principal: worker,
      action: "publish_change",
      input: { branch, candidateSha, baseSha, draft: true },
      resource: change(),
      context: context({ evidence: undefined }),
      execute: async () => {
        executed = true;
        return true;
      },
      onAudit: (audit) => audits.push(audit),
    }),
    FactoryAuthorizationError,
  );
  assert.equal(executed, false);
  assert.equal(audits[0]?.outcome, "blocked");
  assert.equal(audits[0]?.decision, "DENY");
  assert.equal(audits[0]?.valid, true);
  assert.equal(audits[0]?.policyRevision, FACTORY_POLICY_REVISION);
  assert.equal(audits[0]?.schemaRevision, FACTORY_SCHEMA_REVISION);
  assert.deepEqual(audits[0]?.inputFields, ["baseSha", "branch", "candidateSha", "draft"]);

  audits.length = 0;
  executed = false;
  await assert.rejects(
    runFactoryOperation({
      operationId: "operation-invalid-input",
      principal: worker,
      action: "publish_change",
      input: { branch, candidateSha, baseSha },
      resource: change(),
      context: context(),
      execute: async () => {
        executed = true;
        return true;
      },
      onAudit: (audit) => audits.push(audit),
    }),
    FactoryAuthorizationError,
  );
  assert.equal(executed, false);
  assert.equal(audits.length, 1);
  assert.equal(audits[0]?.outcome, "blocked");
  assert.equal(audits[0]?.decision, "DENY");
  assert.equal(audits[0]?.valid, false);
  assert.equal(audits[0]?.policyRevision, FACTORY_POLICY_REVISION);
  assert.equal(audits[0]?.schemaRevision, FACTORY_SCHEMA_REVISION);
  assert.deepEqual(audits[0]?.inputFields, ["baseSha", "branch", "candidateSha"]);
  assert.ok(audits[0]?.errors.some((error) => error.startsWith("input.draft:")));

  audits.length = 0;
  const result = await runFactoryOperation({
    operationId: "operation-allowed",
    principal: worker,
    action: "publish_change",
    input: { branch, candidateSha, baseSha, draft: true },
    resource: change(),
    context: context(),
    execute: async () => "receipt",
    onAudit: (audit) => audits.push(audit),
  });
  assert.equal(result.output, "receipt");
  assert.equal(result.audit.outcome, "succeeded");
  assert.deepEqual(audits.map((audit) => audit.outcome), ["pending", "succeeded"]);
  for (const audit of audits) assertAuditMetadata(audit, "operation-allowed");
});

test("malformed runtime authorization input fails closed with a bounded redacted audit", async () => {
  const audits: FactoryDecisionAudit[] = [];
  let executed = false;
  await assert.rejects(
    runFactoryOperation({
      operationId: "operation-malformed-context",
      principal: worker,
      action: "publish_change",
      input: { branch, candidateSha, baseSha, draft: true },
      context: null as unknown as ReturnType<typeof context>,
      resource: change(),
      execute: async () => {
        executed = true;
        return true;
      },
      onAudit: audit => audits.push(audit),
    }),
    (error: unknown) => error instanceof FactoryAuthorizationError,
  );

  assert.equal(executed, false);
  assert.equal(audits.length, 1);
  assert.equal(audits[0]?.decision, "DENY");
  assert.equal(audits[0]?.outcome, "blocked");
  assert.equal(audits[0]?.valid, false);
  assert.equal(audits[0]?.policyRevision, FACTORY_POLICY_REVISION);
  assert.equal(audits[0]?.schemaRevision, FACTORY_SCHEMA_REVISION);
  assert.deepEqual(audits[0]?.contextFields, []);
  assert.ok(audits[0]?.errors.every(error => error.length <= 500));
  assert.equal(JSON.stringify(audits[0]).includes(candidateSha), false);
});

test("trusted operation runner records a failed allowed execution with decision revisions", async () => {
  const audits: FactoryDecisionAudit[] = [];
  const result = await runFactoryOperation({
    operationId: "operation-failed",
    principal: worker,
    action: "publish_change",
    input: { branch, candidateSha, baseSha, draft: true },
    resource: change(),
    context: context(),
    execute: async () => ({ accepted: false }),
    isSuccess: (output) => output.accepted,
    onAudit: (audit) => audits.push(audit),
  });

  assert.deepEqual(audits.map((audit) => audit.outcome), ["pending", "failed"]);
  assert.equal(result.output.accepted, false);
  assert.equal(result.audit.outcome, "failed");
  assert.equal(result.audit.executionError, undefined);
  assert.equal(audits[0]?.decisionId, audits[1]?.decisionId);
  for (const audit of audits) assertAuditMetadata(audit, "operation-failed");
});

test("trusted operation runner records a thrown allowed execution with a bounded audit error", async () => {
  const audits: FactoryDecisionAudit[] = [];
  const executionError = new Error("upstream unavailable\u0000");
  await assert.rejects(
    runFactoryOperation({
      operationId: "operation-threw",
      principal: worker,
      action: "publish_change",
      input: { branch, candidateSha, baseSha, draft: true },
      resource: change(),
      context: context(),
      execute: async () => {
        throw executionError;
      },
      onAudit: (audit) => audits.push(audit),
    }),
    (error: unknown) => error === executionError,
  );

  assert.deepEqual(audits.map((audit) => audit.outcome), ["pending", "threw"]);
  assert.equal(audits[1]?.executionError, "upstream unavailable ");
  assert.equal(audits[0]?.decisionId, audits[1]?.decisionId);
  for (const audit of audits) assertAuditMetadata(audit, "operation-threw");
});

test("start_task is allowed only for the host workflow with a work_order admission attached", () => {
  const workflow = { kind: "service" as const, id: "factory-workflow", tags: { role: "workflow", station: "workflow", lane: "audit" } };
  const deliveryId = "d".repeat(64);
  const base = {
    principal: workflow,
    action: "start_task" as const,
    input: { deliveryId, operationId: "11111111-1111-4111-8111-111111111111", title: "Migrate" },
    resource: repositoryResource(),
    context: { ...context({ lane: "audit" as const }), evidence: undefined, admission: { kind: "work_order", id: deliveryId } },
  };
  delete (base.context as { evidence?: unknown }).evidence;
  const allowed = evaluateFactory(base);
  assert.equal(allowed.valid, true, allowed.errors.join("\n"));
  assert.equal(allowed.decision, "ALLOW");
  assert.deepEqual(allowed.determiningPolicies, ["factory-workflow-starts-admitted-work-order"]);
  for (const admission of [undefined, { kind: "clarification", id: deliveryId }, { kind: "unsupported", id: deliveryId }, { kind: "work_order", id: "e".repeat(64) }]) {
    const result = evaluateFactory({ ...base, context: { ...base.context, ...(admission ? { admission } : {}) } });
    if (admission) delete (result as unknown as { x?: unknown }).x;
    const ctx = { ...base.context } as Record<string, unknown>;
    if (!admission) delete ctx.admission; else ctx.admission = admission;
    const denied = evaluateFactory({ ...base, context: ctx as typeof base.context });
    assert.equal(denied.decision, "DENY", JSON.stringify(admission));
  }
  const migrator = evaluateFactory({ ...base, principal: worker });
  assert.equal(migrator.decision, "DENY");
});
