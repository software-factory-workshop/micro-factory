import * as cedar from "@cedar-policy/cedar-wasm/nodejs";
import { FACTORY_ACTIONS, FACTORY_ACTION_NAMES, factoryInputJsonSchema, type FactoryActionName } from "./catalog.ts";
import { FACTORY_POLICY_REVISION, FACTORY_POLICY_TEXT } from "./generated-policies.ts";
import {
  factoryContextSchema,
  factoryPrincipalSchema,
  factoryResourceSchema,
  type FactoryContext,
  type FactoryPrincipal,
  type FactoryResource,
} from "./model.ts";
import { FACTORY_POLICY_METADATA } from "./policy-metadata.ts";
import { FACTORY_ENTITY_TYPES, FACTORY_SCHEMA_REVISION, getFactoryCedarSchema } from "./schema.ts";

export type PolicySet = Readonly<Record<string, string>>;

export interface FactoryPolicyValidationIssue {
  severity: "error" | "warning";
  policyId?: string;
  message: string;
}

export interface FactoryPolicyValidationReport {
  ok: boolean;
  issues: FactoryPolicyValidationIssue[];
  policyIds: string[];
  policyCount: number;
}

export interface FactoryAuthorizeRequest {
  principal: FactoryPrincipal;
  action: FactoryActionName;
  input: Record<string, unknown>;
  resource: FactoryResource;
  context: FactoryContext;
  policies?: PolicySet;
}

export interface FactoryAuthorizeResult {
  decision: "ALLOW" | "DENY";
  valid: boolean;
  policyRevision: string;
  schemaRevision: string;
  determiningPolicies: string[];
  errors: string[];
  durationMs: number;
  request: {
    principal: { type: string; id: string };
    action: { type: string; id: string };
    resource: { type: string; id: string };
    context: unknown;
  };
  /** The bounded entity slice used for this decision, useful in audit tests. */
  entities: unknown[];
}

function uid(type: string, id: string) {
  return { type, id };
}

function entityValue(type: string, id: string) {
  return { __entity: uid(type, id) };
}

function policySet(): PolicySet {
  return { ...FACTORY_POLICY_TEXT };
}

function idAnnotationOf(policyText: string): string | undefined {
  return policyText.match(/@id\("([^"]+)"\)/)?.[1];
}

function policyValidationInput(policies: string | PolicySet) {
  const asText = typeof policies === "string" ? policies : Object.values(policies).join("\n\n");
  const parsed = cedar.policySetTextToParts(asText);
  if (parsed.type === "failure") {
    return {
      parsed: null,
      staticPolicies: null,
      issues: parsed.errors.map((error) => ({ severity: "error" as const, message: error.message })),
      policyIds: [],
      policyCount: 0,
    };
  }
  const annotations = parsed.policies.map(idAnnotationOf);
  const annotationIssues: FactoryPolicyValidationIssue[] = annotations.flatMap((id, index) =>
    id
      ? []
      : [{ severity: "error" as const, message: `Policy ${index + 1} is missing a stable @id annotation.` }],
  );
  const duplicateIds = annotations.filter((id): id is string => Boolean(id)).filter((id, index, ids) => ids.indexOf(id) !== index);
  const duplicateIssues = [...new Set(duplicateIds)].map((id) => ({
    severity: "error" as const,
    message: `Policy ID ${id} is duplicated.`,
  }));
  const keyIssues =
    typeof policies === "string"
      ? []
      : Object.entries(policies).flatMap(([key, text]) => {
          const annotation = idAnnotationOf(text);
          return annotation === key
            ? []
            : [{ severity: "error" as const, policyId: key, message: `Policy map key ${key} does not match its @id annotation.` }];
        });
  const policyIds = annotations.filter((id): id is string => Boolean(id));
  const staticPolicies: Record<string, string> =
    typeof policies === "string"
      ? Object.fromEntries(parsed.policies.map((policy, index) => [idAnnotationOf(policy) ?? `policy${index}`, policy]))
      : { ...policies };
  return { parsed, staticPolicies, issues: [...annotationIssues, ...duplicateIssues, ...keyIssues], policyIds, policyCount: parsed.policies.length };
}

/** Cedar strict validation is part of activation safety, not an optional report. */
export function validateFactoryPolicies(policies: string | PolicySet = policySet()): FactoryPolicyValidationReport {
  try {
    const parsed = policyValidationInput(policies);
    if (!parsed.parsed || !parsed.staticPolicies) {
      return {
        ok: false,
        issues: parsed.issues,
        policyIds: parsed.policyIds,
        policyCount: parsed.policyCount,
      };
    }

    const validation = cedar.validate({
      validationSettings: { mode: "strict" },
      schema: getFactoryCedarSchema(),
      policies: { staticPolicies: parsed.staticPolicies },
    });
    if (validation.type === "failure") {
      return {
        ok: false,
        issues: [
          ...parsed.issues,
          ...validation.errors.map((error) => ({ severity: "error" as const, message: error.message })),
        ],
        policyIds: parsed.policyIds,
        policyCount: parsed.policyCount,
      };
    }

    const issues: FactoryPolicyValidationIssue[] = [
      ...parsed.issues,
      ...validation.validationErrors.map((error) => ({
        severity: "error" as const,
        policyId: error.policyId,
        message: error.error.message,
      })),
      ...validation.validationWarnings.map((warning) => ({
        severity: "warning" as const,
        policyId: warning.policyId,
        message: warning.error.message,
      })),
      ...validation.otherWarnings.map((warning) => ({
        severity: "warning" as const,
        message: warning.message,
      })),
    ];
    return {
      ok: !issues.some((issue) => issue.severity === "error"),
      issues,
      policyIds: parsed.policyIds,
      policyCount: parsed.policyCount,
    };
  } catch (error) {
    return {
      ok: false,
      issues: [{ severity: "error", message: error instanceof Error ? error.message : String(error) }],
      policyIds: [],
      policyCount: 0,
    };
  }
}

function buildEntities(principal: FactoryPrincipal, resource: FactoryResource): cedar.Entities {
  const principalType = principal.kind === "user" ? FACTORY_ENTITY_TYPES.user : FACTORY_ENTITY_TYPES.service;
  const project = uid(FACTORY_ENTITY_TYPES.project, resource.projectId);
  const entities: cedar.Entities = [
    {
      uid: uid(principalType, principal.id),
      attrs: {},
      parents: [],
      tags: { ...principal.tags },
    },
    { uid: project, attrs: {}, parents: [] },
  ];

  if (resource.kind === "change") {
    const repository = uid(FACTORY_ENTITY_TYPES.repository, resource.repositoryId);
    const task = uid(FACTORY_ENTITY_TYPES.task, resource.taskId);
    entities.push(
      {
        uid: repository,
        attrs: { defaultBranch: resource.defaultBranch },
        parents: [project],
      },
      {
        uid: task,
        attrs: {},
        parents: [project],
      },
      {
        uid: uid(FACTORY_ENTITY_TYPES.change, resource.id),
        attrs: {
          changeId: resource.id,
          task: entityValue(FACTORY_ENTITY_TYPES.task, resource.taskId),
          candidateSha: resource.candidateSha,
          baseSha: resource.baseSha,
          branch: resource.branch,
          defaultBranch: resource.defaultBranch,
          expectedRevision: resource.expectedRevision,
        },
        parents: [repository],
      },
    );
  } else {
    entities.push({
      uid: uid(FACTORY_ENTITY_TYPES.repository, resource.id),
      attrs: { defaultBranch: resource.defaultBranch },
      parents: [project],
    });
  }

  return entities;
}

function encodeContext(input: Record<string, unknown>, context: FactoryContext): cedar.Context {
  return {
    input: input as cedar.CedarValueJson,
    expectedRevision: context.expectedRevision,
    candidateSha: context.candidateSha,
    baseSha: context.baseSha,
    verifiedSha: context.verifiedSha,
    ...(context.reviewedSha ? { reviewedSha: context.reviewedSha } : {}),
    branch: context.branch,
    lane: context.lane,
    budget: context.budget,
    riskClass: context.riskClass,
    ...(context.evidence ? { evidence: context.evidence as cedar.CedarValueJson } : {}),
    ...(context.approval ? { approval: context.approval as cedar.CedarValueJson } : {}),
    ...(context.admission ? { admission: context.admission as cedar.CedarValueJson } : {}),
  };
}

function invalidResult(
  started: number,
  principal: FactoryPrincipal,
  action: FactoryActionName,
  resource: FactoryResource,
  context: FactoryContext,
  input: Record<string, unknown>,
  errors: string[],
): FactoryAuthorizeResult {
  const principalType = principal.kind === "user" ? FACTORY_ENTITY_TYPES.user : FACTORY_ENTITY_TYPES.service;
  const resourceType = resource.kind === "change" ? FACTORY_ENTITY_TYPES.change : FACTORY_ENTITY_TYPES.repository;
  const request = {
    principal: uid(principalType, principal.id),
    action: uid(FACTORY_ENTITY_TYPES.action, action),
    resource: uid(resourceType, resource.id),
    context: encodeContext(input, context),
  };
  return {
    decision: "DENY",
    valid: false,
    policyRevision: FACTORY_POLICY_REVISION,
    schemaRevision: FACTORY_SCHEMA_REVISION,
    determiningPolicies: [],
    errors,
    durationMs: Math.round((performance.now() - started) * 100) / 100,
    request,
    entities: [],
  };
}

/** Evaluate one action against the static, generated policy set. Errors always deny. */
export function evaluateFactory(requestInput: FactoryAuthorizeRequest): FactoryAuthorizeResult {
  const started = performance.now();
  const principal = factoryPrincipalSchema.safeParse(requestInput.principal);
  const resource = factoryResourceSchema.safeParse(requestInput.resource);
  const context = factoryContextSchema.safeParse(requestInput.context);
  const actionEntry = FACTORY_ACTIONS[requestInput.action];
  const input = actionEntry?.inputSchema.safeParse(requestInput.input);

  if (!principal.success || !resource.success || !context.success || !input?.success) {
    const errors = [
      ...(principal.success ? [] : principal.error.issues.map((issue) => `principal.${issue.path.join(".")}: ${issue.message}`)),
      ...(resource.success ? [] : resource.error.issues.map((issue) => `resource.${issue.path.join(".")}: ${issue.message}`)),
      ...(context.success ? [] : context.error.issues.map((issue) => `context.${issue.path.join(".")}: ${issue.message}`)),
      ...(input?.success ? [] : input?.error.issues.map((issue) => `input.${issue.path.join(".")}: ${issue.message}`) ?? ["Unknown factory action."]),
    ];
    return invalidResult(
      started,
      principal.success ? principal.data : requestInput.principal,
      requestInput.action,
      resource.success ? resource.data : requestInput.resource,
      context.success ? context.data : requestInput.context,
      requestInput.input,
      errors,
    );
  }

  if (actionEntry.resourceType !== (resource.data.kind === "change" ? "Change" : "Repository")) {
    return invalidResult(started, principal.data, requestInput.action, resource.data, context.data, input.data, [
      `Action ${requestInput.action} cannot be evaluated against ${resource.data.kind}.`,
    ]);
  }

  const principalType = principal.data.kind === "user" ? FACTORY_ENTITY_TYPES.user : FACTORY_ENTITY_TYPES.service;
  const resourceType = resource.data.kind === "change" ? FACTORY_ENTITY_TYPES.change : FACTORY_ENTITY_TYPES.repository;
  const request = {
    principal: uid(principalType, principal.data.id),
    action: uid(FACTORY_ENTITY_TYPES.action, requestInput.action),
    resource: uid(resourceType, resource.data.id),
    context: encodeContext(input.data, context.data),
  };
  const entities = buildEntities(principal.data, resource.data);
  let decision: "ALLOW" | "DENY" = "DENY";
  let determiningPolicies: string[] = [];
  let errors: string[] = [];

  try {
    const validation = validateFactoryPolicies(requestInput.policies ?? policySet());
    if (!validation.ok) {
      errors = validation.issues.filter((issue) => issue.severity === "error").map((issue) => `${issue.policyId ?? "policy-set"}: ${issue.message}`);
    } else {
      const result = cedar.isAuthorized({
        ...request,
        policies: { staticPolicies: requestInput.policies ?? policySet() },
        entities,
        schema: getFactoryCedarSchema(),
      });
      if (result.type === "success") {
        decision = result.response.decision === "allow" ? "ALLOW" : "DENY";
        determiningPolicies = Array.from(result.response.diagnostics.reason);
        errors = result.response.diagnostics.errors.map((error) => `${error.policyId}: ${error.error.message}`);
      } else {
        errors = result.errors.map((error) => error.message);
      }
    }
  } catch (error) {
    errors = [error instanceof Error ? error.message : String(error)];
  }

  return {
    decision,
    valid: errors.length === 0,
    policyRevision: FACTORY_POLICY_REVISION,
    schemaRevision: FACTORY_SCHEMA_REVISION,
    determiningPolicies,
    errors,
    durationMs: Math.round((performance.now() - started) * 100) / 100,
    request,
    entities,
  };
}

export function factoryPolicyManifest() {
  const validation = validateFactoryPolicies();
  return {
    readOnly: true,
    activation: "No policy edit or activation endpoint is exposed by the factory.",
    canonicalDirectory: "factory/policies/cedar",
    generatedEvaluator: "apps/factory/runtime/lib/cedar/generated-policies.ts",
    factory: "micro-factory",
    schema: getFactoryCedarSchema(),
    schemaRevision: FACTORY_SCHEMA_REVISION,
    schemaVersion: "factory-schema-v1",
    policyRevision: FACTORY_POLICY_REVISION,
    validation,
    policies: FACTORY_POLICY_METADATA.map((metadata) => ({
      ...metadata,
      source: `factory/policies/cedar/${metadata.id}.cedar`,
      cedar: FACTORY_POLICY_TEXT[metadata.id],
    })),
    actions: FACTORY_ACTION_NAMES.map((name) => ({
      name,
      description: FACTORY_ACTIONS[name].description,
      mutating: FACTORY_ACTIONS[name].mutating,
      resourceType: FACTORY_ACTIONS[name].resourceType,
      inputSchema: factoryInputJsonSchema(name),
    })),
  };
}
