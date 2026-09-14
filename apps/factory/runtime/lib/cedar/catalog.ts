import { z } from "zod";

/**
 * The factory catalog is the single source for the actions exposed to Cedar.
 * It describes the operation boundary, not the worker's prompt vocabulary.
 */
export const FACTORY_NAMESPACE = "Factory";

export type FactoryResourceType = "Change" | "Repository";

export interface FactoryCatalogEntry<T extends z.ZodObject = z.ZodObject> {
  readonly description: string;
  readonly inputSchema: T;
  readonly mutating: boolean;
  readonly resourceType: FactoryResourceType;
}

const shaSchema = z
  .string()
  .regex(/^[a-f0-9]{7,64}$/i, "Use a Git SHA-like hexadecimal value.");

export const FACTORY_ACTIONS = {
  start_task: {
    description: "Admit one work order and start the migrator station for it.",
    inputSchema: z
      .object({
        deliveryId: z.string().min(1).max(240),
        operationId: z.string().min(1).max(240),
        title: z.string().min(1).max(160),
      })
      .strict(),
    mutating: true,
    resourceType: "Repository",
  },
  run_check: {
    description: "Run one fixed, bounded verification check against a repository.",
    inputSchema: z
      .object({
        checkId: z.string().min(1).max(160),
        command: z.string().min(1).max(1000),
      })
      .strict(),
    mutating: false,
    resourceType: "Repository",
  },
  record_verification: {
    description: "Record complete host verification evidence for a candidate change.",
    inputSchema: z
      .object({
        checkIds: z.array(z.string().min(1).max(160)).min(1).max(20),
        outcome: z.enum(["passed", "failed"]),
        evidenceId: z.string().min(1).max(240),
      })
      .strict(),
    mutating: true,
    resourceType: "Change",
  },
  record_review: {
    description: "Record a review decision for an exact candidate change.",
    inputSchema: z
      .object({
        reviewId: z.string().min(1).max(240),
        verdict: z.enum(["approved", "changes_requested", "incomplete"]),
        reviewedSha: shaSchema,
      })
      .strict(),
    mutating: true,
    resourceType: "Change",
  },
  publish_change: {
    description: "Open or update one draft change from a verified factory workspace.",
    inputSchema: z
      .object({
        branch: z.string().min(1).max(200),
        candidateSha: shaSchema,
        baseSha: shaSchema,
        draft: z.literal(true),
      })
      .strict(),
    mutating: true,
    resourceType: "Change",
  },
  merge_change: {
    description: "Merge an exact, independently verified low-risk change into its target branch.",
    inputSchema: z
      .object({
        pullRequest: z.string().min(1).max(240),
        targetBranch: z.string().min(1).max(200),
      })
      .strict(),
    mutating: true,
    resourceType: "Change",
  },
} as const satisfies Record<string, FactoryCatalogEntry>;

export type FactoryActionName = keyof typeof FACTORY_ACTIONS;
export const FACTORY_ACTION_NAMES = Object.keys(FACTORY_ACTIONS) as FactoryActionName[];

export function isFactoryActionName(value: string): value is FactoryActionName {
  return Object.prototype.hasOwnProperty.call(FACTORY_ACTIONS, value);
}

type JsonSchema = Record<string, unknown>;

function zodToJsonSchema(schema: z.ZodType): JsonSchema {
  return z.toJSONSchema(schema, { io: "input", unrepresentable: "any" }) as JsonSchema;
}

function quoteIfNeeded(key: string): string {
  return /^[A-Za-z_][A-Za-z0-9_]*$/.test(key) ? key : JSON.stringify(key);
}

function cedarTypeFor(schema: JsonSchema): string {
  const type = Array.isArray(schema.type) ? schema.type[0] : schema.type;
  if (schema.enum) return "String";
  switch (type) {
    case "string":
      return "String";
    case "integer":
    case "number":
      return "Long";
    case "boolean":
      return "Bool";
    case "array":
      return `Set<${cedarTypeFor((schema.items ?? {}) as JsonSchema)}>`;
    case "object":
      return recordTypeFor(schema);
    default:
      return "String";
  }
}

function recordTypeFor(schema: JsonSchema): string {
  const properties = (schema.properties ?? {}) as Record<string, JsonSchema>;
  const required = new Set((schema.required ?? []) as string[]);
  const fields = Object.entries(properties).map(([key, property]) => {
    const optional = required.has(key) ? "" : "?";
    return `${quoteIfNeeded(key)}${optional}: ${cedarTypeFor(property)}`;
  });
  return `{ ${fields.join(", ")} }`;
}

/** Cedar type of `context.input` for a factory action. */
export function factoryInputRecordType(action: FactoryActionName): string {
  return recordTypeFor(zodToJsonSchema(FACTORY_ACTIONS[action].inputSchema));
}

/** JSON Schema is included in the read-only policy manifest for audit tooling. */
export function factoryInputJsonSchema(action: FactoryActionName): JsonSchema {
  return zodToJsonSchema(FACTORY_ACTIONS[action].inputSchema);
}
