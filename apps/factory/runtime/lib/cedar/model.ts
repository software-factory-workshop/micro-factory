import { z } from "zod";
import { factoryRepository } from "../factory-config.ts";

const idSchema = z.string().min(1).max(240);
const revisionSchema = z
  .string()
  .regex(/^[a-f0-9]{7,64}$/i, "Use a Git SHA or candidate digest.");

export const factoryChangeResourceSchema = z
  .object({
    kind: z.literal("change"),
    id: idSchema,
    projectId: idSchema,
    repositoryId: idSchema,
    taskId: idSchema,
    candidateSha: revisionSchema,
    baseSha: revisionSchema,
    branch: z.string().min(1).max(200),
    defaultBranch: z.string().min(1).max(200),
    /** The revision the host must still be operating on. */
    expectedRevision: revisionSchema,
  })
  .strict();

export const factoryRepositoryResourceSchema = z
  .object({
    kind: z.literal("repository"),
    id: idSchema,
    projectId: idSchema,
    defaultBranch: z.string().min(1).max(200),
  })
  .strict();

export const factoryResourceSchema = z.discriminatedUnion("kind", [
  factoryChangeResourceSchema,
  factoryRepositoryResourceSchema,
]);
export type FactoryResource = z.infer<typeof factoryResourceSchema>;

export const factoryEvidenceSchema = z
  .object({
    id: idSchema,
    source: z.string().min(1).max(240),
    complete: z.boolean(),
    candidateSha: revisionSchema,
  })
  .strict();

export const factoryApprovalSchema = z
  .object({
    id: idSchema,
    actor: idSchema,
    human: z.boolean(),
  })
  .strict();

export const factoryAdmissionSchema = z
  .object({
    kind: z.enum(["work_order", "clarification", "unsupported"]),
    id: idSchema,
  })
  .strict();

export const factoryContextSchema = z
  .object({
    expectedRevision: revisionSchema,
    candidateSha: revisionSchema,
    baseSha: revisionSchema,
    verifiedSha: revisionSchema,
    reviewedSha: revisionSchema.optional(),
    branch: z.string().min(1).max(200),
    lane: z.enum(["worker", "reviewer", "merge", "audit", "release"]),
    budget: z.number().int().nonnegative(),
    riskClass: z.enum(["low", "elevated"]),
    evidence: factoryEvidenceSchema.optional(),
    approval: factoryApprovalSchema.optional(),
    admission: factoryAdmissionSchema.optional(),
  })
  .strict();
export type FactoryContext = z.infer<typeof factoryContextSchema>;

export const factoryPrincipalSchema = z
  .object({
    kind: z.enum(["user", "service"]),
    id: idSchema,
    tags: z.record(z.string(), z.string()),
  })
  .strict();
export type FactoryPrincipal = z.infer<typeof factoryPrincipalSchema>;

/** Stable identifiers for the only target repository in the factory scope. */
export const FACTORY_PROJECT_ID = "software-factory-workshop";
export const FACTORY_REPOSITORY_ID = factoryRepository;
export const FACTORY_DEFAULT_BRANCH = "main";

export function changeResource(input: {
  id: string;
  taskId: string;
  candidateSha: string;
  baseSha: string;
  branch: string;
  expectedRevision: string;
}) {
  return factoryChangeResourceSchema.parse({
    kind: "change",
    id: input.id,
    projectId: FACTORY_PROJECT_ID,
    repositoryId: FACTORY_REPOSITORY_ID,
    taskId: input.taskId,
    candidateSha: input.candidateSha,
    baseSha: input.baseSha,
    branch: input.branch,
    defaultBranch: FACTORY_DEFAULT_BRANCH,
    expectedRevision: input.expectedRevision,
  });
}

export function repositoryResource() {
  return factoryRepositoryResourceSchema.parse({
    kind: "repository",
    id: FACTORY_REPOSITORY_ID,
    projectId: FACTORY_PROJECT_ID,
    defaultBranch: FACTORY_DEFAULT_BRANCH,
  });
}
