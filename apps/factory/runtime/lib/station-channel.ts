import { defineChannel,POST } from 'eve/channels';
import { routeAuth } from 'eve/channels/auth';
import { z } from 'zod';
import { factoryAuth } from './route-auth';
import { migratorRequest,gateRequest,revisionRequest,stationAddress,type Station } from './station-access';
import { updateCockpit } from './cockpit-store';
import { changeRecord } from '../../shared/cockpit';
import { reserveStation,bindStation,updateStationRegistry } from './station-registry';
export function stationChannel(station:Station) {
 return defineChannel({routes:[
  POST('/factory/run',async(request,{from,resolveSession})=>{
   const auth=await routeAuth(request,factoryAuth);if(auth instanceof Response)return auth;
   const body=z.object({request:z.unknown(),contextKey:z.string().max(240).optional()}).strict().parse(await request.json());
   const input=(station==='migrator'?migratorRequest:gateRequest).parse(body.request);
   const address=stationAddress(auth.principalId,station,input.operationId,body.contextKey);
   const reservation=await updateStationRegistry(registry=>reserveStation(registry,station,address,input));
   const prior=await resolveSession(address);
   if(!prior&&!reservation.start&&!reservation.sessionId)return Response.json({error:'Station start acceptance is pending. Retry this operation; no replacement session was created.'},{status:409});
   const deliveryId=body.contextKey&&/^[a-f0-9]{64}$/.test(body.contextKey)?body.contextKey:undefined;
   const session=reservation.sessionId?{id:reservation.sessionId}:prior??await from(address).send(`Execute the authenticated ${station} request.`,{auth:{...auth,attributes:{...auth.attributes,factoryStation:station,factoryRequest:JSON.stringify(input),...(deliveryId?{factoryDeliveryId:deliveryId}:{})}}});
   await updateStationRegistry(registry=>bindStation(registry,station,address,session.id));
   await updateCockpit(doc=>{const prior=doc.runs[session.id];return changeRecord(doc,'runs',session.id,{...prior?.value,label:'title'in input?input.title:`Review PR #${input.prNumber}`,station,operationId:input.operationId,execution:'direct',rootAgent:station},prior?.version??0);});
   return Response.json({sessionId:session.id,station,execution:'direct',rootAgent:station,operationId:input.operationId},{status:prior?200:202});
  }),
  POST('/factory/session/:id/continue',async(request,{attachSession,params})=>{
   const auth=await routeAuth(request,factoryAuth);if(auth instanceof Response)return auth;
   const input=z.object({message:z.string().min(1).max(20000),revision:z.string().optional()}).strict().parse(await request.json());
   const revision=input.revision?revisionRequest.parse(JSON.parse(input.revision)):undefined;
   if(revision&&station!=='migrator')return Response.json({error:'Only migrator sessions accept revisions'},{status:400});
   const result=await attachSession(params.id).send(input.message,{turnPolicy:'queue',auth:{...auth,attributes:{...auth.attributes,...(revision?{factoryRevision:JSON.stringify(revision),factoryRevisionOperationId:revision.operationId}:{})}}});
   return Response.json(result);
  }),
 ]});
}
