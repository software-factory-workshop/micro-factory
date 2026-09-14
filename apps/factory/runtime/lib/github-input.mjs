import { z } from 'zod';

// MCP requires an object at the schema root. Inventory ignores number; fx has
// supplied both null and the string "null" for that irrelevant optional field.
export const githubInput = z.object({
  resource: z.enum(['issues', 'pulls', 'issue_comments']),
  number: z.union([z.number().int().positive(), z.literal('null')]).nullish(),
}).superRefine((input, context) => {
  if (input.resource === 'issue_comments' && typeof input.number !== 'number') {
    context.addIssue({code:'custom', path:['number'], message:'Comment reads require a positive integer issue number.'});
  }
});
