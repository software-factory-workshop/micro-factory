import { createHash } from "node:crypto";
import type { FactoryActionName } from "./catalog.ts";
import { evaluateFactory, type FactoryAuthorizeResult } from "./engine.ts";
import { FACTORY_POLICY_REVISION } from "./generated-policies.ts";
import type { FactoryContext, FactoryPrincipal, FactoryResource } from "./model.ts";
import { FACTORY_SCHEMA_REVISION } from "./schema.ts";

const MAX_AUDIT_FIELDS = 64;
const MAX_AUDIT_MESSAGES = 20;
const MAX_AUDIT_TEXT = 500;
type RuntimeRecord = Record<string, unknown>;

export type FactoryOperationOutcome = "blocked" | "pending" | "succeeded" | "failed" | "threw";

export interface FactoryDecisionAudit {
  readonly decisionId: string;
  readonly operationId: string;
  readonly action: FactoryActionName;
  readonly principal: { kind: FactoryPrincipal["kind"]; id: string };
  readonly resource: { kind: FactoryResource["kind"]; id: string };
  readonly decision: FactoryAuthorizeResult["decision"];
  readonly outcome: FactoryOperationOutcome;
  readonly valid: boolean;
  readonly policyRevision: string;
  readonly schemaRevision: string;
  readonly determiningPolicies: readonly string[];
  readonly errors: readonly string[];
  readonly inputFields: readonly string[];
  readonly contextFields: readonly string[];
  readonly durationMs: number;
  readonly executionError?: string;
}

export interface RunFactoryOperationInput<T> {
  operationId: string;
  principal: FactoryPrincipal;
  action: FactoryActionName;
  input: Record<string, unknown>;
  resource: FactoryResource;
  context: FactoryContext;
  execute: () => PromiseLike<T> | T;
  isSuccess?: (output: T) => boolean;
  onAudit?: (audit: FactoryDecisionAudit) => void;
}

export interface FactoryOperationResult<T> {
  output: T;
  audit: FactoryDecisionAudit;
}

export class FactoryAuthorizationError extends Error {
  readonly audit: FactoryDecisionAudit;

  constructor(message: string, audit: FactoryDecisionAudit) {
    super(message);
    this.name = "FactoryAuthorizationError";
    this.audit = audit;
  }
}

function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => `${JSON.stringify(key)}:${stableJson(item)}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

function isRecord(value: unknown): value is RuntimeRecord {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function requestField(request: unknown, field: string): unknown {
  return isRecord(request) ? request[field] : undefined;
}

function boundedText(value: unknown, fallback: string): string {
  return (typeof value === "string" ? value : fallback).replace(/[\u0000-\u001f\u007f]/g, " ").slice(0, MAX_AUDIT_TEXT);
}

function boundedIdentifier(value: unknown, fallback: string): string {
  return boundedText(value, fallback).slice(0, 240);
}

function auditFields(value: unknown): string[] {
  return isRecord(value) ? Object.keys(value).sort().slice(0, MAX_AUDIT_FIELDS) : [];
}

function auditMessages(values: readonly unknown[]): string[] {
  return values
    .filter((value): value is string => typeof value === "string")
    .slice(0, MAX_AUDIT_MESSAGES)
    .map(value => boundedText(value, "invalid"));
}

function auditAction(value: unknown): FactoryActionName {
  return boundedText(value, "unknown") as FactoryActionName;
}

function auditPrincipal(value: unknown): { kind: FactoryPrincipal["kind"]; id: string } {
  const record = isRecord(value) ? value : {};
  return { kind: record.kind === "user" ? "user" : "service", id: boundedIdentifier(record.id, "invalid") };
}

function auditResource(value: unknown): { kind: FactoryResource["kind"]; id: string } {
  const record = isRecord(value) ? value : {};
  return { kind: record.kind === "change" ? "change" : "repository", id: boundedIdentifier(record.id, "invalid") };
}

function hashDecision(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function decisionId(request: unknown, evaluation: FactoryAuthorizeResult): string {
  try {
    return hashDecision(
      stableJson({
        operationId: requestField(request, "operationId"),
        principal: requestField(request, "principal"),
        action: requestField(request, "action"),
        resource: requestField(request, "resource"),
        context: requestField(request, "context"),
        input: requestField(request, "input"),
        policyRevision: evaluation.policyRevision,
        schemaRevision: evaluation.schemaRevision,
      }),
    );
  } catch {
    return hashDecision(
      JSON.stringify({
        operationId: boundedIdentifier(requestField(request, "operationId"), "invalid-operation"),
        action: auditAction(requestField(request, "action")),
        policyRevision: evaluation.policyRevision,
        schemaRevision: evaluation.schemaRevision,
      }),
    );
  }
}

function boundedError(error: unknown): string {
  return boundedText(error instanceof Error ? error.message : String(error), "unknown execution error");
}

function evaluationFailure(started: number): FactoryAuthorizeResult {
  return {
    decision: "DENY",
    valid: false,
    policyRevision: FACTORY_POLICY_REVISION,
    schemaRevision: FACTORY_SCHEMA_REVISION,
    determiningPolicies: [],
    errors: ["Factory Cedar evaluation failed closed."],
    durationMs: Math.round((performance.now() - started) * 100) / 100,
    request: {
      principal: { type: "Factory::Principal", id: "invalid" },
      action: { type: "Factory::Action", id: "unknown" },
      resource: { type: "Factory::Resource", id: "invalid" },
      context: {},
    },
    entities: [],
  };
}

function auditFor(
  request: unknown,
  evaluation: FactoryAuthorizeResult,
  outcome: FactoryOperationOutcome,
  id: string,
  executionError?: string,
): FactoryDecisionAudit {
  return {
    decisionId: id,
    operationId: boundedIdentifier(requestField(request, "operationId"), "invalid-operation"),
    action: auditAction(requestField(request, "action")),
    principal: auditPrincipal(requestField(request, "principal")),
    resource: auditResource(requestField(request, "resource")),
    decision: evaluation.decision,
    outcome,
    valid: evaluation.valid,
    policyRevision: evaluation.policyRevision,
    schemaRevision: evaluation.schemaRevision,
    determiningPolicies: auditMessages(evaluation.determiningPolicies),
    errors: auditMessages(evaluation.errors),
    inputFields: auditFields(requestField(request, "input")),
    contextFields: auditFields(requestField(request, "context")),
    durationMs: evaluation.durationMs,
    ...(executionError ? { executionError } : {}),
  };
}

function emit(onAudit: unknown, audit: FactoryDecisionAudit) {
  if (typeof onAudit === "function") onAudit(audit);
}

/** Cedar -> trusted operation -> audit. Durable host state remains the CAS/idempotency boundary. */
export async function runFactoryOperation<T>(request: RunFactoryOperationInput<T>): Promise<FactoryOperationResult<T>> {
  const started = performance.now();
  let evaluation: FactoryAuthorizeResult;
  try {
    evaluation = evaluateFactory({
      principal: requestField(request, "principal") as FactoryPrincipal,
      action: requestField(request, "action") as FactoryActionName,
      input: requestField(request, "input") as Record<string, unknown>,
      resource: requestField(request, "resource") as FactoryResource,
      context: requestField(request, "context") as FactoryContext,
    });
  } catch {
    // Runtime callers may cross a JSON or plugin boundary despite the static type.
    // An evaluator failure is still a deny, and must not become an unaudited error.
    evaluation = evaluationFailure(started);
  }
  const rawRequest = request as unknown;
  const id = decisionId(rawRequest, evaluation);

  if (!evaluation.valid || evaluation.decision !== "ALLOW") {
    const audit = auditFor(rawRequest, evaluation, "blocked", id);
    emit(requestField(rawRequest, "onAudit"), audit);
    const reason = !evaluation.valid
      ? "Factory Cedar evaluation failed closed; the operation was not executed."
      : evaluation.determiningPolicies.length
        ? `Factory Cedar denied the operation: ${evaluation.determiningPolicies.join(", ")}.`
        : "Factory Cedar denied the operation by default.";
    throw new FactoryAuthorizationError(reason, audit);
  }

  const onAudit = requestField(rawRequest, "onAudit");
  emit(onAudit, auditFor(rawRequest, evaluation, "pending", id));
  let output: T;
  try {
    output = await request.execute();
  } catch (error) {
    const audit = auditFor(rawRequest, evaluation, "threw", id, boundedError(error));
    emit(onAudit, audit);
    throw error;
  }

  const succeeded = request.isSuccess ? request.isSuccess(output) : true;
  const audit = auditFor(rawRequest, evaluation, succeeded ? "succeeded" : "failed", id);
  emit(onAudit, audit);
  return { output, audit };
}
