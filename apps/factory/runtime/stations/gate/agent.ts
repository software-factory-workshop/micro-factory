import { defineAgent,defineDynamic } from "eve";
import { getVercelOidcToken } from "@vercel/oidc";
import { verifyGatewayScope } from "../../lib/github.mjs";
import { factoryModelIds, factoryModelLimits } from "../../lib/factory-config.ts";
import { requireGate } from "../../lib/station-access.ts";
// One agent definition serves both gates. Which gate a session is comes from
// immutable request auth; the model is chosen per gate so a vendor split later
// is a config change, not a code change.
export default defineAgent({
 description:"Run one authenticated gate station (quality or security). Other station sessions are denied before the model runs. No write or publish tools exist here.",
 defaultTools:false,
 build:{externalDependencies:["@cedar-policy/cedar-wasm"]},
 model:defineDynamic({events:{"session.started":async(_,ctx)=>{
  const gate=requireGate(ctx);
  verifyGatewayScope(await getVercelOidcToken(),process.env.AI_GATEWAY_API_KEY);
  return gate==="security-gate"?factoryModelIds.securityGate:factoryModelIds.qualityGate;
 }}}),
 limits:factoryModelLimits
});
