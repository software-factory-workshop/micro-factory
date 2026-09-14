import { z } from 'zod';

export const modelUsageSchema = z.object({
  model: z.string().min(1).max(240).optional(),
  inputTokens: z.number().int().positive().optional(),
  outputTokens: z.number().int().positive().optional(),
  usd: z.number().finite().positive().optional(),
  factorySha: z.string().min(1).max(240).optional(),
}).strict();

export type ModelUsage = z.infer<typeof modelUsageSchema>;
