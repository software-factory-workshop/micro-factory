import { defineChannel, POST, type RouteHandlerArgs } from "eve/channels";
import { routeAuth } from "eve/channels/auth";
import { factoryAuth } from "../lib/route-auth";
import { getToken } from "@vercel/connect";
import { readPull,verifyOwnerCommit,WorkError } from "../lib/work-github";
import { ownerFromBody,verifyOwnerStream } from "../lib/work-owner";
import { migratorRequest, gateRequest,revisionRequest,stationAddress,stationValues,type Station } from "../lib/station-access";
import { rootRequest,rootSession,recordedRoot } from "../lib/root-agent-client";
import { githubConnectorName } from "../lib/factory-config.ts";
export async function stationOperation(request:Request,{from,params,resolveSession,attachSession}:RouteHandlerArgs,addressPrefix?:string){
  const auth=await routeAuth(request,factoryAuth);
  if(auth instanceof Response) return auth;
  const station=params.station;
  if(station==="revisions") {
   try {
    const revision=revisionRequest.parse(await request.json());
    const token=await getToken(githubConnectorName,{subject:{type:"app"}});
    const pr=await readPull(token,revision.prNumber);
    if(pr.state!=="open")throw new WorkError("invalid_request","Only open pull requests can be revised.");
    const ownerId=ownerFromBody(pr.body||"");const root=await recordedRoot(ownerId);const owner=root?rootSession(root,ownerId):attachSession(ownerId);
    const proof=await verifyOwnerStream(owner,ownerId,pr.number,pr.head.ref);
    await verifyOwnerCommit(token,proof,ownerId);
    const accepted=await owner.send("Apply the authenticated revision from prepare_work. Preserve the original task boundaries; revise your own PR only.",{turnPolicy:"queue",auth:{...auth,attributes:{...auth.attributes,factoryRevision:JSON.stringify(revision),factoryRevisionOperationId:revision.operationId}}});
    if(accepted.status!=="accepted"||!accepted.deliveryId)throw new WorkError("owner_unavailable","Original owner is no longer active; create a child PR instead.");
    return Response.json({sessionId:ownerId,ownerSessionId:ownerId,station:"migrator",execution:"owner",rootAgent:root,operationId:revision.operationId,deliveryId:accepted.deliveryId},{status:202});
   }catch(error){return Response.json({error:{code:error instanceof WorkError?error.code:"invalid_request",message:error instanceof Error?error.message:"Revision unavailable"}},{status:error instanceof WorkError&&error.code==="owner_unavailable"?409:400});}
  }
  if(!(stationValues as readonly string[]).includes(station)) return Response.json({error:"Unknown station"},{status:404});
  const parsed=(station==="migrator"?migratorRequest:gateRequest).safeParse(await request.json().catch(()=>null));
  if(!parsed.success) return Response.json({error:"Invalid station request",issues:parsed.error.issues},{status:400});
  const legacyAddress=stationAddress(auth.principalId,station,parsed.data.operationId,addressPrefix);
  const legacy=await resolveSession(legacyAddress);
  if(legacy)return Response.json({sessionId:legacy.id,station,execution:'dispatcher',operationId:parsed.data.operationId},{status:200});
  return Response.json(await rootRequest(station as Station,'/factory/run',{request:parsed.data,contextKey:addressPrefix}),{status:202});
}
export default defineChannel({routes:[POST("/factory/stations/:station",stationOperation)]});
