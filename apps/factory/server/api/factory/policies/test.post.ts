import { createError, defineEventHandler, readBody, sendWebResponse, setResponseHeader, toWebRequest } from "h3";
import { routeAuth } from "eve/channels/auth";
import { z } from "zod";
import { factoryAuth } from "../../../../runtime/lib/route-auth";
import { evaluateFactory } from "../../../../runtime/lib/cedar/engine.ts";
import { isFactoryActionName } from "../../../../runtime/lib/cedar/catalog.ts";
import {
  factoryContextSchema,
  factoryPrincipalSchema,
  factoryResourceSchema,
} from "../../../../runtime/lib/cedar/model.ts";

const requestSchema = z
  .object({
    principal: factoryPrincipalSchema,
    action: z.string().min(1),
    input: z.record(z.string(), z.unknown()),
    resource: factoryResourceSchema,
    context: factoryContextSchema,
  })
  .strict();

/**
 * This is an authenticated, read-only policy probe. It never authorizes or
 * executes an operation; callers must treat a supplied principal as a test
 * vector, not as proof of identity.
 */
export default defineEventHandler(async (event) => {
  const auth = await routeAuth(toWebRequest(event), factoryAuth);
  if (auth instanceof Response) return sendWebResponse(event, auth);
  setResponseHeader(event, "Cache-Control", "private, no-store");
  const parsed = requestSchema.safeParse(await readBody(event));
  if (!parsed.success) throw createError({ statusCode: 400, statusMessage: "Invalid factory policy probe." });
  if (!isFactoryActionName(parsed.data.action)) throw createError({ statusCode: 400, statusMessage: "Unknown factory Cedar action." });
  const result = evaluateFactory({
    principal: parsed.data.principal,
    action: parsed.data.action,
    input: parsed.data.input,
    resource: parsed.data.resource,
    context: parsed.data.context,
  });
  return { readOnly: true, simulation: true, result };
});
