import { defineEventHandler, sendWebResponse, setResponseHeader, setResponseStatus, toWebRequest } from "h3";
import { routeAuth } from "eve/channels/auth";
import { factoryAuth } from "../../../runtime/lib/route-auth";
import { factoryPolicyManifest } from "../../../runtime/lib/cedar/engine.ts";

/** Read-only inventory of the active factory Cedar source, schema and revision. */
export default defineEventHandler(async (event) => {
  const auth = await routeAuth(toWebRequest(event), factoryAuth);
  if (auth instanceof Response) return sendWebResponse(event, auth);
  setResponseHeader(event, "Cache-Control", "private, no-store");
  const manifest = factoryPolicyManifest();
  if (!manifest.validation.ok) setResponseStatus(event, 503);
  return manifest;
});
