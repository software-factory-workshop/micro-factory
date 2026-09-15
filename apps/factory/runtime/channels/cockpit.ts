import { factorySession } from "../lib/root-agent-client";
import { defineChannel, GET, POST, PUT, DELETE } from 'eve/channels';
import { routeAuth } from 'eve/channels/auth';
import { z } from 'zod';
import { factoryAuth } from '../lib/route-auth';
import { readCockpit,updateCockpit } from '../lib/cockpit-store';
import { collections,idSchema,changeRecord,CockpitConflict } from '../../shared/cockpit';
import { readStationRun,readRunDigest } from '../lib/cockpit-run';
import { factoryRepository, prototypeRepository, factoryRepositoryUrl, prototypeRepositoryUrl, missingCapabilities } from '../lib/factory-config.ts';
const collectionSchema=z.enum(collections);
// Shared records (briefs, feedback, run references) are versioned. Every write
// carries expectedVersion; a stale writer gets 409 and must reload.
const mutation=z.object({value:z.unknown(),expectedVersion:z.number().int().nonnegative()}).strict();
async function authorized(request:Request,work:()=>Promise<unknown>) {
 const auth=await routeAuth(request,factoryAuth);if(auth instanceof Response)return auth;
 try{return Response.json(await work(),{headers:{'cache-control':'no-store'}});}
 catch(error){const status=error instanceof CockpitConflict?409:error instanceof z.ZodError?400:503;return Response.json({error:{code:status===409?'conflict':status===400?'invalid_request':'unavailable',message:status===503?'Cockpit data is unavailable. Retry without discarding your work.':error instanceof Error?error.message:'Invalid request'}},{status});}
}
export default defineChannel({routes:[
 GET('/factory/cockpit',request=>authorized(request,async()=>({version:1,repository:{name:factoryRepository,url:factoryRepositoryUrl},prototype:{name:prototypeRepository,url:prototypeRepositoryUrl},missingCapabilities,capabilities:{collections:'/factory/cockpit/records/:collection',record:'/factory/cockpit/records/:collection/:id',delivery:'/factory/delivery',runResult:'/factory/cockpit/run/:id',runDigest:'/factory/cockpit/run/:id/digest',migrator:'/factory/stations/migrator',qualityGate:'/factory/stations/quality-gate',securityGate:'/factory/stations/security-gate',revision:'/factory/stations/revisions',stream:'/eve/v1/session/:id/stream',cancel:'/eve/v1/session/:id/cancel'}}))),
 POST('/factory/cockpit/records/:collection',(request,{params})=>authorized(request,async()=>{const body=z.object({id:idSchema,value:z.unknown()}).strict().parse(await request.json());return {item:await updateCockpit(doc=>changeRecord(doc,collectionSchema.parse(params.collection),body.id,body.value,0))};})),
 GET('/factory/cockpit/records/:collection',(request,{params})=>authorized(request,async()=>{const collection=collectionSchema.parse(params.collection);return {items:Object.values((await readCockpit()).document[collection]).sort((a,b)=>b.updatedAt.localeCompare(a.updatedAt))};})),
 GET('/factory/cockpit/records/:collection/:id',(request,{params})=>authorized(request,async()=>({item:(await readCockpit()).document[collectionSchema.parse(params.collection)][idSchema.parse(params.id)]??null}))),
 PUT('/factory/cockpit/records/:collection/:id',(request,{params})=>authorized(request,async()=>{const body=mutation.parse(await request.json());return {item:await updateCockpit(doc=>changeRecord(doc,collectionSchema.parse(params.collection),idSchema.parse(params.id),body.value,body.expectedVersion))};})),
 DELETE('/factory/cockpit/records/:collection/:id',(request,{params})=>authorized(request,async()=>{const body=z.object({expectedVersion:z.number().int().positive()}).strict().parse(await request.json());return {item:await updateCockpit(doc=>changeRecord(doc,collectionSchema.parse(params.collection),idSchema.parse(params.id),null,body.expectedVersion))};})),
 GET('/factory/cockpit/run/:id/digest',(request,{params,attachSession})=>authorized(request,async()=>readRunDigest(await factorySession(z.string().regex(/^wrun_[\w-]+$/).parse(params.id),attachSession)))),
 GET('/factory/cockpit/run/:id',(request,{params,attachSession})=>authorized(request,async()=>readStationRun(id=>factorySession(id,attachSession),z.string().regex(/^wrun_[\w-]+$/).parse(params.id),z.object({operationId:z.string().uuid().optional(),deliveryId:z.string().max(200).optional()}).parse(Object.fromEntries(new URL(request.url).searchParams))))),
]});
