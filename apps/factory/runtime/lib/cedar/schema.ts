import { createHash } from "node:crypto";
import { FACTORY_ACTIONS, FACTORY_ACTION_NAMES, FACTORY_NAMESPACE, factoryInputRecordType } from "./catalog.ts";

export const FACTORY_SCHEMA_VERSION = "factory-schema-v1";

function contextType(action: (typeof FACTORY_ACTION_NAMES)[number]): string {
  return `{ input: ${factoryInputRecordType(action)}, expectedRevision: String, candidateSha: String, baseSha: String, verifiedSha: String, reviewedSha?: String, branch: String, lane: String, budget: Long, riskClass: String, evidence?: Evidence, approval?: Approval, admission?: Admission }`;
}

/** Generated from the factory action catalog; do not hand-edit the schema. */
export function generateFactoryCedarSchema(): string {
  const lines: string[] = [
    `namespace ${FACTORY_NAMESPACE} {`,
    `  // Principal identity and tags are supplied by the trusted host.`,
    `  entity User tags String;`,
    `  entity ServicePrincipal tags String;`,
    ``,
    `  entity Project;`,
    `  entity Repository in Project { defaultBranch: String };`,
    `  entity Task in Project;`,
    `  entity Change in Repository { changeId: String, task: Task, candidateSha: String, baseSha: String, branch: String, defaultBranch: String, expectedRevision: String };`,
    ``,
    `  type Evidence = { id: String, source: String, complete: Bool, candidateSha: String };`,
    `  type Approval = { id: String, actor: String, human: Bool };`,
    `  type Admission = { kind: String, id: String };`,
    ``,
  ];
  for (const action of FACTORY_ACTION_NAMES) {
    const entry = FACTORY_ACTIONS[action];
    lines.push(
      `  // ${entry.description}`,
      `  action "${action}" appliesTo {`,
      `    principal: [User, ServicePrincipal],`,
      `    resource: [${entry.resourceType}],`,
      `    context: ${contextType(action)}`,
      `  };`,
      ``,
    );
  }
  lines.push(`}`);
  return lines.join("\n");
}

let cachedSchema: string | undefined;
export function getFactoryCedarSchema(): string {
  cachedSchema ??= generateFactoryCedarSchema();
  return cachedSchema;
}

/** Content-addressed so a schema change cannot silently reuse an old decision. */
export const FACTORY_SCHEMA_REVISION = `sha256:${createHash("sha256")
  .update(FACTORY_SCHEMA_VERSION)
  .update("\n")
  .update(getFactoryCedarSchema())
  .digest("hex")}`;

export const FACTORY_ENTITY_TYPES = {
  user: `${FACTORY_NAMESPACE}::User`,
  service: `${FACTORY_NAMESPACE}::ServicePrincipal`,
  project: `${FACTORY_NAMESPACE}::Project`,
  repository: `${FACTORY_NAMESPACE}::Repository`,
  task: `${FACTORY_NAMESPACE}::Task`,
  change: `${FACTORY_NAMESPACE}::Change`,
  action: `${FACTORY_NAMESPACE}::Action`,
} as const;
